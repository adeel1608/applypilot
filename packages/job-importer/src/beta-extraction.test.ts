import { describe, expect, it } from "vitest";

import { extractBetaJobFields, extractRequirementEvidence } from "./index";

describe("Beta job extraction", () => {
  it("preserves exact evidence spans and separates requirement modality", () => {
    const text = [
      "Requirements:",
      "- You must have Australian work rights.",
      "- Customer service experience is preferred.",
      "- If working nights, RSA is required.",
      "- A driver's licence is not required.",
    ].join("\n");
    const evidence = extractRequirementEvidence(text);

    expect(evidence.map(({ modality }) => modality)).toEqual([
      "REQUIRED",
      "PREFERRED",
      "CONDITIONAL",
      "NEGATED",
    ]);
    for (const item of evidence) {
      expect(text.slice(item.start, item.end)).toBe(item.originalText);
      expect(item.ruleId).toMatch(/^REQ_/);
      expect(item.extractorVersion).toBe("2.0.0");
    }
  });

  it("extracts explicit Australian fields without inventing absent values", () => {
    const result = extractBetaJobFields({
      location: "Preston VIC 3072",
      text: [
        "Location: Preston VIC 3072",
        "Salary: $28.50–$31.25 per hour",
        "Hours: 20 to 24 hours per week and 40 hours per fortnight",
        "A resume is required. No cover letter is required.",
        "Customer service experience is preferred.",
      ].join("\n"),
    });

    expect(result.location).toEqual({
      suburb: "Preston",
      postcode: "3072",
      state: "VIC",
      country: "Australia",
    });
    expect(result.salary).toMatchObject({ minimum: 28.5, maximum: 31.25, period: "HOUR" });
    expect(result.hoursPerWeek).toEqual({ minimum: 20, maximum: 24 });
    expect(result.hoursPerFortnight).toEqual({ minimum: 40, maximum: 40 });
    expect(result.documentRequirements).toMatchObject({
      resume: "REQUIRED",
      coverLetter: "NOT_REQUIRED",
    });
    expect(result.trainingProvided).toBeNull();
  });
});
