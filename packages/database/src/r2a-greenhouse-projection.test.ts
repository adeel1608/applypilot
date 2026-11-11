import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  SourceCapabilityV2Schema,
  R2AFailureDiagnosticSchema,
  classifyR2ASchemaFailure,
  readGreenhousePostingV2FromPayload,
} from "@applypilot/job-sources";
import { R2ANormalizationSchema, assertR2ASourcePointers } from "@applypilot/job-model";
import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import { currentR2Bindings } from "../../../fixtures/r2/test-helpers";
import { testProfile } from "../../../tests/fixture-data";
import {
  assertR2AExcerptHashes,
  normalizeR2AJobEvidence,
  R2ADiagnosticError,
  r2aStructuralMetrics,
  serializeR2AStructuredSource,
} from "@applypilot/job-importer";

import {
  structuredGreenhouseEvidenceRecord,
  structuredGreenhouseRecord,
} from "./source-enablement-repository";

const capability = SourceCapabilityV2Schema.parse({
  schemaVersion: 2,
  capabilityId: "fictional-r2a-projection",
  version: 1,
  predecessorVersion: null,
  source: "GREENHOUSE",
  alias: "Fictional board",
  tenant: "fictional",
  region: "GLOBAL",
  allowedHost: "boards-api.greenhouse.io",
  allowedPathPrefix: "/v1/boards/fictional/",
  allowedOperations: ["LIST_JOBS"],
  approvalState: "APPROVED",
  approvalReference: "fictional-only",
  approvedAt: "2026-10-05T00:00:00.000Z",
  policyVersion: "fictional-only",
  policyReviewedAt: "2026-10-05T00:00:00.000Z",
  policyExpiresAt: "2026-10-06T00:00:00.000Z",
  capabilityExpiresAt: "2026-10-06T00:00:00.000Z",
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
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
  revokedAt: null,
  revocationReason: null,
});

function makeNestedMetadata(depth: number) {
  let value: unknown = "fictional-marker";
  for (let index = 0; index < depth; index += 1) value = { value };
  return value;
}

function normalizeFictionalPosting(content: string) {
  const record = readGreenhousePostingV2FromPayload({
    payload: {
      id: 123,
      title: "Fictional Associate Engineer",
      absolute_url: "https://boards.greenhouse.io/fictional/jobs/123",
      location: { name: "Melbourne VIC Australia" },
      content,
      updated_at: null,
    },
    capability,
  });
  const recordBeforeProjection = JSON.stringify(record);
  const structured = structuredGreenhouseEvidenceRecord(record, capability);
  expect(JSON.stringify(record)).toBe(recordBeforeProjection);
  expect(structuredGreenhouseRecord(record, capability).description).toBe(record.description);
  const sourceText = JSON.stringify(structured);
  const normalization = normalizeR2AJobEvidence({
    sourceText,
    structured,
    diagnosticStructure: structuredGreenhouseRecord(record, capability),
    sourceObservationId: "fictional-schema-regression",
    explicitLocation: record.location,
  });
  assertR2ASourcePointers(normalization, sourceText);
  assertR2AExcerptHashes(normalization);
  return { normalization, sourceText, record, structured };
}

// Greenhouse can retain entity-encoded markup: the reader's inert decode leaves
// this HTML representation for the normalizer, without executing it.
function normalizeFictionalHtmlPosting(content: string) {
  return normalizeFictionalPosting(
    content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  );
}

