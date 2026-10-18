import { createHash } from "node:crypto";
import { z } from "zod";

import {
  SourceCapabilityV2Schema,
  readGreenhousePostingV2FromPayload,
  readLeverPostingV2FromPayload,
  type GreenhousePostingRecordV2,
  type LeverPostingRecordV2,
  type SourceCapabilityV2,
} from "@applypilot/job-sources";
import { normalizeR2AJobEvidence, serializeR2AStructuredSource } from "@applypilot/job-importer";
import { JobSchema, type Job, type R2ANormalization } from "@applypilot/job-model";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function structuredLeverRecord(
  record: LeverPostingRecordV2,
  capability: SourceCapabilityV2,
): Record<string, unknown> {
  const locations = record.allLocations.length
    ? record.allLocations
    : record.location
      ? [record.location]
      : [];
  const sections = record.sections.map(({ heading, content, kind }) => ({
    heading,
    content,
    kind,
  }));
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    identifier: { name: capability.tenant, value: record.externalId },
    title: record.title,
    hiringOrganization: { name: capability.alias },
    jobLocation: locations.map((location) => ({ address: location })),
    employmentType: record.commitment,
    description: record.description,
    datePosted: record.postedAt,
    jobLocationType: record.workplaceType,
    baseSalary: record.salaryRange
      ? {
          currency: record.salaryRange.currency,
          value: {
            minValue: record.salaryRange.min,
            maxValue: record.salaryRange.max,
            unitText: record.salaryRange.interval,
          },
        }
      : null,
    sourceUrl: record.sourceUrl,
    applicationUrl: record.applicationUrl,
    department: record.department,
    team: record.team,
    country: record.country,
    sourceSections: sections,
    requirementTexts: evidenceLines(record, "REQUIREMENTS"),
    responsibilities: evidenceLines(record, "RESPONSIBILITIES"),
    benefitTexts: sections.filter(({ kind }) => kind === "BENEFITS").map(({ content }) => content),
  };
}

export function structuredGreenhouseRecord(
  record: GreenhousePostingRecordV2,
  capability: SourceCapabilityV2,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    identifier: { name: capability.tenant, value: record.externalId },
    title: record.title,
    hiringOrganization: { name: capability.alias },
    jobLocation: [{ address: record.location }],
    description: record.description,
    datePosted: null,
    dateModified: record.updatedAt,
    sourceUrl: record.sourceUrl,
    applicationUrl: record.applicationUrl,
    departments: record.departments,
    offices: record.offices,
    providerMetadata: record.metadata,
  };
}

/** Opaque provider fields remain in rawPayload and are not R2A evidence inputs. */
export function structuredGreenhouseEvidenceRecord(
  record: GreenhousePostingRecordV2,
  capability: SourceCapabilityV2,
): Record<string, unknown> {
  const evidenceRecord = structuredGreenhouseRecord(record, capability);
  delete evidenceRecord.departments;
  delete evidenceRecord.offices;
  delete evidenceRecord.providerMetadata;
  return evidenceRecord;
}

const evidenceChunkLength = 500;

function boundedEvidenceChunks(value: string): string[] {
  const chunks: string[] = [];
  let remainder = value.trim();
  while (remainder) {
    if (remainder.length <= evidenceChunkLength) {
      chunks.push(remainder);
      break;
    }
    let end = evidenceChunkLength;
    if (/^[\uDC00-\uDFFF]$/.test(remainder[end] ?? "")) end -= 1;
    const candidate = remainder.slice(0, end);
    const trailingWord = candidate.search(/\s+\S*$/);
    const splitAt = trailingWord >= evidenceChunkLength / 2 ? trailingWord : end;
    const chunk = remainder.slice(0, splitAt).trim();
    if (chunk) chunks.push(chunk);
    remainder = remainder.slice(splitAt).trimStart();
  }
  return chunks;
}

export function evidenceLines(
  record: LeverPostingRecordV2,
  kind: "REQUIREMENTS" | "RESPONSIBILITIES",
) {
  return record.sections
    .filter((section) => section.kind === kind)
    .flatMap(({ content }) => content.split("\n"))
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap(boundedEvidenceChunks)
    .slice(0, 500)
    .map((line) => line.slice(0, evidenceChunkLength));
}

