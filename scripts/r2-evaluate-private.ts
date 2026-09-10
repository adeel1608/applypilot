import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import BetterSqlite3 from "better-sqlite3";

import { R2ARepository, R2Repository } from "@applypilot/database";
import { CandidateProfileSchema, candidateProfileContentHash } from "@applypilot/candidate-profile";
import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import {
  R2_FIT_SCORER_VERSION,
  R2_FIT_WEIGHT_VERSION,
  R2_GOLDEN_CORPUS_VERSION,
  createR2CalibrationContext,
  evaluateR2GoldenRanking,
  executeR2GoldenCorpus,
  r2OrdinalBand,
  scoreR2JobFit,
  type R2CalibrationGateInput,
} from "@applypilot/fit-scorer";
import { JobSchema } from "@applypilot/job-model";
import { createDatabaseBackup } from "./lib/database-maintenance";
import { CURRENT_DATABASE_SCHEMA_VERSION } from "./lib/database-schema";
import { assertPrivateDatabaseGitIsolation } from "./lib/r2a-private-safety";
import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";

export const R2_PRIVATE_EVALUATION_CONFIRMATION = "EVALUATE_R2_PRIVATE_CURRENT_JOB";

export function assertR2PrivateEvaluationConfirmation(args: readonly string[]): void {
  if (!args.includes(`--confirm=${R2_PRIVATE_EVALUATION_CONFIRMATION}`)) {
    throw new Error(`R2_PRIVATE_CONFIRMATION_REQUIRED:${R2_PRIVATE_EVALUATION_CONFIRMATION}`);
  }
}

function requireIgnoredUntracked(path: string, root: string): void {
  assertPrivateDatabaseGitIsolation(path, root);
}

