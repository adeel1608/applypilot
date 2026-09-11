import { createHash } from "node:crypto";

import { z } from "zod";

export const SourceOperationSchema = z.enum(["LIST_JOBS", "GET_JOB"]);
export type SourceOperation = z.infer<typeof SourceOperationSchema>;

export const SourceApprovalStateSchema = z.enum([
  "DRAFT",
  "APPROVED",
  "REVOKED",
  "EXPIRED",
  "SUPERSEDED",
]);

export const SourceCapabilityV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    capabilityId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/),
    version: z.number().int().positive(),
    predecessorVersion: z.number().int().positive().nullable(),
    source: z.enum(["GREENHOUSE", "LEVER"]),
    alias: z.string().regex(/^[A-Za-z0-9 _-]{1,80}$/),
    tenant: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    region: z.enum(["GLOBAL", "EU"]),
    allowedHost: z.string().min(1).max(253),
    allowedPathPrefix: z.string().startsWith("/").max(500),
    allowedOperations: z
      .array(SourceOperationSchema)
      .min(1)
      .max(2)
      .refine((items) => new Set(items).size === items.length, "Operations must be unique"),
    approvalState: SourceApprovalStateSchema,
    approvalReference: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,99}$/)
      .nullable(),
    approvedAt: z.iso.datetime().nullable(),
    policyVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
    policyReviewedAt: z.iso.datetime(),
    policyExpiresAt: z.iso.datetime(),
    capabilityExpiresAt: z.iso.datetime(),
    requestBudget: z.number().int().min(1).max(30),
    recordCap: z.number().int().min(1).max(500),
    pageSizeCap: z.number().int().min(1).max(100),
    responseByteLimit: z.number().int().min(1).max(5_000_000),
    requestTimeoutMs: z.number().int().min(100).max(30_000),
    runTimeoutMs: z.number().int().min(200).max(300_000),
    maxRedirects: z.number().int().min(0).max(3),
    maxRetries: z.number().int().min(0).max(2),
    maxConcurrency: z.literal(1),
    parserVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
    revocationReason: z
      .enum(["OWNER_REVOKED", "POLICY_CHANGED", "SECURITY_STOP", "SUPERSEDED"])
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedHost =
      value.source === "GREENHOUSE"
        ? "boards-api.greenhouse.io"
        : value.region === "EU"
          ? "api.eu.lever.co"
          : "api.lever.co";
    const expectedPrefix =
      value.source === "GREENHOUSE"
        ? `/v1/boards/${value.tenant}/`
        : `/v0/postings/${value.tenant}`;
    if (value.allowedHost !== expectedHost) {
      context.addIssue({ code: "custom", path: ["allowedHost"], message: "SOURCE_HOST_MISMATCH" });
    }
    if (value.allowedPathPrefix !== expectedPrefix) {
      context.addIssue({
        code: "custom",
        path: ["allowedPathPrefix"],
        message: "SOURCE_PATH_MISMATCH",
      });
    }
    if (value.source === "GREENHOUSE" && value.region !== "GLOBAL") {
      context.addIssue({ code: "custom", path: ["region"], message: "SOURCE_REGION_MISMATCH" });
    }
    if (value.source === "LEVER" && value.maxRedirects !== 0) {
      context.addIssue({
        code: "custom",
        path: ["maxRedirects"],
        message: "LEVER_REDIRECTS_FORBIDDEN",
      });
    }
    if (value.predecessorVersion !== null && value.predecessorVersion >= value.version) {
      context.addIssue({
        code: "custom",
        path: ["predecessorVersion"],
        message: "CAPABILITY_VERSION_ORDER_INVALID",
      });
    }
    if (value.pageSizeCap > value.recordCap) {
      context.addIssue({
        code: "custom",
        path: ["pageSizeCap"],
        message: "PAGE_CAP_EXCEEDS_RUN_CAP",
      });
    }
    if (value.runTimeoutMs <= value.requestTimeoutMs) {
      context.addIssue({
        code: "custom",
        path: ["runTimeoutMs"],
        message: "RUN_TIMEOUT_TOO_SMALL",
      });
    }
    const approved = value.approvalState === "APPROVED";
    if (approved !== Boolean(value.approvedAt && value.approvalReference)) {
      context.addIssue({
        code: "custom",
        path: ["approvalState"],
        message: "APPROVAL_BINDING_INVALID",
      });
    }
    const revoked = ["REVOKED", "SUPERSEDED"].includes(value.approvalState);
    if (revoked !== Boolean(value.revokedAt && value.revocationReason)) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "REVOCATION_BINDING_INVALID",
      });
    }
  });

