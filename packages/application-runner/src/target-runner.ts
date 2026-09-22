import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { ApplicationRunStateSchema } from "@applypilot/job-model";

import {
  ApplicationPacketSchema,
  SyntheticStopReasonSchema,
  assessPacketReadiness,
  packetDigest,
  type ApplicationPacket,
  type FinalActionConsent,
  type RunnerCheckpoint,
  type SyntheticStopReason,
} from "./beta";

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

export const RunnerTargetOperationSchema = z.enum([
  "OPEN_AND_INSPECT_ONLY",
  "MAP_FOR_FILL",
  "FILL",
  "UPLOAD",
  "VERIFY",
  "FILL_PREVIEW",
  "SUBMIT",
]);
export type RunnerTargetOperation = z.infer<typeof RunnerTargetOperationSchema>;

export const InspectionDiagnosticCategorySchema = z.enum([
  "HTTP_ERROR",
  "NAVIGATION_EXCEPTION",
  "SNAPSHOT_INVALID",
  "DOM_INSPECTION_EXCEPTION",
  "ADAPTER_OUTPUT_INVALID",
  "UNKNOWN_INSPECTION_EXCEPTION",
]);
export type InspectionDiagnosticCategory = z.infer<typeof InspectionDiagnosticCategorySchema>;

export const DomInspectionDiagnosticStageSchema = z.enum([
  "DOM_QUERY",
  "DOM_ENUMERATION",
  "DOM_CONTROL_READ",
  "DOM_PAGE_METADATA",
  "DOM_RESULT_SERIALIZATION",
  "DOM_UNKNOWN",
]);
export type DomInspectionDiagnosticStage = z.infer<typeof DomInspectionDiagnosticStageSchema>;

export const DestinationChangeDiagnosticSchema = z.enum([
  "MAIN_NAVIGATION_OUT_OF_SCOPE",
  "FINAL_ORIGIN_CHANGED",
  "FINAL_PATH_CHANGED",
  "FINAL_QUERY_OR_FRAGMENT_CHANGED",
  "POPUP_ATTEMPT",
  "DESTINATION_STATE_UNKNOWN",
]);
export type DestinationChangeDiagnostic = z.infer<typeof DestinationChangeDiagnosticSchema>;

export const UnsupportedControlDiagnosticSchema = z.enum([
  "BLOCKED_WRITE_REQUEST",
  "DOWNLOAD_ATTEMPT",
  "CONTROL_LIMIT_EXCEEDED",
  "LABEL_LIMIT_EXCEEDED",
  "FORM_LIMIT_EXCEEDED",
  "SECTION_LIMIT_EXCEEDED",
  "CONTROL_METADATA_UNREADABLE",
  "LABEL_METADATA_UNREADABLE",
  "SECTION_METADATA_UNREADABLE",
  "CONTROL_SET_MISMATCH",
  "SHADOW_CONTROL_PRESENT",
  "HIDDEN_INTERACTIVE_STEP",
  "CUSTOM_WIDGET_DECLARED",
  "EXPLICIT_UNSUPPORTED_SIGNAL",
  "UNSUPPORTED_UNKNOWN",
]);
export type UnsupportedControlDiagnostic = z.infer<typeof UnsupportedControlDiagnosticSchema>;

const applicationOperations: RunnerTargetOperation[] = ["MAP_FOR_FILL", "FILL", "UPLOAD", "SUBMIT"];

function hasExactOperations(
  actual: readonly RunnerTargetOperation[],
  expected: readonly RunnerTargetOperation[],
): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

export function targetCapabilitySupportsApplication(capability: RunnerTargetCapability): boolean {
  return hasExactOperations(capability.allowedOperations, applicationOperations);
}

const nonSubmitOperations: RunnerTargetOperation[] = [
  "MAP_FOR_FILL",
  "FILL",
  "UPLOAD",
  "VERIFY",
  "FILL_PREVIEW",
];

export function targetCapabilitySupportsNonSubmit(capability: RunnerTargetCapability): boolean {
  return (
    capability.targetKind === "SYNTHETIC_LOCAL" &&
    hasExactOperations(capability.allowedOperations, nonSubmitOperations)
  );
}

