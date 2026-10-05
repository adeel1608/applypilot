import { createHash } from "node:crypto";

import { z } from "zod";

import { R2AFailureDiagnosticSchema } from "./r2a-diagnostic";

export const SourceOperationSchema = z.enum(["LIST_JOBS", "GET_JOB"]);
export type SourceOperation = z.infer<typeof SourceOperationSchema>;
export const SourceOwnerActionSchema = z.enum(["APPROVE", "START"]);
export const SourceOwnerReceiptStateSchema = z.enum([
  "ACTIVE",
  "CONSUMED",
  "REVOKED",
  "EXPIRED",
  "FAILED",
]);

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

export const SourceCapabilityViewBindingSchema = z
  .object({
    capabilityId: SourceCapabilityV2Schema.shape.capabilityId,
    version: z.number().int().positive(),
    capabilityDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type SourceCapabilityViewBinding = z.infer<typeof SourceCapabilityViewBindingSchema>;

/** Selects the immutable highest-version head for every capability family. */
export function latestSourceCapabilityHeads(input: readonly unknown[]): SourceCapabilityV2[] {
  const identities = new Set<string>();
  const heads = new Map<string, SourceCapabilityV2>();
  for (const item of input) {
    const capability = SourceCapabilityV2Schema.parse(item);
    const identity = `${capability.capabilityId}\u0000${capability.version}`;
    if (identities.has(identity)) throw new Error("DUPLICATE_CAPABILITY_VERSION");
    identities.add(identity);
    const current = heads.get(capability.capabilityId);
    if (!current || capability.version > current.version) {
      heads.set(capability.capabilityId, capability);
    }
  }
  return [...heads.values()].sort((left, right) =>
    left.capabilityId < right.capabilityId ? -1 : left.capabilityId > right.capabilityId ? 1 : 0,
  );
}

/** Resolves a posted UI binding only when it still names the exact current private head. */
export function resolveCurrentSourceCapabilityHead(
  capabilities: readonly unknown[],
  bindingInput: unknown,
): SourceCapabilityV2 {
  const binding = SourceCapabilityViewBindingSchema.safeParse(bindingInput);
  if (!binding.success) throw new Error("SOURCE_CAPABILITY_VIEW_STALE");
  const current = latestSourceCapabilityHeads(capabilities).find(
    ({ capabilityId }) => capabilityId === binding.data.capabilityId,
  );
  if (
    !current ||
    current.version !== binding.data.version ||
    sourceCapabilityDigest(current) !== binding.data.capabilityDigest
  ) {
    throw new Error("SOURCE_CAPABILITY_VIEW_STALE");
  }
  return current;
}

export const SourceAllowlistV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    capabilities: z.array(SourceCapabilityV2Schema).max(29),
  })
  .strict()
  // Older APPROVED entries remain immutable history; current authority is the latest family head.
  .superRefine(({ capabilities }, context) => {
    const identities = new Set<string>();
    for (const capability of capabilities) {
      const identity = `${capability.capabilityId}:${capability.version}`;
      if (identities.has(identity)) {
        context.addIssue({ code: "custom", message: "DUPLICATE_CAPABILITY_VERSION" });
      }
      identities.add(identity);
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

export const SourceTransportLifecycleStageSchema = z.enum([
  "DNS",
  "REQUEST_CREATED",
  "SOCKET_ASSIGNED",
  "TCP_CONNECTED",
  "TLS_ESTABLISHED",
  "REQUEST_FLUSHED",
  "RESPONSE_HEADERS",
  "RESPONSE_BODY",
  "PERSISTENCE",
]);
export type SourceTransportLifecycleStage = z.infer<typeof SourceTransportLifecycleStageSchema>;

export const SourceSchemaDiagnosticFieldSchema = z.enum([
  "id",
  "text",
  "categories",
  "categories.location",
  "categories.commitment",
  "categories.team",
  "categories.department",
  "categories.level",
  "categories.allLocations",
  "categories.allLocations[]",
  "country",
  "opening",
  "openingPlain",
  "description",
  "descriptionPlain",
  "descriptionBody",
  "descriptionBodyPlain",
  "lists",
  "lists[]",
  "lists[].text",
  "lists[].content",
  "additional",
  "additionalPlain",
  "hostedUrl",
  "applyUrl",
  "workplaceType",
  "salaryRange",
  "salaryRange.currency",
  "salaryRange.interval",
  "salaryRange.min",
  "salaryRange.max",
  "salaryDescription",
  "salaryDescriptionPlain",
  "UNKNOWN_CONTRACT_BOUNDARY",
]);
export type SourceSchemaDiagnosticField = z.infer<typeof SourceSchemaDiagnosticFieldSchema>;

export const SourceSchemaExpectedTypeSchema = z.enum([
  "array",
  "enum",
  "number",
  "object",
  "string",
  "string|null",
  "url",
]);
export type SourceSchemaExpectedType = z.infer<typeof SourceSchemaExpectedTypeSchema>;

export const SourceSchemaIssueCategorySchema = z.enum([
  "FIELD_TYPE_MISMATCH",
  "INVALID_ENUM",
  "INVALID_FORMAT",
  "INVALID_URL",
  "MISSING_REQUIRED",
  "UNKNOWN_CONTRACT_BOUNDARY",
]);
export type SourceSchemaIssueCategory = z.infer<typeof SourceSchemaIssueCategorySchema>;

export const SourceSchemaDiagnosticSchema = z
  .object({
    field: SourceSchemaDiagnosticFieldSchema,
    expectedStructuralType: SourceSchemaExpectedTypeSchema,
    issueCategory: SourceSchemaIssueCategorySchema,
    recordIndex: z.number().int().nonnegative().max(1_000_000).optional(),
  })
  .strict();
export type SourceSchemaDiagnostic = z.infer<typeof SourceSchemaDiagnosticSchema>;

export const SourceProviderDriftDiagnosticSchema = z
  .object({
    issueCategory: z.literal("PROVIDER_ENUM_DRIFT"),
    field: z.literal("workplaceType"),
    expectedStructuralType: z.literal("enum"),
    recordIndex: z.number().int().nonnegative().max(1_000_000).optional(),
  })
  .strict();
export type SourceProviderDriftDiagnostic = z.infer<typeof SourceProviderDriftDiagnosticSchema>;

export const SourceRecordUnusableReasonSchema = z.enum([
  "UNUSABLE_IDENTITY",
  "UNUSABLE_TITLE",
  "MISSING_EFFECTIVE_LOCATION",
  "MISSING_USABLE_DESCRIPTION",
  "UNUSABLE_LINK_BOUNDARY",
]);
export type SourceRecordUnusableReason = z.infer<typeof SourceRecordUnusableReasonSchema>;

export const SourceRecordUnusableDiagnosticSchema = z
  .object({
    reasonCode: SourceRecordUnusableReasonSchema,
    recordIndex: z.number().int().nonnegative().max(1_000_000),
  })
  .strict();
export type SourceRecordUnusableDiagnostic = z.infer<typeof SourceRecordUnusableDiagnosticSchema>;

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
  "SOURCE_PAGE_DUPLICATE_EXTERNAL_ID",
  "DNS_RESOLUTION_FAILED",
  "NETWORK_ROUTE_UNAVAILABLE",
  "CONNECTION_REFUSED",
  "CONNECTION_RESET",
  "TLS_HANDSHAKE_FAILED",
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
  "SOURCE_RECORD_UNUSABLE",
  "DETAIL_NOT_FOUND",
  "SOURCE_DETAIL_ID_INVALID",
  "SOURCE_DETAIL_ID_MISMATCH",
]);

export const SourcePersistencePhaseSchema = z.enum([
  "CAPABILITY_ASSERT",
  "SOURCE_IDENTITY",
  "JOB_NORMALIZATION",
  "JOB_UPSERT",
  "SOURCE_RECORD_UPSERT",
  "SOURCE_RECORD_LOOKUP",
  "OBSERVATION_INSERT",
  "PAYLOAD_INSERT",
  "JOB_VERSION_INSERT",
  "R2A_NORMALIZATION",
  "R2A_PERSIST",
  "DUPLICATE_IDENTITY",
  "DUPLICATE_SUGGESTION",
  "PAGE_INSERT",
  "VERIFICATION_INSERT",
  "CHECKPOINT_UPDATE",
  "PAGE_AUDIT",
  "COMPLETE_STATUS",
  "COMPLETE_QUALIFICATION",
  "UNKNOWN_PERSISTENCE",
]);
export type SourcePersistencePhase = z.infer<typeof SourcePersistencePhaseSchema>;

export const SourcePersistenceProviderSchema = z.enum(["LEVER", "GREENHOUSE"]);
export const SourcePersistenceSqliteCodeClassSchema = z.enum([
  "SQLITE_CONSTRAINT_FOREIGNKEY",
  "SQLITE_CONSTRAINT_UNIQUE",
  "SQLITE_CONSTRAINT_CHECK",
  "SQLITE_CONSTRAINT_NOTNULL",
  "SQLITE_BUSY",
  "SQLITE_READONLY",
  "SQLITE_OTHER",
  "NOT_SQLITE",
]);
export const SourcePersistenceDomainCodeSchema = z.union([
  SourceStopCodeSchema,
  z.enum([
    "JOB_SOURCE_IDENTITY_CONFLICT",
    "JOB_SOURCE_IDENTITY_RESOLUTION_FAILED",
    "QUALIFICATION_INTERRUPTED",
    "R2_DUPLICATE_OBSERVATION_VERSION_REQUIRED",
    "R2_SCHEMA_REQUIRED",
    "R2A_DERIVATION_BINDING_CONFLICT",
    "R2A_DERIVATION_INPUT_NOT_FOUND",
    "R2A_DERIVATION_SCHEMA_REQUIRED",
    "R2A_EVIDENCE_OBSERVATION_MISMATCH",
    "R2A_EVIDENCE_ID_COLLISION",
    "R2A_EXCERPT_HASH_MISMATCH",
    "R2A_IMMUTABLE_PAYLOAD_IDENTITY_MISMATCH",
    "R2A_IMMUTABLE_VERSION_CONFLICT",
    "R2A_JOB_VERSION_NOT_FOUND",
    "R2A_NORMALIZATION_MISSING",
    "R2A_OBSERVATION_VERSION_MISMATCH",
    "R2A_SCHEMA_NOT_AVAILABLE",
    "R2A_STRUCTURE_BUDGET_EXCEEDED",
    "SOURCE_JOB_VERSION_REQUIRED",
    "SOURCE_OPERATION_MISMATCH",
    "SOURCE_PAGE_REPLAY_CONFLICT",
    "SOURCE_RECORD_CAPABILITY_MISMATCH",
    "SOURCE_RECORD_REQUIRED_FIELD_MISSING",
    "SOURCE_VERIFICATION_CONFLICT",
    "SOURCE_VERIFICATION_LEDGER_REQUIRED",
  ]),
]);

export const SourcePersistenceDiagnosticSchema = z
  .object({
    phase: SourcePersistencePhaseSchema,
    recordIndex: z.number().int().nonnegative().max(1_000_000).nullable(),
    externalIdHashPrefix: z
      .string()
      .regex(/^[a-f0-9]{12}$/)
      .nullable(),
    provider: SourcePersistenceProviderSchema,
    sqliteCodeClass: SourcePersistenceSqliteCodeClassSchema,
    safeDomainCode: SourcePersistenceDomainCodeSchema.nullable(),
    transactionRolledBack: z.literal(true),
    pageProviderRecordCount: z.number().int().nonnegative().max(1_000_000),
    acceptedRecordCount: z.number().int().nonnegative().max(1_000_000),
    unusableRecordCount: z.number().int().nonnegative().max(1_000_000),
    r2a: R2AFailureDiagnosticSchema.optional(),
  })
  .strict();
export type SourcePersistenceDiagnostic = z.infer<typeof SourcePersistenceDiagnosticSchema>;

function persistenceSqliteCodeClass(
  error: unknown,
): z.infer<typeof SourcePersistenceSqliteCodeClassSchema> {
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
  if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") return "SQLITE_CONSTRAINT_FOREIGNKEY";
  if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
    return "SQLITE_CONSTRAINT_UNIQUE";
  }
  if (code === "SQLITE_CONSTRAINT_CHECK") return "SQLITE_CONSTRAINT_CHECK";
  if (code === "SQLITE_CONSTRAINT_NOTNULL") return "SQLITE_CONSTRAINT_NOTNULL";
  if (code === "SQLITE_BUSY" || code?.startsWith("SQLITE_BUSY_")) return "SQLITE_BUSY";
  if (code === "SQLITE_READONLY" || code?.startsWith("SQLITE_READONLY_")) {
    return "SQLITE_READONLY";
  }
  return code?.startsWith("SQLITE_") ? "SQLITE_OTHER" : "NOT_SQLITE";
}

