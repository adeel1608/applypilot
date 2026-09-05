import profileJson from "../../../data/profile.example.json";
import { describe, expect, it } from "vitest";

import {
  CandidateProfileSchema,
  isExplicitlyUnsupported,
  parseCandidateProfile,
  verifiedCandidateName,
  verifiedSkillNames,
} from "./index";

describe("candidate truth store", () => {
  it("validates the fictional example and exposes only verified facts", () => {
    const profile = parseCandidateProfile(profileJson);
    expect(verifiedCandidateName(profile)).toBe("Jordan Example");
    expect(verifiedSkillNames(profile)).toContain("Customer service");
    expect(isExplicitlyUnsupported(profile, "POS experience")).toBe(true);
    expect(profile.candidatePreferences.requireFinalSubmissionConfirmation).toBe(true);
  });

  it("rejects malformed contact information", () => {
    const invalid = structuredClone(profileJson);
    invalid.contact.email.value = "not-an-email";
    expect(CandidateProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects employment references to unverified achievements", () => {
    const invalid = structuredClone(profileJson);
    invalid.employment[0].achievementIds = ["missing-achievement"];
    const result = CandidateProfileSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(({ message }) => message.includes("missing-achievement")),
      ).toBe(true);
    }
  });
});