export const RunnerTargetCapabilitySchema = z
  .object({
    schemaVersion: z.literal(2),
    capabilityId: z.string().min(1).max(100),
    version: z.number().int().positive(),
    predecessorVersion: z.number().int().positive().nullable(),
    targetKind: z.enum(["SYNTHETIC_LOCAL", "REAL_TARGET"]),
    alias: z.string().min(1).max(100),
    allowedOrigin: z.url(),
    allowedPathPrefix: z.string().startsWith("/").max(300),
    formVersion: z.string().min(1).max(100),
    adapterVersion: z.string().min(1).max(100),
    allowedOperations: z.array(RunnerTargetOperationSchema).min(1).max(5),
    approvalState: z.enum(["DRAFT", "APPROVED", "REVOKED", "EXPIRED", "SUPERSEDED"]),
    approvalReference: z.string().min(1).max(200).nullable(),
    approvedAt: z.iso.datetime().nullable(),
    policyVersion: z.string().min(1).max(100),
    policyExpiresAt: z.iso.datetime(),
    capabilityExpiresAt: z.iso.datetime(),
    revokedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.version === 1) !== (value.predecessorVersion === null)) {
      context.addIssue({ code: "custom", message: "Capability version sequence is invalid" });
    }
    if (value.version > 1 && value.predecessorVersion !== value.version - 1) {
      context.addIssue({ code: "custom", message: "Predecessor must be the previous version" });
    }
    const origin = new URL(value.allowedOrigin);
    if (
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    ) {
      context.addIssue({ code: "custom", message: "Allowed origin must be an origin only" });
    }
    const loopback = origin.hostname === "127.0.0.1" || origin.hostname === "localhost";
    if (value.targetKind === "SYNTHETIC_LOCAL" && (!loopback || origin.protocol !== "http:")) {
      context.addIssue({ code: "custom", message: "Synthetic capabilities must use local HTTP" });
    }
    if (value.targetKind === "REAL_TARGET" && (loopback || origin.protocol !== "https:")) {
      context.addIssue({ code: "custom", message: "Real capabilities must use non-local HTTPS" });
    }
    const approved = value.approvalState === "APPROVED";
    if (approved !== Boolean(value.approvalReference && value.approvedAt && !value.revokedAt)) {
      context.addIssue({ code: "custom", message: "Approval binding is inconsistent" });
    }
    if (value.approvalState === "REVOKED" && !value.revokedAt) {
      context.addIssue({ code: "custom", message: "Revoked capability requires revokedAt" });
    }
    if (new Set(value.allowedOperations).size !== value.allowedOperations.length) {
      context.addIssue({ code: "custom", message: "Target operations must be unique" });
    }
    const canonicalOrder = RunnerTargetOperationSchema.options.filter((operation) =>
      value.allowedOperations.includes(operation),
    );
    if (!hasExactOperations(value.allowedOperations, canonicalOrder)) {
      context.addIssue({ code: "custom", message: "Target operations must use canonical order" });
    }
    if (
      value.targetKind === "REAL_TARGET" &&
      !hasExactOperations(value.allowedOperations, ["OPEN_AND_INSPECT_ONLY"])
    ) {
      context.addIssue({
        code: "custom",
        message: "Real target authority is inspection-only in this release",
      });
    }
  });

export type RunnerTargetCapability = z.infer<typeof RunnerTargetCapabilitySchema>;

export const RunnerTargetAllowlistSchema = z
  .object({
    schemaVersion: z.literal(2),
    capabilities: z.array(RunnerTargetCapabilitySchema).max(10),
  })
  .strict()
  .superRefine(({ capabilities }, context) => {
    const versions = new Set<string>();
    const approved = new Set<string>();
    for (const capability of capabilities) {
      const version = `${capability.capabilityId}:${capability.version}`;
      if (versions.has(version))
        context.addIssue({ code: "custom", message: "DUPLICATE_TARGET_CAPABILITY_VERSION" });
      versions.add(version);
      if (capability.approvalState === "APPROVED") {
        if (approved.has(capability.capabilityId))
          context.addIssue({ code: "custom", message: "MULTIPLE_APPROVED_TARGET_VERSIONS" });
        approved.add(capability.capabilityId);
      }
    }
  });

export function runnerTargetCapabilityDigest(input: RunnerTargetCapability): string {
  return sha256(canonical(RunnerTargetCapabilitySchema.parse(input)));
}

