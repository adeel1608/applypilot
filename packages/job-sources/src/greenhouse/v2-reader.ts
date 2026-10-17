import { createHash } from "node:crypto";

import { z } from "zod";

import {
  SourceCapabilityV2Schema,
  SourceRecordUnusableDiagnosticSchema,
  SourceRunBudget,
  type SourceCapabilityV2,
  type SourceRecordUnusableDiagnostic,
} from "../source-capability";
import {
  SecureSourceError,
  boundedSecureJsonGet,
  type SecureSourceTransportDependencies,
} from "../secure-source-transport";
import { extractInertLeverText } from "../lever/inert-text";
import { sourceSchemaDiagnostic } from "../schema-diagnostic";

const GreenhouseJobV2PayloadSchema = z
  .object({
    id: z.union([z.string(), z.number().int().nonnegative()]).optional(),
    title: z.string().optional(),
    absolute_url: z.string().optional(),
    location: z.object({ name: z.string() }).passthrough().nullable().optional(),
    content: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    departments: z.array(z.unknown()).optional(),
    offices: z.array(z.unknown()).optional(),
    metadata: z.array(z.unknown()).nullable().optional(),
  })
  .passthrough();

const GreenhouseListV2PayloadSchema = z.object({
  jobs: z.array(GreenhouseJobV2PayloadSchema),
});

type GreenhouseJobV2Payload = z.infer<typeof GreenhouseJobV2PayloadSchema>;

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export interface GreenhousePostingRecordV2 {
  readonly source: "GREENHOUSE";
  readonly region: "GLOBAL";
  readonly tenant: string;
  readonly externalId: string;
  readonly title: string;
  readonly location: string;
  readonly description: string;
  readonly updatedAt: string | null;
  readonly departments: readonly unknown[];
  readonly offices: readonly unknown[];
  readonly metadata: readonly unknown[];
  readonly sourceUrl: string;
  readonly applicationUrl: string;
  readonly contentDigest: string;
  readonly rawPayload: DeepReadonly<GreenhouseJobV2Payload>;
}

export interface GreenhousePageV2 {
  readonly providerRecordCount: number;
  readonly acceptedRecords: readonly GreenhousePostingRecordV2[];
  readonly acceptedRecordEntries: readonly {
    record: GreenhousePostingRecordV2;
    recordIndex: number;
  }[];
  readonly unusableRecordCount: number;
  readonly safeUnusableDiagnostics: readonly SourceRecordUnusableDiagnostic[];
  readonly cursor: "0";
  readonly nextCursor: null;
  readonly pageDigest: string;
  readonly byteCount: number;
  readonly requestCount: number;
}

export interface GreenhouseDetailV2 {
  readonly record: GreenhousePostingRecordV2;
  readonly externalId: string;
  readonly pageDigest: string;
  readonly byteCount: number;
  readonly requestCount: number;
}

const limits = Object.freeze({
  externalId: 100,
  title: 4_096,
  location: 1_000,
  description: 128 * 1_024,
  url: 2_048,
});

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return (
    "{" +
    entries.map(([key, item]) => JSON.stringify(key) + ":" + canonicalJson(item)).join(",") +
    "}"
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}

function safePostingUrl(
  value: string | undefined,
  tenant: string,
  externalId: string,
): value is string {
  if (!value || value.length > limits.url) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      url.pathname === `/${tenant}/jobs/${externalId}`
    );
  } catch {
    return false;
  }
}

function unusableReason(
  payload: GreenhouseJobV2Payload,
  externalId: string,
  title: string,
  location: string,
  description: string,
  tenant: string,
): SourceRecordUnusableDiagnostic["reasonCode"] | null {
  if (!externalId.trim() || externalId.length > limits.externalId) return "UNUSABLE_IDENTITY";
  if (!title || title.length > limits.title) return "UNUSABLE_TITLE";
  if (!location || location.length > limits.location) return "MISSING_EFFECTIVE_LOCATION";
  if (!description || description.length > limits.description) return "MISSING_USABLE_DESCRIPTION";
  if (!safePostingUrl(payload.absolute_url, tenant, externalId)) {
    return "UNUSABLE_LINK_BOUNDARY";
  }
  return null;
}

