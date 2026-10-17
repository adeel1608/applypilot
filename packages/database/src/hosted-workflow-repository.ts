import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";
import { CandidateProfileSchema, candidateProfileContentHash } from "@applypilot/candidate-profile";
import {
  HOSTED_DISCLOSURE,
  HostedCapabilitySchema,
  HostedFormSchema,
  HostedMappingSchema,
  HostedOwnerProofSchema,
  HostedPreviewSchema,
  HostedQuestionDiscoverySchema,
  HostedSubjectSchema,
  PRIVATE_PREPARATION_VERIFICATION_POLICY,
  admitHostedPdf,
  assessVerificationFreshness,
  hostedCapabilityDigest,
  hostedDigest,
  hostedMapping,
  hostedOwnerAction,
  packetDigest,
  nonFactualConsentKind,
  hostedVerifiedFacts,
  hostedAllowedFactPaths,
  type HostedBuild,
  type HostedCapability,
  type HostedForm,
  type HostedMapping,
  type HostedOperation,
  type HostedOwnerProof,
  type HostedPreview,
  type HostedQuestionDiscovery,
  type HostedSession,
  type HostedSessionState,
  type HostedSubject,
  type HostedUploadProof,
  type HostedWorkflowStore,
  type ApplicationPacket,
} from "@applypilot/application-runner";
import { BetaRepository } from "./beta-repository";
import { SourceEnablementRepository } from "./source-enablement-repository";
import { resolvePersistedApplicationPacket } from "./persisted-packet";

const proofsSchema = z
  .array(
    z
      .object({
        documentId: z.string().min(1).max(200),
        digest: z.string().regex(/^[a-f0-9]{64}$/),
        byteLength: z.number().int().min(5).max(5_000_000),
        proof: z.enum(["LOCAL_ATTACHED", "REMOTE_BYTES_VERIFIED"]),
        acknowledgementId: z.string().max(100).nullable(),
      })
      .strict(),
  )
  .max(20);
const stateSchema = z.enum([
  "INSPECTING",
  "INSPECTED",
  "MAPPED",
  "FILLED",
  "UPLOADED",
  "VERIFIED",
  "REVIEW_READY",
  "CONFIRMED_SUBMITTED",
  "CONFIRMED_NOT_SUBMITTED",
  "OUTCOME_UNKNOWN",
  "STOPPED",
]);
type SessionRow = {
  id: string;
  capId: string;
  runtimeId: string;
  state: HostedSessionState;
  formJson: string | null;
  discoveryId: string | null;
  mappingJson: string;
  proofsJson: string;
  previewJson: string | null;
  requestCount: number;
  safeStopCode: string | null;
  confirmationDigest: string | null;
  disclosureConsentId: string | null;
  createdAt: string;
};
const projection =
  "id,capability_version_id AS capId,runtime_id AS runtimeId,state,form_json AS formJson,discovery_id AS discoveryId,mapping_json AS mappingJson,proofs_json AS proofsJson,preview_json AS previewJson,request_count AS requestCount,safe_stop_code AS safeStopCode,confirmation_digest AS confirmationDigest,disclosure_consent_id AS disclosureConsentId,created_at AS createdAt";
const expectedPrevious: Partial<Record<HostedOperation, HostedSessionState>> = {
  MAP_FOR_FILL: "INSPECTED",
  FILL: "MAPPED",
  UPLOAD: "FILLED",
  VERIFY: "UPLOADED",
  FILL_PREVIEW: "VERIFIED",
  SUBMIT: "REVIEW_READY",
};
const expectedNext: Partial<Record<HostedOperation, HostedSessionState>> = {
  MAP_FOR_FILL: "MAPPED",
  FILL: "FILLED",
  UPLOAD: "UPLOADED",
  VERIFY: "VERIFIED",
  FILL_PREVIEW: "REVIEW_READY",
};

