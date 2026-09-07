import { describe, expect, it } from "vitest";

import { fixtureJob, testProfile } from "../../../tests/fixture-data";
import {
  coverLetterFileName,
  coverLetterRequirementStatus,
  generateBasicCoverLetter,
  validateCoverLetterTruth,
} from "./index";

describe("cover-letter foundation", () => {
  it("uses the actual employer, role and verified claim references", () => {
    const job = fixtureJob("job-junior-receptionist");
    const letter = generateBasicCoverLetter(testProfile, job);
    expect(letter.employer).toBe(job.company);
    expect(letter.roleTitle).toBe(job.title);
    expect(letter.paragraphs.join(" ")).toContain(job.company);
    expect(
      letter.claims.every(({ profileFactReferences }) => profileFactReferences.length > 0),
    ).toBe(true);
    expect(letter.requiresHumanReview).toBe(true);
    expect(validateCoverLetterTruth(letter, testProfile)).toEqual({ valid: true, errors: [] });
  });

  it("uses the safe naming convention", () => {
    expect(coverLetterFileName(testProfile, "Merri Allied Health")).toBe(
      "JORDAN COVER LETTER (Merri Allied Health).pdf",
    );
  });

  it("preserves UNKNOWN requirements and changes tone without changing evidence", () => {
    const job = fixtureJob("job-retail-sales-assistant");
    expect(coverLetterRequirementStatus(job)).toBe("UNKNOWN");
    const warmProfile = {
      ...testProfile,
      candidatePreferences: {
        ...testProfile.candidatePreferences,
        coverLetterTone: "WARM" as const,
      },
    };
    const letter = generateBasicCoverLetter(warmProfile, job);
    expect(letter.tone).toBe("WARM");
    expect(letter.paragraphs[0]).toContain("pleased to apply");
    expect(
      letter.claims.every(({ profileFactReferences }) => profileFactReferences.length > 0),
    ).toBe(true);
  });

  it("rejects arbitrary prose attached to a verified skill ID", () => {
    const letter = generateBasicCoverLetter(testProfile, fixtureJob("job-retail-sales-assistant"));
    letter.claims[0] = {
      text: "I managed a global sales division.",
      profileFactReferences: [testProfile.skills[0]!.id],
    };
    expect(validateCoverLetterTruth(letter, testProfile).valid).toBe(false);
  });
});