function parseRecord(
  payload: GreenhouseJobV2Payload,
  capability: SourceCapabilityV2,
  recordIndex: number,
):
  | { status: "ACCEPTED"; record: GreenhousePostingRecordV2 }
  | { status: "UNUSABLE"; diagnostic: SourceRecordUnusableDiagnostic } {
  const externalId = payload.id === undefined ? "" : String(payload.id);
  const title = extractInertLeverText(payload.title ?? "");
  const location = extractInertLeverText(payload.location?.name ?? "");
  const description = extractInertLeverText(payload.content ?? "");
  const reasonCode = unusableReason(
    payload,
    externalId,
    title,
    location,
    description,
    capability.tenant,
  );
  if (reasonCode) {
    return {
      status: "UNUSABLE",
      diagnostic: SourceRecordUnusableDiagnosticSchema.parse({ reasonCode, recordIndex }),
    };
  }
  const rawPayload = freezeDeep(payload);
  const record: GreenhousePostingRecordV2 = Object.freeze({
    source: "GREENHOUSE",
    region: "GLOBAL",
    tenant: capability.tenant,
    externalId,
    title,
    location,
    description,
    updatedAt: payload.updated_at ?? null,
    departments: Object.freeze(payload.departments ?? []),
    offices: Object.freeze(payload.offices ?? []),
    metadata: Object.freeze(payload.metadata ?? []),
    sourceUrl: payload.absolute_url!,
    applicationUrl: payload.absolute_url!,
    contentDigest: sha256(canonicalJson(payload)),
    rawPayload,
  });
  return { status: "ACCEPTED", record };
}

export function readGreenhousePostingV2FromPayload(input: {
  payload: unknown;
  capability: SourceCapabilityV2;
}): GreenhousePostingRecordV2 {
  const capability = assertGreenhouseCapability(input.capability);
  const payload = GreenhouseJobV2PayloadSchema.safeParse(input.payload);
  if (!payload.success)
    throw new SecureSourceError(
      "SCHEMA_CHANGED",
      null,
      "RESPONSE_BODY",
      sourceSchemaDiagnostic({
        error: payload.error,
        payload: input.payload,
        provider: "GREENHOUSE",
        operation: "GET_JOB",
      }),
    );
  const parsed = parseRecord(payload.data, capability, 0);
  if (parsed.status !== "ACCEPTED") {
    throw new SecureSourceError("SOURCE_RECORD_UNUSABLE", null, "RESPONSE_BODY");
  }
  return parsed.record;
}

function assertGreenhouseCapability(input: unknown): SourceCapabilityV2 {
  const capability = SourceCapabilityV2Schema.parse(input);
  if (capability.source !== "GREENHOUSE") throw new SecureSourceError("SOURCE_MISMATCH");
  if (capability.region !== "GLOBAL") throw new SecureSourceError("SOURCE_REGION_MISMATCH");
  if (capability.maxRedirects !== 0) throw new SecureSourceError("REDIRECT_FORBIDDEN");
  if (capability.maxRetries !== 0) throw new SecureSourceError("RETRY_FORBIDDEN");
  return capability;
}

function apiUrl(capability: SourceCapabilityV2, operation: "LIST_JOBS" | "GET_JOB", id?: string) {
  const root = capability.allowedPathPrefix.endsWith("/")
    ? capability.allowedPathPrefix.slice(0, -1)
    : capability.allowedPathPrefix;
  const path =
    operation === "LIST_JOBS" ? root + "/jobs" : root + "/jobs/" + encodeURIComponent(id ?? "");
  const url = new URL(path, "https://" + capability.allowedHost);
  if (operation === "LIST_JOBS") url.searchParams.set("content", "true");
  if (operation === "GET_JOB" && capability.requestBinding?.includeQuestions)
    url.searchParams.set("questions", "true");
  return url;
}

function parseListPayload(body: unknown): GreenhouseJobV2Payload[] {
  const parsed = GreenhouseListV2PayloadSchema.safeParse(body);
  if (!parsed.success)
    throw new SecureSourceError(
      "SCHEMA_CHANGED",
      null,
      "RESPONSE_BODY",
      sourceSchemaDiagnostic({
        error: parsed.error,
        payload: body,
        provider: "GREENHOUSE",
        operation: "LIST_JOBS",
      }),
    );
  return parsed.data.jobs;
}

function parseDetailPayload(body: unknown): GreenhouseJobV2Payload {
  const parsed = GreenhouseJobV2PayloadSchema.safeParse(body);
  if (!parsed.success)
    throw new SecureSourceError(
      "SCHEMA_CHANGED",
      null,
      "RESPONSE_BODY",
      sourceSchemaDiagnostic({
        error: parsed.error,
        payload: body,
        provider: "GREENHOUSE",
        operation: "GET_JOB",
      }),
    );
  return parsed.data;
}

function pageDigest(
  providerRecordCount: number,
  accepted: readonly { record: GreenhousePostingRecordV2; recordIndex: number }[],
  unusable: readonly SourceRecordUnusableDiagnostic[],
): string {
  const disposition = Array.from({ length: providerRecordCount }, (_, recordIndex) => {
    const good = accepted.find((item) => item.recordIndex === recordIndex);
    if (good)
      return (
        "ACCEPTED:" + recordIndex + ":" + good.record.externalId + ":" + good.record.contentDigest
      );
    const bad = unusable.find((item) => item.recordIndex === recordIndex);
    return "UNUSABLE:" + recordIndex + ":" + (bad?.reasonCode ?? "UNCLASSIFIED");
  });
  return sha256(disposition.join("\n"));
}

