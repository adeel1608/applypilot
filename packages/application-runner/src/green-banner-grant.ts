import { createHash } from "node:crypto";

import { z } from "zod";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

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

export const GreenBannerOperationSchema = z.enum([
  "SOURCE_LIST_JOBS",
  "OPEN_AND_INSPECT_ONLY",
  "MAP_FOR_FILL",
  "FILL",
  "UPLOAD",
  "VERIFY",
  "FILL_PREVIEW",
]);
export type GreenBannerOperation = z.infer<typeof GreenBannerOperationSchema>;

export const GreenBannerProviderSchema = z.enum(["LEVER", "GREENHOUSE"]);

export const GreenBannerScopeSchema = z
  .object({
    sourceProviders: z.array(GreenBannerProviderSchema).min(1).max(2),
    sourceHosts: z
      .array(z.string().regex(/^[A-Za-z0-9.-]{1,253}$/))
      .min(1)
      .max(3),
    targetOrigins: z.array(z.url()).min(1).max(5),
    maxChildTtlMs: z
      .number()
      .int()
      .min(60_000)
      .max(2 * 60 * 60 * 1000),
  })
  .strict()
  .superRefine((scope, context) => {
    if (new Set(scope.sourceProviders).size !== scope.sourceProviders.length) {
      context.addIssue({ code: "custom", message: "PARENT_SOURCE_PROVIDERS_NOT_UNIQUE" });
    }
    if (new Set(scope.sourceHosts).size !== scope.sourceHosts.length) {
      context.addIssue({ code: "custom", message: "PARENT_SOURCE_HOSTS_NOT_UNIQUE" });
    }
    for (const origin of scope.targetOrigins) {
      const parsed = new URL(origin);
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
      ) {
        context.addIssue({ code: "custom", message: "PARENT_TARGET_ORIGIN_INVALID" });
      }
    }
  });
export type GreenBannerScope = z.infer<typeof GreenBannerScopeSchema>;

const ParentGrantConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    grantId: z.literal("GREEN_BANNER_SESSION_GRANT_V1"),
    grantType: z.literal("GREEN_BANNER_SESSION_GRANT_V1"),
    allowedOperations: z.array(GreenBannerOperationSchema).min(1).max(7),
    scope: GreenBannerScopeSchema,
    mainSha: z.string().regex(/^[a-f0-9]{40}$/),
    createdAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.allowedOperations).size !== value.allowedOperations.length) {
      context.addIssue({ code: "custom", message: "PARENT_OPERATIONS_NOT_UNIQUE" });
    }
    if (value.allowedOperations.includes("SUBMIT" as GreenBannerOperation)) {
      context.addIssue({ code: "custom", message: "PARENT_SUBMIT_FORBIDDEN" });
    }
  });

export const GreenBannerParentGrantSchema = ParentGrantConfigSchema.extend({
  grantDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type GreenBannerParentGrant = z.infer<typeof GreenBannerParentGrantSchema>;

export function greenBannerParentGrantDigest(
  input: GreenBannerParentGrant | z.input<typeof ParentGrantConfigSchema>,
): string {
  const config = ParentGrantConfigSchema.parse(input);
  return sha256(canonical(config));
}

export function createGreenBannerParentGrant(
  input: z.input<typeof ParentGrantConfigSchema>,
): GreenBannerParentGrant {
  const config = ParentGrantConfigSchema.parse(input);
  return GreenBannerParentGrantSchema.parse({
    ...config,
    grantDigest: greenBannerParentGrantDigest(config),
  });
}

export const GreenBannerChildTypeSchema = z.enum(["SOURCE", "TARGET"]);

const ChildConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    childId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,100}$/),
    childType: GreenBannerChildTypeSchema,
    operation: GreenBannerOperationSchema,
    provider: GreenBannerProviderSchema.nullable(),
    tenant: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,100}$/)
      .nullable(),
    allowedHost: z
      .string()
      .regex(/^[A-Za-z0-9.-]{1,253}$/)
      .nullable(),
    allowedPathPrefix: z.string().startsWith("/").max(500).nullable(),
    targetOrigin: z.url().nullable(),
    targetPath: z.string().startsWith("/").max(500).nullable(),
    packetDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    adapterVersion: z.string().min(1).max(100).nullable(),
    formVersion: z.string().min(1).max(100).nullable(),
    documentDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    answersDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    disclosuresDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    mainSha: z.string().regex(/^[a-f0-9]{40}$/),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();

