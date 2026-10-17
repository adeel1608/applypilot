import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assessPacketReadiness, packetDigest, type ApplicationPacket } from "./beta";
import {
  HostedCapabilitySchema,
  HostedMappingSchema,
  HostedPreviewSchema,
  hostedCapabilityDigest,
  hostedDigest,
  type HostedApplicationDriver,
  type HostedBuild,
  type HostedCapability,
  type HostedForm,
  type HostedMapping,
  type HostedOperation,
  type HostedPreview,
  type HostedQuestionDiscovery,
  type HostedSubject,
  type HostedUploadProof,
  type HostedVerifiedArtifact,
} from "./hosted-contract";
import { questionsFromHostedForm, reconcileHostedQuestions } from "./hosted-questions";
import { safeHostedError } from "./hosted-driver";

export const HostedOwnerProofSchema = z
  .object({
    action: z.string().min(1).max(500),
    consumedAt: z.iso.datetime(),
    nonceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    loopbackValidated: z.literal(true),
    localSessionValidated: z.literal(true),
    nonceConsumed: z.literal(true),
    ownerConfirmed: z.literal(true),
  })
  .strict();
export type HostedOwnerProof = z.infer<typeof HostedOwnerProofSchema>;
export const hostedOwnerAction = (
  kind: "INSPECT" | "DISCLOSE" | "SUBMIT",
  cap: HostedCapability,
  sessionId = "",
  previewDigest = "",
) =>
  `HOSTED_${kind}:${cap.capabilityId}:${cap.version}:${hostedCapabilityDigest(cap)}:${sessionId}:${previewDigest}`;
export type HostedSessionState =
  | "INSPECTING"
  | "INSPECTED"
  | "MAPPED"
  | "FILLED"
  | "UPLOADED"
  | "VERIFIED"
  | "REVIEW_READY"
  | "CONFIRMED_SUBMITTED"
  | "CONFIRMED_NOT_SUBMITTED"
  | "OUTCOME_UNKNOWN"
  | "STOPPED";
export interface HostedSession {
  id: string;
  capability: HostedCapability;
  runtimeId: string;
  state: HostedSessionState;
  form: HostedForm | null;
  discovery: HostedQuestionDiscovery | null;
  mapping: HostedMapping;
  proofs: HostedUploadProof[];
  preview: HostedPreview | null;
  requestCount: number;
  safeStopCode: string | null;
  confirmationDigest: string | null;
}
export interface HostedWorkflowStore {
  assertCapability(capability: HostedCapability, reviewedBuild: HostedBuild): void;
  openSession(
    capability: HostedCapability,
    proof: HostedOwnerProof,
    runtimeId: string,
    reviewedBuild: HostedBuild,
  ): HostedSession;
  getSession(id: string): HostedSession;
  inspectComplete(id: string, form: HostedForm, discovery: HostedQuestionDiscovery): void;
  bindApplication(
    id: string,
    cap: HostedCapability,
    proof: HostedOwnerProof,
    runtimeId: string,
    reviewedBuild: HostedBuild,
  ): void;
  resolvePacket(cap: HostedCapability): ApplicationPacket;
  admitArtifacts(
    packet: ApplicationPacket,
    mapping: HostedMapping,
  ): Promise<HostedVerifiedArtifact[]>;
  claim(
    id: string,
    operation: HostedOperation,
    runtimeId: string,
    reviewedBuild: HostedBuild,
  ): string;
  complete(
    id: string,
    claimId: string,
    state: HostedSessionState,
    evidence?: {
      mapping?: HostedMapping;
      proofs?: HostedUploadProof[];
      preview?: HostedPreview;
      confirmationDigest?: string | null;
      safeStopCode?: string | null;
    },
  ): void;
  stop(id: string, safeCode: string, outcomeUnknown: boolean): void;
  recordRequest(id: string): void;
  sourceQuestionDiscovery(subject: HostedSubject): HostedQuestionDiscovery | null;
  authorizeSubmit(
    id: string,
    proof: HostedOwnerProof,
    runtimeId: string,
    reviewedBuild: HostedBuild,
  ): string;
  recoverLostContexts(runtimeId: string): { stopped: number; outcomeUnknown: number };
}

