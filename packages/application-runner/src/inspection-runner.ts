import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ApplicationPacketSchema,
  assessPacketReadiness,
  packetDigest,
  type ApplicationPacket,
} from "./beta";
import {
  DomInspectionDiagnosticStageSchema,
  DestinationChangeDiagnosticSchema,
  InspectionDiagnosticCategorySchema,
  RunnerProtectionSignalSchema,
  RunnerTargetCapabilitySchema,
  UnsupportedControlDiagnosticSchema,
  assertRunnerTargetCapabilityIdentity,
  runnerTargetCapabilityIdentity,
  runnerTargetCapabilityDigest,
  runnerTargetReadiness,
  type DomInspectionDiagnosticStage,
  type DestinationChangeDiagnostic,
  type InspectionDiagnosticCategory,
  type RunnerTargetCapability,
  type UnsupportedControlDiagnostic,
} from "./target-runner";

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

const sha256 = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

export function inspectionDocumentsDigest(
  documents: readonly { id: string; digest: string }[],
): string {
  return sha256(documents.map(({ id, digest }) => ({ id, digest })));
}

export function inspectionAnswersDigest(
  answers: readonly {
    questionId: string;
    value: string | number | boolean | null;
    truthState: string;
  }[],
): string {
  return sha256(
    answers.map(({ questionId, value, truthState }) => ({ questionId, value, truthState })),
  );
}

export function inspectionDisclosuresDigest(
  answers: readonly { questionId: string; disclosureState: string }[],
): string {
  return sha256(
    answers.map(({ questionId, disclosureState }) => ({ questionId, disclosureState })),
  );
}

export const InspectionFieldSemanticSchema = z.enum([
  "FIRST_NAME",
  "LAST_NAME",
  "EMAIL",
  "PHONE",
  "RESUME_UPLOAD",
  "COVER_LETTER_UPLOAD",
  "WORK_AUTHORIZATION",
  "SPONSORSHIP_REQUIRED",
  "CITIZENSHIP",
  "EXPORT_CONTROL",
  "SECURITY_CLEARANCE",
  "LOCATION",
  "RELOCATION",
  "EDUCATION",
  "YEARS_EXPERIENCE",
  "FREE_TEXT",
  "CONSENT",
  "FINAL_SUBMIT",
  "UNKNOWN_FIELD",
]);

export const InspectionControlTypeSchema = z.enum([
  "TEXT",
  "EMAIL",
  "TEL",
  "FILE",
  "SELECT",
  "CHECKBOX",
  "RADIO",
  "TEXTAREA",
  "SUBMIT",
  "HIDDEN",
  "CUSTOM",
]);

export const InspectionFieldClassificationSchema = z.enum([
  "SUPPORTED",
  "REVIEW_REQUIRED",
  "DOCUMENT_REQUIRED",
  "AUTH_REQUIRED",
  "UNSUPPORTED",
  "NOT_APPLICABLE",
]);

export const InspectionFieldSchema = z
  .object({
    semanticType: InspectionFieldSemanticSchema,
    controlType: InspectionControlTypeSchema,
    required: z.boolean().nullable(),
    locatorId: z.string().regex(/^lever-field-[a-f0-9]{16}$/),
    inspectionStatus: InspectionFieldClassificationSchema,
    minimumEligibilityLabel: z.string().min(1).max(200).nullable(),
  })
  .strict();

export type InspectionField = z.infer<typeof InspectionFieldSchema>;

export const ZeroMutationMetricsSchema = z
  .object({
    browserWriteEvents: z.literal(0),
    formValueChanges: z.literal(0),
    uploads: z.literal(0),
    submissions: z.literal(0),
    candidateDataOutboundFields: z.literal(0),
  })
  .strict();

export const TargetInspectionObservationSchema = z
  .object({
    targetUrl: z.url(),
    formVersion: z.string().min(1).max(100),
    adapterVersion: z.string().min(1).max(100),
    visibleSectionCount: z.number().int().nonnegative().max(100),
    fields: z.array(InspectionFieldSchema).max(200),
    protectionSignals: z.array(RunnerProtectionSignalSchema).max(1),
    destinationDiagnostic: DestinationChangeDiagnosticSchema.nullable().default(null),
    unsupportedControlDiagnostic: UnsupportedControlDiagnosticSchema.nullable().default(null),
    metrics: ZeroMutationMetricsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.destinationDiagnostic !== null &&
      value.protectionSignals[0] !== "DESTINATION_CHANGED"
    ) {
      context.addIssue({
        code: "custom",
        path: ["destinationDiagnostic"],
        message: "DESTINATION_DIAGNOSTIC_WITHOUT_DESTINATION_STOP",
      });
    }
    if (
      (value.protectionSignals[0] === "UNSUPPORTED_CONTROL" &&
        value.unsupportedControlDiagnostic === null) ||
      (value.protectionSignals[0] !== "UNSUPPORTED_CONTROL" &&
        value.unsupportedControlDiagnostic !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["unsupportedControlDiagnostic"],
        message: "UNSUPPORTED_DIAGNOSTIC_WITHOUT_UNSUPPORTED_STOP",
      });
    }
  });

