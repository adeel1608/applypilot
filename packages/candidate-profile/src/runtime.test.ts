import { describe, expect, it } from "vitest";

import profileJson from "../../../data/profile.example.json";
import { parseCandidateProfile } from "./index";
import { enforceEvaluationProfile, toCandidateProfileStatusDto } from "./runtime";

describe("candidate profile runtime policy", () => {
  it("never permits a demo profile for real imported jobs", () => {
    const result = enforceEvaluationProfile("REAL_IMPORTED_JOB", {
      state: "DEMO_PROFILE",
      profile: parseCandidateProfile(profileJson),
    });
    expect(result).toEqual({ state: "NO_ACTIVE_PROFILE", reasonCode: "PRIVATE_PROFILE_MISSING" });
  });

  it("exposes only an allowlisted safe status DTO", () => {
    const dto = toCandidateProfileStatusDto({
      state: "PRIVATE_LOCAL_PROFILE",
      profile: parseCandidateProfile(profileJson),
    });
    expect(dto).toEqual({
      state: "PRIVATE_LOCAL_PROFILE",
      label: "Private profile loaded",
      evaluationAvailable: true,
    });
    expect(JSON.stringify(dto)).not.toContain(profileJson.contact.email.value);
  });
});
