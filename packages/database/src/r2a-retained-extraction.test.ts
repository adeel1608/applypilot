import { describe, expect, it } from "vitest";

import {
  SourceCapabilityV2Schema,
  readGreenhousePostingV2FromPayload,
} from "@applypilot/job-sources";
import { assertR2ASourcePointers } from "@applypilot/job-model";
import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import { currentR2Bindings } from "../../../fixtures/r2/test-helpers";
import { testProfile } from "../../../tests/fixture-data";
import {
  assertR2AExcerptHashes,
  normalizeR2AJobEvidence,
  serializeR2AStructuredSource,
} from "@applypilot/job-importer";

import {
  structuredGreenhouseEvidenceRecord,
  structuredGreenhouseRecord,
} from "./source-enablement-repository";

const capability = SourceCapabilityV2Schema.parse({
  schemaVersion: 2,
  capabilityId: "fictional-retained-extraction",
  version: 1,
  predecessorVersion: null,
  source: "GREENHOUSE",
  alias: "Fictional shop",
  tenant: "fictional",
  region: "GLOBAL",
  allowedHost: "boards-api.greenhouse.io",
  allowedPathPrefix: "/v1/boards/fictional/",
  allowedOperations: ["LIST_JOBS"],
  approvalState: "REVOKED",
  approvalReference: null,
  approvedAt: null,
  policyVersion: "fictional",
  policyReviewedAt: "2026-10-01T00:00:00.000Z",
  policyExpiresAt: "2026-10-02T00:00:00.000Z",
  capabilityExpiresAt: "2026-10-02T00:00:00.000Z",
  requestBudget: 1,
  recordCap: 100,
  pageSizeCap: 100,
  responseByteLimit: 2_000_000,
  requestTimeoutMs: 30_000,
  runTimeoutMs: 120_000,
  maxRedirects: 0,
  maxRetries: 0,
  maxConcurrency: 1,
  parserVersion: "fictional",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  revokedAt: "2026-10-02T00:00:00.000Z",
  revocationReason: "SECURITY_STOP",
});

function normalizePosting(content: string) {
  const record = readGreenhousePostingV2FromPayload({
    capability,
    payload: {
      id: 8100,
      title: "Fictional Shop Associate",
      absolute_url: "https://boards.greenhouse.io/fictional/jobs/8100",
      location: { name: "Melbourne VIC Australia" },
      content,
      updated_at: null,
    },
  });
  const structured = structuredGreenhouseEvidenceRecord(record, capability);
  const sourceText = serializeR2AStructuredSource(structured);
  const normalization = normalizeR2AJobEvidence({
    sourceText,
    structured,
    diagnosticStructure: structuredGreenhouseRecord(record, capability),
    sourceObservationId: "fictional-retained-observation",
    explicitLocation: record.location,
  });
  assertR2ASourcePointers(normalization, sourceText);
  assertR2AExcerptHashes(normalization);
  return { normalization, sourceText };
}