export type TargetInspectionObservation = z.infer<typeof TargetInspectionObservationSchema>;

export const FrozenInspectionBindingSchema = z
  .object({
    operation: z.literal("OPEN_AND_INSPECT_ONLY"),
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
    allowedPathPrefix: z.string().startsWith("/").max(300),
    formVersion: z.string().min(1).max(100),
    adapterVersion: z.string().min(1).max(100),
    documentsDigest: z.string().regex(/^[a-f0-9]{64}$/),
    answersDigest: z.string().regex(/^[a-f0-9]{64}$/),
    disclosuresDigest: z.string().regex(/^[a-f0-9]{64}$/),
    unresolvedCount: z.number().int().nonnegative(),
  })
  .strict();

export type FrozenInspectionBinding = z.infer<typeof FrozenInspectionBindingSchema>;

export class InspectionDiagnosticError extends Error {
  readonly category: InspectionDiagnosticCategory;
  readonly stage: DomInspectionDiagnosticStage | null;

  constructor(
    category: InspectionDiagnosticCategory,
    stage: DomInspectionDiagnosticStage | null = null,
  ) {
    super("INSPECTION_DIAGNOSTIC");
    this.name = "InspectionDiagnosticError";
    this.category = InspectionDiagnosticCategorySchema.parse(category);
    this.stage = stage === null ? null : DomInspectionDiagnosticStageSchema.parse(stage);
    if (this.category !== "DOM_INSPECTION_EXCEPTION" && this.stage !== null) {
      throw new Error("DOM_DIAGNOSTIC_STAGE_CATEGORY_MISMATCH");
    }
  }
}

function diagnosticDetails(error: unknown): {
  category: InspectionDiagnosticCategory;
  stage: DomInspectionDiagnosticStage | null;
} {
  return error instanceof InspectionDiagnosticError
    ? { category: error.category, stage: error.stage }
    : { category: "UNKNOWN_INSPECTION_EXCEPTION", stage: null };
}

function targetWithinCapability(target: URL, capability: RunnerTargetCapability): boolean {
  const origin = new URL(capability.allowedOrigin);
  const prefix = capability.allowedPathPrefix;
  const pathAllowed = prefix.endsWith("/")
    ? target.pathname.startsWith(prefix)
    : target.pathname === prefix || target.pathname.startsWith(`${prefix}/`);
  return (
    !target.username &&
    !target.password &&
    !target.hash &&
    target.origin === origin.origin &&
    pathAllowed
  );
}

export function freezeInspectionBinding(
  packetInput: ApplicationPacket,
  capabilityInput: RunnerTargetCapability,
): FrozenInspectionBinding {
  const packet = ApplicationPacketSchema.parse(packetInput);
  const capability = RunnerTargetCapabilitySchema.parse(capabilityInput);
  if (!packet.versionsCurrent) throw new Error("STALE_PACKET_VERSION");
  if (
    capability.allowedOperations.length !== 1 ||
    capability.allowedOperations[0] !== "OPEN_AND_INSPECT_ONLY"
  ) {
    throw new Error("INSPECTION_OPERATION_SCOPE_REQUIRED");
  }
  if (!packet.targetUrl) throw new Error("APPLICATION_DESTINATION_INVALID");
  const target = new URL(packet.targetUrl);
  if (!targetWithinCapability(target, capability)) throw new Error("TARGET_CAPABILITY_MISMATCH");
  assertRunnerTargetCapabilityIdentity(
    capability,
    runnerTargetCapabilityIdentity(capability, packetDigest(packet)),
  );
  return FrozenInspectionBindingSchema.parse({
    operation: "OPEN_AND_INSPECT_ONLY",
    packetId: packet.id,
    packetDigest: packetDigest(packet),
    jobVersionId: packet.jobVersionId,
    profileVersionId: packet.profileVersionId,
    evaluationVersionId: packet.evaluationVersionId,
    targetCapabilityId: capability.capabilityId,
    targetCapabilityVersion: capability.version,
    targetCapabilityDigest: runnerTargetCapabilityDigest(capability),
    targetUrl: packet.targetUrl,
    targetOrigin: new URL(capability.allowedOrigin).origin,
    targetPath: `${target.pathname}${target.search}`,
    allowedPathPrefix: capability.allowedPathPrefix,
    formVersion: capability.formVersion,
    adapterVersion: capability.adapterVersion,
    documentsDigest: inspectionDocumentsDigest(packet.documents),
    answersDigest: inspectionAnswersDigest(packet.answers),
    disclosuresDigest: inspectionDisclosuresDigest(packet.answers),
    unresolvedCount: assessPacketReadiness(packet).blockers.length,
  });
}

