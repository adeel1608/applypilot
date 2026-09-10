import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ApplicationPacketSchema,
  deriveDuplicatePacketState,
  deriveJobExpiryState,
  type ApplicationPacket,
} from "@applypilot/application-runner";
import type { CandidateProfile } from "@applypilot/candidate-profile";
import {
  coverLetterFileName,
  coverLetterRequirementStatus,
  generateBasicCoverLetter,
  renderCoverLetterDocx,
  renderCoverLetterPdf,
  type CoverLetterTone,
} from "@applypilot/cover-letter-engine";
import { evaluateR2Eligibility, type R2EligibilityReason } from "@applypilot/eligibility-engine";
import {
  R2_UNREVIEWED_CALIBRATION_CONTEXT,
  scoreR2JobFit,
  type R2FitContribution,
} from "@applypilot/fit-scorer";
import { normalizeAustralianLocation } from "@applypilot/job-importer";
import {
  R2ARepository,
  R2Repository,
  assertCurrentDocumentGenerationTuple,
} from "@applypilot/database";
import { legacyStatusToBeta } from "@applypilot/application-tracker";
import {
  ApplicationStatusSchema,
  BetaApplicationStatusSchema,
  EvaluationCoverageSchema,
  JobSchema,
  type BetaApplicationStatus,
  type EvaluationCoverage,
  type Job,
} from "@applypilot/job-model";
import {
  generateResumeDocument,
  preparePrivateOutputTarget,
  renderResumeDocx,
  renderResumePdf,
  resumeFileName,
  resumeTemplateCategories,
  resumeTemplateDesigns,
  selectResumeTemplate,
  type ResumeTemplateCategory,
} from "@applypilot/resume-engine";
import { candidateProfileProvider } from "@web/lib/candidate-profile-provider";
import {
  ManualApplicationOutcomes,
  manualApplicationOutcomesForStatus,
  type ManualApplicationOutcome,
} from "@web/lib/application-outcomes";
import {
  getBetaRepository,
  getJobImportRepository,
  getLocalDatabase,
  getR2Repository,
  hasBetaSchema,
} from "@web/lib/local-database";
import { resolveLocalDataDirectory } from "@web/lib/local-data-directory";

interface JobListRow {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  dateDiscovered: string;
  employmentType: string;
  category: string;
  state: string | null;
  expiresAt: string | null;
  unknownRequirementCount: number;
  jobVersionId: string | null;
  evaluationVersionId: string | null;
  legacyEvaluationVersionId: string | null;
  eligibilityStatus: string | null;
  fitScore: number | null;
  coverageJson: string | null;
  evaluationStale: number | null;
  queueState: string | null;
  queueReason: string | null;
  coveragePercent: number | null;
  unresolvedConditionCount: number | null;
  unresolvedConflictCount: number | null;
  calibrationState: string | null;
  recommended: number | null;
  queueFreshness: string | null;
  duplicateState: string | null;
}

export interface BetaJobListItem {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  dateDiscovered: string;
  employmentType: string;
  category: string;
  state: string | null;
  expiresAt: string | null;
  unknownRequirementCount: number;
  jobVersionId: string | null;
  evaluationVersionId: string | null;
  legacyEvaluationVersionId: string | null;
  eligibilityStatus: "ELIGIBLE" | "INELIGIBLE" | "REVIEW_REQUIRED" | null;
  fitScore: number | null;
  coverage: EvaluationCoverage | null;
  evaluationStale: boolean;
  queueState: "REVIEWING" | "SHORTLISTED" | "SKIPPED" | "PREPARING" | null;
  queueReason: string | null;
  coveragePercent: number | null;
  unresolvedConditionCount: number;
  unresolvedConflictCount: number;
  calibrationState: "UNCALIBRATED" | "CALIBRATION_PENDING" | "CALIBRATED" | null;
  recommended: boolean;
  queueFreshness: "CURRENT" | "STALE" | null;
  duplicateState: string | null;
}

export interface BetaDocumentItem {
  id: string;
  type: "CV" | "COVER_LETTER";
  format: "PDF" | "DOCX";
  fileName: string;
  template: string;
  contentDigest: string;
  version: number;
  stale: boolean;
  approved: boolean;
  status: "DRAFT" | "REVIEW_REQUIRED" | "APPROVED" | "SUPERSEDED" | "INVALIDATED";
  claimEvidenceCount: number;
  rendererVersion: string | null;
  claimRuleVersion: string | null;
  createdAt: string;
}

export interface BetaJobDetail {
  job: Job;
  jobVersionId: string | null;
  sourceObservationId: string | null;
  evaluationVersionId: string | null;
  legacyEvaluationVersionId: string | null;
  eligibilityStatus: BetaJobListItem["eligibilityStatus"];
  eligibilityReasons: Array<
    | R2EligibilityReason
    | { code: string; severity: string; message: string; evidenceClass?: string }
  >;
  fitScore: number | null;
  fitContributions: Array<
    R2FitContribution | { category: string; points: number; explanation: string; code?: string }
  >;
  coverage: EvaluationCoverage | null;
  evaluationStale: boolean;
  queueState: BetaJobListItem["queueState"];
  queueReason: string | null;
  duplicateState: string | null;
  coveragePercent: number | null;
  unresolvedUnknownCount: number;
  unresolvedConditionCount: number;
  unresolvedConflictCount: number;
  calibrationState: BetaJobListItem["calibrationState"];
  recommended: boolean;
  queueFreshness: BetaJobListItem["queueFreshness"];
  duplicateCandidates: Array<{
    id: string;
    state: string;
    leftObservationId: string;
    rightObservationId: string;
    matchedSignals: string[];
    conflictingSignals: string[];
    decisionReason: string | null;
  }>;
  corrections: Array<{
    id: string;
    actor: string;
    reasonCode: string;
    changedFields: string[];
    createdAt: string;
  }>;
  recommendedTemplate: ResumeTemplateCategory;
  templateStrategy: string;
  templateEvidencePriorities: string[];
  requirements: Array<{
    kind: string;
    modality: string;
    certainty: string;
    originalText: string;
    normalizedProposition: string;
  }>;
  jobVersions: Array<{
    id: string;
    version: number;
    createdAt: string;
    r2aCoverageCount: number;
    r2aState: "AVAILABLE" | "LEGACY_NOT_AVAILABLE";
  }>;
  r2aState: "AVAILABLE" | "LEGACY_NOT_AVAILABLE" | "INVALID";
  r2a: null | {
    parserVersion: string;
    evidenceContractVersion: string;
    normalizationVersion: string;
    fields: Array<{
      id: string;
      family: string;
      canonicalField: string;
      state: string;
      modality: string | null;
      excerpt: string;
      start: number;
      end: number;
      normalizedKind: string;
    }>;
    requirements: Array<{
      id: string;
      family: string;
      canonicalKind: string;
      state: string;
      modality: string;
      excerpt: string;
      start: number;
      end: number;
      normalizedKind: string;
    }>;
    coverage: Array<{
      family: string;
      state: string;
      evidenceCount: number;
      unparsedSpanCount: number;
    }>;
    conflicts: Array<{ id: string; canonicalField: string; evidenceCount: number }>;
  };
  documents: BetaDocumentItem[];
  packet: null | {
    id: string;
    version: number;
    status: string;
    blockers: string[];
    warnings: string[];
    createdAt: string;
  };
}

export interface BetaResumeEvidencePreview {
  state:
    | "READY"
    | "PRIVATE_PROFILE_REQUIRED"
    | "PROFILE_VERSION_STALE_REEVALUATE_REQUIRED"
    | "EVALUATION_STALE_REEVALUATE_REQUIRED";
  template: ResumeTemplateCategory;
  claims: Array<{ text: string; factReferences: string[] }>;
}

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function betaSqlite() {
  const local = getLocalDatabase();
  return local && hasBetaSchema(local.sqlite) ? local.sqlite : null;
}

