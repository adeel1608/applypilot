import type BetterSqlite3 from "better-sqlite3";

import { R2_MINIMUM_EXTRACTION_COVERAGE } from "@applypilot/eligibility-engine";
import { R2_RECOMMENDATION_THRESHOLD } from "@applypilot/fit-scorer";

type StoredReason = {
  code?: unknown;
  severity?: unknown;
  evidenceClass?: unknown;
  jobEvidenceReferences?: unknown;
  candidateFactReferences?: unknown;
};

export interface R2ReadinessSummary {
  jobId: string;
  jobVersionId: string | null;
  evaluationId: string | null;
  eligibilityStatus: string | null;
  stale: boolean;
  fitScore: number | null;
  recommendationThreshold: number;
  recommended: boolean;
  recommendationBlockers: string[];
  blockerReasonCounts: Record<string, number>;
  coveragePercent: number | null;
  unresolvedUnknownCount: number;
  unresolvedConditionCount: number;
  unresolvedConflictCount: number;
  queueState: string | null;
  queueFreshness: string | null;
  duplicateState: "CLEAR" | "UNRESOLVED" | "NONE";
  calibrationState: string | null;
  ownerQuestionIds: string[];
  observedMaterialFamilyCount: number;
  resolvedObservedMaterialFamilyCount: number;
  partialMaterialFamilyCount: number;
  unobservedMaterialFamilyCount: number;
  unobservedMaterialFamilies: string[];
  partialMaterialFamilies: string[];
}

const MATERIAL_FAMILIES = new Set([
  "GEOGRAPHY",
  "HOURS",
  "SCHEDULE",
  "SKILLS",
  "EXPERIENCE",
  "EDUCATION",
  "LICENCES",
  "CERTIFICATIONS",
  "WORK_RIGHTS",
  "VEHICLE",
]);

function safeReasons(value: string | null): StoredReason[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is StoredReason => Boolean(item && typeof item === "object"))
      : [];
  } catch {
    return [];
  }
}

function reasonCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z0-9_]{3,120}$/.test(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function coverageSummary(
  sqlite: BetterSqlite3.Database | undefined,
  jobVersionId: string | null,
): Pick<
  R2ReadinessSummary,
  | "observedMaterialFamilyCount"
  | "resolvedObservedMaterialFamilyCount"
  | "partialMaterialFamilyCount"
  | "unobservedMaterialFamilyCount"
  | "unobservedMaterialFamilies"
  | "partialMaterialFamilies"
> {
  const empty = {
    observedMaterialFamilyCount: 0,
    resolvedObservedMaterialFamilyCount: 0,
    partialMaterialFamilyCount: 0,
    unobservedMaterialFamilyCount: 0,
    unobservedMaterialFamilies: [],
    partialMaterialFamilies: [],
  };
  if (!sqlite || !jobVersionId) return empty;
  const rows = sqlite
    .prepare(
      `SELECT family,coverage_state AS state,evidence_count AS evidenceCount,
              unparsed_spans_json AS unparsedSpansJson
       FROM job_normalization_coverage WHERE job_version_id=?`,
    )
    .all(jobVersionId) as Array<{
    family: string;
    state: string;
    evidenceCount: number;
    unparsedSpansJson: string;
  }>;
  const byFamily = new Map(rows.map((row) => [row.family, row]));
  const unobserved: string[] = [];
  const partial: string[] = [];
  let resolved = 0;
  for (const family of MATERIAL_FAMILIES) {
    const row = byFamily.get(family);
    if (!row) {
      unobserved.push(family);
      continue;
    }
    let unparsedCount = 0;
    try {
      const parsed: unknown = JSON.parse(row.unparsedSpansJson);
      unparsedCount = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      unparsedCount = 1;
    }
    if (row.state === "COMPLETE") {
      resolved += 1;
    } else if (row.state === "UNKNOWN" && row.evidenceCount === 0 && unparsedCount === 0) {
      unobserved.push(row.family);
    } else {
      partial.push(row.family);
    }
  }
  return {
    observedMaterialFamilyCount: resolved + partial.length,
    resolvedObservedMaterialFamilyCount: resolved,
    partialMaterialFamilyCount: partial.length,
    unobservedMaterialFamilyCount: unobserved.length,
    unobservedMaterialFamilies: unobserved.sort(),
    partialMaterialFamilies: partial.sort(),
  };
}

function summaryFromRow(
  row: Record<string, unknown>,
  sqlite?: BetterSqlite3.Database,
): R2ReadinessSummary {
  const reasons = safeReasons(typeof row.reasons === "string" ? row.reasons : null);
  const blockers: string[] = [];
  if (row.eligibilityStatus !== "ELIGIBLE") blockers.push("ELIGIBILITY_NOT_ELIGIBLE");
  if (Boolean(row.stale)) blockers.push("EVALUATION_BINDING_STALE");
  if (Number(row.unknownCount) > 0) blockers.push("MATERIAL_UNKNOWN");
  if (Number(row.conditionCount) > 0) blockers.push("MATERIAL_CONDITIONAL");
  if (Number(row.conflictCount) > 0) blockers.push("MATERIAL_CONFLICT");
  const scope = coverageSummary(
    sqlite,
    typeof row.jobVersionId === "string" ? row.jobVersionId : null,
  );
  if (scope.partialMaterialFamilyCount > 0) blockers.push("MATERIAL_SCOPE_PARTIAL");
  if (scope.observedMaterialFamilyCount === 0) blockers.push("NO_MATERIAL_EMPLOYER_SCOPE_OBSERVED");
  if (Number(row.coveragePercent) < R2_MINIMUM_EXTRACTION_COVERAGE)
    blockers.push("EXTRACTION_COVERAGE_INSUFFICIENT");
  if (Number(row.fitScore) < R2_RECOMMENDATION_THRESHOLD) blockers.push("SCORE_BELOW_THRESHOLD");
  const reasonCounts: Record<string, number> = {};
  for (const reason of reasons) {
    const code = reasonCode(reason.code);
    if (code) reasonCounts[code] = (reasonCounts[code] ?? 0) + 1;
  }
  const ownerQuestionIds = [
    ...new Set(
      reasons
        .filter((reason) => {
          const code = reasonCode(reason.code);
          const jobRefs = stringArray(reason.jobEvidenceReferences);
          const candidateRefs = stringArray(reason.candidateFactReferences);
          return Boolean(code) && jobRefs.length > 0 && candidateRefs.length > 0;
        })
        .map((reason) => `OWNER_FACT_${reasonCode(reason.code)}`),
    ),
  ];
  return {
    jobId: String(row.jobId),
    jobVersionId: typeof row.jobVersionId === "string" ? row.jobVersionId : null,
    evaluationId: typeof row.evaluationId === "string" ? row.evaluationId : null,
    eligibilityStatus: typeof row.eligibilityStatus === "string" ? row.eligibilityStatus : null,
    stale: Boolean(row.stale),
    fitScore: row.fitScore === null ? null : Number(row.fitScore),
    recommendationThreshold: R2_RECOMMENDATION_THRESHOLD,
    recommended: Boolean(row.recommended),
    recommendationBlockers: [...new Set(blockers)],
    blockerReasonCounts: reasonCounts,
    coveragePercent: row.coveragePercent === null ? null : Number(row.coveragePercent),
    unresolvedUnknownCount: Number(row.unknownCount ?? 0),
    unresolvedConditionCount: Number(row.conditionCount ?? 0),
    unresolvedConflictCount: Number(row.conflictCount ?? 0),
    queueState: typeof row.queueState === "string" ? row.queueState : null,
    queueFreshness: typeof row.queueFreshness === "string" ? row.queueFreshness : null,
    duplicateState:
      row.duplicateState === "UNRESOLVED"
        ? "UNRESOLVED"
        : row.duplicateState === "CLEAR"
          ? "CLEAR"
          : "NONE",
    calibrationState: typeof row.calibrationState === "string" ? row.calibrationState : null,
    ownerQuestionIds,
    ...scope,
  };
}

const readinessSelect = `
  SELECT e.job_id AS jobId,e.job_version_id AS jobVersionId,e.id AS evaluationId,e.eligibility_status AS eligibilityStatus,
         e.eligibility_reasons_json AS reasons,e.fit_score AS fitScore,e.recommended,
         e.coverage_percent AS coveragePercent,e.unresolved_unknown_count AS unknownCount,
         e.unresolved_condition_count AS conditionCount,e.unresolved_conflict_count AS conflictCount,
         e.stale,e.calibration_state AS calibrationState,
         (SELECT q.state FROM r2_queue_decision_versions q WHERE q.job_id=e.job_id ORDER BY q.version DESC LIMIT 1) AS queueState,
         (SELECT q.freshness FROM r2_queue_decision_versions q WHERE q.job_id=e.job_id ORDER BY q.version DESC LIMIT 1) AS queueFreshness,
         CASE WHEN EXISTS (
           SELECT 1 FROM r2_duplicate_candidates d
           WHERE d.state='SUGGESTED' AND (
             d.left_observation_id IN (SELECT id FROM source_observations WHERE job_id=e.job_id) OR
             d.right_observation_id IN (SELECT id FROM source_observations WHERE job_id=e.job_id)
           )
         ) THEN 'UNRESOLVED' ELSE 'CLEAR' END AS duplicateState
  FROM r2_evaluation_versions e
  WHERE e.id=(SELECT latest.id FROM r2_evaluation_versions latest
              WHERE latest.job_id=e.job_id ORDER BY latest.evaluated_at DESC,latest.rowid DESC LIMIT 1)
`;

export function readR2ReadinessSummary(
  sqlite: BetterSqlite3.Database,
  jobId?: string,
): R2ReadinessSummary[] {
  const rows = jobId
    ? sqlite.prepare(`${readinessSelect} AND e.job_id=?`).all(jobId)
    : sqlite.prepare(readinessSelect).all();
  return (rows as Array<Record<string, unknown>>).map((row) => summaryFromRow(row, sqlite));
}

export function aggregateR2BlockerReasonCounts(
  summaries: readonly R2ReadinessSummary[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const summary of summaries) {
    for (const [code, count] of Object.entries(summary.blockerReasonCounts)) {
      counts[code] = (counts[code] ?? 0) + count;
    }
    for (const code of summary.recommendationBlockers) {
      counts[code] = (counts[code] ?? 0) + 1;
    }
  }
  return counts;
}
