import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { ApplicationRunStateSchema } from "@applypilot/job-model";

export const DisclosureStateSchema = z.enum(["APPROVED", "NOT_APPROVED", "UNKNOWN"]);
export const AnswerTruthStateSchema = z.enum([
  "VERIFIED_ANSWER",
  "USER_CONFIRMATION_REQUIRED",
  "UNKNOWN",
]);

export const PacketDocumentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["CV", "COVER_LETTER", "OTHER"]),
  fileName: z.string().min(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  approved: z.boolean(),
  stale: z.boolean(),
  required: z.boolean(),
});

export const PacketAnswerSchema = z.object({
  questionId: z.string().min(1),
  questionText: z.string().min(1),
  required: z.boolean(),
  sensitive: z.boolean(),
  value: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  truthState: AnswerTruthStateSchema,
  disclosureState: DisclosureStateSchema,
  factReferences: z.array(z.string().min(1)),
});

export const ApplicationPacketSchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    jobVersionId: z.string().min(1),
    profileVersionId: z.string().min(1),
    evaluationVersionId: z.string().min(1),
    eligibilityStatus: z.enum(["ELIGIBLE", "INELIGIBLE", "REVIEW_REQUIRED"]),
    targetUrl: z.url().nullable(),
    targetHost: z.string().min(1).nullable(),
    jobExpired: z.boolean(),
    duplicateDanger: z.boolean(),
    versionsCurrent: z.boolean(),
    documents: z.array(PacketDocumentSchema),
    answers: z.array(PacketAnswerSchema),
  })
  .superRefine(({ targetUrl, targetHost }, context) => {
    if ((targetUrl === null) !== (targetHost === null)) {
      context.addIssue({
        code: "custom",
        message: "Target URL and host must be provided together",
      });
      return;
    }
    if (!targetUrl || !targetHost) return;
    const parsed = new URL(targetUrl);
    if (parsed.username || parsed.password) {
      context.addIssue({ code: "custom", message: "Target URL credentials are forbidden" });
    }
    if (parsed.hostname !== targetHost.toLowerCase()) {
      context.addIssue({ code: "custom", message: "Target URL host does not match targetHost" });
    }
  });

export type ApplicationPacket = z.infer<typeof ApplicationPacketSchema>;
export type PacketAnswer = z.infer<typeof PacketAnswerSchema>;

export interface PacketReadiness {
  status: "PREPARING" | "REVIEW_REQUIRED" | "READY_TO_APPLY";
  blockers: string[];
  warnings: string[];
}

export function assessPacketReadiness(input: ApplicationPacket): PacketReadiness {
  const packet = ApplicationPacketSchema.parse(input);
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!packet.versionsCurrent) blockers.push("STALE_PACKET_INPUTS");
  if (packet.eligibilityStatus === "INELIGIBLE") blockers.push("JOB_INELIGIBLE");
  if (packet.jobExpired) blockers.push("JOB_EXPIRED");
  if (packet.duplicateDanger) blockers.push("DUPLICATE_DANGER_UNRESOLVED");
  if (!packet.targetUrl || !packet.targetHost) blockers.push("APPLICATION_DESTINATION_INVALID");
  if (!packet.documents.some(({ type, approved, stale }) => type === "CV" && approved && !stale)) {
    blockers.push("APPROVED_CURRENT_CV_REQUIRED");
  }
  for (const document of packet.documents.filter(({ required }) => required)) {
    if (!document.approved || document.stale)
      blockers.push(`REQUIRED_DOCUMENT_NOT_READY:${document.type}`);
  }
  for (const answer of packet.answers) {
    if (answer.required && answer.truthState === "UNKNOWN") {
      blockers.push(`REQUIRED_ANSWER_UNKNOWN:${answer.questionId}`);
    }
    if (answer.required && answer.disclosureState !== "APPROVED") {
      blockers.push(`REQUIRED_DISCLOSURE_NOT_APPROVED:${answer.questionId}`);
    }
    if (answer.truthState === "USER_CONFIRMATION_REQUIRED") {
      warnings.push(`ANSWER_REQUIRES_CONFIRMATION:${answer.questionId}`);
    }
  }
  return {
    status: blockers.length
      ? packet.documents.length
        ? "REVIEW_REQUIRED"
        : "PREPARING"
      : "READY_TO_APPLY",
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
  };
}

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

export function packetDigest(packet: ApplicationPacket): string {
  return createHash("sha256")
    .update(canonical(ApplicationPacketSchema.parse(packet)))
    .digest("hex");
}

export const SyntheticStopReasonSchema = z.enum([
  "UNKNOWN_REQUIRED_ANSWER",
  "SENSITIVE_DISCLOSURE_REQUIRED",
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
  "DOCUMENT_DIGEST_CHANGED",
  "PACKET_NOT_READY",
  "CONSENT_EXPIRED",
  "CONSENT_REPLAYED",
  "TARGET_APPROVAL_REQUIRED",
]);
export type SyntheticStopReason = z.infer<typeof SyntheticStopReasonSchema>;

export interface RunnerCheckpoint {
  sequence: number;
  state: z.infer<typeof ApplicationRunStateSchema>;
  stopReason: SyntheticStopReason | null;
  occurredAt: string;
}

export interface FinalActionConsent {
  id: string;
  token: string;
  tokenHash: string;
  packetDigest: string;
  targetHost: string;
  formVersion: string;
  expiresAt: string;
  usedAt: string | null;
}

export class SyntheticApplicationRunner {
  private state: z.infer<typeof ApplicationRunStateSchema> = "PREPARED";
  private sequence = 0;
  private readonly checkpoints: RunnerCheckpoint[] = [];
  private consent: FinalActionConsent | null = null;
  private irreversibleClicks = 0;
  private readonly syntheticTarget: boolean;