export function createSourcePersistenceDiagnostic(input: {
  phase: SourcePersistencePhase;
  recordIndex: number | null;
  externalId: string | null;
  provider: z.infer<typeof SourcePersistenceProviderSchema>;
  error: unknown;
  pageProviderRecordCount: number;
  acceptedRecordCount: number;
  unusableRecordCount: number;
}): SourcePersistenceDiagnostic {
  const candidateDomainCode = input.error instanceof Error ? input.error.message : null;
  const parsedDomainCode = SourcePersistenceDomainCodeSchema.safeParse(candidateDomainCode);
  const safeDomainCode = parsedDomainCode.success ? parsedDomainCode.data : null;
  const r2a = R2AFailureDiagnosticSchema.safeParse(
    input.error && typeof input.error === "object" && "r2aDiagnostic" in input.error
      ? input.error.r2aDiagnostic
      : undefined,
  );
  return SourcePersistenceDiagnosticSchema.parse({
    phase: input.phase,
    recordIndex: input.recordIndex,
    externalIdHashPrefix: input.externalId
      ? createHash("sha256").update(input.externalId).digest("hex").slice(0, 12)
      : null,
    provider: input.provider,
    sqliteCodeClass: persistenceSqliteCodeClass(input.error),
    safeDomainCode,
    transactionRolledBack: true,
    pageProviderRecordCount: input.pageProviderRecordCount,
    acceptedRecordCount: input.acceptedRecordCount,
    unusableRecordCount: input.unusableRecordCount,
    ...(r2a.success ? { r2a: r2a.data } : {}),
  });
}

