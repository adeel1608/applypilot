import { describe, expect, it } from "vitest";

import { seekFixtureCases } from "../../../../fixtures/seek/manifest";
import {
  classifyRequirement,
  createSeekRawJobRecord,
  normalizeSeekJob,
  normalizeSeekPostingDate,
  SeekAdapterError,
} from "./index";
import type { RequirementEvidence } from "./types";

describe("SEEK deterministic normalization", () => {
  it("matches every synthetic fixture expectation", () => {
    for (const fixture of seekFixtureCases) {
      if (fixture.expected.outcome !== "NORMALIZED") {
        expect(() => normalizeSeekJob(fixture.record)).toThrowError(SeekAdapterError);
        continue;
      }
      const job = normalizeSeekJob(fixture.record);
      expect(job.employmentType).toBe(fixture.expected.employmentType);
      expect(job.workRightsRequirement).toBe(fixture.expected.workRightsRequirement);
      const evidence = job.sourceMetadata.requirementEvidence as RequirementEvidence[];
      expect(evidence.map(({ classification }) => classification)).toEqual(
        fixture.expected.requirementClassifications,
      );
      expect(job.sourceMetadata.rawPayloadHash).toMatch(/^[a-f0-9]{64}$/);
      expect(job.sourceMetadata.provenance).toEqual(fixture.record.provenance);
    }
  });

  it("keeps valid and unrestricted work-rights semantics distinct", () => {
    const valid = normalizeSeekJob(
      seekFixtureCases.find(({ record }) => record.externalId === "seek-fixture-driver-007")!
        .record,
    );
    expect(valid.workRightsRequirement).toBe("VALID_AUSTRALIA");
    expect(valid.workRightsRequirement).not.toBe("UNRESTRICTED_AUSTRALIA");
  });

  it("honours negation and does not invent vehicle or experience requirements", () => {
    const retail = normalizeSeekJob(seekFixtureCases[0].record);
    expect(retail.requirements).not.toContain("No experience required");
    expect(retail.experienceRequirements).toEqual([
      expect.objectContaining({
        description: "Customer service experience preferred",
        mandatory: false,
        minimumYears: null,
      }),
    ]);
    expect(retail.vehicleRequirement).toBe("UNKNOWN");
    expect(classifyRequirement("Own vehicle available", "test").classification).toBe(
      "AMBIGUOUS_REQUIREMENT",
    );
  });

  it("parses only supported explicit and relative dates", () => {
    expect(
      normalizeSeekPostingDate(null, "Listed three days ago", "2026-09-05T12:00:00.000Z"),
    ).toEqual({ datePosted: "2026-09-02T12:00:00.000Z", warning: null });
    expect(
      normalizeSeekPostingDate(null, "Recently listed", "2026-09-05T12:00:00.000Z"),
    ).toMatchObject({ datePosted: null, warning: { code: "AMBIGUOUS_DATE" } });
    expect(normalizeSeekPostingDate("2027-01-01", null, "2026-09-05T12:00:00.000Z")).toMatchObject({
      datePosted: null,
      warning: { code: "INVALID_EXPLICIT_DATE" },
    });
  });

  it("preserves unknown requirement text as ambiguity with evidence", () => {
    const result = classifyRequirement("Familiarity with curious systems", "requirementTexts[0]");
    expect(result).toMatchObject({
      classification: "AMBIGUOUS_REQUIREMENT",
      ruleId: "NO_DETERMINISTIC_MARKER",
      negated: false,
    });
  });

  it("preserves explicitly captured unknown source fields without promoting them", () => {
    const record = createSeekRawJobRecord({
      ...seekFixtureCases[0].record,
      futureSourceField: { label: "Unmapped fixture value" },
    });
    const job = normalizeSeekJob(record);
    expect(job.sourceMetadata.unknownFields).toEqual({
      futureSourceField: { label: "Unmapped fixture value" },
    });
    expect(job.description).not.toContain("Unmapped fixture value");
  });

  it("uses an explicitly supplied advertiser label but never invents a missing company", () => {
    const advertised = createSeekRawJobRecord({
      ...seekFixtureCases[0].record,
      company: null,
      advertiser: "Confidential advertiser",
      rawPayload: { fixture: "advertiser-label", revision: 1 },
      rawPayloadHash: undefined,
    });
    expect(normalizeSeekJob(advertised).company).toBe("Confidential advertiser");
    expect(() => normalizeSeekJob(seekFixtureCases[10].record)).toThrowError(
      /Required normalized fields are missing: company/,
    );
  });
});