export function listBetaJobs(): BetaJobListItem[] {
  const sqlite = betaSqlite();
  if (!sqlite) return [];
  const hasR2 = new R2Repository(sqlite).available();
  const rows = sqlite
    .prepare(
      hasR2
        ? `SELECT j.id, j.title, j.company, j.location, j.category,
         j.employment_type AS employmentType,
         json_extract(j.normalized_json, '$.source') AS source,
         json_extract(j.normalized_json, '$.state') AS state,
         j.date_discovered AS dateDiscovered,
         v.id AS jobVersionId, e.id AS evaluationVersionId,
         (SELECT id FROM evaluation_versions WHERE job_id = j.id ORDER BY evaluated_at DESC, rowid DESC LIMIT 1)
           AS legacyEvaluationVersionId,
         e.eligibility_status AS eligibilityStatus, e.fit_score AS fitScore,
         NULL AS coverageJson, e.stale AS evaluationStale,
         q.state AS queueState, q.reason_code AS queueReason,
         e.coverage_percent AS coveragePercent,
         e.unresolved_unknown_count AS unknownRequirementCount,
         e.unresolved_condition_count AS unresolvedConditionCount,
         e.unresolved_conflict_count AS unresolvedConflictCount,
         e.calibration_state AS calibrationState, e.recommended,
         q.freshness AS queueFreshness,
         (SELECT c.state FROM r2_duplicate_candidates c
            WHERE c.left_observation_id IN (SELECT id FROM source_observations WHERE job_id = j.id)
               OR c.right_observation_id IN (SELECT id FROM source_observations WHERE job_id = j.id)
            ORDER BY CASE c.state WHEN 'SUGGESTED' THEN 0 ELSE 1 END, c.updated_at DESC LIMIT 1)
           AS duplicateState,
         (SELECT o.expires_at FROM source_observations o
            WHERE o.job_id = j.id ORDER BY o.observed_at DESC, o.rowid DESC LIMIT 1) AS expiresAt
       FROM jobs j
       LEFT JOIN job_versions v ON v.id = (
         SELECT id FROM job_versions WHERE job_id = j.id ORDER BY version DESC LIMIT 1)
       LEFT JOIN r2_evaluation_versions e ON e.id = (
         SELECT id FROM r2_evaluation_versions WHERE job_id = j.id ORDER BY evaluated_at DESC, rowid DESC LIMIT 1)
       LEFT JOIN r2_queue_decision_versions q ON q.id = (
         SELECT id FROM r2_queue_decision_versions WHERE job_id = j.id ORDER BY version DESC LIMIT 1)
       ORDER BY CASE q.state WHEN 'SHORTLISTED' THEN 0 WHEN 'PREPARING' THEN 1
         WHEN 'REVIEWING' THEN 2 WHEN 'SKIPPED' THEN 4 ELSE 3 END,
         e.fit_score DESC, j.date_discovered DESC`
        : `SELECT j.id, j.title, j.company, j.location, j.category,
         j.employment_type AS employmentType,
         json_extract(j.normalized_json, '$.source') AS source,
         json_extract(j.normalized_json, '$.state') AS state,
         j.date_discovered AS dateDiscovered,
         v.id AS jobVersionId, e.id AS evaluationVersionId,
         e.id AS legacyEvaluationVersionId,
         e.eligibility_status AS eligibilityStatus, e.fit_score AS fitScore,
         e.coverage_json AS coverageJson, e.stale AS evaluationStale,
         q.state AS queueState, q.reason_code AS queueReason,
         NULL AS coveragePercent, NULL AS unresolvedConditionCount,
         NULL AS unresolvedConflictCount, NULL AS calibrationState,
         NULL AS recommended, NULL AS queueFreshness, NULL AS duplicateState,
         (SELECT o.expires_at FROM source_observations o
            WHERE o.job_id = j.id ORDER BY o.observed_at DESC, o.rowid DESC LIMIT 1) AS expiresAt,
         (SELECT count(*) FROM requirement_evidence r
            WHERE r.job_version_id = v.id AND
              (r.modality = 'UNKNOWN' OR r.certainty <> 'HIGH')) AS unknownRequirementCount
       FROM jobs j
       LEFT JOIN job_versions v ON v.id = (
         SELECT id FROM job_versions WHERE job_id = j.id ORDER BY version DESC LIMIT 1)
       LEFT JOIN evaluation_versions e ON e.id = (
         SELECT id FROM evaluation_versions WHERE job_id = j.id ORDER BY evaluated_at DESC, rowid DESC LIMIT 1)
       LEFT JOIN job_queue_entries q ON q.job_id = j.id
       ORDER BY CASE q.state WHEN 'SHORTLISTED' THEN 0 WHEN 'PREPARING' THEN 1
         WHEN 'REVIEWING' THEN 2 WHEN 'SKIPPED' THEN 4 ELSE 3 END,
         e.fit_score DESC, j.date_discovered DESC`,
    )
    .all() as JobListRow[];
  return rows.map((row) => ({
    ...row,
    eligibilityStatus: row.eligibilityStatus as BetaJobListItem["eligibilityStatus"],
    coverage: row.coverageJson
      ? EvaluationCoverageSchema.parse(parseJson(row.coverageJson, {}))
      : null,
    coveragePercent:
      row.coveragePercent ??
      (row.coverageJson
        ? EvaluationCoverageSchema.parse(parseJson(row.coverageJson, {})).percent
        : null),
    evaluationStale: Boolean(row.evaluationStale),
    queueState: row.queueState as BetaJobListItem["queueState"],
    unresolvedConditionCount: row.unresolvedConditionCount ?? 0,
    unresolvedConflictCount: row.unresolvedConflictCount ?? 0,
    calibrationState: row.calibrationState as BetaJobListItem["calibrationState"],
    recommended: Boolean(row.recommended),
    queueFreshness: row.queueFreshness as BetaJobListItem["queueFreshness"],
  }));
}

