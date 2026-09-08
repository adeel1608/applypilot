import type BetterSqlite3 from "better-sqlite3";

import { candidateProfileContentHash, type CandidateProfile } from "@applypilot/candidate-profile";

export function assertCurrentDocumentGenerationTuple(input: {
  sqlite: BetterSqlite3.Database;
  profile: CandidateProfile;
  jobVersionId: string;
  evaluationVersionId: string;
}): { profileVersionId: string } {
  const tuple = input.sqlite
    .prepare(
      `SELECT e.job_version_id AS jobVersionId, e.profile_version_id AS profileVersionId,
              e.stale, p.id AS profileId, p.active_version_id AS activeProfileVersionId,
              pv.content_hash AS profileContentHash
       FROM evaluation_versions e
       JOIN candidate_profile_versions pv ON pv.id = e.profile_version_id
       JOIN candidate_profiles p ON p.id = pv.profile_id
       WHERE e.id = ?`,
    )
    .get(input.evaluationVersionId) as
    | {
        jobVersionId: string | null;
        profileVersionId: string;
        stale: number;
        profileId: string;
        activeProfileVersionId: string | null;
        profileContentHash: string;
      }
    | undefined;
  if (!tuple || tuple.stale || tuple.jobVersionId !== input.jobVersionId) {
    throw new Error("EVALUATION_STALE_REEVALUATE_REQUIRED");
  }
  if (
    tuple.profileId !== input.profile.profileId ||
    tuple.activeProfileVersionId !== tuple.profileVersionId ||
    tuple.profileContentHash !== candidateProfileContentHash(input.profile)
  ) {
    throw new Error("PROFILE_VERSION_STALE_REEVALUATE_REQUIRED");
  }
  return { profileVersionId: tuple.profileVersionId };
}
