import { describe, expect, it } from "vitest";

import {
  R2JobFieldEvidenceSchema,
  SourceEvidencePointerSchema,
  assertR2ASourcePointers,
} from "@applypilot/job-model";
import { r2aGoldenFixtures } from "../../../fixtures/r2a/manifest";
import { normalizeR2AJobEvidence, parseR2ASections } from "./r2a-normalization";

describe("R2A evidence normalization", () => {
  it("accepts only bounded source pointers and linked derived/conflicting evidence", () => {
    expect(() =>
      SourceEvidencePointerSchema.parse({
        sourcePath: "visibleText",
        start: 0,
        end: 6,
        sourceLength: 5,
        excerpt: "123456",
        excerptHash: "a".repeat(64),
      }),
    ).toThrow();
    expect(() =>
      R2JobFieldEvidenceSchema.parse({
        id: "derived",
        sourceObservationId: "observation",
        jobVersionId: null,
        family: "IDENTITY",
        canonicalField: "title",
        state: "DERIVED",
        modality: null,
        source: {
          sourcePath: "visibleText",
          start: 0,
          end: 4,
          sourceLength: 4,
          excerpt: "Role",
          excerptHash: "a".repeat(64),
        },
        normalizedValue: { kind: "TEXT", value: "Role" },
        extractorVersion: "3.0.0",
        ruleId: "fixture",
        derivationInputIds: [],
        ownerCorrectionId: null,
        conflictSetId: null,
      }),
    ).toThrow();
  });

  it("parses ordinary headings without requiring colons", () => {
    const sections = parseR2ASections(
      "Requirements\n- Skill required\nWhat you'll do\n- Serve guests",
    );
    expect(sections.map(({ heading }) => heading)).toEqual(["requirements", "what you'll do"]);
    expect(sections[0]?.items[0]?.text).toBe("Skill required");
  });

  it.each(r2aGoldenFixtures)("normalizes fictional $id with complete provenance", (fixture) => {
    const result = normalizeR2AJobEvidence({
      sourceText: fixture.text,
      sourceObservationId: `observation:${fixture.id}`,
      structured: fixture.structured,
      explicitLocation: fixture.location,
    });
    assertR2ASourcePointers(result, fixture.text);
    expect(result.parserVersion).toBe("3.0.0");
    expect(result.coverage).toHaveLength(17);
    for (const family of fixture.expectedFamilies) {
      expect(result.coverage.find((item) => item.family === family)?.state).not.toBe("UNKNOWN");
    }
    for (const expected of fixture.expectedModalities ?? []) {
      expect(result.requirementEvidence.some(({ modality }) => modality === expected)).toBe(true);
    }
  });

  it("keeps structured and prose employment conflicts instead of choosing one", () => {
    const fixture = r2aGoldenFixtures.find(({ id }) => id === "structured-conflict")!;
    const result = normalizeR2AJobEvidence({
      sourceText: fixture.text,
      sourceObservationId: "observation:conflict",
      structured: fixture.structured,
      explicitLocation: fixture.location,
    });
    const employment = result.fieldEvidence.filter(
      ({ canonicalField }) => canonicalField === "employment.type",
    );
    expect(
      new Set(employment.map(({ normalizedValue }) => JSON.stringify(normalizedValue))).size,
    ).toBe(2);
    expect(
      employment.every(({ state, conflictSetId }) => state === "CONFLICTING" && conflictSetId),
    ).toBe(true);
  });

  it("keeps valid and unrestricted work-right wording distinct", () => {
    const source =
      "Requirements\nValid Australian work rights required\nUnrestricted work rights preferred";
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      sourceObservationId: "observation:rights",
    });
    const kinds = result.requirementEvidence
      .filter(({ family }) => family === "WORK_RIGHTS")
      .map(
        ({ normalizedValue }) =>
          normalizedValue.kind === "WORK_RIGHTS" && normalizedValue.value.kind,
      );
    expect(kinds).toContain("VALID_AUSTRALIAN_WORK_RIGHTS");
    expect(kinds).toContain("UNRESTRICTED_WORK_RIGHTS");
  });

  it("retains weekly and fortnightly hours as separate units", () => {
    const source = "Hours\n20 hours per week\n40 hours per fortnight";
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      sourceObservationId: "observation:hours",
    });
    const units = result.fieldEvidence.flatMap(({ normalizedValue }) =>
      normalizedValue.kind === "HOURS" ? [normalizedValue.value.unit] : [],
    );
    expect(units).toEqual(expect.arrayContaining(["WEEK", "FORTNIGHT"]));
  });

  it("uses UNKNOWN salary period and true tri-state document requirements", () => {
    const source = "Salary: $90000\nDocuments\nPlease send a cover letter\nCV not required";
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      sourceObservationId: "observation:unknowns",
    });
    const salary = result.fieldEvidence.find(
      ({ normalizedValue }) => normalizedValue.kind === "SALARY",
    );
    expect(salary?.normalizedValue.kind === "SALARY" && salary.normalizedValue.value.period).toBe(
      "UNKNOWN",
    );
    const documents = result.fieldEvidence.flatMap(({ normalizedValue }) =>
      normalizedValue.kind === "DOCUMENT" ? [normalizedValue.value] : [],
    );
    expect(documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ documentKind: "COVER_LETTER", state: "UNKNOWN" }),
        expect.objectContaining({ documentKind: "CV_RESUME", state: "NOT_REQUIRED" }),
      ]),
    );
  });

  it("does not treat employment words in benefit prose as scoped employment evidence", () => {
    const source =
      "Benefits\nFull-time parking support is available\nRequirements\nCustomer service skill required";
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      sourceObservationId: "observation:scope",
    });
    expect(result.fieldEvidence.filter(({ family }) => family === "EMPLOYMENT")).toHaveLength(0);
    expect(result.coverage.find(({ family }) => family === "EMPLOYMENT")?.state).toBe("UNKNOWN");
  });

  it("keeps commute duration and distance as separate typed evidence", () => {
    const source = "Travel\nCommute is 35 minutes\nCommute distance is 18 km";
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      sourceObservationId: "observation:commute",
    });
    const commute = result.fieldEvidence.filter(({ canonicalField }) =>
      canonicalField.startsWith("commute."),
    );
    expect(commute.map(({ canonicalField }) => canonicalField)).toEqual(
      expect.arrayContaining(["commute.duration", "commute.distance"]),
    );
    expect(
      commute.find(({ canonicalField }) => canonicalField === "commute.duration"),
    ).toMatchObject({ normalizedValue: { value: { durationMinutes: 35, distanceKm: null } } });
    expect(
      commute.find(({ canonicalField }) => canonicalField === "commute.distance"),
    ).toMatchObject({ normalizedValue: { value: { durationMinutes: null, distanceKm: 18 } } });
  });

  it("preserves conditional state separately from conditional modality", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: "Requirements\nRSA must be obtained within 30 days",
      sourceObservationId: "observation:conditional",
    });
    expect(result.requirementEvidence[0]).toMatchObject({
      state: "CONDITIONAL",
      modality: "CONDITIONAL",
    });
  });

  it("marks conflicting closing dates without overwriting either value", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: "Closing date: 10 October 2026\nApplications close: 12 October 2026",
      sourceObservationId: "observation:dates",
    });
    const closing = result.fieldEvidence.filter(
      ({ canonicalField }) => canonicalField === "dates.closing",
    );
    expect(closing).toHaveLength(2);
    expect(closing.every(({ state }) => state === "CONFLICTING")).toBe(true);
  });

  it("keeps structured and prose location conflicts linked", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: '{"location":"Perth WA 6000"}\nLocation: Sydney NSW 2000',
      sourceObservationId: "observation:location-priority",
      structured: { location: "Perth WA 6000" },
      explicitLocation: "Sydney NSW 2000",
    });
    const locations = result.fieldEvidence.filter(
      ({ canonicalField }) => canonicalField === "location.alternative",
    );
    expect(locations).toHaveLength(2);
    expect(
      locations.every(({ state, conflictSetId }) => state === "CONFLICTING" && conflictSetId),
    ).toBe(true);
  });

  it("distinguishes training not provided from training provided", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: "Benefits\nNo training is provided",
      sourceObservationId: "observation:training",
    });
    expect(
      result.fieldEvidence.find(({ family }) => family === "TRAINING")?.normalizedValue,
    ).toMatchObject({ value: { state: "NOT_PROVIDED" } });
  });
});