export type SourceCapabilityV2 = z.infer<typeof SourceCapabilityV2Schema>;

export const SourceAllowlistV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    capabilities: z.array(SourceCapabilityV2Schema).max(20),
  })
  .strict()
  .superRefine(({ capabilities }, context) => {
    const identities = new Set<string>();
    const active = new Set<string>();
    for (const capability of capabilities) {
      const identity = `${capability.capabilityId}:${capability.version}`;
      if (identities.has(identity)) {
        context.addIssue({ code: "custom", message: "DUPLICATE_CAPABILITY_VERSION" });
      }
      identities.add(identity);
      if (capability.approvalState === "APPROVED") {
        if (active.has(capability.capabilityId)) {
          context.addIssue({ code: "custom", message: "MULTIPLE_ACTIVE_CAPABILITY_VERSIONS" });
        }
        active.add(capability.capabilityId);
      }
    }
  });

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sourceCapabilityDigest(input: SourceCapabilityV2): string {
  return createHash("sha256")
    .update(canonical(SourceCapabilityV2Schema.parse(input)))
    .digest("hex");
}

export type SourceCapabilityReadiness =
  | { status: "WAITING_FOR_APPROVED_TENANT" }
  | {
      status: "SOURCE_DISABLED";
      reason: "NOT_APPROVED" | "POLICY_EXPIRED" | "CAPABILITY_EXPIRED" | "REVOKED" | "SUPERSEDED";
    }
  | { status: "SOURCE_ENABLED"; capabilityId: string; version: number; alias: string };

export function sourceCapabilityReadiness(
  input: unknown,
  now: Date = new Date(),
): SourceCapabilityReadiness {
  if (input === null || input === undefined) return { status: "WAITING_FOR_APPROVED_TENANT" };
  const parsed = SourceCapabilityV2Schema.safeParse(input);
  if (!parsed.success) return { status: "SOURCE_DISABLED", reason: "NOT_APPROVED" };
  const capability = parsed.data;
  if (capability.approvalState === "REVOKED")
    return { status: "SOURCE_DISABLED", reason: "REVOKED" };
  if (capability.approvalState === "SUPERSEDED")
    return { status: "SOURCE_DISABLED", reason: "SUPERSEDED" };
  if (capability.approvalState !== "APPROVED")
    return { status: "SOURCE_DISABLED", reason: "NOT_APPROVED" };
  if (Date.parse(capability.policyExpiresAt) <= now.getTime())
    return { status: "SOURCE_DISABLED", reason: "POLICY_EXPIRED" };
  if (Date.parse(capability.capabilityExpiresAt) <= now.getTime())
    return { status: "SOURCE_DISABLED", reason: "CAPABILITY_EXPIRED" };
  return {
    status: "SOURCE_ENABLED",
    capabilityId: capability.capabilityId,
    version: capability.version,
    alias: capability.alias,
  };
}

export const SourceRunStatusSchema = z.enum([
  "RUNNING",
  "COMPLETE",
  "PARTIAL",
  "STOPPED",
  "OUTCOME_UNKNOWN",
]);

