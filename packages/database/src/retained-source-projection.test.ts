import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { fixtureJobs } from "../../../fixtures/jobs";
import {
  SourceCapabilityV2Schema,
  readGreenhousePostingV2FromPayload,
  readLeverPostingV2FromPayload,
} from "@applypilot/job-sources";
import { JobSchema, assertR2ASourcePointers } from "@applypilot/job-model";
import {
  assertR2AExcerptHashes,
  normalizeR2AJobEvidence,
  serializeR2AStructuredSource,
} from "@applypilot/job-importer";

import {
  normalizeRetainedSourcePosting,
  structuredGreenhouseRecord,
  structuredGreenhouseEvidenceRecord,
  structuredLeverRecord,
  type NormalizeRetainedSourcePostingInput,
} from "./retained-source-projection";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function retainedInput(
  source: "LEVER" | "GREENHOUSE",
  leverExternalId = "8100",
): NormalizeRetainedSourcePostingInput {
  const capability = SourceCapabilityV2Schema.parse({
    schemaVersion: 2,
    capabilityId: "fictional-retained",
    version: 1,
    predecessorVersion: null,
    source,
    alias: "Fictional Board",
    tenant: "fictional",
    region: "GLOBAL",
    allowedHost: source === "LEVER" ? "api.lever.co" : "boards-api.greenhouse.io",
    allowedPathPrefix: source === "LEVER" ? "/v0/postings/fictional" : "/v1/boards/fictional/",
    allowedOperations: ["LIST_JOBS"],
    approvalState: "REVOKED",
    approvalReference: null,
    approvedAt: null,
    policyVersion: "fictional",
    policyReviewedAt: "2026-10-01T00:00:00.000Z",
    policyExpiresAt: "2026-10-02T00:00:00.000Z",
    capabilityExpiresAt: "2026-10-02T00:00:00.000Z",
    requestBudget: 1,
    recordCap: 10,
    pageSizeCap: 10,
    responseByteLimit: 100_000,
    requestTimeoutMs: 1_000,
    runTimeoutMs: 5_000,
    maxRedirects: 0,
    maxRetries: 0,
    maxConcurrency: 1,
    parserVersion: "fictional-reader",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    revokedAt: "2026-10-02T00:00:00.000Z",
    revocationReason: "SECURITY_STOP",
  });
  const payload =
    source === "LEVER"
      ? {
          id: leverExternalId,
          text: "Fictional Engineer",
          hostedUrl: "https://jobs.example.test/fictional/8100",
          applyUrl: "https://jobs.example.test/fictional/8100/apply",
          categories: { location: "Melbourne VIC Australia", commitment: "Full time" },
          descriptionPlain: "Must be 18+ years old.",
          lists: [
            {
              text: "Requirements",
              content: "<ul><li>Python programming skills are required.</li></ul>",
            },
          ],
        }
      : {
          id: 8100,
          title: "Fictional Engineer",
          absolute_url: "https://boards.greenhouse.io/fictional/jobs/8100",
          location: { name: "Melbourne VIC Australia" },
          content: "Must be 18+ years old.",
          updated_at: null,
          metadata: [{ name: "opaque", value: "not evidence" }],
        };
  const payloadJson = JSON.stringify(payload);
  const record =
    source === "LEVER"
      ? readLeverPostingV2FromPayload({ capability, payload })
      : readGreenhousePostingV2FromPayload({ capability, payload });
  const identity = `${source}\nGLOBAL\nfictional\n${record.externalId}`;
  const jobId = `source-job-${hash(identity).slice(0, 32)}`;
  const observationId = `source-observation-${hash(`${identity}\n${record.contentDigest}`)}`;
  const job = JobSchema.parse({
    ...fixtureJobs[0],
    id: jobId,
    source,
    externalId: record.externalId,
    sourceUrl: record.sourceUrl,
    title: record.title,
    company: capability.alias,
    location: record.location,
    description: record.description,
    dateDiscovered: "2026-10-01T00:00:00.000Z",
    dateUpdated: null,
    sourceMetadata: {
      applicationUrl: record.applicationUrl,
      provenance: {
        importRecordId: observationId,
        contentHashPrefix: record.contentDigest.slice(0, 12),
        manuallyEditedFields: [],
      },
    },
  });
  return {
    payloadJson,
    capability,
    job,
    expected: {
      source,
      region: "GLOBAL",
      tenant: "fictional",
      externalId: record.externalId,
      sourceObservationId: observationId,
      contentHash: record.contentDigest,
      payloadSha256: hash(payloadJson),
    },
  };
}