export interface TargetInspectionAdapter {
  readonly adapterVersion: string;
  readonly formVersion: string;
  inspect(binding: FrozenInspectionBinding): Promise<TargetInspectionObservation>;
}

export type InspectionAuditRecord =
  | {
      type: "runner.inspection.opened";
      metadata: {
        operation: "OPEN_AND_INSPECT_ONLY";
        adapterVersion: string;
        formVersion: string;
      };
    }
  | {
      type: "runner.inspection.completed";
      metadata: {
        operation: "OPEN_AND_INSPECT_ONLY";
        visibleSectionCount: number;
        fieldCount: number;
        reviewRequiredCount: number;
        documentRequiredCount: number;
        unsupportedCount: number;
      };
    }
  | {
      type: "runner.inspection.stopped";
      metadata: {
        operation: "OPEN_AND_INSPECT_ONLY";
        reason: z.infer<typeof RunnerProtectionSignalSchema> | "TARGET_APPROVAL_REQUIRED";
        diagnosticCategory: InspectionDiagnosticCategory | null;
        diagnosticStage: DomInspectionDiagnosticStage | null;
        destinationDiagnostic: DestinationChangeDiagnostic | null;
        unsupportedControlDiagnostic: UnsupportedControlDiagnostic | null;
      };
    };

export type InspectionAuditSink = (record: InspectionAuditRecord) => void;

export type InspectionRunResult =
  | { state: "COMPLETED"; observation: TargetInspectionObservation }
  | {
      state: "STOPPED";
      stopReason: z.infer<typeof RunnerProtectionSignalSchema> | "TARGET_APPROVAL_REQUIRED";
      diagnosticCategory: InspectionDiagnosticCategory | null;
      diagnosticStage: DomInspectionDiagnosticStage | null;
      destinationDiagnostic: DestinationChangeDiagnostic | null;
      unsupportedControlDiagnostic: UnsupportedControlDiagnostic | null;
      observation: null;
    };

type InspectionStopReason = Extract<InspectionRunResult, { state: "STOPPED" }>["stopReason"];

export class TargetInspectionRunner {
  private state: "BOUND" | "OPENED" | "COMPLETED" | "STOPPED" = "BOUND";
  private stopReason: InspectionStopReason | null = null;

  constructor(
    private readonly capability: RunnerTargetCapability,
    private readonly binding: FrozenInspectionBinding,
    private readonly adapter: TargetInspectionAdapter,
    private readonly currentBinding: () => FrozenInspectionBinding,
    private readonly audit: InspectionAuditSink = () => undefined,
    private readonly now: () => Date = () => new Date(),
  ) {
    RunnerTargetCapabilitySchema.parse(capability);
    FrozenInspectionBindingSchema.parse(binding);
    if (
      capability.allowedOperations.length !== 1 ||
      capability.allowedOperations[0] !== "OPEN_AND_INSPECT_ONLY" ||
      binding.operation !== "OPEN_AND_INSPECT_ONLY" ||
      binding.targetCapabilityDigest !== runnerTargetCapabilityDigest(capability) ||
      adapter.adapterVersion !== binding.adapterVersion ||
      adapter.formVersion !== binding.formVersion
    ) {
      throw new Error("INSPECTION_AUTHORITY_MISMATCH");
    }
  }