export const GreenBannerChildCapabilitySchema = ChildConfigSchema.extend({
  parentGrantId: z.literal("GREEN_BANNER_SESSION_GRANT_V1"),
  parentGrantDigest: z.string().regex(/^[a-f0-9]{64}$/),
  childDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type GreenBannerChildCapability = z.infer<typeof GreenBannerChildCapabilitySchema>;
export type GreenBannerChildInput = z.input<typeof ChildConfigSchema>;

function assertRequiredChildBindings(child: z.infer<typeof ChildConfigSchema>): void {
  const source = child.childType === "SOURCE";
  if (
    source !==
    Boolean(child.provider && child.tenant && child.allowedHost && child.allowedPathPrefix)
  ) {
    throw new Error("CHILD_SOURCE_SCOPE_INCOMPLETE");
  }
  if (!source && (!child.targetOrigin || !child.targetPath || !child.packetDigest)) {
    throw new Error("CHILD_TARGET_SCOPE_INCOMPLETE");
  }
  if (source && !["SOURCE_LIST_JOBS"].includes(child.operation)) {
    throw new Error("CHILD_SOURCE_OPERATION_INVALID");
  }
  if (!source && child.operation === "SOURCE_LIST_JOBS") {
    throw new Error("CHILD_TARGET_OPERATION_INVALID");
  }
  if (
    ["MAP_FOR_FILL", "FILL", "FILL_PREVIEW", "VERIFY"].includes(child.operation) &&
    !child.packetDigest
  ) {
    throw new Error("CHILD_PACKET_BINDING_REQUIRED");
  }
  if (child.operation === "UPLOAD" && (!child.packetDigest || !child.documentDigest)) {
    throw new Error("CHILD_DOCUMENT_BINDING_REQUIRED");
  }
}

function originOf(value: string): string {
  return new URL(value).origin;
}

export function assertGreenBannerChildWithinParent(
  parentInput: GreenBannerParentGrant,
  childInput: GreenBannerChildInput,
  now = new Date(),
): void {
  const parent = GreenBannerParentGrantSchema.parse(parentInput);
  const child = ChildConfigSchema.parse(childInput);
  assertRequiredChildBindings(child);
  if (!parent.allowedOperations.includes(child.operation))
    throw new Error("CHILD_OPERATION_ESCALATION");
  if (child.mainSha !== parent.mainSha) throw new Error("CHILD_MAIN_SHA_MISMATCH");
  const created = Date.parse(child.createdAt);
  const expires = Date.parse(child.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || expires <= now.getTime()) {
    throw new Error("CHILD_EXPIRED");
  }
  if (expires - created > parent.scope.maxChildTtlMs) throw new Error("CHILD_TTL_EXCEEDS_PARENT");
  if (child.childType === "SOURCE") {
    if (!parent.scope.sourceProviders.includes(child.provider!))
      throw new Error("CHILD_PROVIDER_ESCALATION");
    if (!parent.scope.sourceHosts.includes(child.allowedHost!))
      throw new Error("CHILD_HOST_ESCALATION");
    const providerHosts =
      child.provider === "GREENHOUSE"
        ? ["boards-api.greenhouse.io"]
        : ["api.lever.co", "api.eu.lever.co"];
    if (!providerHosts.includes(child.allowedHost!))
      throw new Error("CHILD_PROVIDER_HOST_MISMATCH");
  } else if (!parent.scope.targetOrigins.includes(originOf(child.targetOrigin!))) {
    throw new Error("CHILD_TARGET_ORIGIN_ESCALATION");
  }
}

export function greenBannerChildCapabilityDigest(
  input: GreenBannerChildCapability | GreenBannerChildInput,
): string {
  const configInput = { ...(input as GreenBannerChildCapability) } as Record<string, unknown>;
  delete configInput.parentGrantId;
  delete configInput.parentGrantDigest;
  delete configInput.childDigest;
  const config = ChildConfigSchema.parse(configInput);
  return sha256(canonical(config));
}

export function deriveGreenBannerChildCapability(input: {
  parent: GreenBannerParentGrant;
  child: GreenBannerChildInput;
  now?: Date;
}): GreenBannerChildCapability {
  const parent = GreenBannerParentGrantSchema.parse(input.parent);
  const child = ChildConfigSchema.parse(input.child);
  assertGreenBannerChildWithinParent(parent, child, input.now ?? new Date());
  const childDigest = greenBannerChildCapabilityDigest(child);
  return GreenBannerChildCapabilitySchema.parse({
    ...child,
    parentGrantId: parent.grantId,
    parentGrantDigest: parent.grantDigest,
    childDigest,
  });
}

export function assertGreenBannerChildDigest(input: GreenBannerChildCapability): void {
  const child = GreenBannerChildCapabilitySchema.parse(input);
  if (greenBannerChildCapabilityDigest(child) !== child.childDigest) {
    throw new Error("CHILD_DIGEST_MISMATCH");
  }
}