/** Mapping is derived only from reviewed selected alternatives; unmatched/unknown required fields block. */
export function hostedMapping(
  packet: ApplicationPacket,
  form: HostedForm,
  discovery: HostedQuestionDiscovery,
): HostedMapping {
  if (
    !packet.questionContract?.complete ||
    !discovery.complete ||
    packet.questionContract.discoveryDigest !== hostedDigest(discovery)
  )
    throw new Error("HOSTED_QUESTION_CONTRACT_REQUIRED");
  const groups = packet.questionContract.groups;
  if (
    groups.length !== discovery.groups.length ||
    groups.some(
      (group, index) =>
        hostedDigest({ ...group, selectedAlternative: null }) !==
        hostedDigest(discovery.groups[index]),
    )
  )
    throw new Error("HOSTED_QUESTION_CONTRACT_CHANGED");
  const mapping: HostedMapping = [];
  for (const group of groups) {
    if (group.selectedAlternative === null) {
      if (group.required) throw new Error("HOSTED_REQUIRED_ANSWER_UNKNOWN");
      continue;
    }
    const alternative = group.alternatives[group.selectedAlternative]!;
    if (alternative.kind === "ANSWER") {
      const question = discovery.questions.find((value) => value.id === alternative.questionId);
      const answer = packet.answers.find((value) => value.questionId === alternative.questionId);
      const control = form.controls.find(
        (value) => value.name === question?.controlName && value.type !== "file",
      );
      if (
        !answer ||
        !["VERIFIED_ANSWER", "OWNER_CHOICE"].includes(answer.truthState) ||
        answer.disclosureState !== "APPROVED" ||
        answer.value === null ||
        !control
      )
        throw new Error("HOSTED_REQUIRED_ANSWER_UNKNOWN");
      mapping.push({ kind: "ANSWER", controlIndex: control.index, questionId: answer.questionId });
    } else {
      const document = packet.documents.find(
        (value) => value.type === alternative.documentType && value.approved && !value.stale,
      );
      const field = discovery.documentControls.find(
        (value) => value.documentType === alternative.documentType,
      );
      const control = form.controls.find(
        (value) => value.name === field?.name && value.type === "file",
      );
      if (!document || !control) throw new Error("HOSTED_APPROVED_DOCUMENT_REQUIRED");
      mapping.push({ kind: "DOCUMENT", controlIndex: control.index, documentId: document.id });
    }
  }
  return HostedMappingSchema.parse(mapping);
}

/** Same service is used by the owned local runtime and explicit disposable FICTIONAL acceptance. */
export class HostedApplicationService {
  readonly runtimeId: string;
  private readonly drivers = new Map<string, HostedApplicationDriver>();
  private readonly inFlight = new Set<string>();
  constructor(
    private readonly input: {
      store: HostedWorkflowStore;
      reviewedBuild: HostedBuild;
      driverFactory: (onRequest: () => void) => HostedApplicationDriver;
      runtimeId?: string;
      now?: () => Date;
    },
  ) {
    this.runtimeId = input.runtimeId ?? randomUUID();
  }

  recover(): { stopped: number; outcomeUnknown: number } {
    return this.input.store.recoverLostContexts(this.runtimeId);
  }

  async inspect(input: HostedCapability, proof: HostedOwnerProof): Promise<HostedSession> {
    const cap = HostedCapabilitySchema.parse(input);
    const session = this.input.store.openSession(
      cap,
      HostedOwnerProofSchema.parse(proof),
      this.runtimeId,
      this.input.reviewedBuild,
    );
    let driver: HostedApplicationDriver | null = null;
    try {
      driver = this.input.driverFactory(() => this.input.store.recordRequest(session.id));
      this.drivers.set(session.id, driver);
      const form = await driver.inspect(cap);
      const discovery = reconcileHostedQuestions(
        questionsFromHostedForm(cap.subject, form),
        this.input.store.sourceQuestionDiscovery(cap.subject),
      );
      this.input.store.inspectComplete(session.id, form, discovery);
      return this.input.store.getSession(session.id);
    } catch (error) {
      try {
        this.input.store.stop(session.id, safeHostedError(error), false);
      } finally {
        await driver?.close();
        this.drivers.delete(session.id);
      }
      throw new Error(safeHostedError(error));
    }
  }