describe("retained production-source extraction regressions", () => {
  it.each(["", " "])(
    "resets narrative scope at a nested block-open heading (%s) without erasing a real licence",
    (gap) => {
      const { normalization, sourceText } = normalizePosting(
        `&lt;div&gt;If you were here last week, you might have${gap}&lt;h2&gt;Requirements&lt;/h2&gt;&lt;p&gt;Forklift licence&lt;/p&gt;&lt;/div&gt;`,
      );
      expect(JSON.parse(sourceText).description).toContain("<div>");
      expect(normalization.requirementEvidence).toContainEqual(
        expect.objectContaining({
          canonicalKind: "LICENCE",
          modality: "UNKNOWN",
          source: expect.objectContaining({
            excerpt: "Forklift licence",
            sourcePath: expect.stringContaining("structured.description.item."),
          }),
        }),
      );
      expect(normalization.requirementEvidence).toHaveLength(1);
    },
  );
  it("preserves the existing inert HTML depth boundary", () => {
    expect(() =>
      normalizePosting(
        `${"&lt;div&gt;".repeat(300)}Python skills required.${"&lt;/div&gt;".repeat(300)}`,
      ),
    ).toThrow();
    const result = normalizePosting(
      "&lt;p&gt;Python programming &lt;b&gt;skills&lt;/b&gt; are required.&lt;/p&gt;",
    );
    expect(result.normalization.requirementEvidence).toContainEqual(
      expect.objectContaining({ canonicalKind: "SKILL", modality: "REQUIRED" }),
    );
  });
  it.each(["", ":", "...", "…"])(
    "excludes criteria headings (%s) and explicit invitations despite skill vocabulary",
    (punctuation) => {
      const { normalization } = normalizePosting(
        `You could be the one if you have${punctuation}\nCommunication skills are required.\nEven if you don't tick every box in these skills requirements, we'd love to hear from you.`,
      );
      expect(normalization.requirementEvidence.map(({ source }) => source.excerpt)).toEqual([
        "Communication skills are required.",
      ]);
    },
  );

  it("keeps contrasted vendor categories out of blanket licence scope", () => {
    const { normalization } = normalizePosting(
      "Freelancer if you have a business license; private individual if you do not have a business license.",
    );
    expect(normalization.requirementEvidence).toEqual([]);
    expect(normalization.coverage.find(({ family }) => family === "LICENCES")?.state).toBe(
      "UNKNOWN",
    );
  });
  it.each([
    "Over 3 years of retail experience is required.",
    "At least 18 months of programming experience is required.",
  ])("preserves genuine experience rather than age: %s", (text) => {
    const { normalization } = normalizePosting(text);
    expect(normalization.requirementEvidence).toContainEqual(
      expect.objectContaining({ canonicalKind: "EXPERIENCE", modality: "REQUIRED" }),
    );
    expect(
      normalization.requirementEvidence.some(({ canonicalKind }) => canonicalKind === "AGE"),
    ).toBe(false);
  });

  it.each([
    ["A driver's licence is required if you drive a company vehicle.", "CONDITIONAL"],
    ["You must hold a driver's licence when driving company vehicles.", "CONDITIONAL"],
    ["A driver's licence is required unless a colleague drives.", "CONDITIONAL"],
    ["A business license is mandatory for all applicants.", "REQUIRED"],
    ["A freelancer must hold a business license.", "REQUIRED"],
    ["A licence may be required where applicable.", "CONDITIONAL"],
  ])("preserves actual licence wording: %s", (text, modality) => {
    const { normalization } = normalizePosting(text);
    expect(normalization.requirementEvidence).toContainEqual(
      expect.objectContaining({ modality, source: expect.objectContaining({ excerpt: text }) }),
    );
    expect(normalization.coverage.find(({ family }) => family === "LICENCES")?.state).not.toBe(
      "UNKNOWN",
    );
  });

  it.each([
    "You must have the ability to remain composed when helping customers.",
    "Ability to communicate when a customer has questions is required.",
    "Ability to assist customers when needed is required.",
  ])("keeps operational skill context separate from applicant conditions: %s", (text) => {
    const { normalization } = normalizePosting(text);
    expect(normalization.requirementEvidence).toContainEqual(
      expect.objectContaining({ canonicalKind: "SKILL", modality: "REQUIRED", condition: null }),
    );
  });

  it.each([
    "Ability to operate equipment when medically cleared is required.",
    "Ability to operate equipment when authorised is required.",
    "Ability to operate equipment when a medical clearance has been provided is required.",
    "Ability to operate equipment when the prerequisite is satisfied is required.",
    "Ability to assist customers when needed and after medical clearance is required.",
    "Ability to assist customers when needed when medically cleared is required.",
    "Ability to assist customers when needed is required if assigned to the counter.",
    "Ability to assist customers when needed is required unless supervised.",
  ])("retains genuine or ambiguous when prerequisites in the complete skill row: %s", (text) => {
    const { normalization } = normalizePosting(text);
    expect(normalization.requirementEvidence).toHaveLength(1);
    expect(normalization.requirementEvidence[0]).toMatchObject({
      canonicalKind: "SKILL",
      family: "SKILLS",
      state: "SOURCE_STATED",
      modality: "CONDITIONAL",
      condition: text.slice(text.indexOf("when")).replace(/\.$/, ""),
      normalizedValue: { kind: "TEXT", value: text },
      source: { excerpt: text },
      extractorVersion: "3.6.5",
      ownerCorrectionId: null,
      derivationInputIds: [],
      conflictSetId: null,
    });
  });

  it.each([
    ["Ability to assist customers when needed is not required.", "NEGATED"],
    ["Ability to assist customers when needed is preferred.", "PREFERRED"],
  ])("preserves the polarity of routine wording: %s", (text, modality) => {
    const { normalization } = normalizePosting(text);
    expect(normalization.requirementEvidence).toHaveLength(1);
    expect(normalization.requirementEvidence[0]).toMatchObject({
      canonicalKind: "SKILL",
      family: "SKILLS",
      state: "SOURCE_STATED",
      modality,
      condition: null,
      normalizedValue: { kind: "TEXT", value: text },
      source: { excerpt: text },
    });
  });

  it("preserves a genuine conditional skill prerequisite", () => {
    const { normalization } = normalizePosting(
      "Python knowledge is required if assigned to automation.",
    );
    expect(normalization.requirementEvidence).toContainEqual(
      expect.objectContaining({ canonicalKind: "SKILL", modality: "CONDITIONAL" }),
    );
    const separateCondition = normalizePosting(
      "Ability to communicate when busy is required, subject to security clearance.",
    ).normalization;
    expect(separateCondition.requirementEvidence).toContainEqual(
      expect.objectContaining({ canonicalKind: "SKILL", modality: "CONDITIONAL" }),
    );
  });

  it.each([
    "Minimum of 5 hours per week and maximum of 20 hours per month.",
    "Minimum of 5 hours per week. Maximum of 20 hours per week.",
    "5 hours per week for training, 20 hours per week for support.",
    "Minimum of 20 hours per week, maximum of 5 hours per week.",
    "Minimum of 5 hours per week or maximum of 20 hours per week.",
  ])("preserves separate, alternative, mixed-unit or invalid hour claims: %s", (text) => {
    const { normalization } = normalizePosting(text);
    expect(normalization.fieldEvidence.filter(({ family }) => family === "HOURS")).toHaveLength(2);
    expect(
      normalization.fieldEvidence.some(
        ({ normalizedValue }) =>
          normalizedValue.kind === "HOURS" &&
          normalizedValue.value.minimum === 5 &&
          normalizedValue.value.maximum === 20,
      ),
    ).toBe(false);
    if (!text.includes("month"))
      expect(
        normalization.conflicts.some(({ canonicalField }) => canonicalField === "hours.week"),
      ).toBe(true);
  });

  it("preserves bounded escaped JSON, Unicode, entities and inline HTML evidence", () => {
    const content =
      "&lt;p&gt;Fictional 🚀 introduction.&lt;/p&gt;&lt;p&gt;Python &amp;amp; C++ programming skills are required.&lt;/p&gt;&lt;p&gt;Must be 18+ years old.&lt;/p&gt;";
    const first = normalizePosting(content);
    const second = normalizePosting(content);
    expect(first).toEqual(second);
    const skill = first.normalization.requirementEvidence.find(
      ({ canonicalKind }) => canonicalKind === "SKILL",
    );
    const age = first.normalization.requirementEvidence.find(
      ({ canonicalKind }) => canonicalKind === "AGE",
    );
    expect(skill?.source.excerpt).toContain("Python &amp; C++ programming skills");
    expect(age?.source.excerpt).toBe("Must be 18+ years old.");
    expect(age!.source.start).toBeGreaterThan(skill!.source.end);
  });
  it("keeps explicit adult age out of experience requirements", () => {
    const { normalization } = normalizePosting("Requirements\nMust be 18+ years old.");
    expect(normalization.requirementEvidence).toContainEqual(
      expect.objectContaining({ canonicalKind: "AGE", modality: "REQUIRED" }),
    );
    expect(
      normalization.requirementEvidence.some(({ canonicalKind }) => canonicalKind === "EXPERIENCE"),
    ).toBe(false);
    const eligibility = evaluateR2Eligibility({
      profile: testProfile,
      normalization,
      bindings: currentR2Bindings,
      evaluatedAt: "2026-10-18T00:00:00.000Z",
    });
    expect(eligibility.status).toBe("REVIEW_REQUIRED");
    expect(
      eligibility.reasons.some(({ code }) => code === "R2_MANDATORY_CAPABILITY_UNCONFIRMED"),
    ).toBe(true);
  });

  it("coordinates explicit minimum and maximum hours in one weekly proposition", () => {
    const { normalization } = normalizePosting(
      "Commit to a minimum of 5 hours per week, maximum of 20 hours per week.",
    );
    const hours = normalization.fieldEvidence.filter(({ family }) => family === "HOURS");
    expect(hours).toHaveLength(1);
    expect(hours[0]?.normalizedValue).toEqual({
      kind: "HOURS",
      value: { minimum: 5, maximum: 20, unit: "WEEK" },
    });
    expect(
      normalization.conflicts.some(({ canonicalField }) => canonicalField === "hours.week"),
    ).toBe(false);
  });

  it("does not promote rhetorical headings or calls to apply into conditions", () => {
    const { normalization } = normalizePosting(
      "You could be the one if you have:\nCustomer service skills are required.\nIf you are excited about this opportunity, click apply.",
    );
    expect(normalization.requirementEvidence.map(({ source }) => source.excerpt)).toEqual([
      "Customer service skills are required.",
    ]);
  });

  it("does not turn a hypothetical past-week illustration into applicant conditions or schedule", () => {
    const { normalization } = normalizePosting(
      "If you were here last week, you might have:\nHelped a customer on Saturday when they visited the shop.\nRequirements:\nPython programming skills are required.",
    );
    expect(normalization.requirementEvidence.map(({ source }) => source.excerpt)).toEqual([
      "Python programming skills are required.",
    ]);
    expect(normalization.fieldEvidence.some(({ family }) => family === "SCHEDULE")).toBe(false);
  });

  it.each(["", "LOCATION AND HOURS\n"])(
    "preserves a real document directive after illustrative text (%s)",
    (heading) => {
      const { normalization } = normalizePosting(
        `If you were here last week, you might have:\nHelped customers on Saturday when they visited.\n${heading}You need to upload your resume to apply.`,
      );
      expect(normalization.requirementEvidence).toContainEqual(
        expect.objectContaining({
          canonicalKind: "DOCUMENT",
          modality: "REQUIRED",
          normalizedValue: {
            kind: "DOCUMENT",
            value: { documentKind: "CV_RESUME", state: "REQUIRED", name: null },
          },
        }),
      );
      expect(normalization.fieldEvidence).toContainEqual(
        expect.objectContaining({
          canonicalField: "documents.cvResume",
          normalizedValue: {
            kind: "DOCUMENT",
            value: { documentKind: "CV_RESUME", state: "REQUIRED", name: null },
          },
        }),
      );
      expect(normalization.fieldEvidence.some(({ family }) => family === "SCHEDULE")).toBe(false);
    },
  );

  it("preserves a document directive within an otherwise optional invitation", () => {
    const { normalization } = normalizePosting(
      "Even if you don't tick every box, we'd love to hear from you; you need to upload your resume.",
    );
    expect(normalization.requirementEvidence).toContainEqual(
      expect.objectContaining({ canonicalKind: "DOCUMENT", modality: "REQUIRED" }),
    );
    expect(normalization.fieldEvidence).toContainEqual(
      expect.objectContaining({
        canonicalField: "documents.cvResume",
        normalizedValue: {
          kind: "DOCUMENT",
          value: { documentKind: "CV_RESUME", state: "REQUIRED", name: null },
        },
      }),
    );
    expect(
      normalization.requirementEvidence.some(({ modality }) => modality === "CONDITIONAL"),
    ).toBe(false);
  });

  it("separates a call to apply from a genuine document directive in one paragraph", () => {
    const { normalization } = normalizePosting(
      "If you are excited about the opportunity, click apply. You need to upload your resume.",
    );
    expect(normalization.requirementEvidence).toHaveLength(1);
    expect(normalization.requirementEvidence[0]).toMatchObject({
      canonicalKind: "DOCUMENT",
      modality: "REQUIRED",
    });
  });

  it("does not make explanatory vendor licence definitions applicant licence scope", () => {
    const { normalization } = normalizePosting(
      "Vendor types\nA private individual means a person without a business licence, whereas a freelancer is a registered business.\nRequirements:\nPython knowledge is required.",
    );
    expect(normalization.coverage.find(({ family }) => family === "LICENCES")?.state).toBe(
      "UNKNOWN",
    );
    expect(
      normalization.requirementEvidence.some(({ canonicalKind }) => canonicalKind === "LICENCE"),
    ).toBe(false);
  });

  it("anchors escaped HTML statements after the first 1000 immutable source code units", () => {
    const padding = "Fictional company introduction. ".repeat(45);
    const { normalization, sourceText } = normalizePosting(
      `&lt;p&gt;${padding}&lt;/p&gt;&lt;p&gt;Applicants must have Python programming skills.&lt;/p&gt;`,
    );
    const skill = normalization.requirementEvidence.find(
      ({ canonicalKind }) => canonicalKind === "SKILL",
    );
    expect(skill?.source.excerpt).toContain("Python programming skills");
    expect(skill?.source.start).toBeGreaterThan(1000);
    expect(sourceText.slice(skill!.source.start, skill!.source.end)).toBe(skill?.source.excerpt);
  });
});