function listDocuments(sqlite: NonNullable<ReturnType<typeof betaSqlite>>, jobId: string) {
  const rows = sqlite
    .prepare(
      `SELECT d.id, d.type, d.format, d.file_name AS fileName, d.template,
         d.content_digest AS contentDigest, d.claim_evidence_json AS claimEvidenceJson,
         d.layout_result_json AS layoutResultJson, d.version, d.stale, d.created_at AS createdAt,
         EXISTS(SELECT 1 FROM document_approvals a WHERE a.document_artifact_id = d.id
           AND a.content_digest = d.content_digest AND a.invalidated_at IS NULL) AS approved
       FROM document_artifacts d WHERE d.job_id = ? ORDER BY d.created_at DESC, d.format`,
    )
    .all(jobId) as Array<{
    id: string;
    type: BetaDocumentItem["type"];
    format: BetaDocumentItem["format"];
    fileName: string;
    template: string;
    contentDigest: string;
    version: number;
    stale: number;
    approved: number;
    claimEvidenceJson: string;
    layoutResultJson: string;
    createdAt: string;
  }>;
  const latestByTypeFormat = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.type}:${row.format}`;
    latestByTypeFormat.set(key, Math.max(latestByTypeFormat.get(key) ?? 0, row.version));
  }
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    format: row.format,
    fileName: row.fileName,
    template: row.template,
    contentDigest: row.contentDigest,
    version: row.version,
    stale: Boolean(row.stale),
    approved: Boolean(row.approved),
    status: row.stale
      ? row.version < (latestByTypeFormat.get(`${row.type}:${row.format}`) ?? row.version)
        ? ("SUPERSEDED" as const)
        : ("INVALIDATED" as const)
      : row.approved
        ? ("APPROVED" as const)
        : ("REVIEW_REQUIRED" as const),
    claimEvidenceCount: parseJson<unknown[]>(row.claimEvidenceJson, []).length,
    rendererVersion:
      parseJson<{ rendererVersion?: string }>(row.layoutResultJson, {}).rendererVersion ?? null,
    claimRuleVersion:
      parseJson<{ claimRuleVersion?: string }>(row.layoutResultJson, {}).claimRuleVersion ?? null,
    createdAt: row.createdAt,
  }));
}

export function getBetaJob(jobId: string): BetaJobDetail | null {
  const sqlite = betaSqlite();
  if (!sqlite) return null;
  const hasR2 = new R2Repository(sqlite).available();
  const row = sqlite
    .prepare(
      hasR2
        ? `SELECT j.normalized_json AS normalizedJson, v.id AS jobVersionId,
         v.source_observation_id AS sourceObservationId, e.id AS evaluationVersionId,
         (SELECT id FROM evaluation_versions WHERE job_id = j.id ORDER BY evaluated_at DESC, rowid DESC LIMIT 1)
           AS legacyEvaluationVersionId,
         e.eligibility_status AS eligibilityStatus, e.eligibility_reasons_json AS reasonsJson,
         e.fit_score AS fitScore, e.fit_contributions_json AS contributionsJson,
         NULL AS coverageJson, e.coverage_percent AS coveragePercent,
         e.unresolved_unknown_count AS unresolvedUnknownCount,
         e.unresolved_condition_count AS unresolvedConditionCount,
         e.unresolved_conflict_count AS unresolvedConflictCount,
         e.calibration_state AS calibrationState, e.recommended,
         e.stale AS evaluationStale, q.state AS queueState,
         q.reason_code AS queueReason, q.freshness AS queueFreshness,
         (SELECT c.state FROM r2_duplicate_candidates c
            WHERE c.left_observation_id IN (SELECT id FROM source_observations WHERE job_id = j.id)
               OR c.right_observation_id IN (SELECT id FROM source_observations WHERE job_id = j.id)
            ORDER BY CASE c.state WHEN 'SUGGESTED' THEN 0 ELSE 1 END, c.updated_at DESC LIMIT 1)
           AS duplicateState
       FROM jobs j
       LEFT JOIN job_versions v ON v.id = (
         SELECT id FROM job_versions WHERE job_id = j.id ORDER BY version DESC LIMIT 1)
       LEFT JOIN r2_evaluation_versions e ON e.id = (
         SELECT id FROM r2_evaluation_versions WHERE job_id = j.id ORDER BY evaluated_at DESC, rowid DESC LIMIT 1)
       LEFT JOIN r2_queue_decision_versions q ON q.id = (
         SELECT id FROM r2_queue_decision_versions WHERE job_id = j.id ORDER BY version DESC LIMIT 1)
       WHERE j.id = ?`
        : `SELECT j.normalized_json AS normalizedJson, v.id AS jobVersionId,
         v.source_observation_id AS sourceObservationId, e.id AS evaluationVersionId,
         e.id AS legacyEvaluationVersionId,
         e.eligibility_status AS eligibilityStatus, e.eligibility_reasons_json AS reasonsJson,
         e.fit_score AS fitScore, e.fit_contributions_json AS contributionsJson,
         e.coverage_json AS coverageJson, e.stale AS evaluationStale, q.state AS queueState,
         q.reason_code AS queueReason,
         NULL AS coveragePercent, 0 AS unresolvedUnknownCount,
         0 AS unresolvedConditionCount, 0 AS unresolvedConflictCount,
         NULL AS calibrationState, 0 AS recommended, NULL AS queueFreshness,
         (SELECT c.state FROM duplicate_clusters c
            LEFT JOIN duplicate_cluster_members m ON m.cluster_id = c.id
            WHERE c.canonical_job_id = j.id OR m.source_observation_id = v.source_observation_id
            ORDER BY c.updated_at DESC LIMIT 1) AS duplicateState
       FROM jobs j
       LEFT JOIN job_versions v ON v.id = (
         SELECT id FROM job_versions WHERE job_id = j.id ORDER BY version DESC LIMIT 1)
       LEFT JOIN evaluation_versions e ON e.id = (
         SELECT id FROM evaluation_versions WHERE job_id = j.id ORDER BY evaluated_at DESC, rowid DESC LIMIT 1)
       LEFT JOIN job_queue_entries q ON q.job_id = j.id WHERE j.id = ?`,
    )
    .get(jobId) as
    | {
        normalizedJson: string;
        jobVersionId: string | null;
        sourceObservationId: string | null;
        evaluationVersionId: string | null;
        legacyEvaluationVersionId: string | null;
        eligibilityStatus: BetaJobListItem["eligibilityStatus"];
        reasonsJson: string | null;
        fitScore: number | null;
        contributionsJson: string | null;
        coverageJson: string | null;
        evaluationStale: number | null;
        queueState: BetaJobListItem["queueState"];
        queueReason: string | null;
        duplicateState: string | null;
        coveragePercent: number | null;
        unresolvedUnknownCount: number | null;
        unresolvedConditionCount: number | null;
        unresolvedConflictCount: number | null;
        calibrationState: BetaJobListItem["calibrationState"];
        recommended: number | null;
        queueFreshness: BetaJobListItem["queueFreshness"];
      }
    | undefined;
  if (!row) return null;
  const parsedJob = JobSchema.parse(JSON.parse(row.normalizedJson));
  const recommendedTemplate = selectResumeTemplate(parsedJob);
  const recommendedDesign = resumeTemplateDesigns[recommendedTemplate];
  const requirementRows = row.jobVersionId
    ? (sqlite
        .prepare(
          `SELECT kind, modality, certainty, original_text AS originalText,
             normalized_proposition AS normalizedProposition
           FROM requirement_evidence WHERE job_version_id = ? ORDER BY start_offset LIMIT 100`,
        )
        .all(row.jobVersionId) as BetaJobDetail["requirements"])
    : [];
  const jobVersions = sqlite
    .prepare(
      `SELECT v.id, v.version, v.created_at AS createdAt,
         (SELECT count(*) FROM job_normalization_coverage c WHERE c.job_version_id = v.id)
           AS r2aCoverageCount,
         CASE WHEN EXISTS(
           SELECT 1 FROM job_field_evidence_v2 f
           WHERE f.job_version_id = v.id AND f.rule_id <> 'R2A_LEGACY_FIELD_UNKNOWN'
         ) OR EXISTS(
           SELECT 1 FROM requirement_evidence_v2 r
           WHERE r.job_version_id = v.id AND r.rule_id <> 'R2A_LEGACY_REQUIREMENT_UNKNOWN'
         ) THEN 'AVAILABLE' ELSE 'LEGACY_NOT_AVAILABLE' END AS r2aState
       FROM job_versions v WHERE v.job_id = ? ORDER BY v.version DESC`,
    )
    .all(jobId) as BetaJobDetail["jobVersions"];
  let r2aRead: ReturnType<R2ARepository["getNormalizationResult"]> = {
    state: "LEGACY_NOT_AVAILABLE",
    normalization: null,
  };
  if (row.jobVersionId) {
    r2aRead = new R2ARepository(sqlite).getNormalizationResult(row.jobVersionId);
  }
  const r2aNormalization = r2aRead.normalization;
  const packetRow = sqlite
    .prepare(
      `SELECT id, version, status, readiness_json AS readinessJson, created_at AS createdAt
       FROM application_packets WHERE job_id = ? ORDER BY version DESC LIMIT 1`,
    )
    .get(jobId) as
    | { id: string; version: number; status: string; readinessJson: string; createdAt: string }
    | undefined;
  const readiness = packetRow
    ? parseJson<{ blockers?: string[]; warnings?: string[] }>(packetRow.readinessJson, {})
    : null;
  const duplicateCandidates = hasR2
    ? (
        sqlite
          .prepare(
            `SELECT c.id, c.state, c.left_observation_id AS leftObservationId,
             c.right_observation_id AS rightObservationId,
             c.matched_signals_json AS matchedSignalsJson,
             c.conflicting_signals_json AS conflictingSignalsJson,
             (SELECT d.reason_code FROM r2_duplicate_decision_versions d
                WHERE d.candidate_id = c.id ORDER BY d.version DESC LIMIT 1) AS decisionReason
           FROM r2_duplicate_candidates c
           WHERE c.left_observation_id IN (SELECT id FROM source_observations WHERE job_id = ?)
              OR c.right_observation_id IN (SELECT id FROM source_observations WHERE job_id = ?)
           ORDER BY CASE c.state WHEN 'SUGGESTED' THEN 0 ELSE 1 END, c.updated_at DESC`,
          )
          .all(jobId, jobId) as Array<{
          id: string;
          state: string;
          leftObservationId: string;
          rightObservationId: string;
          matchedSignalsJson: string;
          conflictingSignalsJson: string;
          decisionReason: string | null;
        }>
      ).map(({ matchedSignalsJson, conflictingSignalsJson, ...candidate }) => ({
        ...candidate,
        matchedSignals: parseJson<string[]>(matchedSignalsJson, []),
        conflictingSignals: parseJson<string[]>(conflictingSignalsJson, []),
      }))
    : [];
  const corrections = (
    sqlite
      .prepare(
        `SELECT id, actor, reason_code AS reasonCode, changed_fields_json AS changedFieldsJson,
           created_at AS createdAt FROM job_corrections WHERE job_id = ? ORDER BY created_at DESC`,
      )
      .all(jobId) as Array<{
      id: string;
      actor: string;
      reasonCode: string;
      changedFieldsJson: string;
      createdAt: string;
    }>
  ).map(({ changedFieldsJson, ...correction }) => ({
    ...correction,
    changedFields: parseJson<string[]>(changedFieldsJson, []),
  }));
  return {
    job: parsedJob,
    jobVersionId: row.jobVersionId,
    sourceObservationId: row.sourceObservationId,
    evaluationVersionId: row.evaluationVersionId,
    legacyEvaluationVersionId: row.legacyEvaluationVersionId,
    eligibilityStatus: row.eligibilityStatus,
    eligibilityReasons: parseJson(row.reasonsJson, []),
    fitScore: row.fitScore,
    fitContributions: parseJson(row.contributionsJson, []),
    coverage: row.coverageJson
      ? EvaluationCoverageSchema.parse(parseJson(row.coverageJson, {}))
      : null,
    coveragePercent:
      row.coveragePercent ??
      (row.coverageJson
        ? EvaluationCoverageSchema.parse(parseJson(row.coverageJson, {})).percent
        : null),
    unresolvedUnknownCount: row.unresolvedUnknownCount ?? 0,
    unresolvedConditionCount: row.unresolvedConditionCount ?? 0,
    unresolvedConflictCount: row.unresolvedConflictCount ?? 0,
    calibrationState: row.calibrationState,
    recommended: Boolean(row.recommended),
    evaluationStale: Boolean(row.evaluationStale),
    queueState: row.queueState,
    queueReason: row.queueReason,
    queueFreshness: row.queueFreshness,
    duplicateState: row.duplicateState,
    duplicateCandidates,
    corrections,
    recommendedTemplate,
    templateStrategy: recommendedDesign.summaryStrategy,
    templateEvidencePriorities: recommendedDesign.evidencePriorities,
    requirements: requirementRows,
    jobVersions,
    r2aState: r2aRead.state,
    r2a: r2aNormalization
      ? {
          parserVersion: r2aNormalization.parserVersion,
          evidenceContractVersion: r2aNormalization.evidenceContractVersion,
          normalizationVersion: r2aNormalization.normalizationVersion,
          fields: r2aNormalization.fieldEvidence.map((item) => ({
            id: item.id,
            family: item.family,
            canonicalField: item.canonicalField,
            state: item.state,
            modality: item.modality,
            excerpt: item.source.excerpt,
            start: item.source.start,
            end: item.source.end,
            normalizedKind: item.normalizedValue.kind,
          })),
          requirements: r2aNormalization.requirementEvidence.map((item) => ({
            id: item.id,
            family: item.family,
            canonicalKind: item.canonicalKind,
            state: item.state,
            modality: item.modality,
            excerpt: item.source.excerpt,
            start: item.source.start,
            end: item.source.end,
            normalizedKind: item.normalizedValue.kind,
          })),
          coverage: r2aNormalization.coverage.map((item) => ({
            family: item.family,
            state: item.state,
            evidenceCount: item.evidenceIds.length,
            unparsedSpanCount: item.unparsedSpans.length,
          })),
          conflicts: r2aNormalization.conflicts.map((item) => ({
            id: item.id,
            canonicalField: item.canonicalField,
            evidenceCount: item.evidenceIds.length,
          })),
        }
      : null,
    documents: listDocuments(sqlite, jobId),
    packet: packetRow
      ? {
          id: packetRow.id,
          version: packetRow.version,
          status: packetRow.status,
          blockers: readiness?.blockers ?? [],
          warnings: readiness?.warnings ?? [],
          createdAt: packetRow.createdAt,
        }
      : null,
  };
}

export async function getBetaResumeEvidencePreview(
  jobId: string,
  template: ResumeTemplateCategory,
): Promise<BetaResumeEvidencePreview> {
  const detail = getBetaJob(jobId);
  if (!detail) throw new Error("JOB_NOT_FOUND");
  if (!resumeTemplateCategories.includes(template)) throw new Error("INVALID_RESUME_TEMPLATE");
  const resolution = await candidateProfileProvider.resolve("REAL_IMPORTED_JOB");
  if (resolution.state !== "PRIVATE_LOCAL_PROFILE" || !resolution.profile) {
    return { state: "PRIVATE_PROFILE_REQUIRED", template, claims: [] };
  }
  const sqlite = betaSqlite();
  if (!sqlite || !detail.jobVersionId || !detail.legacyEvaluationVersionId) {
    return { state: "EVALUATION_STALE_REEVALUATE_REQUIRED", template, claims: [] };
  }
  try {
    assertCurrentDocumentGenerationTuple({
      sqlite,
      profile: resolution.profile,
      jobVersionId: detail.jobVersionId,
      evaluationVersionId: detail.legacyEvaluationVersionId,
    });
  } catch (error) {
    const state = error instanceof Error ? error.message : "";
    if (
      state === "PROFILE_VERSION_STALE_REEVALUATE_REQUIRED" ||
      state === "EVALUATION_STALE_REEVALUATE_REQUIRED"
    ) {
      return { state, template, claims: [] };
    }
    throw error;
  }
  const document = generateResumeDocument(resolution.profile, detail.job, template);
  const claims = [
    ...document.summary,
    ...document.skills,
    ...document.employment.flatMap(({ claims: employmentClaims }) => employmentClaims),
    ...document.projects.flatMap(({ claims: projectClaims }) => projectClaims),
    ...document.achievements,
  ];
  return { state: "READY", template, claims: claims.slice(0, 8) };
}

export async function reevaluateBetaJob(jobId: string): Promise<string> {
  const sqlite = betaSqlite();
  const importer = getJobImportRepository();
  if (!sqlite || !importer) throw new Error("BETA_DATABASE_NOT_READY");
  const resolution = await candidateProfileProvider.resolve("REAL_IMPORTED_JOB");
  if (resolution.state !== "PRIVATE_LOCAL_PROFILE") throw new Error("PRIVATE_PROFILE_REQUIRED");
  const legacyResult = await importer.reevaluateExistingJob(jobId, candidateProfileProvider);
  if (legacyResult !== "PRIVATE_LOCAL_PROFILE")
    throw new Error("PRIVATE_PROFILE_EVALUATION_FAILED");
  const legacyRow = sqlite
    .prepare(
      `SELECT id FROM evaluation_versions WHERE job_id = ?
       ORDER BY evaluated_at DESC, rowid DESC LIMIT 1`,
    )
    .get(jobId) as { id: string } | undefined;
  if (!legacyRow) throw new Error("BETA_VERSION_STATE_MISSING");
  const r2 = getR2Repository();
  if (!r2) return legacyRow.id;
  const current = sqlite
    .prepare(
      `SELECT j.normalized_json AS normalizedJson, v.id AS jobVersionId,
         p.active_version_id AS profileVersionId
       FROM jobs j
       JOIN job_versions v ON v.id = (
         SELECT id FROM job_versions WHERE job_id = j.id ORDER BY version DESC LIMIT 1)
       JOIN candidate_profiles p ON p.id = ?
       WHERE j.id = ?`,
    )
    .get(resolution.profile.profileId, jobId) as
    | { normalizedJson: string; jobVersionId: string; profileVersionId: string | null }
    | undefined;
  if (!current?.profileVersionId) throw new Error("R2_CURRENT_PROFILE_VERSION_REQUIRED");
  const normalization = new R2ARepository(sqlite).getNormalization(current.jobVersionId);
  if (!normalization) throw new Error("R2_CURRENT_NORMALIZATION_REQUIRED");
  const evaluationId = randomUUID();
  const eligibility = evaluateR2Eligibility({
    profile: resolution.profile,
    normalization,
    bindings: {
      jobVersionId: current.jobVersionId,
      currentJobVersionId: current.jobVersionId,
      profileVersionId: current.profileVersionId,
      currentProfileVersionId: current.profileVersionId,
      evidenceContractVersion: normalization.evidenceContractVersion,
      currentEvidenceContractVersion: normalization.evidenceContractVersion,
      evaluationVersionId: evaluationId,
    },
    evaluatedAt: new Date().toISOString(),
  });
  const job = JobSchema.parse(JSON.parse(current.normalizedJson));
  const fit = scoreR2JobFit({
    profile: resolution.profile,
    normalization,
    eligibility,
    calibrationContext: R2_UNREVIEWED_CALIBRATION_CONTEXT,
    commute: {
      distanceKm: job.estimatedCommuteKm,
      durationMinutes: job.estimatedCommuteMinutes ?? null,
    },
  });
  return r2.recordEvaluation({
    id: evaluationId,
    jobId,
    jobVersionId: current.jobVersionId,
    profileVersionId: current.profileVersionId,
    normalization,
    eligibility,
    fit,
  }).id;
}

interface CurrentDocumentContext {
  detail: BetaJobDetail & { jobVersionId: string; legacyEvaluationVersionId: string };
  profile: CandidateProfile;
  profileVersionId: string;
  privateRoot: string;
}

async function currentDocumentContext(jobId: string): Promise<CurrentDocumentContext> {
  const sqlite = betaSqlite();
  if (!sqlite) throw new Error("BETA_DATABASE_NOT_READY");
  const resolution = await candidateProfileProvider.resolve("REAL_IMPORTED_JOB");
  if (resolution.state !== "PRIVATE_LOCAL_PROFILE") throw new Error("PRIVATE_PROFILE_REQUIRED");
  const detail = getBetaJob(jobId);
  if (!detail?.jobVersionId || !detail.legacyEvaluationVersionId) {
    throw new Error("EVALUATION_STALE_REEVALUATE_REQUIRED");
  }
  const tuple = assertCurrentDocumentGenerationTuple({
    sqlite,
    profile: resolution.profile,
    jobVersionId: detail.jobVersionId,
    evaluationVersionId: detail.legacyEvaluationVersionId,
  });
  return {
    detail: {
      ...detail,
      jobVersionId: detail.jobVersionId,
      legacyEvaluationVersionId: detail.legacyEvaluationVersionId,
    },
    profile: resolution.profile,
    profileVersionId: tuple.profileVersionId,
    privateRoot: join(resolveLocalDataDirectory(), "private"),
  };
}

export async function generatePrivateCv(
  jobId: string,
  templateOverride?: ResumeTemplateCategory,
): Promise<{ pdfId: string; docxId: string }> {
  const sqlite = betaSqlite();
  const beta = getBetaRepository();
  if (!sqlite || !beta) throw new Error("BETA_DATABASE_NOT_READY");
  const { detail, profile, profileVersionId, privateRoot } = await currentDocumentContext(jobId);
  if (templateOverride && !resumeTemplateCategories.includes(templateOverride)) {
    throw new Error("INVALID_RESUME_TEMPLATE");
  }
  const artifactKey = randomUUID();
  const directory = join("documents", jobId.replace(/[^A-Za-z0-9._-]/g, "_"));
  const displayName = resumeFileName(profile, detail.job.company);
  const stem = displayName.replace(/\.pdf$/i, "");
  const pdfRelative = join(directory, `${artifactKey}.pdf`);
  const docxRelative = join(directory, `${artifactKey}.docx`);
  await Promise.all([
    preparePrivateOutputTarget(pdfRelative, privateRoot),
    preparePrivateOutputTarget(docxRelative, privateRoot),
  ]);
  const document = generateResumeDocument(profile, detail.job, templateOverride);
  const fittedDocument = await renderResumePdf(document, pdfRelative, privateRoot);
  await renderResumeDocx(fittedDocument, docxRelative, privateRoot);
  const [pdfBytes, docxBytes] = await Promise.all([
    readFile(join(privateRoot, pdfRelative)),
    readFile(join(privateRoot, docxRelative)),
  ]);
  if (pdfBytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("PDF_INVALID");
  if (docxBytes.subarray(0, 2).toString("ascii") !== "PK") throw new Error("DOCX_INVALID");
  const pages = pdfBytes.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  if (pages < 1 || pages > fittedDocument.pageLimit) throw new Error("PDF_PAGE_LIMIT_EXCEEDED");
  const claimReferences = [
    ...fittedDocument.summary,
    ...fittedDocument.skills,
    ...fittedDocument.employment.flatMap(({ claims }) => claims),
    ...fittedDocument.projects.flatMap(({ claims }) => claims),
    ...fittedDocument.achievements,
  ].flatMap(({ factReferences }) => factReferences);
  const common = {
    jobId,
    jobVersionId: detail.jobVersionId,
    profileVersionId,
    type: "CV" as const,
    template: fittedDocument.template,
    claimEvidence: [...new Set(claimReferences)],
    layoutResult: {
      rendererVersion: "resume-engine-beta-core-1",
      claimRuleVersion: "semantic-claims-1",
      pageLimit: fittedDocument.pageLimit,
      pageCount: pages,
      atsText: true,
      minimumPointSize: 10,
    },
  };
  const pdf = beta.recordDocumentArtifact({
    ...common,
    format: "PDF",
    fileName: displayName,
    localPath: pdfRelative,
    contentDigest: createHash("sha256").update(pdfBytes).digest("hex"),
  });
  const docx = beta.recordDocumentArtifact({
    ...common,
    format: "DOCX",
    fileName: `${stem}.docx`,
    localPath: docxRelative,
    contentDigest: createHash("sha256").update(docxBytes).digest("hex"),
    layoutResult: { ...common.layoutResult, pageCount: null, structureValidated: true },
  });
  return { pdfId: pdf.id, docxId: docx.id };
}

export async function generatePrivateCoverLetter(
  jobId: string,
  toneOverride?: CoverLetterTone,
): Promise<{ pdfId: string; docxId: string }> {
  const sqlite = betaSqlite();
  const beta = getBetaRepository();
  if (!sqlite || !beta) throw new Error("BETA_DATABASE_NOT_READY");
  const { detail, profile, profileVersionId, privateRoot } = await currentDocumentContext(jobId);
  if (toneOverride && !["DIRECT", "WARM", "FORMAL"].includes(toneOverride)) {
    throw new Error("INVALID_COVER_LETTER_TONE");
  }
  const artifactKey = randomUUID();
  const directory = join("documents", jobId.replace(/[^A-Za-z0-9._-]/g, "_"));
  const pdfRelative = join(directory, `${artifactKey}-letter.pdf`);
  const docxRelative = join(directory, `${artifactKey}-letter.docx`);
  await Promise.all([
    preparePrivateOutputTarget(pdfRelative, privateRoot),
    preparePrivateOutputTarget(docxRelative, privateRoot),
  ]);
  const document = generateBasicCoverLetter(profile, detail.job, toneOverride);
  await renderCoverLetterPdf(document, pdfRelative, privateRoot);
  await renderCoverLetterDocx(document, docxRelative, privateRoot);
  const [pdfBytes, docxBytes] = await Promise.all([
    readFile(join(privateRoot, pdfRelative)),
    readFile(join(privateRoot, docxRelative)),
  ]);
  if (pdfBytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("PDF_INVALID");
  if (docxBytes.subarray(0, 2).toString("ascii") !== "PK") throw new Error("DOCX_INVALID");
  const pages = pdfBytes.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  if (pages !== 1) throw new Error("COVER_LETTER_PAGE_LIMIT_EXCEEDED");
  const displayName = coverLetterFileName(profile, detail.job.company);
  const common = {
    jobId,
    jobVersionId: detail.jobVersionId,
    profileVersionId,
    type: "COVER_LETTER" as const,
    template: `letter-${document.tone.toLowerCase()}`,
    claimEvidence: [
      ...new Set(document.claims.flatMap(({ profileFactReferences }) => profileFactReferences)),
    ],
    layoutResult: {
      rendererVersion: "cover-letter-engine-beta-core-1",
      claimRuleVersion: "semantic-claims-1",
      pageLimit: 1,
      pageCount: pages,
      requiresHumanReview: true,
    },
  };
  const pdf = beta.recordDocumentArtifact({
    ...common,
    format: "PDF",
    fileName: displayName,
    localPath: pdfRelative,
    contentDigest: createHash("sha256").update(pdfBytes).digest("hex"),
  });
  const docx = beta.recordDocumentArtifact({
    ...common,
    format: "DOCX",
    fileName: displayName.replace(/\.pdf$/i, ".docx"),
    localPath: docxRelative,
    contentDigest: createHash("sha256").update(docxBytes).digest("hex"),
    layoutResult: { ...common.layoutResult, pageCount: null, structureValidated: true },
  });
  return { pdfId: pdf.id, docxId: docx.id };
}

export function approvePrivateDocument(documentArtifactId: string, contentDigest: string): string {
  const beta = getBetaRepository();
  if (!beta) throw new Error("BETA_DATABASE_NOT_READY");
  return beta.approveDocument({ documentArtifactId, contentDigest });
}

export function setBetaQueueState(
  jobId: string,
  state: "REVIEWING" | "SHORTLISTED" | "SKIPPED" | "PREPARING",
  reasonCode: string = `OWNER_${state}`,
): void {
  const detail = getBetaJob(jobId);
  const beta = getBetaRepository();
  if (!detail || !beta) throw new Error("BETA_JOB_NOT_FOUND");
  const r2 = getR2Repository();
  if (r2 && detail.evaluationVersionId) {
    r2.recordQueueDecision({
      jobId,
      state,
      r2EvaluationId: detail.evaluationVersionId,
      duplicateResolutionVersion: r2.duplicateResolutionVersion(jobId),
      actor: "OWNER",
      reasonCode,
    });
    return;
  }
  beta.setQueueState({
    jobId,
    state,
    evaluationVersionId: detail.legacyEvaluationVersionId,
    reasonCode,
  });
}

export function decideBetaDuplicate(
  jobId: string,
  candidateId: string,
  decision: "LINKED" | "REJECTED" | "SPLIT",
): void {
  const r2 = getR2Repository();
  if (!r2) throw new Error("R2_DATABASE_NOT_READY");
  const detail = getBetaJob(jobId);
  if (!detail?.duplicateCandidates.some(({ id }) => id === candidateId)) {
    throw new Error("DUPLICATE_CANDIDATE_NOT_FOUND_FOR_JOB");
  }
  r2.decideDuplicate({
    candidateId,
    decision,
    reasonCode:
      decision === "LINKED"
        ? "OWNER_CONFIRMED_DUPLICATE"
        : decision === "SPLIT"
          ? "OWNER_CONFIRMED_DISTINCT"
          : "OWNER_REJECTED_SUGGESTION",
    evidenceVersion: "r2-duplicate-1",
  });
}

export async function correctBetaJob(
  jobId: string,
  input: {
    title: string;
    company: string;
    location: string;
    category: string;
    employmentType: Job["employmentType"];
    salaryMinimum: string;
    salaryMaximum: string;
    salaryCurrency: string;
    salaryPeriod: NonNullable<Job["salary"]>["period"];
    hoursPerWeekMinimum: string;
    hoursPerWeekMaximum: string;
    hoursPerFortnightMinimum: string;
    hoursPerFortnightMaximum: string;
    rosterType: NonNullable<Job["schedule"]["rosterType"]>;
    scheduleDay: Job["schedule"]["shifts"][number]["day"] | "";
    scheduleStart: string;
    scheduleEnd: string;
    coverLetterState: "REQUIRED" | "NOT_REQUIRED";
    workRightsRequirement: Job["workRightsRequirement"];
    vehicleRequirement: Job["vehicleRequirement"];
    requirementsText: string;
    preferredRequirementsText: string;
    requiredSkillsText: string;
  },
): Promise<void> {
  const detail = getBetaJob(jobId);
  const beta = getBetaRepository();
  if (!detail || !beta) throw new Error("BETA_JOB_NOT_FOUND");
  const numberOrNull = (value: string): number | null => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error("INVALID_CORRECTION_NUMBER");
    return parsed;
  };
  const lines = (value: string) =>
    [
      ...new Set(
        value
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    ].slice(0, 100);
  const salaryMinimum = numberOrNull(input.salaryMinimum);
  const salaryMaximum = numberOrNull(input.salaryMaximum);
  const salary =
    salaryMinimum === null && salaryMaximum === null
      ? null
      : {
          minimum: salaryMinimum,
          maximum: salaryMaximum,
          currency: input.salaryCurrency.trim().toUpperCase(),
          period: input.salaryPeriod,
          text: null,
        };
  const weeklyMinimum = numberOrNull(input.hoursPerWeekMinimum);
  const weeklyMaximum = numberOrNull(input.hoursPerWeekMaximum);
  const fortnightlyMinimum = numberOrNull(input.hoursPerFortnightMinimum);
  const fortnightlyMaximum = numberOrNull(input.hoursPerFortnightMaximum);
  const shifts =
    input.scheduleDay && input.scheduleStart && input.scheduleEnd
      ? [
          {
            day: input.scheduleDay,
            startTime: input.scheduleStart,
            endTime: input.scheduleEnd,
            mandatory: true,
          },
        ]
      : [];
  const correctedLocation = normalizeAustralianLocation(input.location.trim());
  const job = JobSchema.parse({
    ...detail.job,
    title: input.title.trim(),
    company: input.company.trim(),
    location: input.location.trim(),
    suburb: correctedLocation.suburb,
    state: correctedLocation.state,
    postcode: correctedLocation.postcode,
    country: correctedLocation.country,
    category: input.category.trim(),
    employmentType: input.employmentType,
    casual: input.employmentType === "CASUAL",
    partTime: input.employmentType === "PART_TIME",
    fullTime: input.employmentType === "FULL_TIME",
    contract: input.employmentType === "CONTRACT",
    internship: input.employmentType === "INTERNSHIP",
    salary,
    hoursPerWeek:
      weeklyMinimum === null && weeklyMaximum === null
        ? null
        : { minimum: weeklyMinimum, maximum: weeklyMaximum },
    hoursPerFortnight:
      fortnightlyMinimum === null && fortnightlyMaximum === null
        ? null
        : { minimum: fortnightlyMinimum, maximum: fortnightlyMaximum },
    schedule: {
      ...detail.job.schedule,
      fixed: input.rosterType === "FIXED" ? true : input.rosterType === "UNKNOWN" ? null : false,
      rosterType: input.rosterType,
      shifts,
    },
    requirements: lines(input.requirementsText),
    preferredRequirements: lines(input.preferredRequirementsText),
    requiredSkills: lines(input.requiredSkillsText),
    documentRequirements: {
      ...detail.job.documentRequirements,
      coverLetterRequired: input.coverLetterState === "REQUIRED",
    },
    coverLetterRequired: input.coverLetterState === "REQUIRED",
    workRightsRequirement: input.workRightsRequirement,
    vehicleRequirement: input.vehicleRequirement,
    dateUpdated: new Date().toISOString(),
    eligibilityStatus: null,
    eligibilityReasons: [],
    fitScore: null,
    fitReasons: [],
  });
  const correctionFields = [
    "title",
    "company",
    "location",
    "suburb",
    "state",
    "postcode",
    "country",
    "category",
    "employmentType",
    "salary",
    "hoursPerWeek",
    "hoursPerFortnight",
    "schedule",
    "requirements",
    "preferredRequirements",
    "requiredSkills",
    "documentRequirements",
    "coverLetterRequired",
    "workRightsRequirement",
    "vehicleRequirement",
  ] as const;
  const changedFields = correctionFields.filter(
    (field) => JSON.stringify(job[field]) !== JSON.stringify(detail.job[field]),
  );
  if (!changedFields.length) throw new Error("CORRECTION_HAS_NO_CHANGE");
  beta.recordOwnerCorrection({ job, reasonCode: "OWNER_REVIEWED_FIELDS", changedFields });
  await reevaluateBetaJob(jobId);
}

export async function preparePrivatePacket(
  jobId: string,
): Promise<{ packetId: string; status: string }> {
  const sqlite = betaSqlite();
  const beta = getBetaRepository();
  const detail = getBetaJob(jobId);
  if (
    !sqlite ||
    !beta ||
    !detail?.jobVersionId ||
    !detail.legacyEvaluationVersionId ||
    !detail.eligibilityStatus
  ) {
    throw new Error("BETA_JOB_NOT_READY");
  }
  if (
    getR2Repository()?.available() &&
    (!detail.recommended ||
      detail.evaluationStale ||
      detail.queueFreshness === "STALE" ||
      detail.duplicateState === "SUGGESTED")
  ) {
    throw new Error("R2_QUEUE_PREPARING_NOT_READY");
  }
  const r2 = getR2Repository();
  if (r2?.available()) {
    if (!detail.evaluationVersionId) throw new Error("R2_QUEUE_CURRENT_PREPARING_REQUIRED");
    r2.assertCurrentPreparing(jobId, detail.evaluationVersionId);
  }
  const resolution = await candidateProfileProvider.resolve("REAL_IMPORTED_JOB");
  if (resolution.state !== "PRIVATE_LOCAL_PROFILE") throw new Error("PRIVATE_PROFILE_REQUIRED");
  const profileVersion = assertCurrentDocumentGenerationTuple({
    sqlite,
    profile: resolution.profile,
    jobVersionId: detail.jobVersionId,
    evaluationVersionId: detail.legacyEvaluationVersionId,
  });
  const currentDocuments = detail.documents.filter(
    ({ stale, approved, format }) => !stale && approved && format === "PDF",
  );
  const expiry = detail.sourceObservationId
    ? (sqlite
        .prepare("SELECT expires_at AS expiresAt FROM source_observations WHERE id = ?")
        .get(detail.sourceObservationId) as { expiresAt: string | null } | undefined)
    : undefined;
  const jobExpiryState = deriveJobExpiryState(expiry?.expiresAt);
  const duplicateRows = sqlite
    .prepare(
      `SELECT DISTINCT c.state FROM duplicate_clusters c
       LEFT JOIN duplicate_cluster_members m ON m.cluster_id = c.id
       WHERE c.canonical_job_id = ? OR m.source_observation_id = ?`,
    )
    .all(jobId, detail.sourceObservationId) as Array<{ state: string }>;
  const duplicateState = deriveDuplicatePacketState(duplicateRows.map(({ state }) => state));
  const packet = ApplicationPacketSchema.parse({
    id: randomUUID(),
    jobId,
    jobVersionId: detail.jobVersionId,
    profileVersionId: profileVersion.profileVersionId,
    evaluationVersionId: detail.legacyEvaluationVersionId,
    eligibilityStatus: detail.eligibilityStatus,
    targetUrl: null,
    targetHost: null,
    jobExpiryState,
    duplicateState,
    versionsCurrent: !detail.evaluationStale,
    documents: currentDocuments.map((document) => ({
      id: document.id,
      type: document.type,
      fileName: document.fileName,
      digest: document.contentDigest,
      approved: document.approved,
      stale: document.stale,
      required:
        document.type === "CV" ||
        (document.type === "COVER_LETTER" &&
          coverLetterRequirementStatus(detail.job) === "REQUIRED"),
    })),
    answers: [],
  } satisfies ApplicationPacket);
  const result = beta.persistApplicationPacket(packet);
  const now = new Date().toISOString();
  let application = sqlite
    .prepare("SELECT id FROM applications WHERE job_id = ? ORDER BY created_at LIMIT 1")
    .get(jobId) as { id: string } | undefined;
  if (!application) {
    application = { id: randomUUID() };
    sqlite
      .prepare(
        `INSERT INTO applications
          (id, job_id, profile_version_id, status, source, resume_document_id,
           cover_letter_document_id, submitted_at, created_at, updated_at)
         VALUES (?, ?, ?, 'DISCOVERED', ?, NULL, NULL, NULL, ?, ?)`,
      )
      .run(application.id, jobId, profileVersion.profileVersionId, detail.job.source, now, now);
  }
  const transitions = ["DISCOVERED", "REVIEWING", "SHORTLISTED", "PREPARING"] as const;
  for (const toStatus of transitions) {
    try {
      beta.appendApplicationEvent({
        applicationId: application.id,
        packetId: packet.id,
        toStatus,
        eventType: `OWNER_${toStatus}`,
        actor: "LOCAL_USER",
        idempotencyKey: `packet:${packet.id}:${toStatus}`,
        metadata: { packetVersion: result.version },
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("transition")) throw error;
    }
  }
  return { packetId: result.packetId, status: result.status };
}

export interface BetaApplicationListItem {
  id: string;
  jobId: string;
  title: string;
  company: string;
  status: BetaApplicationStatus;
  packetId: string | null;
  packetStatus: string | null;
  packetVersion: number | null;
  blockers: string[];
  selectedDocuments: Array<{
    type: "CV" | "COVER_LETTER";
    format: "PDF" | "DOCX";
    version: number;
    required: boolean;
    approved: boolean;
    stale: boolean;
  }>;
  coverLetterState: "APPROVED" | "REQUIRED_MISSING" | "NOT_INCLUDED" | "UNKNOWN";
  unknownAnswerCount: number;
  approvedDisclosureCount: number;
  questionCount: number;
  runnerState: string;
  runnerStopReason: string | null;
  nextAction: string;
  manualOutcomes: ManualApplicationOutcome[];
  timeline: Array<{ toStatus: string; eventType: string; occurredAt: string }>;
}

function betaApplicationStatus(value: string): BetaApplicationStatus {
  const beta = BetaApplicationStatusSchema.safeParse(value);
  if (beta.success) return beta.data;
  return legacyStatusToBeta(ApplicationStatusSchema.parse(value));
}

export function listBetaApplications(): BetaApplicationListItem[] {
  const sqlite = betaSqlite();
  if (!sqlite) return [];
  const rows = sqlite
    .prepare(
      `SELECT a.id, a.job_id AS jobId, j.title, j.company, j.normalized_json AS normalizedJson,
         a.status, p.id AS packetId, p.status AS packetStatus, p.version AS packetVersion,
         p.readiness_json AS readinessJson
       FROM applications a JOIN jobs j ON j.id = a.job_id
       LEFT JOIN application_packets p ON p.id = (
         SELECT id FROM application_packets WHERE job_id = a.job_id ORDER BY version DESC LIMIT 1)
       ORDER BY a.updated_at DESC`,
    )
    .all() as Array<{
    id: string;
    jobId: string;
    title: string;
    company: string;
    status: string;
    normalizedJson: string;
    packetId: string | null;
    packetStatus: string | null;
    packetVersion: number | null;
    readinessJson: string | null;
  }>;
  return rows.map((row) => {
    const status = betaApplicationStatus(row.status);
    const blockers = parseJson<{ blockers?: string[] }>(row.readinessJson, {}).blockers ?? [];
    const selectedDocuments = row.packetId
      ? (
          sqlite
            .prepare(
              `SELECT d.type, d.format, d.version, d.stale, pd.required,
               EXISTS(SELECT 1 FROM document_approvals a
                 WHERE a.document_artifact_id = d.id AND a.content_digest = d.content_digest
                   AND a.invalidated_at IS NULL) AS approved
             FROM application_packet_documents pd
             JOIN document_artifacts d ON d.id = pd.document_artifact_id
             WHERE pd.packet_id = ? ORDER BY d.type, d.format`,
            )
            .all(row.packetId) as Array<{
            type: "CV" | "COVER_LETTER";
            format: "PDF" | "DOCX";
            version: number;
            stale: number;
            required: number;
            approved: number;
          }>
        ).map((document) => ({
          ...document,
          stale: Boolean(document.stale),
          required: Boolean(document.required),
          approved: Boolean(document.approved),
        }))
      : [];
    const answers = row.packetId
      ? (sqlite
          .prepare(
            `SELECT count(*) AS questionCount,
               coalesce(sum(CASE WHEN q.required = 1 AND
                 coalesce(a.certainty, 'UNKNOWN') = 'UNKNOWN' THEN 1 ELSE 0 END), 0)
                 AS unknownAnswerCount,
               coalesce(sum(CASE WHEN a.disclosure_state = 'APPROVED' THEN 1 ELSE 0 END), 0)
                 AS approvedDisclosureCount
             FROM application_questions q
             LEFT JOIN application_answer_versions a ON a.id = (
               SELECT id FROM application_answer_versions WHERE question_id = q.id
               ORDER BY version DESC LIMIT 1)
             WHERE q.packet_id = ?`,
          )
          .get(row.packetId) as {
          questionCount: number;
          unknownAnswerCount: number;
          approvedDisclosureCount: number;
        })
      : { questionCount: 0, unknownAnswerCount: 0, approvedDisclosureCount: 0 };
    const runner = row.packetId
      ? (sqlite
          .prepare(
            `SELECT state, stop_reason AS stopReason FROM application_runs
             WHERE packet_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
          )
          .get(row.packetId) as { state: string; stopReason: string | null } | undefined)
      : undefined;
    const job = JobSchema.parse(JSON.parse(row.normalizedJson));
    const letterRequirement = coverLetterRequirementStatus(job);
    const approvedLetter = selectedDocuments.some(
      ({ type, approved, stale }) => type === "COVER_LETTER" && approved && !stale,
    );
    const coverLetterState = approvedLetter
      ? ("APPROVED" as const)
      : letterRequirement === "REQUIRED"
        ? ("REQUIRED_MISSING" as const)
        : letterRequirement === "UNKNOWN"
          ? ("UNKNOWN" as const)
          : ("NOT_INCLUDED" as const);
    const manualOutcomes = manualApplicationOutcomesForStatus(status);
    const nextAction = !row.packetId
      ? "Prepare a packet"
      : blockers.length
        ? "Resolve packet blockers"
        : runner?.stopReason
          ? runner.stopReason.replaceAll("_", " ")
          : "Real target approval required";
    return {
      id: row.id,
      jobId: row.jobId,
      title: row.title,
      company: row.company,
      status,
      packetId: row.packetId,
      packetStatus: row.packetStatus,
      packetVersion: row.packetVersion,
      blockers,
      selectedDocuments,
      coverLetterState,
      unknownAnswerCount: answers.unknownAnswerCount,
      approvedDisclosureCount: answers.approvedDisclosureCount,
      questionCount: answers.questionCount,
      runnerState: runner?.state ?? "TARGET_APPROVAL_REQUIRED",
      runnerStopReason: runner?.stopReason ?? "TARGET_APPROVAL_REQUIRED",
      nextAction,
      manualOutcomes,
      timeline: sqlite
        .prepare(
          `SELECT to_status AS toStatus, event_type AS eventType, occurred_at AS occurredAt
         FROM application_events_v2 WHERE application_id = ? ORDER BY occurred_at, rowid`,
        )
        .all(row.id) as BetaApplicationListItem["timeline"],
    };
  });
}