/** Additive hosted workflow; legacy real-inspection and synthetic tables/guards are preserved. */
export class HostedWorkflowRepository implements HostedWorkflowStore {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly options: {
      mode: "REAL" | "FICTIONAL";
      approvedArtifactRoot: string;
      reviewedBuild: HostedBuild | null;
      currentReviewedBuild?: () => HostedBuild | null;
      currentPrivateProfileHash?: () => string;
      now?: () => Date;
    },
  ) {}
  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
  private capRow(
    cap: HostedCapability,
  ): { id: string; json: string; digest: string; revokedAt: string | null } | undefined {
    return this.sqlite
      .prepare(
        "SELECT id,capability_json AS json,capability_digest AS digest,revoked_at AS revokedAt FROM hosted_capability_versions WHERE capability_id=? AND version=?",
      )
      .get(cap.capabilityId, cap.version) as ReturnType<HostedWorkflowRepository["capRow"]>;
  }
  private readCapability(id: string): HostedCapability {
    const row = this.sqlite
      .prepare(
        "SELECT capability_json AS json,capability_digest AS digest FROM hosted_capability_versions WHERE id=?",
      )
      .get(id) as { json: string; digest: string } | undefined;
    try {
      const cap = HostedCapabilitySchema.parse(JSON.parse(row?.json ?? "null"));
      if (hostedCapabilityDigest(cap) !== row?.digest) throw new Error();
      return cap;
    } catch {
      throw new Error("HOSTED_CAPABILITY_CORRUPT");
    }
  }
  persistCapability(input: HostedCapability): string {
    const cap = HostedCapabilitySchema.parse(input);
    if (cap.mode !== this.options.mode) throw new Error("HOSTED_MODE_MISMATCH");
    return this.sqlite
      .transaction(() => {
        const existing = this.capRow(cap);
        if (existing) {
          if (existing.digest !== hostedCapabilityDigest(cap))
            throw new Error("HOSTED_CAPABILITY_IMMUTABLE");
          return existing.id;
        }
        const head = this.sqlite
          .prepare(
            "SELECT id,version FROM hosted_capability_versions WHERE capability_id=? ORDER BY version DESC LIMIT 1",
          )
          .get(cap.capabilityId) as { id: string; version: number } | undefined;
        if ((head?.version ?? 0) + 1 !== cap.version)
          throw new Error("HOSTED_CAPABILITY_SEQUENCE_INVALID");
        if (head) {
          const old = this.readCapability(head.id);
          if (
            old.mode !== cap.mode ||
            hostedDigest(old.subject) !== hostedDigest(cap.subject) ||
            hostedDigest(old.build) !== hostedDigest(cap.build)
          )
            throw new Error("HOSTED_CAPABILITY_FAMILY_CHANGED");
        }
        const id = randomUUID();
        this.sqlite
          .prepare(
            "INSERT INTO hosted_capability_versions(id,capability_id,version,mode,scope,capability_json,capability_digest,created_at) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            cap.capabilityId,
            cap.version,
            cap.mode,
            cap.scope,
            JSON.stringify(cap),
            hostedCapabilityDigest(cap),
            this.now().toISOString(),
          );
        this.audit(id, "HOSTED_CAPABILITY_STAGED", {
          version: cap.version,
          mode: cap.mode,
          scope: cap.scope,
          digest: hostedCapabilityDigest(cap),
        });
        return id;
      })
      .immediate();
  }
  assertCapability(capability: HostedCapability, build: HostedBuild): void {
    const cap = HostedCapabilitySchema.parse(capability);
    const row = this.capRow(cap);
    const head = this.sqlite
      .prepare(
        "SELECT version FROM hosted_capability_versions WHERE capability_id=? ORDER BY version DESC LIMIT 1",
      )
      .get(cap.capabilityId) as { version: number } | undefined;
    if (
      !row ||
      row.revokedAt ||
      row.digest !== hostedCapabilityDigest(cap) ||
      head?.version !== cap.version ||
      hostedCapabilityDigest(this.readCapability(row.id)) !== row.digest
    )
      throw new Error("HOSTED_CAPABILITY_NOT_CURRENT");
    if (
      cap.mode !== this.options.mode ||
      !this.options.reviewedBuild ||
      hostedDigest(cap.build) !== hostedDigest(build) ||
      hostedDigest(build) !== hostedDigest(this.options.reviewedBuild)
    )
      throw new Error("HOSTED_REVIEWED_BUILD_REQUIRED");
    if (
      this.options.mode === "REAL" &&
      (!this.options.currentReviewedBuild ||
        hostedDigest(this.options.currentReviewedBuild()) !== hostedDigest(build))
    )
      throw new Error("HOSTED_REVIEWED_BUILD_REQUIRED");
    const now = this.now().getTime();
    if (
      now < Date.parse(cap.createdAt) ||
      now < Date.parse(cap.policyReviewedAt) ||
      now >= Date.parse(cap.expiresAt)
    )
      throw new Error("HOSTED_CAPABILITY_EXPIRED");
    this.assertSubject(
      cap.subject,
      cap.scope === "APPLICATION" ? "PRE_EXTERNAL_ACTION" : "PREPARATION",
    );
  }
  assertSubject(
    input: HostedSubject,
    operation: "PREPARATION" | "PRE_EXTERNAL_ACTION" = "PREPARATION",
  ): void {
    const subject = HostedSubjectSchema.parse(input);
    const version = this.sqlite
      .prepare("SELECT id FROM job_versions WHERE job_id=? ORDER BY version DESC LIMIT 1")
      .get(subject.jobId) as { id: string } | undefined;
    const profile = this.sqlite
      .prepare(
        "SELECT v.content_hash AS hash,v.snapshot_json AS snapshot,p.active_version_id AS active FROM candidate_profile_versions v JOIN candidate_profiles p ON p.id=v.profile_id WHERE v.id=?",
      )
      .get(subject.profileVersionId) as
      | { hash: string; active: string; snapshot: string }
      | undefined;
    if (version?.id !== subject.jobVersionId || profile?.active !== subject.profileVersionId)
      throw new Error("HOSTED_SUBJECT_NOT_CURRENT");
    try {
      if (
        candidateProfileContentHash(CandidateProfileSchema.parse(JSON.parse(profile.snapshot))) !==
        profile.hash
      )
        throw new Error();
    } catch {
      throw new Error("HOSTED_PRIVATE_PROFILE_CHANGED");
    }
    if (
      this.options.mode === "REAL" &&
      (!this.options.currentPrivateProfileHash ||
        this.options.currentPrivateProfileHash() !== profile.hash)
    )
      throw new Error("HOSTED_PRIVATE_PROFILE_CHANGED");
    const evidence = new BetaRepository(this.sqlite, () =>
      this.now(),
    ).requireLatestQualifiedVerification(subject.jobId, subject.jobVersionId);
    if (
      evidence.verificationId !== subject.verificationId ||
      evidence.runId !== subject.sourceRunId ||
      evidence.contentHash !== subject.sourceContentHash ||
      new SourceEnablementRepository(this.sqlite, () => this.now()).getRunOwnerProvenance(
        evidence.runId,
      ) !== "OWNER_RECEIPTS_BOUND"
    )
      throw new Error("HOSTED_SOURCE_BINDING_INVALID");
    const lineage = this.sqlite
      .prepare(
        "SELECT o.source,o.tenant,o.external_id AS externalId,c.region FROM source_observations o JOIN source_record_verifications v ON v.source_observation_id=o.id JOIN source_capability_versions c ON c.id=v.capability_version_id WHERE v.id=?",
      )
      .get(subject.verificationId) as
      | { source: string; tenant: string; externalId: string; region: string }
      | undefined;
    if (
      lineage?.source !== subject.provider ||
      lineage.tenant !== subject.tenant ||
      lineage.externalId !== subject.externalId ||
      lineage.region !== subject.region
    )
      throw new Error("HOSTED_SOURCE_BINDING_INVALID");
    if (
      assessVerificationFreshness({
        verifiedAt: evidence.verifiedAt,
        evidenceQualified: true,
        providerExpiresAt: evidence.providerExpiresAt,
        operation,
        policy: PRIVATE_PREPARATION_VERIFICATION_POLICY,
        now: this.now(),
      }).state !== "FRESH"
    )
      throw new Error("HOSTED_SOURCE_STALE");
  }
  private ownerConsent(
    cap: HostedCapability,
    kind: "INSPECT" | "DISCLOSE" | "SUBMIT",
    proof: HostedOwnerProof,
    sessionId = "",
    previewDigest = "",
  ): string {
    HostedOwnerProofSchema.parse(proof);
    if (
      proof.action !== hostedOwnerAction(kind, cap, sessionId, previewDigest) ||
      this.now().getTime() - Date.parse(proof.consumedAt) < 0 ||
      this.now().getTime() - Date.parse(proof.consumedAt) > 60_000
    )
      throw new Error("HOSTED_OWNER_CONSENT_INVALID");
    const id = randomUUID();
    this.sqlite
      .prepare(
        "INSERT INTO hosted_owner_consents(id,capability_version_id,action,action_binding,nonce_digest,proof_json,consumed_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        id,
        this.capRow(cap)!.id,
        kind,
        proof.action,
        proof.nonceDigest,
        JSON.stringify({
          ...proof,
          ...(kind === "DISCLOSE" ? { disclosureDigest: hostedDigest(HOSTED_DISCLOSURE) } : {}),
        }),
        proof.consumedAt,
      );
    return id;
  }
  openSession(
    cap: HostedCapability,
    proof: HostedOwnerProof,
    runtimeId: string,
    build: HostedBuild,
  ): HostedSession {
    const id = this.sqlite
      .transaction(() => {
        this.assertCapability(cap, build);
        if (
          cap.scope !== "PASSIVE_INSPECTION" ||
          this.sqlite
            .prepare(
              "SELECT 1 FROM hosted_browser_sessions s JOIN hosted_capability_versions c ON c.id=s.capability_version_id WHERE c.capability_id=? LIMIT 1",
            )
            .get(cap.capabilityId)
        )
          throw new Error("HOSTED_INSPECTION_REPLAYED");
        const consentId = this.ownerConsent(cap, "INSPECT", proof);
        const id = randomUUID();
        const now = this.now().toISOString();
        this.sqlite
          .prepare(
            "INSERT INTO hosted_browser_sessions(id,capability_version_id,inspection_consent_id,runtime_id,state,mapping_json,proofs_json,created_at,updated_at) VALUES(?,?,?,?,'INSPECTING','[]','[]',?,?)",
          )
          .run(id, this.capRow(cap)!.id, consentId, runtimeId, now, now);
        this.sqlite
          .prepare(
            "INSERT INTO hosted_operation_claims(id,session_id,operation,state,capability_digest,runtime_id,claimed_at) VALUES(?,?,'OPEN_AND_INSPECT_ONLY','CLAIMED',?,?,?)",
          )
          .run(randomUUID(), id, hostedCapabilityDigest(cap), runtimeId, now);
        this.audit(id, "HOSTED_INSPECTION_CLAIMED", {
          mode: cap.mode,
          digest: hostedCapabilityDigest(cap),
        });
        return id;
      })
      .immediate();
    return this.getSession(id);
  }
  private row(id: string): SessionRow {
    const row = this.sqlite
      .prepare(`SELECT ${projection} FROM hosted_browser_sessions WHERE id=?`)
      .get(id) as SessionRow | undefined;
    if (!row) throw new Error("HOSTED_SESSION_NOT_FOUND");
    return row;
  }
  getSession(id: string): HostedSession {
    const row = this.row(id);
    try {
      return {
        id,
        capability: this.readCapability(row.capId),
        runtimeId: row.runtimeId,
        state: stateSchema.parse(row.state),
        form: row.formJson ? HostedFormSchema.parse(JSON.parse(row.formJson)) : null,
        discovery: row.discoveryId ? this.getDiscovery(row.discoveryId).discovery : null,
        mapping: HostedMappingSchema.parse(JSON.parse(row.mappingJson)),
        proofs: proofsSchema.parse(JSON.parse(row.proofsJson)),
        preview: row.previewJson ? HostedPreviewSchema.parse(JSON.parse(row.previewJson)) : null,
        requestCount: row.requestCount,
        safeStopCode: row.safeStopCode,
        confirmationDigest: row.confirmationDigest,
      };
    } catch {
      throw new Error("HOSTED_SESSION_CORRUPT");
    }
  }
  recordDiscovery(subject: HostedSubject, input: HostedQuestionDiscovery): string {
    this.assertSubject(subject);
    const discovery = HostedQuestionDiscoverySchema.parse(input);
    if (discovery.subjectDigest !== hostedDigest(subject))
      throw new Error("HOSTED_QUESTION_SUBJECT_CHANGED");
    const digest = hostedDigest(discovery);
    const old = this.sqlite
      .prepare(
        "SELECT id FROM hosted_question_discoveries WHERE subject_digest=? AND discovery_digest=?",
      )
      .get(hostedDigest(subject), digest) as { id: string } | undefined;
    if (old) return old.id;
    const id = randomUUID();
    this.sqlite
      .prepare(
        "INSERT INTO hosted_question_discoveries(id,subject_digest,job_id,job_version_id,profile_version_id,verification_id,source_run_id,subject_json,discovery_json,discovery_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        hostedDigest(subject),
        subject.jobId,
        subject.jobVersionId,
        subject.profileVersionId,
        subject.verificationId,
        subject.sourceRunId,
        JSON.stringify(subject),
        JSON.stringify(discovery),
        digest,
        this.now().toISOString(),
      );
    return id;
  }
  getDiscovery(id: string): {
    subject: HostedSubject;
    discovery: HostedQuestionDiscovery;
    digest: string;
  } {
    const row = this.sqlite
      .prepare(
        "SELECT subject_json AS subject,discovery_json AS discovery,discovery_digest AS digest FROM hosted_question_discoveries WHERE id=?",
      )
      .get(id) as { subject: string; discovery: string; digest: string } | undefined;
    try {
      const subject = HostedSubjectSchema.parse(JSON.parse(row?.subject ?? "null"));
      const discovery = HostedQuestionDiscoverySchema.parse(JSON.parse(row?.discovery ?? "null"));
      if (
        hostedDigest(discovery) !== row?.digest ||
        discovery.subjectDigest !== hostedDigest(subject)
      )
        throw new Error();
      return { subject, discovery, digest: row.digest };
    } catch {
      throw new Error("HOSTED_QUESTION_DISCOVERY_CORRUPT");
    }
  }
  latestDiscovery(jobId: string): ReturnType<HostedWorkflowRepository["getDiscovery"]> | null {
    const row = this.sqlite
      .prepare(
        "SELECT id FROM hosted_question_discoveries WHERE job_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(jobId) as { id: string } | undefined;
    if (!row) return null;
    const result = this.getDiscovery(row.id);
    this.assertSubject(result.subject);
    return result;
  }
  sourceQuestionDiscovery(subject: HostedSubject): HostedQuestionDiscovery | null {
    this.assertSubject(subject);
    const row = this.sqlite
      .prepare(
        "SELECT id FROM hosted_question_discoveries WHERE subject_digest=? AND json_extract(discovery_json,'$.origin')='SOURCE_DETAIL' ORDER BY rowid DESC LIMIT 1",
      )
      .get(hostedDigest(subject)) as { id: string } | undefined;
    return row ? this.getDiscovery(row.id).discovery : null;
  }
  inspectComplete(id: string, form: HostedForm, discovery: HostedQuestionDiscovery): void {
    this.sqlite
      .transaction(() => {
        const session = this.getSession(id);
        if (session.state !== "INSPECTING") throw new Error("HOSTED_OPERATION_SEQUENCE_INVALID");
        const discoveryId = this.recordDiscovery(session.capability.subject, discovery);
        const claim = this.sqlite
          .prepare(
            "SELECT id FROM hosted_operation_claims WHERE session_id=? AND operation='OPEN_AND_INSPECT_ONLY' AND state='CLAIMED'",
          )
          .get(id) as { id: string } | undefined;
        if (!claim) throw new Error("HOSTED_OPERATION_CLAIM_MISSING");
        this.sqlite
          .prepare(
            "UPDATE hosted_browser_sessions SET state='INSPECTED',form_json=?,discovery_id=?,updated_at=? WHERE id=?",
          )
          .run(
            JSON.stringify(HostedFormSchema.parse(form)),
            discoveryId,
            this.now().toISOString(),
            id,
          );
        this.sqlite
          .prepare("UPDATE hosted_operation_claims SET state='COMPLETE',completed_at=? WHERE id=?")
          .run(this.now().toISOString(), claim.id);
        this.audit(id, "HOSTED_INSPECTION_COMPLETE", {
          formDigest: hostedDigest(form),
          discoveryDigest: hostedDigest(discovery),
          complete: discovery.complete,
        });
      })
      .immediate();
  }
  bindApplication(
    id: string,
    cap: HostedCapability,
    proof: HostedOwnerProof,
    runtimeId: string,
    build: HostedBuild,
  ): void {
    this.sqlite
      .transaction(() => {
        this.assertCapability(cap, build);
        const session = this.getSession(id);
        if (
          session.state !== "INSPECTED" ||
          session.runtimeId !== runtimeId ||
          cap.scope !== "APPLICATION" ||
          cap.capabilityId !== session.capability.capabilityId ||
          cap.version !== session.capability.version + 1 ||
          cap.mode !== session.capability.mode ||
          hostedDigest(cap.subject) !== hostedDigest(session.capability.subject) ||
          !session.form ||
          !session.discovery ||
          cap.formDigest !== hostedDigest(session.form) ||
          cap.discoveryDigest !== hostedDigest(session.discovery)
        )
          throw new Error("HOSTED_APPLICATION_BINDING_INVALID");
        this.resolvePacket(cap);
        const consentId = this.ownerConsent(cap, "DISCLOSE", proof, id);
        if (
          this.sqlite
            .prepare(
              "UPDATE hosted_browser_sessions SET capability_version_id=?,disclosure_consent_id=?,updated_at=? WHERE id=? AND disclosure_consent_id IS NULL AND state='INSPECTED'",
            )
            .run(this.capRow(cap)!.id, consentId, this.now().toISOString(), id).changes !== 1
        )
          throw new Error("HOSTED_DISCLOSURE_REPLAYED");
        this.audit(id, "HOSTED_DISCLOSURE_CONSUMED", {
          digest: hostedCapabilityDigest(cap),
          disclosureDigest: hostedDigest(HOSTED_DISCLOSURE),
        });
      })
      .immediate();
  }
  resolvePacket(cap: HostedCapability): ApplicationPacket {
    if (!cap.packetId || !cap.packetDigest) throw new Error("HOSTED_PACKET_BINDING_REQUIRED");
    this.assertSubject(cap.subject, "PRE_EXTERNAL_ACTION");
    const result = resolvePersistedApplicationPacket({
      sqlite: this.sqlite,
      packetId: cap.packetId,
      expectedDigest: cap.packetDigest,
      now: this.now(),
      operation: "PRE_EXTERNAL_ACTION",
      policy: PRIVATE_PREPARATION_VERIFICATION_POLICY,
    });
    const packet = result.packet;
    if (
      !packet.r2EvaluationId ||
      result.readiness.status !== "READY_TO_APPLY" ||
      packet.jobId !== cap.subject.jobId ||
      packet.jobVersionId !== cap.subject.jobVersionId ||
      packet.profileVersionId !== cap.subject.profileVersionId ||
      packet.verificationEvidence?.verificationId !== cap.subject.verificationId ||
      packet.targetUrl !== cap.subject.targetUrl ||
      packet.questionContract?.discoveryDigest !== cap.discoveryDigest
    )
      throw new Error("HOSTED_PACKET_NOT_READY");
    const discoveryRow = this.sqlite
      .prepare(
        "SELECT id FROM hosted_question_discoveries WHERE subject_digest=? AND discovery_digest=?",
      )
      .get(hostedDigest(cap.subject), cap.discoveryDigest) as { id: string } | undefined;
    if (!discoveryRow) throw new Error("HOSTED_QUESTION_CONTRACT_REQUIRED");
    const discovery = this.getDiscovery(discoveryRow.id).discovery;
    const selected = new Set(
      packet.questionContract.groups.flatMap((group) =>
        group.selectedAlternative === null
          ? []
          : group.alternatives[group.selectedAlternative]?.kind === "ANSWER"
            ? [(group.alternatives[group.selectedAlternative] as { questionId: string }).questionId]
            : [],
      ),
    );
    for (const answer of packet.answers.filter((value) => selected.has(value.questionId))) {
      if (answer.truthState === "OWNER_CHOICE") {
        const question = discovery.questions.find((value) => value.id === answer.questionId);
        const receipt = this.sqlite
          .prepare(
            "SELECT subject_digest AS subjectDigest,discovery_digest AS discoveryDigest,question_id AS questionId,kind,value,proof_json AS proofJson FROM hosted_question_choices WHERE id=?",
          )
          .get(answer.ownerChoice?.receiptId ?? "") as
          | {
              subjectDigest: string;
              discoveryDigest: string;
              questionId: string;
              kind: string;
              value: number;
              proofJson: string;
            }
          | undefined;
        if (
          !question ||
          !receipt ||
          receipt.subjectDigest !== hostedDigest(cap.subject) ||
          receipt.discoveryDigest !== cap.discoveryDigest ||
          receipt.questionId !== answer.questionId ||
          receipt.kind !== nonFactualConsentKind(question) ||
          receipt.kind !== answer.ownerChoice?.kind ||
          Boolean(receipt.value) !== answer.value
        )
          throw new Error("HOSTED_OWNER_CHOICE_INVALID");
        try {
          HostedOwnerProofSchema.parse(JSON.parse(receipt.proofJson));
        } catch {
          throw new Error("HOSTED_OWNER_CHOICE_INVALID");
        }
      } else {
        const question = discovery.questions.find((value) => value.id === answer.questionId);
        if (
          !question ||
          !hostedAllowedFactPaths(question).some((path) =>
            hostedVerifiedFacts(
              JSON.parse(
                (
                  this.sqlite
                    .prepare(
                      "SELECT snapshot_json AS json FROM candidate_profile_versions WHERE id=?",
                    )
                    .get(packet.profileVersionId) as { json: string }
                ).json,
              ),
            ).some(
              (fact) =>
                fact.path === path &&
                fact.value === answer.value &&
                JSON.stringify(fact.references ?? [fact.path]) ===
                  JSON.stringify(answer.factReferences),
            ),
          )
        )
          throw new Error("HOSTED_FACT_QUESTION_UNSUPPORTED");
        this.assertVerifiedAnswer(packet, answer);
      }
    }
    if (!discovery.complete) throw new Error("HOSTED_QUESTION_CONTRACT_REQUIRED");
    return packet;
  }
  private assertVerifiedAnswer(
    packet: ApplicationPacket,
    answer: ApplicationPacket["answers"][number],
  ): void {
    if (
      answer.truthState !== "VERIFIED_ANSWER" ||
      answer.disclosureState !== "APPROVED" ||
      answer.value === null ||
      (answer.factTransform === "JOIN_NAME"
        ? JSON.stringify(answer.factReferences) !==
          JSON.stringify(["identity.firstName", "identity.lastName"])
        : answer.factReferences.length !== 1)
    )
      throw new Error("HOSTED_ANSWER_NOT_VERIFIED");
    const row = this.sqlite
      .prepare("SELECT snapshot_json AS json FROM candidate_profile_versions WHERE id=?")
      .get(packet.profileVersionId) as { json: string };
    if (answer.factTransform === "JOIN_NAME") {
      const expected = hostedVerifiedFacts(JSON.parse(row.json)).find(
        (fact) => fact.transform === "JOIN_NAME",
      );
      if (expected?.value !== answer.value) throw new Error("HOSTED_ANSWER_NOT_VERIFIED");
      return;
    }
    let value: unknown = JSON.parse(row.json);
    const path = answer.factReferences[0]!;
    if (
      !/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*|\.[0-9]+){1,8}$/.test(path) ||
      /(?:__proto__|prototype|constructor)/.test(path)
    )
      throw new Error("HOSTED_ANSWER_NOT_VERIFIED");
    for (const token of path.split(".")) {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, token))
        throw new Error("HOSTED_ANSWER_NOT_VERIFIED");
      value = Object.getOwnPropertyDescriptor(value, token)?.value as unknown;
    }
    const fact = value as { value?: unknown; verification?: unknown } | null;
    if (!fact || fact.verification !== "VERIFIED" || fact.value !== answer.value)
      throw new Error("HOSTED_ANSWER_NOT_VERIFIED");
  }
  recordQuestionChoices(
    subject: HostedSubject,
    discovery: HostedQuestionDiscovery,
    choices: { questionId: string; value: boolean }[],
    proof: HostedOwnerProof,
  ): Map<string, { receiptId: string; kind: "TERMS" | "DATA_PROCESSING" }> {
    return this.sqlite
      .transaction(() => {
        this.assertSubject(subject);
        HostedOwnerProofSchema.parse(proof);
        if (
          proof.action !==
            `HOSTED_QUESTION_REVIEW:${hostedDigest(subject)}:${hostedDigest(discovery)}` ||
          discovery.subjectDigest !== hostedDigest(subject) ||
          this.now().getTime() - Date.parse(proof.consumedAt) < 0 ||
          this.now().getTime() - Date.parse(proof.consumedAt) > 60_000 ||
          new Set(choices.map((value) => value.questionId)).size !== choices.length
        )
          throw new Error("HOSTED_OWNER_CHOICE_INVALID");
        if (
          this.sqlite
            .prepare("SELECT 1 FROM hosted_question_review_receipts WHERE nonce_digest=?")
            .get(proof.nonceDigest)
        )
          throw new Error("HOSTED_OWNER_NONCE_REPLAY");
        this.sqlite
          .prepare(
            "INSERT INTO hosted_question_review_receipts(nonce_digest,subject_digest,discovery_digest,proof_json,consumed_at) VALUES(?,?,?,?,?)",
          )
          .run(
            proof.nonceDigest,
            hostedDigest(subject),
            hostedDigest(discovery),
            JSON.stringify(proof),
            proof.consumedAt,
          );
        const receipts = new Map<
          string,
          { receiptId: string; kind: "TERMS" | "DATA_PROCESSING" }
        >();
        for (const choice of choices) {
          const question = discovery.questions.find((value) => value.id === choice.questionId);
          const kind = question && nonFactualConsentKind(question);
          if (!kind || typeof choice.value !== "boolean")
            throw new Error("HOSTED_OWNER_CHOICE_INVALID");
          const id = randomUUID();
          this.sqlite
            .prepare(
              "INSERT INTO hosted_question_choices(id,subject_digest,discovery_digest,question_id,kind,value,nonce_digest,proof_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            )
            .run(
              id,
              hostedDigest(subject),
              hostedDigest(discovery),
              choice.questionId,
              kind,
              Number(choice.value),
              proof.nonceDigest,
              JSON.stringify(proof),
              this.now().toISOString(),
            );
          receipts.set(choice.questionId, { receiptId: id, kind });
        }
        return receipts;
      })
      .immediate();
  }
  async admitArtifacts(packet: ApplicationPacket, mapping: HostedMapping) {
    const admitted = [];
    for (const entry of mapping)
      if (entry.kind === "DOCUMENT") {
        const document = packet.documents.find((value) => value.id === entry.documentId);
        const row = this.sqlite
          .prepare(
            "SELECT d.local_path AS path,d.file_name AS fileName,d.content_digest AS digest,d.format,d.stale,d.job_version_id AS jobVersionId,d.profile_version_id AS profileVersionId FROM document_artifacts d JOIN document_approvals a ON a.document_artifact_id=d.id AND a.content_digest=d.content_digest AND a.invalidated_at IS NULL WHERE d.id=?",
          )
          .get(entry.documentId) as
          | {
              path: string;
              fileName: string;
              digest: string;
              format: string;
              stale: number;
              jobVersionId: string;
              profileVersionId: string;
            }
          | undefined;
        if (
          !document ||
          !row ||
          row.format !== "PDF" ||
          row.stale ||
          row.digest !== document.digest ||
          row.fileName !== document.fileName ||
          row.jobVersionId !== packet.jobVersionId ||
          row.profileVersionId !== packet.profileVersionId
        )
          throw new Error("HOSTED_APPROVED_DOCUMENT_REQUIRED");
        admitted.push(
          await admitHostedPdf({
            documentId: document.id,
            path: resolve(row.path),
            approvedRoot: this.options.approvedArtifactRoot,
            expectedDigest: document.digest,
            fileName: document.fileName,
          }),
        );
      }
    return admitted;
  }
  claim(id: string, operation: HostedOperation, runtimeId: string, build: HostedBuild): string {
    return this.sqlite
      .transaction(() => {
        const session = this.getSession(id);
        this.assertCapability(session.capability, build);
        this.resolvePacket(session.capability);
        const row = this.row(id);
        if (
          row.runtimeId !== runtimeId ||
          !row.disclosureConsentId ||
          expectedPrevious[operation] !== row.state
        )
          throw new Error("HOSTED_OPERATION_SEQUENCE_INVALID");
        const idClaim = randomUUID();
        this.sqlite
          .prepare(
            "INSERT INTO hosted_operation_claims(id,session_id,operation,state,capability_digest,runtime_id,claimed_at) VALUES(?,?,?,'CLAIMED',?,?,?)",
          )
          .run(
            idClaim,
            id,
            operation,
            hostedCapabilityDigest(session.capability),
            runtimeId,
            this.now().toISOString(),
          );
        this.audit(id, "HOSTED_OPERATION_CLAIMED", {
          operation,
          claimId: idClaim,
          mode: session.capability.mode,
        });
        return idClaim;
      })
      .immediate();
  }
  complete(
    id: string,
    claimId: string,
    state: HostedSessionState,
    evidence: {
      mapping?: HostedMapping;
      proofs?: HostedUploadProof[];
      preview?: HostedPreview;
      confirmationDigest?: string | null;
      safeStopCode?: string | null;
    } = {},
  ): void {
    this.sqlite
      .transaction(() => {
        const claim = this.sqlite
          .prepare(
            "SELECT operation,capability_digest AS digest FROM hosted_operation_claims WHERE id=? AND session_id=? AND state='CLAIMED'",
          )
          .get(claimId, id) as { operation: HostedOperation; digest: string } | undefined;
        const session = this.getSession(id);
        if (
          state === "CONFIRMED_SUBMITTED" &&
          (!evidence.confirmationDigest || !/^[a-f0-9]{64}$/.test(evidence.confirmationDigest))
        )
          throw new Error("HOSTED_CONFIRMATION_UNPROVEN");
        if (
          !claim ||
          claim.digest !== hostedCapabilityDigest(session.capability) ||
          (claim.operation === "SUBMIT"
            ? !["CONFIRMED_SUBMITTED", "CONFIRMED_NOT_SUBMITTED", "OUTCOME_UNKNOWN"].includes(state)
            : expectedNext[claim.operation] !== state)
        )
          throw new Error("HOSTED_OPERATION_COMPLETION_INVALID");
        const mapping = evidence.mapping
          ? HostedMappingSchema.parse(evidence.mapping)
          : session.mapping;
        if (
          evidence.mapping &&
          (!session.form ||
            !session.discovery ||
            hostedDigest(mapping) !==
              hostedDigest(
                hostedMapping(
                  this.resolvePacket(session.capability),
                  session.form,
                  session.discovery,
                ),
              ))
        )
          throw new Error("HOSTED_MAPPING_CHANGED");
        const proofs = evidence.proofs ? proofsSchema.parse(evidence.proofs) : session.proofs;
        const preview = evidence.preview
          ? HostedPreviewSchema.parse(evidence.preview)
          : session.preview;
        if (
          state === "REVIEW_READY" &&
          (!preview ||
            preview.sessionId !== id ||
            preview.capabilityDigest !== hostedCapabilityDigest(session.capability) ||
            preview.packetDigest !== packetDigest(this.resolvePacket(session.capability)) ||
            preview.formDigest !== hostedDigest(session.form) ||
            preview.mappingDigest !== hostedDigest(mapping) ||
            preview.uploadsDigest !== hostedDigest(proofs))
        )
          throw new Error("HOSTED_FINAL_PREVIEW_CHANGED");
        this.sqlite
          .prepare("UPDATE hosted_operation_claims SET state=?,completed_at=? WHERE id=?")
          .run(
            state === "OUTCOME_UNKNOWN" ? "OUTCOME_UNKNOWN" : "COMPLETE",
            this.now().toISOString(),
            claimId,
          );
        this.sqlite
          .prepare(
            "UPDATE hosted_browser_sessions SET state=?,mapping_json=?,proofs_json=?,preview_json=?,updated_at=? WHERE id=?",
          )
          .run(
            state,
            JSON.stringify(mapping),
            JSON.stringify(proofs),
            preview ? JSON.stringify(preview) : null,
            this.now().toISOString(),
            id,
          );
        if (claim.operation === "SUBMIT")
          this.sqlite
            .prepare(
              "UPDATE hosted_browser_sessions SET confirmation_digest=?,safe_stop_code=? WHERE id=?",
            )
            .run(
              evidence.confirmationDigest ?? null,
              evidence.safeStopCode && /^HOSTED_[A-Z_]{1,70}$/.test(evidence.safeStopCode)
                ? evidence.safeStopCode
                : null,
              id,
            );
        if (["CONFIRMED_SUBMITTED", "CONFIRMED_NOT_SUBMITTED", "OUTCOME_UNKNOWN"].includes(state))
          this.sqlite
            .prepare(
              "UPDATE hosted_capability_versions SET revoked_at=? WHERE id=? AND revoked_at IS NULL",
            )
            .run(this.now().toISOString(), this.row(id).capId);
        this.audit(id, "HOSTED_OPERATION_COMPLETE", {
          operation: claim.operation,
          claimId,
          state,
          mode: session.capability.mode,
          previewDigest: preview ? hostedDigest(preview) : null,
        });
      })
      .immediate();
  }
  recordRequest(id: string): void {
    this.sqlite
      .transaction(() => {
        const session = this.getSession(id);
        this.assertCapability(session.capability, this.options.reviewedBuild!);
        if (session.capability.scope === "APPLICATION") this.resolvePacket(session.capability);
        if (
          ["CONFIRMED_SUBMITTED", "CONFIRMED_NOT_SUBMITTED", "OUTCOME_UNKNOWN", "STOPPED"].includes(
            session.state,
          ) ||
          session.requestCount >= session.capability.requestBudget
        )
          throw new Error("HOSTED_REQUEST_BUDGET_EXHAUSTED");
        this.sqlite
          .prepare(
            "UPDATE hosted_browser_sessions SET request_count=request_count+1,updated_at=? WHERE id=?",
          )
          .run(this.now().toISOString(), id);
      })
      .immediate();
  }
  authorizeSubmit(
    id: string,
    proof: HostedOwnerProof,
    runtimeId: string,
    build: HostedBuild,
  ): string {
    return this.sqlite
      .transaction(() => {
        const session = this.getSession(id);
        const cap = session.capability;
        this.assertCapability(cap, build);
        this.resolvePacket(cap);
        if (
          session.state !== "REVIEW_READY" ||
          session.runtimeId !== runtimeId ||
          !session.preview ||
          this.now().getTime() - Date.parse(session.preview.preparedAt) > 5 * 60_000
        )
          throw new Error("HOSTED_FINAL_PREVIEW_REQUIRED");
        const claimId = this.claim(id, "SUBMIT", runtimeId, build);
        const consentId = this.ownerConsent(
          cap,
          "SUBMIT",
          proof,
          id,
          hostedDigest(session.preview),
        );
        const binding = hostedDigest({
          sessionId: id,
          capabilityDigest: hostedCapabilityDigest(cap),
          previewDigest: hostedDigest(session.preview),
          build,
          disclosureDigest: hostedDigest(HOSTED_DISCLOSURE),
        });
        this.sqlite
          .prepare(
            "INSERT INTO hosted_final_consents(id,session_id,owner_consent_id,preview_digest,binding_digest,expires_at,consumed_at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            id,
            consentId,
            hostedDigest(session.preview),
            binding,
            new Date(this.now().getTime() + 60_000).toISOString(),
            this.now().toISOString(),
          );
        this.sqlite
          .prepare(
            "INSERT INTO hosted_submit_guards(mode,provider,region,tenant,external_id,session_id,claim_id,activated_at) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            cap.mode,
            cap.subject.provider,
            cap.subject.region,
            cap.subject.tenant,
            cap.subject.externalId,
            id,
            claimId,
            this.now().toISOString(),
          );
        this.audit(id, "HOSTED_SUBMIT_ACTIVATION_GUARDED", {
          claimId,
          consentId,
          mode: cap.mode,
          binding,
        });
        return claimId;
      })
      .immediate();
  }
  stop(id: string, safeCode: string, outcomeUnknown: boolean): void {
    if (!/^HOSTED_[A-Z_]{1,70}$/.test(safeCode)) safeCode = "HOSTED_OPERATION_STOPPED";
    const claims = this.sqlite
      .prepare(
        "SELECT operation FROM hosted_operation_claims WHERE session_id=? AND state='CLAIMED'",
      )
      .all(id) as { operation: string }[];
    const unknown =
      outcomeUnknown ||
      claims.some((value) => ["FILL", "UPLOAD", "SUBMIT"].includes(value.operation));
    const state = unknown ? "OUTCOME_UNKNOWN" : "STOPPED";
    const update = () => {
      this.sqlite
        .prepare(
          "UPDATE hosted_operation_claims SET state=?,completed_at=? WHERE session_id=? AND state='CLAIMED'",
        )
        .run(state, this.now().toISOString(), id);
      this.sqlite
        .prepare(
          "UPDATE hosted_browser_sessions SET state=?,safe_stop_code=?,updated_at=? WHERE id=? AND state NOT IN ('CONFIRMED_SUBMITTED','CONFIRMED_NOT_SUBMITTED','OUTCOME_UNKNOWN','STOPPED')",
        )
        .run(state, safeCode, this.now().toISOString(), id);
      this.sqlite
        .prepare(
          "UPDATE hosted_capability_versions SET revoked_at=? WHERE id=? AND revoked_at IS NULL",
        )
        .run(this.now().toISOString(), this.row(id).capId);
    };
    try {
      this.sqlite
        .transaction(() => {
          update();
          this.audit(id, "HOSTED_SESSION_STOPPED", { state, safeCode });
        })
        .immediate();
    } catch {
      safeCode = "HOSTED_AUDIT_PERSISTENCE_FAILED";
      this.sqlite.transaction(update).immediate();
      throw new Error(safeCode);
    }
  }
  recoverLostContexts(runtimeId: string): { stopped: number; outcomeUnknown: number } {
    const rows = this.sqlite
      .prepare(
        "SELECT id FROM hosted_browser_sessions WHERE runtime_id<>? AND state NOT IN ('CONFIRMED_SUBMITTED','CONFIRMED_NOT_SUBMITTED','OUTCOME_UNKNOWN','STOPPED')",
      )
      .all(runtimeId) as { id: string }[];
    let stopped = 0;
    let outcomeUnknown = 0;
    for (const row of rows) {
      this.stop(row.id, "HOSTED_CONTEXT_LOST", false);
      if (this.row(row.id).state === "OUTCOME_UNKNOWN") outcomeUnknown++;
      else stopped++;
    }
    return { stopped, outcomeUnknown };
  }
  listSessions(): HostedSession[] {
    return (
      this.sqlite
        .prepare("SELECT id FROM hosted_browser_sessions ORDER BY rowid DESC LIMIT 100")
        .all() as { id: string }[]
    ).map((row) => this.getSession(row.id));
  }
  listCapabilities(): HostedCapability[] {
    return (
      this.sqlite
        .prepare(
          "SELECT id FROM hosted_capability_versions WHERE id IN (SELECT id FROM hosted_capability_versions h WHERE version=(SELECT max(version) FROM hosted_capability_versions WHERE capability_id=h.capability_id)) ORDER BY rowid DESC LIMIT 100",
        )
        .all() as { id: string }[]
    ).map((row) => this.readCapability(row.id));
  }
  private audit(entityId: string, action: string, metadata: Record<string, unknown>): void {
    this.sqlite
      .prepare(
        "INSERT INTO audit_events(id,event_type,actor,entity_type,entity_id,redacted_metadata_json,occurred_at) VALUES(?,?,'LOCAL_USER','HOSTED_APPLICATION',?,?,?)",
      )
      .run(randomUUID(), action, entityId, JSON.stringify(metadata), this.now().toISOString());
  }
}