export class SourcePersistenceError extends Error {
  readonly code = "PERSISTENCE_FAILED" as const;
  readonly persistenceDiagnostic: SourcePersistenceDiagnostic;

  constructor(diagnostic: SourcePersistenceDiagnostic) {
    super(diagnostic.safeDomainCode ?? "PERSISTENCE_FAILED");
    this.name = "SourcePersistenceError";
    this.persistenceDiagnostic = SourcePersistenceDiagnosticSchema.parse(diagnostic);
  }
}

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
  "source.owner.approval-recorded": z
    .object({
      receiptId: z.string().min(1),
      capabilityId: z.string().min(1),
      capabilityVersion: z.number().int().positive(),
      capabilityDigest: z.string().regex(/^[a-f0-9]{64}$/),
      state: z.literal("ACTIVE"),
    })
    .strict(),
  "source.owner.start-recorded": z
    .object({
      receiptId: z.string().min(1),
      approvalReceiptId: z.string().min(1),
      capabilityId: z.string().min(1),
      capabilityVersion: z.number().int().positive(),
      capabilityDigest: z.string().regex(/^[a-f0-9]{64}$/),
      operation: SourceOperationSchema,
      state: z.literal("ACTIVE"),
    })
    .strict(),
  "source.owner.receipt-terminal": z
    .object({
      receiptId: z.string().min(1),
      action: SourceOwnerActionSchema,
      state: z.enum(["CONSUMED", "REVOKED", "EXPIRED", "FAILED"]),
    })
    .strict(),
  "source.run.owner-bound": z
    .object({
      runId: z.string().min(1),
      approvalReceiptId: z.string().min(1),
      startReceiptId: z.string().min(1),
      capabilityId: z.string().min(1),
      capabilityVersion: z.number().int().positive(),
      capabilityDigest: z.string().regex(/^[a-f0-9]{64}$/),
      operation: SourceOperationSchema,
    })
    .strict(),
  "source.page.persisted": z
    .object({
      runId: z.string().min(1),
      pageNumber: z.number().int().positive(),
      requestCount: z.number().int().nonnegative(),
      recordCount: z.number().int().nonnegative(),
      providerRecordCount: z.number().int().nonnegative().optional(),
      acceptedRecordCount: z.number().int().nonnegative().optional(),
      unusableRecordCount: z.number().int().nonnegative().optional(),
      providerDriftWarningCount: z.number().int().nonnegative().optional(),
      persistedObservationCount: z.number().int().nonnegative().optional(),
      byteCount: z.number().int().nonnegative(),
    })
    .strict(),
  "source.record.unusable": SourceRecordUnusableDiagnosticSchema,
  "source.provider.drift": SourceProviderDriftDiagnosticSchema,
  "source.run.stopped": z
    .object({
      runId: z.string().min(1),
      code: SourceStopCodeSchema,
      transportStage: SourceTransportLifecycleStageSchema.nullable().optional(),
      schemaDiagnostic: SourceSchemaDiagnosticSchema.optional(),
      persistenceDiagnostic: SourcePersistenceDiagnosticSchema.optional(),
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