export function deterministicRunnerTargetCapabilityId(input: {
  targetKind: "SYNTHETIC_LOCAL" | "REAL_TARGET";
  allowedOrigin: string;
  allowedPathPrefix: string;
  operation: RunnerTargetOperation;
  formVersion: string;
  adapterVersion: string;
  packetDigest: string;
}): string {
  const value = z
    .object({
      targetKind: z.enum(["SYNTHETIC_LOCAL", "REAL_TARGET"]),
      allowedOrigin: z.url(),
      allowedPathPrefix: z.string().startsWith("/").max(300),
      operation: RunnerTargetOperationSchema,
      formVersion: z.string().min(1).max(100),
      adapterVersion: z.string().min(1).max(100),
      packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict()
    .parse(input);
  return `runner_${sha256(canonical(value)).slice(0, 24)}`;
}

export type RunnerTargetCapabilityIdentity = Parameters<
  typeof deterministicRunnerTargetCapabilityId
>[0];

export type RunnerTargetCapabilityLifecycle = Pick<
  RunnerTargetCapability,
  | "alias"
  | "approvalState"
  | "approvalReference"
  | "approvedAt"
  | "policyVersion"
  | "policyExpiresAt"
  | "capabilityExpiresAt"
  | "revokedAt"
>;

export function runnerTargetCapabilityIdentity(
  input: RunnerTargetCapability,
  packetDigest: string,
): RunnerTargetCapabilityIdentity {
  const capability = RunnerTargetCapabilitySchema.parse(input);
  if (capability.allowedOperations.length !== 1) {
    throw new Error("TARGET_CAPABILITY_SINGLE_OPERATION_IDENTITY_REQUIRED");
  }
  return {
    targetKind: capability.targetKind,
    allowedOrigin: capability.allowedOrigin,
    allowedPathPrefix: capability.allowedPathPrefix,
    operation: capability.allowedOperations[0],
    formVersion: capability.formVersion,
    adapterVersion: capability.adapterVersion,
    packetDigest,
  };
}

export function assertRunnerTargetCapabilityIdentity(
  input: RunnerTargetCapability,
  identity: RunnerTargetCapabilityIdentity,
): RunnerTargetCapability {
  const capability = RunnerTargetCapabilitySchema.parse(input);
  const expectedId = deterministicRunnerTargetCapabilityId(identity);
  if (
    capability.capabilityId !== expectedId ||
    capability.targetKind !== identity.targetKind ||
    capability.allowedOrigin !== identity.allowedOrigin ||
    capability.allowedPathPrefix !== identity.allowedPathPrefix ||
    capability.formVersion !== identity.formVersion ||
    capability.adapterVersion !== identity.adapterVersion ||
    capability.allowedOperations.length !== 1 ||
    capability.allowedOperations[0] !== identity.operation
  ) {
    throw new Error("TARGET_CAPABILITY_IDENTITY_MISMATCH");
  }
  return capability;
}

export function deriveNextRunnerTargetCapability(input: {
  previous: RunnerTargetCapability | null;
  identity: RunnerTargetCapabilityIdentity;
  lifecycle: RunnerTargetCapabilityLifecycle;
}): RunnerTargetCapability {
  const expectedId = deterministicRunnerTargetCapabilityId(input.identity);
  const previous = input.previous ? RunnerTargetCapabilitySchema.parse(input.previous) : null;
  const sameFamily = previous?.capabilityId === expectedId;
  if (sameFamily && previous) {
    assertRunnerTargetCapabilityIdentity(previous, input.identity);
  }
  const capability = RunnerTargetCapabilitySchema.parse({
    schemaVersion: 2,
    capabilityId: expectedId,
    version: sameFamily ? previous.version + 1 : 1,
    predecessorVersion: sameFamily ? previous.version : null,
    targetKind: input.identity.targetKind,
    alias: input.lifecycle.alias,
    allowedOrigin: input.identity.allowedOrigin,
    allowedPathPrefix: input.identity.allowedPathPrefix,
    formVersion: input.identity.formVersion,
    adapterVersion: input.identity.adapterVersion,
    allowedOperations: [input.identity.operation],
    approvalState: input.lifecycle.approvalState,
    approvalReference: input.lifecycle.approvalReference,
    approvedAt: input.lifecycle.approvedAt,
    policyVersion: input.lifecycle.policyVersion,
    policyExpiresAt: input.lifecycle.policyExpiresAt,
    capabilityExpiresAt: input.lifecycle.capabilityExpiresAt,
    revokedAt: input.lifecycle.revokedAt,
  });
  return assertRunnerTargetCapabilityIdentity(capability, input.identity);
}

export function runnerTargetReadiness(input: RunnerTargetCapability, now = new Date()) {
  const capability = RunnerTargetCapabilitySchema.parse(input);
  if (capability.approvalState !== "APPROVED") {
    return { status: "TARGET_DISABLED" as const, reason: capability.approvalState };
  }
  if (Date.parse(capability.policyExpiresAt) <= now.getTime()) {
    return { status: "TARGET_DISABLED" as const, reason: "POLICY_EXPIRED" as const };
  }
  if (Date.parse(capability.capabilityExpiresAt) <= now.getTime()) {
    return { status: "TARGET_DISABLED" as const, reason: "CAPABILITY_EXPIRED" as const };
  }
  return { status: "TARGET_ENABLED" as const };
}

export const FrozenRunnerBindingSchema = z
  .object({
    packetId: z.string().min(1),
    packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    jobVersionId: z.string().min(1),
    profileVersionId: z.string().min(1),
    evaluationVersionId: z.string().min(1),
    targetCapabilityId: z.string().min(1),
    targetCapabilityVersion: z.number().int().positive(),
    targetCapabilityDigest: z.string().regex(/^[a-f0-9]{64}$/),
    targetUrl: z.url(),
    targetOrigin: z.url(),
    targetPath: z.string().startsWith("/"),
    formVersion: z.string().min(1),
    adapterVersion: z.string().min(1),
    documentsDigest: z.string().regex(/^[a-f0-9]{64}$/),
    answersDigest: z.string().regex(/^[a-f0-9]{64}$/),
    disclosuresDigest: z.string().regex(/^[a-f0-9]{64}$/),
    unresolvedCount: z.number().int().nonnegative(),
  })
  .strict();

export type FrozenRunnerBinding = z.infer<typeof FrozenRunnerBindingSchema>;

export function runnerBindingDigest(input: FrozenRunnerBinding): string {
  return sha256(canonical(FrozenRunnerBindingSchema.parse(input)));
}

export const RunnerAuditMetadataSchemas = {
  "runner.target.versioned": z
    .object({
      capabilityId: z.string().min(1),
      version: z.number().int().positive(),
      state: z.enum(["DRAFT", "APPROVED", "REVOKED", "EXPIRED", "SUPERSEDED"]),
      targetKind: z.enum(["SYNTHETIC_LOCAL", "REAL_TARGET"]),
      operations: z.array(RunnerTargetOperationSchema).min(1).max(5),
    })
    .strict(),
  "runner.target.revoked": z
    .object({
      capabilityId: z.string().min(1),
      version: z.number().int().positive(),
      targetKind: z.enum(["SYNTHETIC_LOCAL", "REAL_TARGET"]),
    })
    .strict(),
  "runner.run.bound": z
    .object({
      runId: z.string().min(1),
      packetId: z.string().min(1),
      capabilityId: z.string().min(1),
      capabilityVersion: z.number().int().positive(),
      unresolvedCount: z.number().int().nonnegative(),
    })
    .strict(),
  "runner.recovery.recorded": z
    .object({
      runId: z.string().min(1),
      decision: z.enum([
        "PAUSE",
        "RESUME_REFUSED",
        "RESUME_APPROVED",
        "OWNER_CANCELLED",
        "OUTCOME_UNKNOWN",
        "TERMINAL",
      ]),
      reasonCode: z.string().regex(/^[A-Z0-9_]{3,100}$/),
    })
    .strict(),
  "runner.consent.issued": z
    .object({
      runId: z.string().min(1),
      consentId: z.string().min(1),
      expiresAt: z.iso.datetime(),
    })
    .strict(),
  "runner.consent.consumed": z
    .object({ runId: z.string().min(1), consentId: z.string().min(1) })
    .strict(),
  "runner.inspection.bound": z
    .object({
      runId: z.string().min(1),
      packetId: z.string().min(1),
      capabilityId: z.string().min(1),
      capabilityVersion: z.number().int().positive(),
      operation: z.literal("OPEN_AND_INSPECT_ONLY"),
      unresolvedCount: z.number().int().nonnegative(),
    })
    .strict(),
  "runner.inspection.opened": z
    .object({
      runId: z.string().min(1),
      operation: z.literal("OPEN_AND_INSPECT_ONLY"),
      adapterVersion: z.string().min(1).max(100),
      formVersion: z.string().min(1).max(100),
    })
    .strict(),
  "runner.inspection.completed": z
    .object({
      runId: z.string().min(1),
      operation: z.literal("OPEN_AND_INSPECT_ONLY"),
      visibleSectionCount: z.number().int().min(0).max(100),
      fieldCount: z.number().int().min(0).max(200),
      reviewRequiredCount: z.number().int().min(0).max(200),
      documentRequiredCount: z.number().int().min(0).max(200),
      unsupportedCount: z.number().int().min(0).max(200),
    })
    .strict(),
  "runner.inspection.stopped": z
    .object({
      runId: z.string().min(1),
      operation: z.literal("OPEN_AND_INSPECT_ONLY"),
      reason: z.enum([
        "CAPTCHA",
        "MFA",
        "AUTHENTICATION_REQUIRED",
        "BOT_DETECTION",
        "RATE_LIMIT",
        "ACCESS_CONTROL",
        "WEBSITE_RESTRICTION",
        "PAGE_CHANGED",
        "FORM_CHANGED",
        "DESTINATION_CHANGED",
        "UNSUPPORTED_CONTROL",
        "TARGET_APPROVAL_REQUIRED",
      ]),
      diagnosticCategory: InspectionDiagnosticCategorySchema.nullable(),
      diagnosticStage: DomInspectionDiagnosticStageSchema.nullable(),
      destinationDiagnostic: DestinationChangeDiagnosticSchema.nullable(),
      unsupportedControlDiagnostic: UnsupportedControlDiagnosticSchema.nullable(),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        (value.reason === "DESTINATION_CHANGED" && value.destinationDiagnostic === null) ||
        (value.reason !== "DESTINATION_CHANGED" && value.destinationDiagnostic !== null)
      ) {
        context.addIssue({
          code: "custom",
          path: ["destinationDiagnostic"],
          message: "DESTINATION_DIAGNOSTIC_STOP_MISMATCH",
        });
      }
      if (
        (value.reason === "UNSUPPORTED_CONTROL" && value.unsupportedControlDiagnostic === null) ||
        (value.reason !== "UNSUPPORTED_CONTROL" && value.unsupportedControlDiagnostic !== null)
      ) {
        context.addIssue({
          code: "custom",
          path: ["unsupportedControlDiagnostic"],
          message: "UNSUPPORTED_DIAGNOSTIC_STOP_MISMATCH",
        });
      }
    }),
} as const;

export type RunnerAuditEventType = keyof typeof RunnerAuditMetadataSchemas;

export function validateRunnerAuditMetadata(type: RunnerAuditEventType, input: unknown): object {
  return RunnerAuditMetadataSchemas[type].parse(input) as object;
}

export function freezeRunnerBinding(
  packetInput: ApplicationPacket,
  capabilityInput: RunnerTargetCapability,
): FrozenRunnerBinding {
  const packet = ApplicationPacketSchema.parse(packetInput);
  const capability = RunnerTargetCapabilitySchema.parse(capabilityInput);
  if (
    !targetCapabilitySupportsApplication(capability) &&
    !targetCapabilitySupportsNonSubmit(capability)
  ) {
    throw new Error("TARGET_OPERATION_SCOPE_INVALID");
  }
  if (!packet.targetUrl) throw new Error("APPLICATION_DESTINATION_INVALID");
  const target = new URL(packet.targetUrl);
  const origin = new URL(capability.allowedOrigin);
  const prefix = capability.allowedPathPrefix;
  const pathAllowed = prefix.endsWith("/")
    ? target.pathname.startsWith(prefix)
    : target.pathname === prefix || target.pathname.startsWith(`${prefix}/`);
  if (target.hash || target.origin !== origin.origin || !pathAllowed) {
    throw new Error("TARGET_CAPABILITY_MISMATCH");
  }
  const readiness = assessPacketReadiness(packet, { allowUnknownProviderExpiry: true });
  const unresolvedCount = readiness.blockers.length;
  return FrozenRunnerBindingSchema.parse({
    packetId: packet.id,
    packetDigest: packetDigest(packet),
    jobVersionId: packet.jobVersionId,
    profileVersionId: packet.profileVersionId,
    evaluationVersionId: packet.evaluationVersionId,
    targetCapabilityId: capability.capabilityId,
    targetCapabilityVersion: capability.version,
    targetCapabilityDigest: runnerTargetCapabilityDigest(capability),
    targetUrl: packet.targetUrl,
    targetOrigin: origin.origin,
    targetPath: `${target.pathname}${target.search}`,
    formVersion: capability.formVersion,
    adapterVersion: capability.adapterVersion,
    documentsDigest: sha256(canonical(packet.documents.map(({ id, digest }) => ({ id, digest })))),
    answersDigest: sha256(
      canonical(
        packet.answers.map(({ questionId, value, truthState }) => ({
          questionId,
          value,
          truthState,
        })),
      ),
    ),
    disclosuresDigest: sha256(
      canonical(
        packet.answers.map(({ questionId, disclosureState }) => ({ questionId, disclosureState })),
      ),
    ),
    unresolvedCount,
  });
}

export const RunnerProtectionSignalSchema = z.enum([
  "CAPTCHA",
  "MFA",
  "AUTHENTICATION_REQUIRED",
  "BOT_DETECTION",
  "RATE_LIMIT",
  "ACCESS_CONTROL",
  "WEBSITE_RESTRICTION",
  "PAGE_CHANGED",
  "FORM_CHANGED",
  "DESTINATION_CHANGED",
  "UNSUPPORTED_CONTROL",
]);

export const TargetObservationSchema = z
  .object({
    targetUrl: z.url(),
    formVersion: z.string().min(1).max(100),
    adapterVersion: z.string().min(1).max(100),
    documentDigests: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20),
    protectionSignals: z.array(RunnerProtectionSignalSchema).max(1),
    fieldReadBack: z
      .array(
        z.object({
          questionId: z.string().min(1),
          value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
        }),
      )
      .max(100)
      .default([]),
    uploadEvidence: z
      .object({
        documentId: z.string().min(1),
        expectedDigest: z.string().regex(/^[a-f0-9]{64}$/),
        receivedDigest: z.string().regex(/^[a-f0-9]{64}$/),
        acknowledgementId: z.string().min(1),
      })
      .nullable()
      .default(null),
    previewDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
  })
  .strict();