function ensureCurrentProfileVersion(
  sqlite: BetterSqlite3.Database,
  profile: ReturnType<typeof CandidateProfileSchema.parse>,
  now: string,
): string {
  const hash = candidateProfileContentHash(profile);
  const existing = sqlite
    .prepare(
      `SELECT id FROM candidate_profile_versions
       WHERE profile_id = ? AND content_hash = ? ORDER BY version DESC LIMIT 1`,
    )
    .pluck()
    .get(profile.profileId, hash) as string | undefined;
  sqlite
    .prepare(
      `INSERT INTO candidate_profiles (id,active_version_id,created_at,updated_at)
       VALUES (?,NULL,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at`,
    )
    .run(profile.profileId, now, now);
  const id = existing ?? randomUUID();
  if (!existing) {
    const version = Number(
      sqlite
        .prepare(
          `SELECT COALESCE(max(version),0) + 1 FROM candidate_profile_versions
           WHERE profile_id = ?`,
        )
        .pluck()
        .get(profile.profileId),
    );
    sqlite
      .prepare(
        `INSERT INTO candidate_profile_versions
          (id,profile_id,version,schema_version,snapshot_json,content_hash,created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        profile.profileId,
        version,
        profile.schemaVersion,
        JSON.stringify(profile),
        hash,
        now,
      );
  }
  sqlite
    .prepare("UPDATE candidate_profiles SET active_version_id = ?, updated_at = ? WHERE id = ?")
    .run(id, now, profile.profileId);
  return id;
}

async function main(): Promise<void> {
  assertR2PrivateEvaluationConfirmation(process.argv.slice(2));
  const root = repositoryRoot();
  const databasePath = localDatabasePath();
  const profilePath = join(root, "data", "profile.private.json");
  requireIgnoredUntracked(databasePath, root);
  requireIgnoredUntracked(profilePath, root);
  const profile = CandidateProfileSchema.parse(JSON.parse(readFileSync(profilePath, "utf8")));
  const preview = new BetterSqlite3(databasePath, { readonly: true, fileMustExist: true });
  try {
    if (
      Number(preview.pragma("user_version", { simple: true })) !== CURRENT_DATABASE_SCHEMA_VERSION
    ) {
      throw new Error("R2_CURRENT_SCHEMA_REQUIRED");
    }
    if (preview.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new Error("DATABASE_INTEGRITY_FAILED");
    }
    if ((preview.pragma("foreign_key_check") as unknown[]).length > 0) {
      throw new Error("DATABASE_FOREIGN_KEY_FAILED");
    }
  } finally {
    preview.close();
  }
  const backup = await createDatabaseBackup({
    databasePath,
    backupRoot: join(dirname(databasePath), "private", "backups"),
  });
  const sqlite = new BetterSqlite3(databasePath, { fileMustExist: true });
  sqlite.pragma("foreign_keys = ON");
  try {
    if (
      Number(sqlite.pragma("user_version", { simple: true })) !== CURRENT_DATABASE_SCHEMA_VERSION
    ) {
      throw new Error("R2_CURRENT_SCHEMA_REQUIRED");
    }
    if (sqlite.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new Error("DATABASE_INTEGRITY_FAILED");
    }
    if ((sqlite.pragma("foreign_key_check") as unknown[]).length > 0) {
      throw new Error("DATABASE_FOREIGN_KEY_FAILED");
    }
    const jobs = sqlite
      .prepare("SELECT id, normalized_json AS normalizedJson FROM jobs ORDER BY id")
      .all() as Array<{ id: string; normalizedJson: string }>;
    if (jobs.length !== 1) throw new Error("R2_PRIVATE_EVALUATION_REQUIRES_ONE_STORED_JOB");
    const job = JobSchema.parse(JSON.parse(jobs[0]!.normalizedJson));
    const jobVersionId = sqlite
      .prepare("SELECT id FROM job_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1")
      .pluck()
      .get(job.id) as string | undefined;
    if (!jobVersionId) throw new Error("R2_CURRENT_JOB_VERSION_REQUIRED");
    const read = new R2ARepository(sqlite).getNormalizationResult(jobVersionId);
    if (read.state !== "AVAILABLE") throw new Error(`R2_CURRENT_NORMALIZATION_${read.state}`);
    const before = {
      legacyEvaluations: Number(
        sqlite.prepare("SELECT count(*) FROM evaluation_versions").pluck().get(),
      ),
      r2Evaluations: Number(
        sqlite.prepare("SELECT count(*) FROM r2_evaluation_versions").pluck().get(),
      ),
      documents: Number(sqlite.prepare("SELECT count(*) FROM document_artifacts").pluck().get()),
      packets: Number(sqlite.prepare("SELECT count(*) FROM application_packets").pluck().get()),
    };
    const now = new Date().toISOString();
    const evaluationId = randomUUID();
    const profileVersionId = ensureCurrentProfileVersion(sqlite, profile, now);
    const eligibility = evaluateR2Eligibility({
      profile,
      normalization: read.normalization,
      bindings: {
        jobVersionId,
        currentJobVersionId: jobVersionId,
        profileVersionId,
        currentProfileVersionId: profileVersionId,
        evidenceContractVersion: read.normalization.evidenceContractVersion,
        currentEvidenceContractVersion: read.normalization.evidenceContractVersion,
        evaluationVersionId: evaluationId,
      },
      evaluatedAt: now,
    });
    const labelRows = sqlite
      .prepare(
        `SELECT l.id, j.category AS roleFamily, l.label AS ownerLabel,
                e.eligibility_status AS eligibility, e.fit_score AS score, e.recommended
         FROM calibration_labels l
         JOIN jobs j ON j.id = l.job_id
         LEFT JOIN r2_evaluation_versions e ON e.id = (
           SELECT id FROM r2_evaluation_versions
           WHERE job_id = l.job_id AND stale = 0
           ORDER BY evaluated_at DESC, rowid DESC LIMIT 1)
         ORDER BY l.id`,
      )
      .all() as Array<{
      id: string;
      roleFamily: string;
      ownerLabel: "GOOD_MATCH" | "POOR_MATCH" | "AMBIGUOUS";
      eligibility: "ELIGIBLE" | "REVIEW_REQUIRED" | "INELIGIBLE" | null;
      score: number | null;
      recommended: number | null;
    }>;
    const pairRows = sqlite
      .prepare(
        `SELECT p.id, preferred.fit_score AS preferredScore, other.fit_score AS otherScore
         FROM calibration_pairs p
         LEFT JOIN r2_evaluation_versions preferred ON preferred.id = (
           SELECT id FROM r2_evaluation_versions
           WHERE job_id = p.preferred_job_id AND stale = 0
           ORDER BY evaluated_at DESC, rowid DESC LIMIT 1)
         LEFT JOIN r2_evaluation_versions other ON other.id = (
           SELECT id FROM r2_evaluation_versions
           WHERE job_id = p.other_job_id AND stale = 0
           ORDER BY evaluated_at DESC, rowid DESC LIMIT 1)
         ORDER BY p.id`,
      )
      .all() as Array<{ id: string; preferredScore: number | null; otherScore: number | null }>;
    const calibrationGate: R2CalibrationGateInput = {
      sourceLabelCount: labelRows.length,
      sourcePairCount: pairRows.length,
      labels: labelRows.map(({ score, recommended, ...label }) => ({
        ...label,
        ordinalBand:
          label.eligibility === null || score === null
            ? null
            : r2OrdinalBand(label.eligibility, score),
        recommended: recommended === null ? null : Boolean(recommended),
      })),
      pairs: pairRows,
      performanceThresholds: null,
      safetyGates: null,
      ownerApproval: null,
    };
    const goldenExecutions = executeR2GoldenCorpus();
    const metrics = evaluateR2GoldenRanking(
      goldenExecutions.map(({ fixture, eligibility: result, fit: scored }) => ({
        id: fixture.id,
        roleFamily: fixture.roleFamily,
        eligibility: result.status,
        score: scored.score,
        expectedBand: fixture.expectedBand,
      })),
      calibrationGate,
    );
    const repository = new R2Repository(sqlite, () => new Date(now));
    const calibrationRunId = repository.recordCalibrationRun({
      metrics,
      gate: calibrationGate,
      evidenceVersion: "r2-private-calibration-evidence-1",
      privateEvidenceDigest: createHash("sha256")
        .update(JSON.stringify({ labels: calibrationGate.labels, pairs: calibrationGate.pairs }))
        .digest("hex"),
      scorerVersion: R2_FIT_SCORER_VERSION,
      weightVersion: R2_FIT_WEIGHT_VERSION,
      corpusVersion: R2_GOLDEN_CORPUS_VERSION,
    });
    const calibrationContext = createR2CalibrationContext({
      version: `r2-calibration-context-1:${calibrationRunId}`,
      scorerVersion: R2_FIT_SCORER_VERSION,
      weightVersion: R2_FIT_WEIGHT_VERSION,
      corpusVersion: R2_GOLDEN_CORPUS_VERSION,
      runId: calibrationRunId,
      gate: calibrationGate,
    });
    const fit = scoreR2JobFit({
      profile,
      normalization: read.normalization,
      eligibility,
      calibrationContext,
    });
    const recorded = repository.recordEvaluation({
      id: evaluationId,
      jobId: job.id,
      jobVersionId,
      profileVersionId,
      normalization: read.normalization,
      eligibility,
      fit,
    });
    const after = {
      legacyEvaluations: Number(
        sqlite.prepare("SELECT count(*) FROM evaluation_versions").pluck().get(),
      ),
      r2Evaluations: Number(
        sqlite.prepare("SELECT count(*) FROM r2_evaluation_versions").pluck().get(),
      ),
      staleDocuments: Number(
        sqlite.prepare("SELECT count(*) FROM document_artifacts WHERE stale = 1").pluck().get(),
      ),
      invalidatedPackets: Number(
        sqlite
          .prepare("SELECT count(*) FROM application_packets WHERE status = 'INVALIDATED'")
          .pluck()
          .get(),
      ),
    };
    if (
      after.legacyEvaluations !== before.legacyEvaluations ||
      after.r2Evaluations !== before.r2Evaluations + (recorded.created ? 1 : 0) ||
      after.staleDocuments < before.documents ||
      after.invalidatedPackets < before.packets
    ) {
      throw new Error("R2_PRIVATE_HISTORY_OR_STALENESS_VERIFICATION_FAILED");
    }
    if (
      sqlite.pragma("integrity_check", { simple: true }) !== "ok" ||
      (sqlite.pragma("foreign_key_check") as unknown[]).length > 0
    ) {
      throw new Error("R2_PRIVATE_POST_EVALUATION_DATABASE_FAILED");
    }
    const safeSummary = [
      `backup=${backup.backupId}`,
      `created=${recorded.created ? "YES" : "NO"}`,
      `eligibility=${eligibility.status}`,
      `recommended=${fit.recommended ? "YES" : "NO"}`,
      `coverage=${eligibility.coveragePercent}`,
      `unknowns=${eligibility.unresolvedMaterialUnknowns}`,
      `conditions=${eligibility.unresolvedMaterialConditions}`,
      `conflicts=${eligibility.unresolvedMaterialConflicts}`,
      `fit_band=${r2OrdinalBand(eligibility.status, fit.score)}`,
      `calibration=${metrics.calibrationState}`,
      `private_reviewed=${calibrationGate.sourceLabelCount}`,
      `role_families=${new Set(calibrationGate.labels.map(({ roleFamily }) => roleFamily)).size}`,
      `statuses=${new Set(calibrationGate.labels.map(({ eligibility: state }) => state).filter(Boolean)).size}`,
      `historical_legacy_evaluations=${after.legacyEvaluations}`,
      `historical_r2_evaluations=${after.r2Evaluations}`,
      `stale_documents=${after.staleDocuments}`,
      `invalidated_packets=${after.invalidatedPackets}`,
      "integrity=PASS",
      "foreign_key_issues=0",
      "real_source_calls=0",
      "real_application_actions=0",
    ].join(" ");
    console.log(`R2_PRIVATE_EVALUATION_COMPLETE ${safeSummary}`);
  } finally {
    sqlite.close();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/r2-evaluate-private.ts")) {
  void main();
}