  constructor(
    private readonly packet: ApplicationPacket,
    private readonly formVersion: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    const host = packet.targetHost;
    this.syntheticTarget = host === "127.0.0.1" || host === "localhost";
    if (!this.syntheticTarget) {
      this.pause("TARGET_APPROVAL_REQUIRED");
    } else {
      this.record("PREPARED", null);
    }
  }

  open(): RunnerCheckpoint {
    if (!this.syntheticTarget) return this.pause("TARGET_APPROVAL_REQUIRED");
    this.assertState("PREPARED");
    return this.advance("OPENED");
  }

  map(): RunnerCheckpoint {
    if (!this.syntheticTarget) return this.pause("TARGET_APPROVAL_REQUIRED");
    this.assertState("OPENED");
    const unknown = this.packet.answers.some(
      ({ required, truthState }) => required && truthState === "UNKNOWN",
    );
    if (unknown) return this.pause("UNKNOWN_REQUIRED_ANSWER");
    const disclosure = this.packet.answers.some(
      ({ required, disclosureState }) => required && disclosureState !== "APPROVED",
    );
    if (disclosure) return this.pause("SENSITIVE_DISCLOSURE_REQUIRED");
    return this.advance("MAPPED");
  }

  fill(observed: {
    host: string;
    formVersion: string;
    documentDigests: string[];
  }): RunnerCheckpoint {
    if (!this.syntheticTarget) return this.pause("TARGET_APPROVAL_REQUIRED");
    this.assertState("MAPPED");
    if (observed.host !== this.packet.targetHost) return this.pause("DESTINATION_CHANGED");
    if (observed.formVersion !== this.formVersion) return this.pause("FORM_CHANGED");
    const expected = this.packet.documents.map(({ digest }) => digest).sort();
    if (canonical(expected) !== canonical([...observed.documentDigests].sort())) {
      return this.pause("DOCUMENT_DIGEST_CHANGED");
    }
    return this.advance("FILLED");
  }

  stop(reason: SyntheticStopReason): RunnerCheckpoint {
    return this.pause(reason);
  }

  readyForFinalReview(): RunnerCheckpoint {
    if (!this.syntheticTarget) return this.pause("TARGET_APPROVAL_REQUIRED");
    this.assertState("FILLED");
    const readiness = assessPacketReadiness(this.packet);
    if (readiness.blockers.length) return this.pause("PACKET_NOT_READY");
    return this.advance("READY_FOR_FINAL_REVIEW");
  }

  createConsent(ttlMs = 5 * 60 * 1000): FinalActionConsent {
    if (this.state !== "READY_FOR_FINAL_REVIEW") throw new Error("FINAL_REVIEW_REQUIRED");
    const token = randomBytes(32).toString("base64url");
    this.consent = {
      id: randomBytes(12).toString("hex"),
      token,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      packetDigest: packetDigest(this.packet),
      targetHost: this.packet.targetHost ?? "",
      formVersion: this.formVersion,
      expiresAt: new Date(this.now().getTime() + ttlMs).toISOString(),
      usedAt: null,
    };
    return { ...this.consent };
  }

  submitSynthetic(input: {
    token: string;
    packetDigest: string;
    targetHost: string;
    formVersion: string;
    responseLost?: boolean;
  }): RunnerCheckpoint {
    if (this.state === "SYNTHETIC_SUBMITTED" || this.state === "OUTCOME_UNKNOWN") {
      throw new Error("RUN_TERMINAL");
    }
    if (!this.syntheticTarget) return this.pause("TARGET_APPROVAL_REQUIRED");
    if (this.state !== "READY_FOR_FINAL_REVIEW") throw new Error("FINAL_REVIEW_REQUIRED");
    if (!this.consent) return this.pause("CONSENT_EXPIRED");
    if (this.consent.usedAt) return this.pause("CONSENT_REPLAYED");
    if (Date.parse(this.consent.expiresAt) <= this.now().getTime())
      return this.pause("CONSENT_EXPIRED");
    const suppliedHash = createHash("sha256").update(input.token).digest("hex");
    const left = Buffer.from(suppliedHash, "hex");
    const right = Buffer.from(this.consent.tokenHash, "hex");
    const validToken = left.length === right.length && timingSafeEqual(left, right);
    if (
      !validToken ||
      input.packetDigest !== this.consent.packetDigest ||
      input.packetDigest !== packetDigest(this.packet) ||
      input.targetHost !== this.consent.targetHost ||
      input.formVersion !== this.consent.formVersion
    ) {
      return this.pause("PAGE_CHANGED");
    }
    this.consent.usedAt = this.now().toISOString();
    this.irreversibleClicks += 1;
    return this.advance(input.responseLost ? "OUTCOME_UNKNOWN" : "SYNTHETIC_SUBMITTED");
  }

  snapshot() {
    return {
      state: this.state,
      checkpoints: this.checkpoints.map((item) => ({ ...item })),
      irreversibleClicks: this.irreversibleClicks,
    };
  }

  private advance(state: z.infer<typeof ApplicationRunStateSchema>): RunnerCheckpoint {
    if (this.state === "SYNTHETIC_SUBMITTED" || this.state === "OUTCOME_UNKNOWN") {
      throw new Error("RUN_TERMINAL");
    }
    this.state = state;
    return this.record(state, null);
  }

  private assertState(expected: z.infer<typeof ApplicationRunStateSchema>): void {
    if (this.state !== expected) throw new Error(`RUN_STATE_REQUIRED:${expected}`);
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
