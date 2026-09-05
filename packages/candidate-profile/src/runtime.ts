import type { CandidateProfile } from "./index";

export type CandidateProfileRuntimeState =
  | "DEMO_PROFILE"
  | "PRIVATE_LOCAL_PROFILE"
  | "NO_ACTIVE_PROFILE"
  | "INVALID_PRIVATE_PROFILE";

export type JobEvaluationContext = "DEMO_FIXTURE_JOB" | "REAL_IMPORTED_JOB";

export type CandidateProfileResolution =
  | { state: "DEMO_PROFILE"; profile: CandidateProfile }
  | { state: "PRIVATE_LOCAL_PROFILE"; profile: CandidateProfile }
  | { state: "NO_ACTIVE_PROFILE"; reasonCode: "PRIVATE_PROFILE_MISSING" }
  | { state: "INVALID_PRIVATE_PROFILE"; reasonCode: "PRIVATE_PROFILE_INVALID" };

export interface CandidateProfileProvider {
  resolve(context: JobEvaluationContext): Promise<CandidateProfileResolution>;
}

export interface CandidateProfileStatusDto {
  state: CandidateProfileRuntimeState;
  label: "Demo" | "Private profile loaded" | "Private profile missing" | "Private profile invalid";
  evaluationAvailable: boolean;
}

export function enforceEvaluationProfile(
  context: JobEvaluationContext,
  resolution: CandidateProfileResolution,
): CandidateProfileResolution {
  if (context === "REAL_IMPORTED_JOB" && resolution.state === "DEMO_PROFILE") {
    return { state: "NO_ACTIVE_PROFILE", reasonCode: "PRIVATE_PROFILE_MISSING" };
  }
  if (context === "DEMO_FIXTURE_JOB" && resolution.state === "PRIVATE_LOCAL_PROFILE") {
    throw new Error("PROFILE_CONTEXT_MISMATCH");
  }
  return resolution;
}

export function toCandidateProfileStatusDto(
  resolution: CandidateProfileResolution,
): CandidateProfileStatusDto {
  switch (resolution.state) {
    case "DEMO_PROFILE":
      return { state: resolution.state, label: "Demo", evaluationAvailable: false };
    case "PRIVATE_LOCAL_PROFILE":
      return {
        state: resolution.state,
        label: "Private profile loaded",
        evaluationAvailable: true,
      };
    case "NO_ACTIVE_PROFILE":
      return {
        state: resolution.state,
        label: "Private profile missing",
        evaluationAvailable: false,
      };
    case "INVALID_PRIVATE_PROFILE":
      return {
        state: resolution.state,
        label: "Private profile invalid",
        evaluationAvailable: false,
      };
  }
}