describe("Greenhouse R2A evidence projection", () => {
  it("retains bounded HTML requirement and preference headings through the real reader", () => {
    const { normalization, sourceText } = normalizeFictionalHtmlPosting(
      "<h3>Required qualifications</h3><ul><li>Python programming</li>" +
        "<li>No certification is required.</li><li>Linux knowledge when a customer requests deployment.</li>" +
        "<li>Networking skills are preferred.</li></ul>" +
        "<h4>Preferred skills</h4><p>Software testing experience</p>" +
        "<p><strong>Required:</strong></p><p>Embedded systems knowledge</p>" +
        "<h5>Benefits</h5><p>Communication skills training</p>" +
        "<h6>Examples</h6><p>C++ programming</p>",
    );
    expect(
      normalization.requirementEvidence.map(({ normalizedValue, modality }) => [
        normalizedValue.kind === "TEXT"
          ? normalizedValue.value
          : normalizedValue.kind === "EXPERIENCE"
            ? normalizedValue.value.domain
            : normalizedValue.kind === "LICENCE_CERTIFICATION"
              ? normalizedValue.value.name
              : normalizedValue.kind,
        modality,
      ]),
    ).toEqual([
      ["Python programming", "REQUIRED"],
      ["No certification is required.", "NEGATED"],
      ["Linux knowledge when a customer requests deployment.", "CONDITIONAL"],
      ["Networking skills are preferred.", "PREFERRED"],
      ["Software testing experience", "PREFERRED"],
      ["Embedded systems knowledge", "REQUIRED"],
      ["Communication skills training", "UNKNOWN"],
      ["C++ programming", "UNKNOWN"],
    ]);
    assertR2ASourcePointers(normalization, sourceText);
    assertR2AExcerptHashes(normalization);
  });

  it.each([
    "<h2>Responsibilities</h2>",
    "<h2>Unknown context</h2>",
    "<h2>Requirements and benefits</h2>",
    "<h2>Some of the following requirements</h2>",
    "<p><strong>Examples:</strong></p>",
    "<p><strong>Responsibilities:</strong></p>",
    "<p><strong>Company benefits</strong></p>",
    "<p><b>Unknown context</b></p>",
    "<p>Preferred:</p><p>Unknown context:</p>",
  ])("resets inherited scope at the HTML context boundary %s", (boundary) => {
    const { normalization } = normalizeFictionalHtmlPosting(
      "<h2>Requirements</h2><p>Python programming</p>" +
        boundary +
        "<p>Communication skills</p><p>Software testing is required.</p>",
    );
    expect(
      normalization.requirementEvidence.find(
        ({ source }) => source.excerpt === "Python programming",
      ),
    ).toMatchObject({ modality: "REQUIRED" });
    expect(
      normalization.requirementEvidence.find(
        ({ source }) => source.excerpt === "Communication skills",
      ),
    ).toMatchObject({ modality: "UNKNOWN" });
    expect(
      normalization.requirementEvidence.find(
        ({ source }) => source.excerpt === "Software testing is required.",
      ),
    ).toMatchObject({ modality: "REQUIRED" });
  });

  it("keeps inline emphasis inert, alternative scope unknown, and repeated clauses stable", () => {
    const content =
      "<h2>Some of the following requirements</h2>" +
      "<p>Python programming</p><h2>Required skills</h2>" +
      "<ul><li>Experience with <strong>Preferred:</strong> programming tools.</li>" +
      "<li>Communication skills</li><li>Communication skills</li></ul>" +
      "<script><h2>Preferred</h2></script><p>Embedded systems knowledge</p>" +
      "<p><strong>Required:</strong> explanatory prose</p><p>Software testing experience</p>";
    const first = normalizeFictionalHtmlPosting(content);
    expect(
      first.normalization.requirementEvidence.find(
        ({ source }) => source.excerpt === "Python programming",
      ),
    ).toMatchObject({ modality: "UNKNOWN" });
    expect(
      first.normalization.requirementEvidence.filter(
        ({ source }) => source.excerpt === "Communication skills",
      ),
    ).toHaveLength(2);
    expect(
      first.normalization.requirementEvidence.find(
        ({ source }) => source.excerpt === "Embedded systems knowledge",
      ),
    ).toMatchObject({ modality: "REQUIRED" });
    expect(
      first.normalization.requirementEvidence.find(
        ({ source }) => source.excerpt === "Software testing experience",
      ),
    ).toMatchObject({ modality: "REQUIRED" });
    expect(normalizeFictionalHtmlPosting(content).normalization).toEqual(first.normalization);
  });

  it("retains ordinary raw HTML structure separately from the reader's inert job description", () => {
    const { normalization } = normalizeFictionalPosting(
      "<h2>Required</h2><p>Python programming</p>" +
        "<h2>Unmarked context</h2><p>Communication skills</p>",
    );
    expect(normalization.requirementEvidence).toHaveLength(2);
    expect(
      normalization.requirementEvidence.find(
        ({ source }) => source.excerpt === "Python programming",
      ),
    ).toMatchObject({ modality: "REQUIRED" });
    expect(
      normalization.requirementEvidence.find(
        ({ source }) => source.excerpt === "Communication skills",
      ),
    ).toMatchObject({ modality: "UNKNOWN" });
  });

  it("does not infer defaults from plain text with unmarked context boundaries", () => {
    const { normalization } = normalizeFictionalPosting(
      "Required\nPython programming\nUnmarked context\nCommunication skills",
    );
    expect(normalization.requirementEvidence).toHaveLength(2);
    expect(normalization.requirementEvidence.every(({ modality }) => modality === "UNKNOWN")).toBe(
      true,
    );
  });

  it("gives raw and entity-encoded HTML the same bounded modality without changing source identity", () => {
    const html =
      "<h2>Required skills</h2><p>Python programming</p>" +
      "<p><strong>Company benefits</strong></p><p>Communication skills training</p>" +
      "<p><strong>Required:</strong></p><p>Experience with <strong>Python</strong> programming.</p>" +
      "<h2 hidden>Preferred</h2><p>Software testing experience</p>";
    const modalities: unknown[] = [];
    for (const normalize of [normalizeFictionalPosting, normalizeFictionalHtmlPosting]) {
      const { normalization, sourceText, record, structured } = normalize(html);
      assertR2ASourcePointers(normalization, sourceText);
      assertR2AExcerptHashes(normalization);
      const expectedPayload =
        normalize === normalizeFictionalPosting
          ? html
          : html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      expect((record.rawPayload as { content: string }).content).toBe(expectedPayload);
      expect(record.contentDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(structured.description).toBe(html);
      expect(sourceText).toContain(JSON.stringify(html));
      expect(record.description.includes("<h2>")).toBe(normalize === normalizeFictionalHtmlPosting);
      modalities.push(
        normalization.requirementEvidence.map(({ normalizedValue, modality }) => [
          normalizedValue,
          modality,
        ]),
      );
    }
    expect(modalities[0]).toEqual(modalities[1]);
  });

  it.each([
    "At least one of the following",
    "Some of these skills",
    "Any of the following",
    "Either of the following",
    "You must have one of the following requirements",
    "Any one of the following",
    "Optional skills include",
    "The following skills are optional",
  ])(
    "does not promote each alternative after an unmarked closed introduction %s",
    (introduction) => {
      const { normalization } = normalizeFictionalHtmlPosting(
        "<h2>Required skills</h2><p>" +
          introduction +
          "</p>" +
          "<ul><li>Python programming</li><li>Rust programming</li></ul>" +
          "<p>Software testing is required.</p>",
      );
      expect(
        normalization.requirementEvidence.find(
          ({ source }) => source.excerpt === "Python programming",
        ),
      ).toMatchObject({ modality: "UNKNOWN" });
      expect(
        normalization.requirementEvidence.find(
          ({ source }) => source.excerpt === "Rust programming",
        ),
      ).toMatchObject({ modality: "UNKNOWN" });
      expect(
        normalization.requirementEvidence.find(
          ({ source }) => source.excerpt === "Software testing is required.",
        ),
      ).toMatchObject({ modality: "REQUIRED" });
    },
  );

  it.each([
    "<h2>Required and Preferred skills</h2>",
    "<h2 hidden>Preferred</h2>",
    '<div aria-hidden="true"><h2>Required</h2></div>',
    '<h2 style="display:none">Required</h2>',
  ])("cannot acquire required scope from a mixed or hidden heading %s", (heading) => {
    const { normalization } = normalizeFictionalHtmlPosting(heading + "<p>Python programming</p>");
    expect(
      normalization.requirementEvidence.find(
        ({ source }) => source.excerpt === "Python programming",
      ),
    ).toMatchObject({ modality: "UNKNOWN" });
  });

  it("does not treat encoded markup or discarded content as an actual heading", () => {
    const { normalization } = normalizeFictionalHtmlPosting(
      "<h2>Required</h2><p>&lt;h2&gt;Preferred&lt;/h2&gt;</p>" +
        "<script><h2>Preferred</h2></script><style>Preferred:</style>" +
        "<p>Python programming</p>",
    );
    expect(
      normalization.requirementEvidence.find(
        ({ source }) => source.excerpt === "Python programming",
      ),
    ).toMatchObject({ modality: "REQUIRED" });
  });

  it("preserves inherited prerequisites, lexical exceptions and exact escaped Unicode spans", () => {
    const clauses = [
      ["Python programming when the assignment requires it.", "CONDITIONAL"],
      ["Linux knowledge if deployed at a customer site.", "CONDITIONAL"],
      ["Embedded systems knowledge unless the assignment excludes it.", "CONDITIONAL"],
      ["Ability to communicate when under pressure.", "REQUIRED"],
      ["No certification is required.", "NEGATED"],
      ["C++ programming is preferred.", "PREFERRED"],
      ['Software testing skills 🧪 with quoted "checks" & review.', "REQUIRED"],
    ];
    for (const ordered of [clauses, [...clauses].reverse()]) {
      const { normalization, sourceText } = normalizeFictionalHtmlPosting(
        "<h2>Required skills</h2>" + ordered.map(([text]) => "<p>" + text + "</p>").join(""),
      );
      const modalities = new Map(
        normalization.requirementEvidence.map(({ normalizedValue, modality }) => [
          normalizedValue.kind === "TEXT"
            ? normalizedValue.value
            : normalizedValue.kind === "LICENCE_CERTIFICATION"
              ? normalizedValue.value.name
              : "",
          modality,
        ]),
      );
      for (const [text, expected] of clauses) expect(modalities.get(text)).toBe(expected);
      assertR2ASourcePointers(normalization, sourceText);
      assertR2AExcerptHashes(normalization);
      const unicode = normalization.requirementEvidence.find(
        ({ normalizedValue }) =>
          normalizedValue.kind === "TEXT" && normalizedValue.value.includes("🧪"),
      );
      expect(unicode?.source.excerpt).toContain("🧪");
      expect(unicode?.source.excerpt).toContain('\\"checks\\"');
    }
  });

  it.each(["Required", "Preferred"])(
    "retains a when prerequisite inside inherited %s scope",
    (heading) => {
      const { normalization } = normalizeFictionalHtmlPosting(
        `<h2>${heading} skills</h2><p>Python programming when deployed at a customer site.</p>` +
          "<p>Experience with software testing when assigned to the client.</p>",
      );
      expect(
        normalization.requirementEvidence.every(
          ({ modality, condition }) => modality === "CONDITIONAL" && condition?.startsWith("when "),
        ),
      ).toBe(true);
      expect(
        normalization.requirementEvidence.find(
          ({ normalizedValue }) => normalizedValue.kind === "EXPERIENCE",
        )?.normalizedValue,
      ).toMatchObject({ value: { condition: "when assigned to the client" } });
    },
  );

  it.each([
    ["Python programming is preferred but not essential.", "PREFERRED"],
    ["Python programming is preferred but not essential if authorised.", "CONDITIONAL"],
    ["Python programming is preferred but not essential when authorised.", "CONDITIONAL"],
    [
      "Python programming is preferred but not essential unless the scope excludes it.",
      "CONDITIONAL",
    ],
    ["Python programming is not required.", "NEGATED"],
    ["No certification is required.", "NEGATED"],
  ])("preserves preference and condition precedence for %s", (text, expected) => {
    const { normalization } = normalizeFictionalHtmlPosting("<p>" + text + "</p>");
    expect(normalization.requirementEvidence).toHaveLength(1);
    expect(normalization.requirementEvidence[0]?.modality).toBe(expected);
    expect(Boolean(normalization.requirementEvidence[0]?.condition)).toBe(
      expected === "CONDITIONAL",
    );
  });

  it.each([
    ["<p>The role is a contract position with contract renewal.</p>", "CONTRACT", "contract"],
    ["<p>This role is full time and full time.</p>", "FULL_TIME", "full time"],
    ['<p>Employment type: "🚀" full time, full time.</p>', "FULL_TIME", "full time"],
  ])(
    "preserves each repeated employment occurrence in reader-accepted content %s",
    (content, value, token) => {
      const { normalization, sourceText } = normalizeFictionalPosting(content);
      const employment = normalization.fieldEvidence.filter(
        ({ canonicalField }) => canonicalField === "employment.type",
      );
      expect(employment).toHaveLength(2);
      expect(new Set(employment.map(({ id }) => id)).size).toBe(2);
      expect(new Set(employment.map(({ source }) => source.start)).size).toBe(2);
      expect(employment.map(({ normalizedValue }) => normalizedValue)).toEqual([
        { kind: "EMPLOYMENT_TYPE", value },
        { kind: "EMPLOYMENT_TYPE", value },
      ]);
      expect(employment.map(({ source }) => sourceText.slice(source.start, source.end))).toEqual([
        token,
        token,
      ]);
      expect(normalization.conflicts).toHaveLength(0);
    },
  );

  it("preserves exact escaped HTML occurrences and the historical shared-span collision proof", () => {
    const record = readGreenhousePostingV2FromPayload({
      payload: {
        id: 7001,
        title: "Fictional Associate Engineer",
        absolute_url: "https://boards.greenhouse.io/fictional/jobs/7001",
        location: { name: "Melbourne VIC Australia" },
        content:
          "&lt;p&gt;This role is full time&lt;/p&gt; &lt;p&gt;This role is full time&lt;/p&gt;",
        updated_at: null,
      },
      capability,
    });
    expect(record.description).toContain("<p>");

    const fullStructured = structuredGreenhouseRecord(record, capability);
    const evidenceStructured = structuredGreenhouseEvidenceRecord(record, capability);
    expect(evidenceStructured.description).toBe(fullStructured.description);
    const sourceText = serializeR2AStructuredSource(evidenceStructured);
    const normalization = normalizeR2AJobEvidence({
      sourceText,
      structured: evidenceStructured,
      diagnosticStructure: fullStructured,
      sourceObservationId: "fictional-escaped-html-items",
      explicitLocation: record.location,
    });

    assertR2ASourcePointers(normalization, sourceText);
    assertR2AExcerptHashes(normalization);
    const employment = normalization.fieldEvidence.filter(
      ({ canonicalField }) => canonicalField === "employment.type",
    );
    expect(employment).toHaveLength(2);
    expect(employment.map(({ source }) => source.sourcePath)).toEqual([
      "structured.description.item.0",
      "structured.description.item.1",
    ]);
    expect(new Set(employment.map(({ id }) => id)).size).toBe(2);
    expect(new Set(employment.map(({ source }) => source.start)).size).toBe(2);
    expect(new Set(employment.map(({ source }) => source.end)).size).toBe(2);
    expect(employment.map(({ source }) => source.excerpt)).toEqual(["full time", "full time"]);
    expect(employment.map(({ normalizedValue }) => normalizedValue.kind)).toEqual([
      "EMPLOYMENT_TYPE",
      "EMPLOYMENT_TYPE",
    ]);

    const oldIdentity = (item: (typeof employment)[number]) =>
      [
        "3.6.1",
        item.sourceObservationId,
        item.canonicalField,
        // Before the HTML provenance repair every item borrowed the JSON parent start.
        String(sourceText.indexOf(JSON.stringify(record.description))),
        JSON.stringify(item.normalizedValue),
      ].join("\n");
    expect(oldIdentity(employment[0]!)).toBe(oldIdentity(employment[1]!));
    const oldEvidenceId = createHash("sha256")
      .update(oldIdentity(employment[0]!))
      .digest("hex")
      .slice(0, 32);
    expect(
      createHash("sha256").update(oldIdentity(employment[1]!)).digest("hex").slice(0, 32),
    ).toBe(oldEvidenceId);
    const oldNormalization = {
      ...normalization,
      fieldEvidence: normalization.fieldEvidence.map((item) =>
        item.canonicalField === "employment.type" ? { ...item, id: oldEvidenceId } : item,
      ),
    };
    try {
      R2ANormalizationSchema.parse(oldNormalization);
      throw new Error("OLD_DUPLICATE_ID_FAILURE_NOT_REPRODUCED");
    } catch (error) {
      expect(classifyR2ASchemaFailure(error)).toContain("DUPLICATE_EVIDENCE_ID");
    }
  });

  it("preserves overlapping state/postcode contradictions in one linked region conflict", () => {
    const { normalization } = normalizeFictionalPosting(
      "<p>Location: Melbourne NSW 3000; Adelaide VIC 5000.</p>",
    );
    const region = normalization.conflicts.filter(
      ({ canonicalField }) => canonicalField === "location.region",
    );
    expect(region).toHaveLength(1);
    expect(region[0]!.evidenceIds).toHaveLength(4);
    expect(new Set(region[0]!.evidenceIds).size).toBe(4);
    const members = normalization.fieldEvidence.filter(({ id }) =>
      region[0]!.evidenceIds.includes(id),
    );
    expect(
      members
        .map(({ normalizedValue }) => normalizedValue)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual(
      ["NSW", "3000", "VIC", "5000"]
        .map((value) => ({ kind: "TEXT", value }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    );
    expect(
      members.every(
        ({ state, conflictSetId }) => state === "CONFLICTING" && conflictSetId === region[0]!.id,
      ),
    ).toBe(true);
    const eligibility = evaluateR2Eligibility({
      profile: testProfile,
      normalization,
      bindings: currentR2Bindings,
      evaluatedAt: "2026-10-05T00:00:00.000Z",
    });
    expect(eligibility.status).toBe("REVIEW_REQUIRED");
    expect(eligibility.reasons.some(({ code }) => code === "R2_MATERIAL_FIELD_CONFLICT")).toBe(
      true,
    );
  });

  it("keeps independent region contradictions in separate conflict sets", () => {
    const { normalization } = normalizeFictionalPosting(
      "<p>Location: Melbourne NSW 3000; Footscray NSW 3000.</p>",
    );
    const region = normalization.conflicts.filter(
      ({ canonicalField }) => canonicalField === "location.region",
    );
    expect(region).toHaveLength(2);
    expect(region.every(({ evidenceIds }) => evidenceIds.length === 2)).toBe(true);
    expect(new Set(region.flatMap(({ evidenceIds }) => evidenceIds)).size).toBe(4);
  });

  it("normalizes a parser-accepted deep metadata record and preserves its full raw payload", () => {
    const payload = {
      id: 123,
      title: "Fictional Associate Engineer",
      absolute_url: "https://boards.greenhouse.io/fictional/jobs/123",
      location: { name: "Melbourne VIC Australia" },
      content: "Requirements\nPython knowledge preferred.",
      updated_at: null,
      departments: [{ name: "Engineering" }],
      offices: [{ name: "Melbourne" }],
      metadata: [{ name: "opaque", value: makeNestedMetadata(1_600) }],
    };
    const record = readGreenhousePostingV2FromPayload({
      payload: JSON.parse(JSON.stringify(payload)),
      capability,
    });
    const full = structuredGreenhouseRecord(record, capability);
    const projection = structuredGreenhouseEvidenceRecord(record, capability);
    const sourceText = serializeR2AStructuredSource(projection);
    const normalization = normalizeR2AJobEvidence({
      sourceText,
      sourceObservationId: "fictional-deep-metadata",
      structured: projection,
      diagnosticStructure: full,
      explicitLocation: record.location,
    });

    expect(record.rawPayload).toHaveProperty("metadata.0.value");
    expect(full).toHaveProperty("providerMetadata.0.value");
    expect(projection).not.toHaveProperty("providerMetadata");
    expect(sourceText).not.toContain("fictional-marker");
    expect(
      normalization.fieldEvidence.some(({ canonicalField }) => canonicalField === "title"),
    ).toBe(true);
    expect(
      normalization.fieldEvidence.some(
        ({ canonicalField }) => canonicalField === "location.alternative",
      ),
    ).toBe(true);

    const ordinaryPayload = {
      ...payload,
      metadata: [{ id: 902, name: "fictional ordinary metadata", value: "fictional only" }],
    };
    const ordinaryRecord = readGreenhousePostingV2FromPayload({
      payload: ordinaryPayload,
      capability,
    });
    const ordinaryFull = structuredGreenhouseRecord(ordinaryRecord, capability);
    const ordinaryProjection = structuredGreenhouseEvidenceRecord(ordinaryRecord, capability);
    const legacyNormalization = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(ordinaryFull),
      sourceObservationId: "fictional-projection-parity",
      structured: ordinaryFull,
      explicitLocation: ordinaryRecord.location,
    });
    const projectedNormalization = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(ordinaryProjection),
      sourceObservationId: "fictional-projection-parity",
      structured: ordinaryProjection,
      diagnosticStructure: ordinaryFull,
      explicitLocation: ordinaryRecord.location,
    });
    expect(
      projectedNormalization.fieldEvidence.map(({ family, canonicalField, normalizedValue }) => ({
        family,
        canonicalField,
        normalizedValue,
      })),
    ).toEqual(
      legacyNormalization.fieldEvidence.map(({ family, canonicalField, normalizedValue }) => ({
        family,
        canonicalField,
        normalizedValue,
      })),
    );
    expect(
      projectedNormalization.requirementEvidence.map(({ family, normalizedValue, modality }) => ({
        family,
        normalizedValue,
        modality,
      })),
    ).toEqual(
      legacyNormalization.requirementEvidence.map(({ family, normalizedValue, modality }) => ({
        family,
        normalizedValue,
        modality,
      })),
    );
    expect(
      projectedNormalization.coverage.map(({ family, state, evidenceIds, unparsedSpans }) => ({
        family,
        state,
        evidenceCount: evidenceIds.length,
        unparsedCount: unparsedSpans.length,
      })),
    ).toEqual(
      legacyNormalization.coverage.map(({ family, state, evidenceIds, unparsedSpans }) => ({
        family,
        state,
        evidenceCount: evidenceIds.length,
        unparsedCount: unparsedSpans.length,
      })),
    );
    assertR2ASourcePointers(normalization, sourceText);
    assertR2AExcerptHashes(normalization);
    const metrics = r2aStructuralMetrics(projection, sourceText.length, sourceText.length, full);
    expect(metrics.providerMetadata.depth).toBe("DEPTH_257_PLUS");
    expect(
      R2AFailureDiagnosticSchema.safeParse({
        subphase: "R2A_INDEX_STRUCTURED_SPANS",
        rangeErrorClass: "RANGE_MAX_CALL_STACK",
        structuralBudget: null,
        metrics,
        rawText: "fictional-marker",
      }).success,
    ).toBe(false);
    expect(JSON.stringify(normalization)).not.toContain("fictional-marker");
  });

  it("classifies a rejected evidence structure without retaining any source text", () => {
    const structured = { description: "x".repeat(262_145) };
    const sourceText = serializeR2AStructuredSource(structured);
    try {
      normalizeR2AJobEvidence({ sourceText, structured, sourceObservationId: "fictional-budget" });
      throw new Error("STRUCTURE_BUDGET_NOT_ENFORCED");
    } catch (error) {
      expect(error).toBeInstanceOf(R2ADiagnosticError);
      const diagnostic = (error as R2ADiagnosticError).r2aDiagnostic;
      expect(diagnostic.structuralBudget).toBe("STRING_LENGTH");
      expect(diagnostic.subphase).toBe("R2A_INDEX_STRUCTURED_SPANS");
      expect(JSON.stringify(diagnostic)).not.toContain("fictional-budget");
    }
  });
});
