import BetterSqlite3 from "better-sqlite3";

import { aggregateR2BlockerReasonCounts, readR2ReadinessSummary } from "@applypilot/database";
import { localDatabasePath } from "./lib/runtime-safety";

const jobId = process.argv[2];
const readonly = new BetterSqlite3(localDatabasePath(), { readonly: true, fileMustExist: true });
try {
  const summaries = readR2ReadinessSummary(readonly, jobId);
  console.log(`R2_READINESS_SUMMARY count=${summaries.length} candidate_values=NONE`);
  for (const summary of summaries) {
    console.log(
      JSON.stringify({
        jobId: summary.jobId,
        evaluationId: summary.evaluationId,
        eligibilityStatus: summary.eligibilityStatus,
        stale: summary.stale,
        fitScore: summary.fitScore,
        recommendationThreshold: summary.recommendationThreshold,
        recommended: summary.recommended,
        recommendationBlockers: summary.recommendationBlockers,
        blockerReasonCounts: summary.blockerReasonCounts,
        coveragePercent: summary.coveragePercent,
        unresolvedUnknownCount: summary.unresolvedUnknownCount,
        unresolvedConditionCount: summary.unresolvedConditionCount,
        unresolvedConflictCount: summary.unresolvedConflictCount,
        queueState: summary.queueState,
        queueFreshness: summary.queueFreshness,
        duplicateState: summary.duplicateState,
        calibrationState: summary.calibrationState,
        ownerQuestionIds: summary.ownerQuestionIds,
      }),
    );
  }
  console.log(
    JSON.stringify({ aggregateBlockerReasonCounts: aggregateR2BlockerReasonCounts(summaries) }),
  );
} finally {
  readonly.close();
}