export async function readGreenhousePageV2(input: {
  capability: SourceCapabilityV2;
  budget: SourceRunBudget;
  now?: () => Date;
  signal?: AbortSignal;
  dependencies?: SecureSourceTransportDependencies;
}): Promise<GreenhousePageV2> {
  const capability = assertGreenhouseCapability(input.capability);
  if (!capability.allowedOperations.includes("LIST_JOBS")) {
    throw new SecureSourceError("OPERATION_NOT_APPROVED");
  }
  const response = await boundedSecureJsonGet({
    initialUrl: apiUrl(capability, "LIST_JOBS").toString(),
    capability,
    operation: "LIST_JOBS",
    budget: input.budget,
    now: input.now,
    signal: input.signal,
    dependencies: input.dependencies,
  });
  const payloads = parseListPayload(response.body);
  if (payloads.length > capability.recordCap) throw new SecureSourceError("RECORD_CAP_EXCEEDED");
  if (payloads.length > capability.pageSizeCap) {
    throw new SecureSourceError("PAGE_SIZE_EXCEEDED", null, "RESPONSE_BODY");
  }
  const accepted: Array<{ record: GreenhousePostingRecordV2; recordIndex: number }> = [];
  const unusable: SourceRecordUnusableDiagnostic[] = [];
  payloads.forEach((payload, recordIndex) => {
    const parsed = parseRecord(payload, capability, recordIndex);
    if (parsed.status === "ACCEPTED") accepted.push({ record: parsed.record, recordIndex });
    else unusable.push(parsed.diagnostic);
  });
  const digest = pageDigest(payloads.length, accepted, unusable);
  input.budget.consumePage("0", payloads.length, response.byteCount);
  return Object.freeze({
    providerRecordCount: payloads.length,
    acceptedRecords: Object.freeze(accepted.map(({ record }) => record)),
    acceptedRecordEntries: Object.freeze(accepted),
    unusableRecordCount: unusable.length,
    safeUnusableDiagnostics: Object.freeze(unusable),
    cursor: "0",
    nextCursor: null,
    pageDigest: digest,
    byteCount: response.byteCount,
    requestCount: response.requestCount,
  });
}

export async function readGreenhouseDetailV2(input: {
  capability: SourceCapabilityV2;
  budget: SourceRunBudget;
  externalId: string;
  now?: () => Date;
  signal?: AbortSignal;
  dependencies?: SecureSourceTransportDependencies;
}): Promise<GreenhouseDetailV2> {
  const capability = assertGreenhouseCapability(input.capability);
  if (!capability.allowedOperations.includes("GET_JOB")) {
    throw new SecureSourceError("OPERATION_NOT_APPROVED");
  }
  const externalId = z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .parse(input.externalId);
  const response = await boundedSecureJsonGet({
    initialUrl: apiUrl(capability, "GET_JOB", externalId).toString(),
    capability,
    operation: "GET_JOB",
    budget: input.budget,
    now: input.now,
    signal: input.signal,
    dependencies: input.dependencies,
  });
  const payload = parseDetailPayload(response.body);
  const payloadExternalId = payload.id === undefined ? "" : String(payload.id);
  if (payloadExternalId !== externalId) {
    throw new SecureSourceError("SOURCE_DETAIL_ID_MISMATCH", null, "RESPONSE_BODY");
  }
  const parsed = parseRecord(payload, capability, 0);
  if (parsed.status === "UNUSABLE") {
    throw new SecureSourceError("SOURCE_RECORD_UNUSABLE", null, "RESPONSE_BODY");
  }
  if (parsed.record.externalId !== externalId) {
    throw new SecureSourceError("SOURCE_DETAIL_ID_MISMATCH", null, "RESPONSE_BODY");
  }
  const digest = sha256(
    ["GET_JOB", externalId, parsed.record.externalId, parsed.record.contentDigest].join("\n"),
  );
  input.budget.consumePage("GET_JOB:" + externalId, 1, response.byteCount);
  return Object.freeze({
    record: parsed.record,
    externalId,
    pageDigest: digest,
    byteCount: response.byteCount,
    requestCount: response.requestCount,
  });
}

export function greenhousePageDigestForDetail(
  externalId: string,
  record: GreenhousePostingRecordV2,
): string {
  return sha256(["GET_JOB", externalId, record.externalId, record.contentDigest].join("\n"));
}