export type TargetObservation = z.infer<typeof TargetObservationSchema>;

export interface ApplicationTargetAdapter {
  readonly targetKind: "SYNTHETIC_LOCAL" | "REAL_TARGET";
  open(binding: FrozenRunnerBinding): Promise<TargetObservation>;
  map(packet: ApplicationPacket, binding: FrozenRunnerBinding): Promise<TargetObservation>;
  fill(packet: ApplicationPacket, binding: FrozenRunnerBinding): Promise<TargetObservation>;
  submit(binding: FrozenRunnerBinding): Promise<"CONFIRMED" | "OUTCOME_UNKNOWN">;
}

export interface FinalConsentStore {
  issue(binding: FrozenRunnerBinding, ttlMs: number): FinalActionConsent;
  consume(input: { id: string; token: string; binding: FrozenRunnerBinding; now: Date }): boolean;
}

export class InMemoryFinalConsentStore implements FinalConsentStore {
  private readonly items = new Map<string, FinalActionConsent>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  issue(binding: FrozenRunnerBinding, ttlMs: number): FinalActionConsent {
    const token = randomBytes(32).toString("base64url");
    const consent: FinalActionConsent = {
      id: randomBytes(12).toString("hex"),
      token,
      tokenHash: sha256(token),
      packetDigest: binding.packetDigest,
      targetHost: new URL(binding.targetOrigin).hostname,
      formVersion: binding.formVersion,
      bindingDigest: runnerBindingDigest(binding),
      expiresAt: new Date(this.now().getTime() + ttlMs).toISOString(),
      usedAt: null,
    };
    this.items.set(consent.id, consent);
    return { ...consent };
  }