  async openAndInspect(): Promise<InspectionRunResult> {
    if (this.state !== "BOUND") throw new Error("INSPECTION_RUN_NOT_BOUND");
    if (
      runnerTargetReadiness(this.capability, this.now()).status !== "TARGET_ENABLED" ||
      !this.bindingCurrent()
    ) {
      return this.stop("TARGET_APPROVAL_REQUIRED");
    }
    this.state = "OPENED";
    this.audit({
      type: "runner.inspection.opened",
      metadata: {
        operation: "OPEN_AND_INSPECT_ONLY",
        adapterVersion: this.binding.adapterVersion,
        formVersion: this.binding.formVersion,
      },
    });
    let adapterOutput: TargetInspectionObservation;
    try {
      adapterOutput = await this.adapter.inspect(this.binding);
    } catch (error) {
      const diagnostic = diagnosticDetails(error);
      return this.stop("PAGE_CHANGED", diagnostic.category, diagnostic.stage);
    }
    const parsedObservation = TargetInspectionObservationSchema.safeParse(adapterOutput);
    if (!parsedObservation.success) return this.stop("PAGE_CHANGED", "ADAPTER_OUTPUT_INVALID");
    const observation = parsedObservation.data;
    const signal = observation.protectionSignals[0];
    if (signal) {
      return this.stop(
        signal,
        signal === "PAGE_CHANGED" ? "UNKNOWN_INSPECTION_EXCEPTION" : null,
        null,
        signal === "DESTINATION_CHANGED"
          ? (observation.destinationDiagnostic ?? "DESTINATION_STATE_UNKNOWN")
          : null,
        signal === "UNSUPPORTED_CONTROL"
          ? (observation.unsupportedControlDiagnostic ?? "UNSUPPORTED_UNKNOWN")
          : null,
      );
    }
    if (observation.targetUrl !== this.binding.targetUrl) {
      return this.stop("DESTINATION_CHANGED", null, null, "DESTINATION_STATE_UNKNOWN");
    }
    if (
      observation.formVersion !== this.binding.formVersion ||
      observation.adapterVersion !== this.binding.adapterVersion
    ) {
      return this.stop("FORM_CHANGED");
    }
    this.state = "COMPLETED";
    this.audit({
      type: "runner.inspection.completed",
      metadata: {
        operation: "OPEN_AND_INSPECT_ONLY",
        visibleSectionCount: observation.visibleSectionCount,
        fieldCount: observation.fields.length,
        reviewRequiredCount: observation.fields.filter(
          ({ inspectionStatus }) => inspectionStatus === "REVIEW_REQUIRED",
        ).length,
        documentRequiredCount: observation.fields.filter(
          ({ inspectionStatus }) => inspectionStatus === "DOCUMENT_REQUIRED",
        ).length,
        unsupportedCount: observation.fields.filter(
          ({ inspectionStatus }) => inspectionStatus === "UNSUPPORTED",
        ).length,
      },
    });
    return { state: "COMPLETED", observation };
  }

  snapshot() {
    return { state: this.state, stopReason: this.stopReason, operation: this.binding.operation };
  }

  private bindingCurrent(): boolean {
    try {
      const current = FrozenInspectionBindingSchema.parse(this.currentBinding());
      return canonical(current) === canonical(this.binding);
    } catch {
      return false;
    }
  }

  private stop(
    reason: InspectionStopReason,
    diagnosticCategory: InspectionDiagnosticCategory | null = null,
    diagnosticStage: DomInspectionDiagnosticStage | null = null,
    destinationDiagnostic: DestinationChangeDiagnostic | null = null,
    unsupportedControlDiagnostic: UnsupportedControlDiagnostic | null = null,
  ): InspectionRunResult {
    const safeDiagnosticCategory =
      reason === "PAGE_CHANGED" ? (diagnosticCategory ?? "UNKNOWN_INSPECTION_EXCEPTION") : null;
    const safeDiagnosticStage =
      safeDiagnosticCategory === "DOM_INSPECTION_EXCEPTION" ? diagnosticStage : null;
    const safeDestinationDiagnostic =
      reason === "DESTINATION_CHANGED" ? destinationDiagnostic : null;
    const safeUnsupportedControlDiagnostic =
      reason === "UNSUPPORTED_CONTROL"
        ? (unsupportedControlDiagnostic ?? "UNSUPPORTED_UNKNOWN")
        : null;
    this.state = "STOPPED";
    this.stopReason = reason;
    this.audit({
      type: "runner.inspection.stopped",
      metadata: {
        operation: "OPEN_AND_INSPECT_ONLY",
        reason,
        diagnosticCategory: safeDiagnosticCategory,
        diagnosticStage: safeDiagnosticStage,
        destinationDiagnostic: safeDestinationDiagnostic,
        unsupportedControlDiagnostic: safeUnsupportedControlDiagnostic,
      },
    });
    return {
      state: "STOPPED",
      stopReason: reason,
      diagnosticCategory: safeDiagnosticCategory,
      diagnosticStage: safeDiagnosticStage,
      destinationDiagnostic: safeDestinationDiagnostic,
      unsupportedControlDiagnostic: safeUnsupportedControlDiagnostic,
      observation: null,
    };
  }
}
