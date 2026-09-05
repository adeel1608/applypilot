import { describe, expect, it } from "vitest";

import { fixtureJob, testProfile } from "../../../tests/fixture-data";
import { coverLetterFileName, generateBasicCoverLetter } from "./index";

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
  });

  it("uses the safe naming convention", () => {
    expect(coverLetterFileName(testProfile, "Merri Allied Health")).toBe(
      "JORDAN COVER LETTER (Merri Allied Health).pdf",
    );
  });
});
