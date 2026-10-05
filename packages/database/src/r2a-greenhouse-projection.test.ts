import { describe, expect, it } from "vitest";

import {
  SourceCapabilityV2Schema,
  R2AFailureDiagnosticSchema,
  readGreenhousePostingV2FromPayload,
} from "@applypilot/job-sources";
import { assertR2ASourcePointers } from "@applypilot/job-model";
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

describe("Greenhouse R2A evidence projection", () => {
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
