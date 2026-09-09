import BetterSqlite3 from "better-sqlite3";

import { JobImportRepository } from "@applypilot/database";

import { localDatabasePath } from "./lib/runtime-safety";

async function main(): Promise<void> {
  const databasePath = localDatabasePath();
  const sqlite = new BetterSqlite3(databasePath, { fileMustExist: true });
  sqlite.pragma("foreign_keys = ON");
  try {
    if (Number(sqlite.pragma("user_version", { simple: true })) !== 3) {
      throw new Error("R2A_SCHEMA_V3_REQUIRED");
    }
    if (sqlite.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new Error("DATABASE_INTEGRITY_FAILED");
    }
    if ((sqlite.pragma("foreign_key_check") as unknown[]).length > 0) {
      throw new Error("DATABASE_FOREIGN_KEY_FAILED");
    }
    const jobIds = sqlite.prepare("SELECT id FROM jobs ORDER BY id").pluck().all() as string[];
    if (jobIds.length !== 1) throw new Error("PRIVATE_R2A_REPROCESS_REQUIRES_ONE_STORED_JOB");
    const before = {
      observations: Number(
        sqlite.prepare("SELECT count(*) FROM source_observations").pluck().get(),
      ),
      versions: Number(sqlite.prepare("SELECT count(*) FROM job_versions").pluck().get()),
      evaluations: Number(sqlite.prepare("SELECT count(*) FROM evaluation_versions").pluck().get()),
      documents: Number(sqlite.prepare("SELECT count(*) FROM document_artifacts").pluck().get()),
      packets: Number(sqlite.prepare("SELECT count(*) FROM application_packets").pluck().get()),
    };
    const result = await new JobImportRepository(sqlite).reprocessLegacyJobR2A(jobIds[0]!);
    const after = {
      observations: Number(
        sqlite.prepare("SELECT count(*) FROM source_observations").pluck().get(),
      ),
      versions: Number(sqlite.prepare("SELECT count(*) FROM job_versions").pluck().get()),
      evaluations: Number(sqlite.prepare("SELECT count(*) FROM evaluation_versions").pluck().get()),
      documents: Number(sqlite.prepare("SELECT count(*) FROM document_artifacts").pluck().get()),
      packets: Number(sqlite.prepare("SELECT count(*) FROM application_packets").pluck().get()),
    };
    if (
      after.observations !== before.observations ||
      after.versions !== before.versions + 1 ||
      after.evaluations !== before.evaluations ||
      after.documents !== before.documents ||
      after.packets !== before.packets
    ) {
      throw new Error("R2A_HISTORY_PRESERVATION_FAILED");
    }
    const currentVersion = sqlite
      .prepare("SELECT id FROM job_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1")
      .pluck()
      .get(jobIds[0]);
    if (currentVersion !== result.jobVersionId || result.coverageCount !== 17) {
      throw new Error("R2A_CURRENT_VERSION_VERIFICATION_FAILED");
    }
    const currentOldEvaluations = Number(
      sqlite
        .prepare(
          "SELECT count(*) FROM evaluation_versions WHERE job_id = ? AND job_version_id <> ? AND stale = 0",
        )
        .pluck()
        .get(jobIds[0], result.jobVersionId),
    );
    const currentOldDocuments = Number(
      sqlite
        .prepare(
          "SELECT count(*) FROM document_artifacts WHERE job_id = ? AND job_version_id <> ? AND stale = 0",
        )
        .pluck()
        .get(jobIds[0], result.jobVersionId),
    );
    const currentOldPackets = Number(
      sqlite
        .prepare(
          "SELECT count(*) FROM application_packets WHERE job_id = ? AND job_version_id <> ? AND status <> 'INVALIDATED'",
        )
        .pluck()
        .get(jobIds[0], result.jobVersionId),
    );
    if (currentOldEvaluations || currentOldDocuments || currentOldPackets) {
      throw new Error("R2A_DOWNSTREAM_STALENESS_FAILED");
    }
    if (
      sqlite.pragma("integrity_check", { simple: true }) !== "ok" ||
      (sqlite.pragma("foreign_key_check") as unknown[]).length > 0
    ) {
      throw new Error("R2A_POST_REPROCESS_DATABASE_FAILED");
    }
    console.log(
      `R2A_PRIVATE_REPROCESS_COMPLETE versions_before=${before.versions} versions_after=${after.versions} field_evidence=${result.fieldEvidenceCount} requirement_evidence=${result.requirementEvidenceCount} coverage=${result.coverageCount} conflicts=${result.conflictCount} unknown_coverage=${result.unknownCoverageCount} stale_evaluations=${result.staleEvaluations} stale_documents=${result.staleDocuments} invalidated_packets=${result.invalidatedPackets} real_source_calls=0 real_application_actions=0`,
    );
  } finally {
    sqlite.close();
  }
}

void main();