export const SourceStopCodeSchema = z.enum([
  "OWNER_CANCELLED",
  "CAPABILITY_CHANGED",
  "CAPABILITY_REVOKED",
  "CAPABILITY_EXPIRED",
  "POLICY_EXPIRED",
  "OPERATION_NOT_APPROVED",
  "REQUEST_BUDGET_EXCEEDED",
  "PAGE_BUDGET_EXCEEDED",
  "RECORD_CAP_EXCEEDED",
  "RESPONSE_TOO_LARGE",
  "RUN_TIMEOUT",
  "REQUEST_TIMEOUT",
  "CURSOR_LOOP",
  "CURSOR_REVERSED",
  "CONCURRENT_RUN",
  "RATE_LIMITED",
  "ACCESS_DENIED",
  "AUTHENTICATION_REQUIRED",
  "BOT_PROTECTION",
  "CONTENT_TYPE_INVALID",
  "SCHEMA_CHANGED",
  "DESTINATION_FORBIDDEN",
  "PERSISTENCE_FAILED",
  "NETWORK_OUTCOME_UNKNOWN",
  "SOURCE_MISMATCH",
  "NOT_APPROVED",
  "HTTPS_REQUIRED",
  "URL_CREDENTIALS_FORBIDDEN",
  "NON_STANDARD_PORT_FORBIDDEN",
  "URL_FRAGMENT_FORBIDDEN",
  "HOST_NOT_ALLOWLISTED",
  "PATH_NOT_ALLOWLISTED",
  "QUERY_NOT_ALLOWLISTED",
  "DESTINATION_ADDRESS_FORBIDDEN",
  "PINNED_ADDRESS_MISMATCH",
  "REDIRECT_FORBIDDEN",
  "REDIRECT_WITHOUT_LOCATION",
  "CONTENT_ENCODING_FORBIDDEN",
  "BOT_OR_ACCESS_INTERSTITIAL",
  "PAGE_SIZE_EXCEEDED",
]);

export const SourceAuditMetadataSchemas = {
  "source.capability.versioned": z
    .object({
      capabilityId: z.string().min(1),
      version: z.number().int().positive(),
      state: SourceApprovalStateSchema,
    })
    .strict(),
  "source.run.started": z
    .object({
      runId: z.string().min(1),
      capabilityId: z.string().min(1),
      capabilityVersion: z.number().int().positive(),
      operation: SourceOperationSchema,
    })
    .strict(),
  "source.page.persisted": z
    .object({
      runId: z.string().min(1),
      pageNumber: z.number().int().positive(),
      requestCount: z.number().int().nonnegative(),
      recordCount: z.number().int().nonnegative(),
      byteCount: z.number().int().nonnegative(),
    })
    .strict(),
  "source.run.stopped": z
    .object({
      runId: z.string().min(1),
      code: SourceStopCodeSchema,
      requestCount: z.number().int().nonnegative(),
      recordCount: z.number().int().nonnegative(),
    })
    .strict(),
  "source.run.completed": z
    .object({
      runId: z.string().min(1),
      requestCount: z.number().int().nonnegative(),
      pageCount: z.number().int().nonnegative(),
      recordCount: z.number().int().nonnegative(),
    })
    .strict(),
} as const;

export type SourceAuditEventType = keyof typeof SourceAuditMetadataSchemas;

export function validateSourceAuditMetadata(type: SourceAuditEventType, input: unknown): object {
  return SourceAuditMetadataSchemas[type].parse(input) as object;
}

export class SourceRunBudget {
  readonly seenCursors = new Set<string>();
  attempts = 0;
  pages = 0;
  records = 0;
  bytes = 0;
  redirects = 0;
  retries = 0;

  constructor(
    readonly capability: SourceCapabilityV2,
    readonly startedAt: Date,
  ) {
    SourceCapabilityV2Schema.parse(capability);
  }

  assertCurrent(now: Date): void {
    const readiness = sourceCapabilityReadiness(this.capability, now);
    if (readiness.status !== "SOURCE_ENABLED") {
      throw new Error(readiness.status === "SOURCE_DISABLED" ? readiness.reason : "NOT_APPROVED");
    }
    if (now.getTime() - this.startedAt.getTime() >= this.capability.runTimeoutMs) {
      throw new Error("RUN_TIMEOUT");
    }
  }

  consumeAttempt(): void {
    if (this.attempts >= this.capability.requestBudget) throw new Error("REQUEST_BUDGET_EXCEEDED");
    this.attempts += 1;
  }

  consumePage(cursor: string, records: number, bytes: number): void {
    if (this.seenCursors.has(cursor)) throw new Error("CURSOR_LOOP");
    if (this.pages >= this.capability.requestBudget) throw new Error("PAGE_BUDGET_EXCEEDED");
    if (this.records + records > this.capability.recordCap) throw new Error("RECORD_CAP_EXCEEDED");
    this.seenCursors.add(cursor);
    this.pages += 1;
    this.records += records;
    this.bytes += bytes;
  }
}