  consume(input: { id: string; token: string; binding: FrozenRunnerBinding; now: Date }): boolean {
    const stored = this.items.get(input.id);
    if (!stored || stored.usedAt || Date.parse(stored.expiresAt) <= input.now.getTime())
      return false;
    const supplied = Buffer.from(sha256(input.token), "hex");
    const expected = Buffer.from(stored.tokenHash, "hex");
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected) ||
      stored.packetDigest !== input.binding.packetDigest ||
      stored.targetHost !== new URL(input.binding.targetOrigin).hostname ||
      stored.formVersion !== input.binding.formVersion ||
      stored.bindingDigest !== runnerBindingDigest(input.binding)
    )
      return false;
    stored.usedAt = input.now.toISOString();
    return true;
  }
}

export class TargetIndependentApplicationRunner {
  private state: z.infer<typeof ApplicationRunStateSchema> = "PREPARED";
  private sequence = 0;
  private readonly checkpoints: RunnerCheckpoint[] = [];
  private finalAttempts = 0;

  constructor(
    private readonly packet: ApplicationPacket,
    private readonly capability: RunnerTargetCapability,
    private readonly binding: FrozenRunnerBinding,
    private readonly adapter: ApplicationTargetAdapter,
    private readonly consentStore: FinalConsentStore,
    private readonly currentBinding: () => FrozenRunnerBinding,
    private readonly now: () => Date = () => new Date(),
  ) {
    ApplicationPacketSchema.parse(packet);
    RunnerTargetCapabilitySchema.parse(capability);
    FrozenRunnerBindingSchema.parse(binding);
    if (adapter.targetKind !== capability.targetKind) throw new Error("TARGET_ADAPTER_MISMATCH");
    if (
      runnerTargetReadiness(capability, now()).status !== "TARGET_ENABLED" ||
      !targetCapabilitySupportsApplication(capability)
    ) {
      this.pause("TARGET_APPROVAL_REQUIRED");
    } else if (binding.unresolvedCount > 0) {
      this.pause("PACKET_NOT_READY");
    } else {
      this.record("PREPARED", null);
    }
  }