  async prepare(
    sessionId: string,
    input: HostedCapability,
    proof: HostedOwnerProof,
  ): Promise<HostedSession> {
    const cap = HostedCapabilitySchema.parse(input);
    const driver = this.drivers.get(sessionId);
    if (!driver) throw new Error("HOSTED_CONTEXT_LOST");
    if (this.inFlight.has(sessionId)) throw new Error("HOSTED_OPERATION_IN_PROGRESS");
    this.input.store.bindApplication(
      sessionId,
      cap,
      HostedOwnerProofSchema.parse(proof),
      this.runtimeId,
      this.input.reviewedBuild,
    );
    this.inFlight.add(sessionId);
    try {
      let session = this.input.store.getSession(sessionId);
      let packet = this.input.store.resolvePacket(cap);
      if (
        assessPacketReadiness(packet, { allowUnknownProviderExpiry: true }).blockers.length ||
        !session.form ||
        !session.discovery
      )
        throw new Error("HOSTED_PACKET_NOT_READY");
      const mapping = hostedMapping(packet, session.form, session.discovery);
      const steps: {
        operation: HostedOperation;
        state: HostedSessionState;
        run: () => Promise<{
          mapping?: HostedMapping;
          proofs?: HostedUploadProof[];
          preview?: HostedPreview;
        }>;
      }[] = [
        {
          operation: "MAP_FOR_FILL",
          state: "MAPPED",
          run: async () => {
            await driver.map(cap, packet, mapping);
            return { mapping };
          },
        },
        {
          operation: "FILL",
          state: "FILLED",
          run: async () => {
            await driver.fill(packet, mapping);
            return {};
          },
        },
        {
          operation: "UPLOAD",
          state: "UPLOADED",
          run: async () => ({
            proofs: await driver.upload(
              await this.input.store.admitArtifacts(packet, mapping),
              mapping,
            ),
          }),
        },
        {
          operation: "VERIFY",
          state: "VERIFIED",
          run: async () => {
            await driver.verify(packet, mapping, this.input.store.getSession(sessionId).proofs);
            return {};
          },
        },
        {
          operation: "FILL_PREVIEW",
          state: "REVIEW_READY",
          run: async () => {
            session = this.input.store.getSession(sessionId);
            const verification = await driver.verify(packet, mapping, session.proofs);
            const preview = HostedPreviewSchema.parse({
              sessionId,
              capabilityDigest: hostedCapabilityDigest(cap),
              packetDigest: packetDigest(packet),
              formDigest: hostedDigest(session.form),
              mappingDigest: hostedDigest(mapping),
              ...verification,
              documentDigests: session.proofs.map((value) => value.digest).sort(),
              materialDiffCount: 0,
              preparedAt: this.input.now?.().toISOString() ?? new Date().toISOString(),
            });
            return { preview };
          },
        },
      ];
      for (const step of steps) {
        packet = this.input.store.resolvePacket(cap);
        const claimId = this.input.store.claim(
          sessionId,
          step.operation,
          this.runtimeId,
          this.input.reviewedBuild,
        );
        this.input.store.complete(sessionId, claimId, step.state, await step.run());
      }
      return this.input.store.getSession(sessionId);
    } catch (error) {
      // Candidate attachment and upload ambiguity are never automatically retried.
      const session = this.input.store.getSession(sessionId);
      try {
        this.input.store.stop(
          sessionId,
          safeHostedError(error),
          ["FILLED", "UPLOADED", "VERIFIED", "REVIEW_READY"].includes(session.state),
        );
      } finally {
        await driver.close();
        this.drivers.delete(sessionId);
      }
      throw new Error(safeHostedError(error));
    } finally {
      this.inFlight.delete(sessionId);
    }
  }

  async submit(sessionId: string, proof: HostedOwnerProof): Promise<HostedSession> {
    const driver = this.drivers.get(sessionId);
    if (!driver) throw new Error("HOSTED_CONTEXT_LOST");
    if (this.inFlight.has(sessionId)) throw new Error("HOSTED_OPERATION_IN_PROGRESS");
    this.inFlight.add(sessionId);
    let activated = false;
    try {
      const session = this.input.store.getSession(sessionId);
      const packet = this.input.store.resolvePacket(session.capability);
      if (!session.preview) throw new Error("HOSTED_FINAL_PREVIEW_REQUIRED");
      const verification = await driver.verify(packet, session.mapping, session.proofs);
      if (
        verification.valuesDigest !== session.preview.valuesDigest ||
        verification.uploadsDigest !== session.preview.uploadsDigest
      )
        throw new Error("HOSTED_FINAL_PREVIEW_CHANGED");
      // The consent, local claim and global target-post guard are committed together before activation.
      const claimId = this.input.store.authorizeSubmit(
        sessionId,
        HostedOwnerProofSchema.parse(proof),
        this.runtimeId,
        this.input.reviewedBuild,
      );
      activated = true;
      const result = await driver.submit();
      this.input.store.complete(sessionId, claimId, result.state, result);
    } catch (error) {
      this.input.store.stop(
        sessionId,
        activated ? "HOSTED_TRANSPORT_OUTCOME_UNKNOWN" : safeHostedError(error),
        activated,
      );
      if (!activated) throw new Error(safeHostedError(error));
    } finally {
      await driver.close();
      this.drivers.delete(sessionId);
      this.inFlight.delete(sessionId);
    }
    return this.input.store.getSession(sessionId);
  }

  async stop(sessionId: string): Promise<void> {
    const session = this.input.store.getSession(sessionId);
    try {
      if (
        !["CONFIRMED_SUBMITTED", "CONFIRMED_NOT_SUBMITTED", "OUTCOME_UNKNOWN", "STOPPED"].includes(
          session.state,
        )
      )
        this.input.store.stop(sessionId, "HOSTED_OWNER_STOP", false);
    } finally {
      await this.drivers.get(sessionId)?.close();
      this.drivers.delete(sessionId);
    }
  }
  async close(): Promise<void> {
    for (const id of this.drivers.keys()) await this.stop(id);
  }
}
