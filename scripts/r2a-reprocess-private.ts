import { dirname, join } from "node:path";

import BetterSqlite3 from "better-sqlite3";

import { JobImportRepository } from "@applypilot/database";

import { createDatabaseBackup } from "./lib/database-maintenance";
import {
  R2A_PRIVATE_CONFIRMATION,
  assertPrivateDatabaseGitIsolation,
  assertPrivateR2ADatabasePreflight,
  assertR2APrivateConfirmation,
} from "./lib/r2a-private-safety";
import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";

async function main(): Promise<void> {
  assertR2APrivateConfirmation(process.argv.slice(2));
  const root = repositoryRoot();
  const databasePath = localDatabasePath();
  assertPrivateDatabaseGitIsolation(databasePath, root);
  const sqlite = new BetterSqlite3(databasePath, { fileMustExist: true });
  sqlite.pragma("foreign_keys = ON");
  try {
    const jobId = assertPrivateR2ADatabasePreflight(sqlite);
    const backup = await createDatabaseBackup({
      databasePath,
      backupRoot: join(dirname(databasePath), "private", "backups"),
    });
    const before = {
      observations: Number(
        sqlite.prepare("SELECT count(*) FROM source_observations").pluck().get(),
      ),
      versions: Number(sqlite.prepare("SELECT count(*) FROM job_versions").pluck().get()),
      evaluations: Number(sqlite.prepare("SELECT count(*) FROM evaluation_versions").pluck().get()),
      documents: Number(sqlite.prepare("SELECT count(*) FROM document_artifacts").pluck().get()),
      packets: Number(sqlite.prepare("SELECT count(*) FROM application_packets").pluck().get()),
    };
    const result = await new JobImportRepository(sqlite).reprocessLegacyJobR2A(jobId);
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
      after.versions !== before.versions + (result.created ? 1 : 0) ||
      after.evaluations !== before.evaluations ||
      after.documents !== before.documents ||
      after.packets !== before.packets
    ) {
      throw new Error("R2A_HISTORY_PRESERVATION_FAILED");
    }
    const currentVersion = sqlite
      .prepare("SELECT id FROM job_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1")
      .pluck()
      .get(jobId);
    if (currentVersion !== result.jobVersionId || result.coverageCount !== 17) {
      throw new Error("R2A_CURRENT_VERSION_VERIFICATION_FAILED");
    }
    const currentOldEvaluations = Number(
      sqlite
        .prepare(
          "SELECT count(*) FROM evaluation_versions WHERE job_id = ? AND job_version_id <> ? AND stale = 0",
        )
        .pluck()
        .get(jobId, result.jobVersionId),
    );
    const currentOldDocuments = Number(
      sqlite
        .prepare(
          "SELECT count(*) FROM document_artifacts WHERE job_id = ? AND job_version_id <> ? AND stale = 0",
        )
        .pluck()
        .get(jobId, result.jobVersionId),
    );
    const currentOldPackets = Number(
      sqlite
        .prepare(
          "SELECT count(*) FROM application_packets WHERE job_id = ? AND job_version_id <> ? AND status <> 'INVALIDATED'",
        )
        .pluck()
        .get(jobId, result.jobVersionId),
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
      `R2A_PRIVATE_REPROCESS_COMPLETE backup=${backup.backupId} confirmed=${R2A_PRIVATE_CONFIRMATION} created=${result.created ? "YES" : "NO"} versions_before=${before.versions} versions_after=${after.versions} field_evidence=${result.fieldEvidenceCount} requirement_evidence=${result.requirementEvidenceCount} coverage=${result.coverageCount} conflicts=${result.conflictCount} unknown_coverage=${result.unknownCoverageCount} stale_evaluations=${result.staleEvaluations} stale_documents=${result.staleDocuments} invalidated_packets=${result.invalidatedPackets} real_source_calls=0 real_application_actions=0`,
    );
  } finally {
    sqlite.close();
  }
}

void main();