  async open(): Promise<RunnerCheckpoint> {
    this.assertState("PREPARED");
    if (!this.bindingsCurrent()) return this.pause("PAGE_CHANGED");
    try {
      return this.acceptObservation(
        TargetObservationSchema.parse(await this.adapter.open(this.binding)),
        "OPENED",
      );
    } catch {
      return this.pause("PAGE_CHANGED");
    }
  }

  async map(): Promise<RunnerCheckpoint> {
    this.assertState("OPENED");
    if (!this.bindingsCurrent()) return this.pause("PAGE_CHANGED");
    const unknown = this.packet.answers.some(
      ({ required, truthState }) => required && truthState === "UNKNOWN",
    );
    if (unknown) return this.pause("UNKNOWN_REQUIRED_ANSWER");
    const disclosure = this.packet.answers.some(
      ({ required, disclosureState }) => required && disclosureState !== "APPROVED",
    );
    if (disclosure) return this.pause("SENSITIVE_DISCLOSURE_REQUIRED");
    try {
      return this.acceptObservation(
        TargetObservationSchema.parse(await this.adapter.map(this.packet, this.binding)),
        "MAPPED",
      );
    } catch {
      return this.pause("PAGE_CHANGED");
    }
  }

  async fill(): Promise<RunnerCheckpoint> {
    this.assertState("MAPPED");
    if (!this.bindingsCurrent()) return this.pause("PAGE_CHANGED");
    try {
      return this.acceptObservation(
        TargetObservationSchema.parse(await this.adapter.fill(this.packet, this.binding)),
        "FILLED",
      );
    } catch {
      return this.pause("PAGE_CHANGED");
    }
  }

  readyForFinalReview(): RunnerCheckpoint {
    this.assertState("FILLED");
    if (!this.bindingsCurrent() || assessPacketReadiness(this.packet).blockers.length) {
      return this.pause("PACKET_NOT_READY");
    }
    return this.advance("READY_FOR_FINAL_REVIEW");
  }

  createConsent(ttlMs = 5 * 60 * 1000): FinalActionConsent {
    this.assertState("READY_FOR_FINAL_REVIEW");
    if (!this.bindingsCurrent()) throw new Error("STALE_RUN_BINDING");
    return this.consentStore.issue(this.binding, ttlMs);
  }

  async submit(input: {
    consentId: string;
    token: string;
    ownerConfirmed: true;
  }): Promise<RunnerCheckpoint> {
    this.assertState("READY_FOR_FINAL_REVIEW");
    if (!input.ownerConfirmed) return this.pause("CONSENT_EXPIRED");
    if (!this.bindingsCurrent()) return this.pause("PAGE_CHANGED");
    if (
      !this.consentStore.consume({
        id: input.consentId,
        token: input.token,
        binding: this.binding,
        now: this.now(),
      })
    ) {
      return this.pause("CONSENT_REPLAYED");
    }
    this.finalAttempts += 1;
    try {
      const outcome = await this.adapter.submit(this.binding);
      return this.advance(
        outcome === "CONFIRMED"
          ? this.capability.targetKind === "SYNTHETIC_LOCAL"
            ? "SYNTHETIC_SUBMITTED"
            : "SUBMITTED"
          : "OUTCOME_UNKNOWN",
      );
    } catch {
      return this.advance("OUTCOME_UNKNOWN");
    }
  }

  snapshot() {
    return {
      state: this.state,
      checkpoints: this.checkpoints.map((item) => ({ ...item })),
      finalAttempts: this.finalAttempts,
    };
  }

  private bindingsCurrent(): boolean {
    try {
      if (runnerTargetReadiness(this.capability, this.now()).status !== "TARGET_ENABLED") {
        return false;
      }
      const current = FrozenRunnerBindingSchema.safeParse(this.currentBinding());
      return current.success && canonical(current.data) === canonical(this.binding);
    } catch {
      return false;
    }
  }

  private acceptObservation(
    observation: TargetObservation,
    state: "OPENED" | "MAPPED" | "FILLED",
  ): RunnerCheckpoint {
    const signal = observation.protectionSignals[0];
    if (signal) return this.pause(SyntheticStopReasonSchema.parse(signal));
    if (observation.targetUrl !== this.binding.targetUrl) return this.pause("DESTINATION_CHANGED");
    if (
      observation.formVersion !== this.binding.formVersion ||
      observation.adapterVersion !== this.binding.adapterVersion
    ) {
      return this.pause("FORM_CHANGED");
    }
    if (state === "FILLED") {
      const expected = this.packet.documents.map(({ digest }) => digest).sort();
      if (canonical([...observation.documentDigests].sort()) !== canonical(expected)) {
        return this.pause("DOCUMENT_DIGEST_CHANGED");
      }
    }
    return this.advance(state);
  }

  private assertState(expected: z.infer<typeof ApplicationRunStateSchema>): void {
    if (
      this.state === "SYNTHETIC_SUBMITTED" ||
      this.state === "SUBMITTED" ||
      this.state === "OUTCOME_UNKNOWN"
    )
      throw new Error("RUN_TERMINAL");
    if (this.state !== expected) throw new Error(`RUN_STATE_REQUIRED:${expected}`);
  }