describe("pure retained source projection", () => {
  it("retains the production Lever reader's accepted 2048-code-unit identity bound", () => {
    const input = retainedInput("LEVER", "x".repeat(2_048));
    const result = normalizeRetainedSourcePosting(input);
    expect(result.sourceIdentity.externalId).toBe(input.expected.externalId);
    expect(result.record.externalId).toHaveLength(2_048);
  });
  it.each(["LEVER", "GREENHOUSE"] as const)(
    "reconstructs %s through the exact production projection without authority or refreshed dates",
    (provider) => {
      const input = retainedInput(provider);
      const original = JSON.stringify(input);
      const fetch = vi.spyOn(globalThis, "fetch");
      try {
        const result = normalizeRetainedSourcePosting(input);
        const structured =
          result.record.source === "LEVER"
            ? structuredLeverRecord(result.record, input.capability)
            : structuredGreenhouseRecord(result.record, input.capability);
        const evidence =
          result.record.source === "LEVER"
            ? structured
            : structuredGreenhouseEvidenceRecord(result.record, input.capability);
        expect(result.sourceText).toBe(serializeR2AStructuredSource(evidence));
        expect(result.normalization).toEqual(
          normalizeR2AJobEvidence({
            sourceText: result.sourceText,
            structured: evidence,
            diagnosticStructure: structured,
            sourceObservationId: input.expected.sourceObservationId,
            explicitLocation: result.record.location,
          }),
        );
        expect(result.normalization.parserVersion).toBe("3.6.5");
        expect(result.sourceTextDigest).toBe(hash(result.sourceText));
        expect(result.payloadSha256).toBe(hash(input.payloadJson));
        expect(result.sourceIdentity.jobId).toBe(input.job.id);
        expect(result.job).toEqual(input.job);
        expect(JSON.stringify(input)).toBe(original);
        expect(result.job.dateDiscovered).toBe("2026-10-01T00:00:00.000Z");
        expect(input.capability.approvalState).toBe("REVOKED");
        expect(fetch).not.toHaveBeenCalled();
        assertR2ASourcePointers(result.normalization, result.sourceText);
        assertR2AExcerptHashes(result.normalization);
        expect(normalizeRetainedSourcePosting(input)).toEqual(result);
      } finally {
        fetch.mockRestore();
      }
    },
  );

  it.each(["tenant", "externalId", "sourceObservationId", "contentHash", "payloadSha256"] as const)(
    "rejects an altered original %s binding",
    (field) => {
      const input = retainedInput("GREENHOUSE");
      input.expected[field] =
        field.endsWith("Hash") || field === "payloadSha256" ? "f".repeat(64) : "altered";
      expect(() => normalizeRetainedSourcePosting(input)).toThrow(
        "RETAINED_SOURCE_BINDING_MISMATCH",
      );
    },
  );

  it.each([
    "id",
    "source",
    "externalId",
    "sourceUrl",
    "title",
    "company",
    "location",
    "description",
  ] as const)("rejects mismatched canonical job context %s", (field) => {
    const input = retainedInput("GREENHOUSE");
    Object.assign(input.job, {
      [field]:
        field === "source"
          ? "LEVER"
          : field === "sourceUrl"
            ? "https://example.test/altered"
            : "altered",
    });
    expect(() => normalizeRetainedSourcePosting(input)).toThrow("RETAINED_SOURCE_BINDING_MISMATCH");
  });

  it.each(["importRecordId", "contentHashPrefix", "manuallyEditedFields"] as const)(
    "rejects unsupported altered provenance %s",
    (field) => {
      const input = retainedInput("LEVER");
      Object.assign(input.job.sourceMetadata.provenance as object, {
        [field]: field === "manuallyEditedFields" ? ["description"] : "altered",
      });
      expect(() => normalizeRetainedSourcePosting(input)).toThrow(
        "RETAINED_SOURCE_BINDING_MISMATCH",
      );
    },
  );

  it("rejects altered bytes even when the JSON meaning is unchanged", () => {
    const input = retainedInput("GREENHOUSE");
    input.payloadJson += " ";
    expect(() => normalizeRetainedSourcePosting(input)).toThrow("RETAINED_SOURCE_BINDING_MISMATCH");
  });

  it("rejects an altered canonical application destination independently", () => {
    const input = retainedInput("GREENHOUSE");
    input.job.sourceMetadata.applicationUrl = "https://example.test/altered";
    expect(() => normalizeRetainedSourcePosting(input)).toThrow("RETAINED_SOURCE_BINDING_MISMATCH");
  });

  it("rejects malformed JSON and oversized retained input without a parser fallback", () => {
    const malformed = retainedInput("GREENHOUSE");
    malformed.payloadJson = "{";
    malformed.expected.payloadSha256 = hash(malformed.payloadJson);
    expect(() => normalizeRetainedSourcePosting(malformed)).toThrow();
    const oversized = retainedInput("LEVER");
    oversized.payloadJson = " ".repeat(oversized.capability.responseByteLimit + 1);
    oversized.expected.payloadSha256 = hash(oversized.payloadJson);
    expect(() => normalizeRetainedSourcePosting(oversized)).toThrow(
      "RETAINED_SOURCE_BINDING_MISMATCH",
    );
  });
});