const RetainedSourceIdentitySchema = z
  .object({
    source: z.enum(["LEVER", "GREENHOUSE"]),
    region: z.enum(["GLOBAL", "EU"]),
    tenant: z.string().min(1).max(200),
    externalId: z.string().min(1).max(2_048),
    sourceObservationId: z.string().min(1).max(200),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export interface NormalizeRetainedSourcePostingInput {
  payloadJson: string;
  capability: SourceCapabilityV2;
  job: Job;
  expected: z.infer<typeof RetainedSourceIdentitySchema>;
}

export interface NormalizedRetainedSourcePosting {
  job: Job;
  record: LeverPostingRecordV2 | GreenhousePostingRecordV2;
  normalization: R2ANormalization;
  sourceText: string;
  sourceTextDigest: string;
  payloadSha256: string;
  sourceIdentity: z.infer<typeof RetainedSourceIdentitySchema> & { jobId: string };
}

/** Pure reconstruction only: no authority, clock, DB, freshness or transport. */
export function normalizeRetainedSourcePosting(
  input: NormalizeRetainedSourcePostingInput,
): NormalizedRetainedSourcePosting {
  const expected = RetainedSourceIdentitySchema.parse(input.expected);
  const capability = SourceCapabilityV2Schema.parse(input.capability);
  const job = JobSchema.parse(input.job);
  if (
    typeof input.payloadJson !== "string" ||
    Buffer.byteLength(input.payloadJson, "utf8") > capability.responseByteLimit ||
    sha256(input.payloadJson) !== expected.payloadSha256 ||
    capability.source !== expected.source ||
    capability.region !== expected.region ||
    capability.tenant !== expected.tenant
  ) {
    throw new Error("RETAINED_SOURCE_BINDING_MISMATCH");
  }
  const payload: unknown = JSON.parse(input.payloadJson);
  const record =
    expected.source === "LEVER"
      ? readLeverPostingV2FromPayload({ payload, capability })
      : readGreenhousePostingV2FromPayload({ payload, capability });
  const identity = `${record.source}\n${record.region}\n${record.tenant}\n${record.externalId}`;
  const jobId = `source-job-${sha256(identity).slice(0, 32)}`;
  const observationId = `source-observation-${sha256(`${identity}\n${record.contentDigest}`)}`;
  const provenance = job.sourceMetadata.provenance;
  if (
    record.source !== expected.source ||
    record.region !== expected.region ||
    record.tenant !== expected.tenant ||
    record.externalId !== expected.externalId ||
    record.contentDigest !== expected.contentHash ||
    observationId !== expected.sourceObservationId ||
    job.id !== jobId ||
    job.source !== record.source ||
    job.externalId !== record.externalId ||
    job.sourceUrl !== record.sourceUrl ||
    job.title !== record.title ||
    job.company !== capability.alias ||
    job.location !==
      (record.source === "LEVER" ? (record.location ?? record.allLocations[0]) : record.location) ||
    job.sourceMetadata.applicationUrl !== record.applicationUrl ||
    job.description !== record.description ||
    !provenance ||
    typeof provenance !== "object" ||
    Array.isArray(provenance) ||
    (provenance as Record<string, unknown>).importRecordId !== observationId ||
    (provenance as Record<string, unknown>).contentHashPrefix !==
      record.contentDigest.slice(0, 12) ||
    !Array.isArray((provenance as Record<string, unknown>).manuallyEditedFields) ||
    ((provenance as Record<string, unknown>).manuallyEditedFields as unknown[]).length !== 0
  ) {
    throw new Error("RETAINED_SOURCE_BINDING_MISMATCH");
  }
  const structured =
    record.source === "LEVER"
      ? structuredLeverRecord(record, capability)
      : structuredGreenhouseRecord(record, capability);
  const evidence =
    record.source === "LEVER" ? structured : structuredGreenhouseEvidenceRecord(record, capability);
  const sourceText = serializeR2AStructuredSource(evidence);
  const normalization = normalizeR2AJobEvidence({
    sourceText,
    sourceObservationId: observationId,
    structured: evidence,
    diagnosticStructure: structured,
    explicitLocation:
      record.source === "LEVER"
        ? (record.location ?? record.allLocations[0] ?? null)
        : record.location,
  });
  return {
    job,
    record,
    normalization,
    sourceText,
    sourceTextDigest: sha256(sourceText),
    payloadSha256: expected.payloadSha256,
    sourceIdentity: { ...expected, jobId },
  };
}