  private advance(state: z.infer<typeof ApplicationRunStateSchema>): RunnerCheckpoint {
    this.state = state;
    return this.record(state, null);
  }

  private pause(reason: SyntheticStopReason): RunnerCheckpoint {
    this.state = "PAUSED";
    return this.record("PAUSED", reason);
  }

  private record(
    state: z.infer<typeof ApplicationRunStateSchema>,
    stopReason: SyntheticStopReason | null,
  ): RunnerCheckpoint {
    const checkpoint = {
      sequence: this.sequence++,
      state,
      stopReason,
      occurredAt: this.now().toISOString(),
    };
    this.checkpoints.push(checkpoint);
    return checkpoint;
  }
}

export const NonSubmitRunnerStateSchema = z.enum([
  "PREPARED",
  "OPENED",
  "MAPPED",
  "FILLED",
  "UPLOADED",
  "VERIFIED",
  "FILL_PREVIEW",
  "PAUSED",
]);
export type NonSubmitRunnerState = z.infer<typeof NonSubmitRunnerStateSchema>;

export interface NonSubmitTargetAdapter {
  readonly targetKind: "SYNTHETIC_LOCAL";
  map(packet: ApplicationPacket, binding: FrozenRunnerBinding): Promise<TargetObservation>;
  fill(packet: ApplicationPacket, binding: FrozenRunnerBinding): Promise<TargetObservation>;
  upload(packet: ApplicationPacket, binding: FrozenRunnerBinding): Promise<TargetObservation>;
  verify(packet: ApplicationPacket, binding: FrozenRunnerBinding): Promise<TargetObservation>;
  fillPreview(packet: ApplicationPacket, binding: FrozenRunnerBinding): Promise<TargetObservation>;
}

export interface NonSubmitDurableSnapshot {
  state: NonSubmitRunnerState;
  sequence: number;
  checkpoints: NonSubmitRunnerCheckpoint[];
  claimedOperations: string[];
  activeOperation?: RunnerTargetOperation | null;
}

export interface NonSubmitDurableStore {
  load(bindingDigest: string): NonSubmitDurableSnapshot | null;
  claim(bindingDigest: string, operation: RunnerTargetOperation): boolean;
  save(bindingDigest: string, snapshot: NonSubmitDurableSnapshot): void;
}

export class InMemoryNonSubmitDurableStore implements NonSubmitDurableStore {
  private readonly snapshots = new Map<string, NonSubmitDurableSnapshot>();

  load(bindingDigest: string): NonSubmitDurableSnapshot | null {
    const value = this.snapshots.get(bindingDigest);
    return value ? structuredClone(value) : null;
  }

  claim(bindingDigest: string, operation: RunnerTargetOperation): boolean {
    const snapshot = this.snapshots.get(bindingDigest) ?? {
      state: "PREPARED",
      sequence: 0,
      checkpoints: [],
      claimedOperations: [],
      activeOperation: null,
    };
    if (snapshot.claimedOperations.includes(operation) || snapshot.activeOperation) return false;
    snapshot.activeOperation = operation;
    snapshot.claimedOperations.push(operation);
    this.snapshots.set(bindingDigest, snapshot);
    return true;
  }

  save(bindingDigest: string, snapshot: NonSubmitDurableSnapshot): void {
    this.snapshots.set(bindingDigest, structuredClone({ ...snapshot, activeOperation: null }));
  }
}

export interface NonSubmitRunnerCheckpoint {
  sequence: number;
  state: NonSubmitRunnerState;
  stopReason: SyntheticStopReason | null;
  occurredAt: string;
  targetUrl: string;
  formVersion: string;
  adapterVersion: string;
  fieldReadBack: ReadonlyArray<{ questionId: string; value: string | number | boolean | null }>;
  uploadEvidence: TargetObservation["uploadEvidence"];
  previewDigest: string | null;
}

export class TargetIndependentNonSubmitRunner {
  private state: NonSubmitRunnerState = "PREPARED";
  private sequence = 0;
  private readonly checkpoints: NonSubmitRunnerCheckpoint[] = [];
  private readonly claimedOperations: string[] = [];
  private readonly bindingDigest: string;

  constructor(
    private readonly packet: ApplicationPacket,
    private readonly capability: RunnerTargetCapability,
    private readonly binding: FrozenRunnerBinding,
    private readonly adapter: NonSubmitTargetAdapter,
    private readonly currentBinding: () => FrozenRunnerBinding,
    private readonly now: () => Date = () => new Date(),
    private readonly durableStore?: NonSubmitDurableStore,
  ) {
    ApplicationPacketSchema.parse(packet);
    RunnerTargetCapabilitySchema.parse(capability);
    FrozenRunnerBindingSchema.parse(binding);
    this.bindingDigest = runnerBindingDigest(binding);
    const recovered = this.durableStore?.load(this.bindingDigest);
    if (recovered) {
      this.state = recovered.state;
      this.sequence = recovered.sequence;
      this.checkpoints.push(...recovered.checkpoints);
      this.claimedOperations.push(...recovered.claimedOperations);
      return;
    }
    if (
      adapter.targetKind !== capability.targetKind ||
      !targetCapabilitySupportsNonSubmit(capability) ||
      runnerTargetReadiness(capability, now()).status !== "TARGET_ENABLED"
    ) {
      this.pause("TARGET_APPROVAL_REQUIRED");
    } else if (
      binding.unresolvedCount > 0 ||
      assessPacketReadiness(packet, { allowUnknownProviderExpiry: true }).blockers.length > 0
    ) {
      this.pause("PACKET_NOT_READY");
    } else {
      this.record("PREPARED", null);
    }
  }