export function recordManualApplicationOutcome(
  applicationId: string,
  outcome: ManualApplicationOutcome,
): void {
  const sqlite = betaSqlite();
  const beta = getBetaRepository();
  if (!sqlite || !beta) throw new Error("BETA_DATABASE_NOT_READY");
  if (!ManualApplicationOutcomes.includes(outcome)) throw new Error("INVALID_APPLICATION_OUTCOME");
  const application = sqlite
    .prepare(
      `SELECT a.status, p.id AS packetId FROM applications a
       LEFT JOIN application_packets p ON p.id = (
         SELECT id FROM application_packets WHERE job_id = a.job_id ORDER BY version DESC LIMIT 1)
       WHERE a.id = ?`,
    )
    .get(applicationId) as { status: string; packetId: string | null } | undefined;
  if (!application) throw new Error("APPLICATION_NOT_FOUND");
  const current = betaApplicationStatus(application.status);
  if (!manualApplicationOutcomesForStatus(current).includes(outcome)) {
    throw new Error("APPLICATION_OUTCOME_TRANSITION_NOT_ALLOWED");
  }
  beta.appendApplicationEvent({
    applicationId,
    packetId: application.packetId,
    toStatus: outcome,
    eventType: `OWNER_RECORDED_${outcome}`,
    actor: "LOCAL_USER",
    idempotencyKey: `owner-outcome:${applicationId}:${outcome}:${randomUUID()}`,
    metadata: {
      reasonCode: `OWNER_OBSERVED_${outcome}`,
      outcomeSource: "LOCAL_USER",
    },
  });
}

export function getSourceCapabilitySummary(): {
  status: "SOURCE_READY_AWAITING_TENANT" | "SOURCE_ALLOWLIST_READY";
  capabilities: Array<{ source: string; approved: boolean; expiresAt: string }>;
} {
  const sqlite = betaSqlite();
  if (!sqlite) return { status: "SOURCE_READY_AWAITING_TENANT", capabilities: [] };
  const rows = sqlite
    .prepare(
      `SELECT source, approved, expires_at AS expiresAt FROM capability_configs
       ORDER BY source, expires_at DESC`,
    )
    .all() as Array<{ source: string; approved: number; expiresAt: string }>;
  return {
    status: rows.length ? "SOURCE_ALLOWLIST_READY" : "SOURCE_READY_AWAITING_TENANT",
    capabilities: rows.map(({ source, approved, expiresAt }) => ({
      source,
      approved: Boolean(approved),
      expiresAt,
    })),
  };
}