  async map(): Promise<NonSubmitRunnerCheckpoint> {
    this.assertState("PREPARED");
    return this.observe("MAPPED", "MAP_FOR_FILL", () =>
      this.adapter.map(this.packet, this.binding),
    );
  }

  async fill(): Promise<NonSubmitRunnerCheckpoint> {
    this.assertState("MAPPED");
    return this.observe("FILLED", "FILL", () => this.adapter.fill(this.packet, this.binding));
  }

  async upload(): Promise<NonSubmitRunnerCheckpoint> {
    this.assertState("FILLED");
    return this.observe("UPLOADED", "UPLOAD", () => this.adapter.upload(this.packet, this.binding));
  }

  async verify(): Promise<NonSubmitRunnerCheckpoint> {
    this.assertState("UPLOADED");
    return this.observe("VERIFIED", "VERIFY", () => this.adapter.verify(this.packet, this.binding));
  }

  async fillPreview(): Promise<NonSubmitRunnerCheckpoint> {
    this.assertState("VERIFIED");
    return this.observe("FILL_PREVIEW", "FILL_PREVIEW", () =>
      this.adapter.fillPreview(this.packet, this.binding),
    );
  }

  snapshot() {
    return {
      state: this.state,
      checkpoints: this.checkpoints.map((checkpoint) => ({ ...checkpoint })),
      claimedOperations: [...this.claimedOperations],
      submitEnabled: false as const,
    };
  }

  private async observe(
    state: Exclude<NonSubmitRunnerState, "PREPARED" | "OPENED" | "PAUSED">,
    operationName: RunnerTargetOperation,
    operation: () => Promise<TargetObservation>,
  ): Promise<NonSubmitRunnerCheckpoint> {
    if (!this.bindingsCurrent()) return this.pause("PAGE_CHANGED");
    if (this.claimedOperations.includes(operationName)) {
      return this.pause("OPERATION_REPLAYED");
    }
    if (this.durableStore && !this.durableStore.claim(this.bindingDigest, operationName)) {
      return this.record(
        "PAUSED",
        operationName === "UPLOAD" ? "UPLOAD_OUTCOME_UNKNOWN" : "OPERATION_IN_PROGRESS",
        undefined,
        false,
      );
    }
    this.claimedOperations.push(operationName);
    try {
      const observation = TargetObservationSchema.parse(await operation());
      const signal = observation.protectionSignals[0];
      if (signal) return this.pause(SyntheticStopReasonSchema.parse(signal));
      if (observation.targetUrl !== this.binding.targetUrl)
        return this.pause("DESTINATION_CHANGED");
      if (
        observation.formVersion !== this.binding.formVersion ||
        observation.adapterVersion !== this.binding.adapterVersion
      ) {
        return this.pause("FORM_CHANGED");
      }
      if (state === "UPLOADED") {
        const expected = this.packet.documents.map(({ digest }) => digest).sort();
        if (canonical([...observation.documentDigests].sort()) !== canonical(expected)) {
          return this.pause("DOCUMENT_DIGEST_CHANGED");
        }
      }
      return this.record(state, null, observation);
    } catch {
      return this.pause(operationName === "UPLOAD" ? "UPLOAD_OUTCOME_UNKNOWN" : "PAGE_CHANGED");
    }
  }

  private bindingsCurrent(): boolean {
    try {
      return (
        runnerTargetReadiness(this.capability, this.now()).status === "TARGET_ENABLED" &&
        canonical(FrozenRunnerBindingSchema.parse(this.currentBinding())) ===
          canonical(this.binding)
      );
    } catch {
      return false;
    }
  }

  private assertState(expected: NonSubmitRunnerState): void {
    if (this.state === "PAUSED") throw new Error("RUN_PAUSED");
    if (this.state !== expected) throw new Error(`RUN_STATE_REQUIRED:${expected}`);
  }

  private pause(reason: SyntheticStopReason): NonSubmitRunnerCheckpoint {
    this.state = "PAUSED";
    return this.record("PAUSED", reason);
  }

  private record(
    state: NonSubmitRunnerState,
    stopReason: SyntheticStopReason | null,
    observation?: TargetObservation,
    persist = true,
  ) {
    this.state = state;
    const checkpoint: NonSubmitRunnerCheckpoint = {
      sequence: ++this.sequence,
      state,
      stopReason,
      occurredAt: this.now().toISOString(),
      targetUrl: this.binding.targetUrl,
      formVersion: this.binding.formVersion,
      adapterVersion: this.binding.adapterVersion,
      fieldReadBack: observation?.fieldReadBack ?? [],
      uploadEvidence: observation?.uploadEvidence ?? null,
      previewDigest: observation?.previewDigest ?? null,
    };
    this.checkpoints.push(checkpoint);
    if (persist) {
      this.durableStore?.save(this.bindingDigest, {
        state: this.state,
        sequence: this.sequence,
        checkpoints: this.checkpoints,
        claimedOperations: this.claimedOperations,
      });
    }
    return checkpoint;
  }
}
