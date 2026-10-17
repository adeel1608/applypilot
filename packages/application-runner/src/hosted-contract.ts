import { createHash } from "node:crypto";
import { z } from "zod";
import { PacketQuestionGroupSchema, type ApplicationPacket } from "./beta";

export const HOSTED_ADAPTER_VERSION = "hosted-native-v1" as const;
export const HOSTED_DISCLOSURE =
  "Employer page scripts can receive the approved values and files during fill or upload, before final submission. Final submission requires a separate confirmation.";
export const HostedOperationSchema = z.enum([
  "OPEN_AND_INSPECT_ONLY",
  "MAP_FOR_FILL",
  "FILL",
  "UPLOAD",
  "VERIFY",
  "FILL_PREVIEW",
  "SUBMIT",
]);
export type HostedOperation = z.infer<typeof HostedOperationSchema>;
export const HostedSubjectSchema = z
  .object({
    provider: z.enum(["GREENHOUSE", "LEVER"]),
    tenant: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    region: z.enum(["GLOBAL", "EU"]),
    externalId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    jobId: z.string().min(1).max(200),
    jobVersionId: z.string().min(1).max(200),
    profileVersionId: z.string().min(1).max(200),
    verificationId: z.string().min(1).max(200),
    sourceRunId: z.string().min(1).max(200),
    sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    targetUrl: z.url(),
  })
  .strict()
  .superRefine((subject, context) => {
    const url = new URL(subject.targetUrl);
    const hosts =
      subject.provider === "GREENHOUSE"
        ? ["boards.greenhouse.io", "job-boards.greenhouse.io"]
        : [subject.region === "EU" ? "jobs.eu.lever.co" : "jobs.lever.co"];
    const path =
      subject.provider === "GREENHOUSE"
        ? `/${subject.tenant}/jobs/${subject.externalId}`
        : `/${subject.tenant}/${subject.externalId}/apply`;
    if (
      url.protocol !== "https:" ||
      !hosts.includes(url.hostname) ||
      url.pathname !== path ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      (subject.provider === "GREENHOUSE" && subject.region !== "GLOBAL")
    )
      context.addIssue({ code: "custom", message: "HOSTED_SUBJECT_BOUNDARY_INVALID" });
  });
export type HostedSubject = z.infer<typeof HostedSubjectSchema>;

const ExactDestinationSchema = z
  .object({ origin: z.url(), path: z.string().startsWith("/").max(500) })
  .strict()
  .superRefine((value, context) => {
    const url = new URL(value.origin);
    if (
      url.protocol !== "https:" ||
      url.origin !== value.origin ||
      url.username ||
      url.password ||
      url.port ||
      !/^\/[A-Za-z0-9/_.-]*$/.test(value.path) ||
      value.path.includes("..") ||
      value.path.includes("//")
    )
      context.addIssue({ code: "custom", message: "HOSTED_DESTINATION_INVALID" });
  });
export const HostedBuildSchema = z
  .object({
    head: z.string().regex(/^[a-f0-9]{40}$/),
    tree: z.string().regex(/^[a-f0-9]{40}$/),
    buildDigest: z.string().regex(/^[a-f0-9]{64}$/),
    adapterVersion: z.literal(HOSTED_ADAPTER_VERSION),
  })
  .strict();
export type HostedBuild = z.infer<typeof HostedBuildSchema>;
export const HostedCapabilitySchema = z
  .object({
    schemaVersion: z.literal(1),
    capabilityId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/),
    version: z.number().int().positive(),
    predecessorVersion: z.number().int().positive().nullable(),
    mode: z.enum(["REAL", "FICTIONAL"]),
    scriptPolicy: z.literal("NATIVE_SCRIPT_DISABLED"),
    subject: HostedSubjectSchema,
    scope: z.enum(["PASSIVE_INSPECTION", "APPLICATION"]),
    packetId: z.string().min(1).max(200).nullable(),
    packetDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    formDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    discoveryDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    build: HostedBuildSchema,
    policyReference: z.string().regex(/^[A-Za-z0-9._:-]{3,100}$/),
    policyReviewedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    allowedReads: z.array(ExactDestinationSchema).min(1).max(20),
    allowedWrites: z
      .array(
        ExactDestinationSchema.extend({
          operation: z.enum(["UPLOAD", "SUBMIT"]),
          method: z.literal("POST"),
          acknowledgement: z.enum([
            "NATIVE_INPUT_ONLY",
            "SHA256_JSON_ACK",
            "PROVIDER_CONFIRMATION",
          ]),
        }).strict(),
      )
      .max(2),
    confirmation: ExactDestinationSchema.extend({
      selector: z.string().regex(/^#[A-Za-z][A-Za-z0-9_-]{0,99}$/),
      expectedText: z.string().min(1).max(200),
    })
      .strict()
      .nullable(),
    requestBudget: z.number().int().min(1).max(30),
    responseByteLimit: z.number().int().min(1000).max(5_000_000),
    requestTimeoutMs: z.number().int().min(100).max(30_000),
    sessionTimeoutMs: z.number().int().min(1000).max(3_600_000),
    remoteUploadProofRequired: z.boolean(),
  })
  .strict()
  .superRefine((capability, context) => {
    const app = capability.scope === "APPLICATION";
    if (
      (capability.version === 1) !== (capability.predecessorVersion === null) ||
      (capability.version > 1 && capability.predecessorVersion !== capability.version - 1)
    )
      context.addIssue({ code: "custom", message: "HOSTED_CAPABILITY_SEQUENCE_INVALID" });
    if (
      app !==
      Boolean(
        capability.packetId &&
          capability.packetDigest &&
          capability.formDigest &&
          capability.discoveryDigest,
      )
    )
      context.addIssue({ code: "custom", message: "HOSTED_PACKET_BINDING_INVALID" });
    if (
      !app &&
      (capability.packetId ||
        capability.packetDigest ||
        capability.formDigest ||
        capability.discoveryDigest ||
        capability.allowedWrites.length ||
        capability.confirmation ||
        capability.remoteUploadProofRequired)
    )
      context.addIssue({ code: "custom", message: "PASSIVE_CAPABILITY_HAS_WRITE_AUTHORITY" });
    const target = new URL(capability.subject.targetUrl);
    if (
      !capability.allowedReads.some(
        (destination) =>
          destination.origin === target.origin && destination.path === target.pathname,
      )
    )
      context.addIssue({ code: "custom", message: "HOSTED_INITIAL_READ_REQUIRED" });
    if (
      new Set(capability.allowedReads.map((value) => `${value.origin}${value.path}`)).size !==
        capability.allowedReads.length ||
      new Set(capability.allowedWrites.map((value) => value.operation)).size !==
        capability.allowedWrites.length
    )
      context.addIssue({ code: "custom", message: "HOSTED_DESTINATION_DUPLICATE" });
    if (
      app &&
      (!capability.allowedWrites.some(
        (value) =>
          value.operation === "SUBMIT" && value.acknowledgement === "PROVIDER_CONFIRMATION",
      ) ||
        !capability.confirmation)
    )
      context.addIssue({ code: "custom", message: "HOSTED_SUBMIT_CONFIRMATION_CONTRACT_REQUIRED" });
    if (Date.parse(capability.expiresAt) <= Date.parse(capability.createdAt))
      context.addIssue({ code: "custom", message: "HOSTED_CAPABILITY_TIME_INVALID" });
    // An exact CDN read may be reviewed, but upload/submit storage never uses a wildcard.
    for (const write of capability.allowedWrites)
      if (
        !new Set([
          "boards.greenhouse.io",
          "job-boards.greenhouse.io",
          "jobs.lever.co",
          "jobs.eu.lever.co",
        ]).has(new URL(write.origin).hostname) &&
        write.acknowledgement !== "SHA256_JSON_ACK"
      )
        context.addIssue({ code: "custom", message: "HOSTED_EXTERNAL_UPLOAD_PROOF_REQUIRED" });
  });
export type HostedCapability = z.infer<typeof HostedCapabilitySchema>;
export function hostedDigest(value: unknown): string {
  const canonical = (input: unknown): string =>
    Array.isArray(input)
      ? `[${input.map(canonical).join(",")}]`
      : input && typeof input === "object"
        ? `{${Object.entries(input)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
            .join(",")}}`
        : JSON.stringify(input);
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export const hostedCapabilityDigest = (capability: HostedCapability) =>
  hostedDigest(HostedCapabilitySchema.parse(capability));

export const HostedControlSchema = z
  .object({
    index: z.number().int().min(0).max(199),
    name: z.string().max(200),
    label: z.string().max(500),
    type: z.enum([
      "text",
      "email",
      "tel",
      "url",
      "number",
      "textarea",
      "select",
      "checkbox",
      "radio",
      "file",
      "submit",
      "hidden",
    ]),
    required: z.boolean(),
    options: z
      .array(z.object({ value: z.string().max(200), label: z.string().max(500) }).strict())
      .max(100),
    accept: z.string().max(500),
    constraintsDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type HostedControl = z.infer<typeof HostedControlSchema>;
export const HostedFormSchema = z
  .object({
    targetUrl: z.url(),
    action: z.url(),
    method: z.literal("POST"),
    encoding: z.enum(["application/x-www-form-urlencoded", "multipart/form-data"]),
    controls: z.array(HostedControlSchema).min(1).max(200),
  })
  .strict();
export type HostedForm = z.infer<typeof HostedFormSchema>;
export const HostedQuestionDiscoverySchema = z
  .object({
    version: z.literal("hosted-questions-v1"),
    subjectDigest: z.string().regex(/^[a-f0-9]{64}$/),
    complete: z.boolean(),
    origin: z.enum(["SOURCE_DETAIL", "PASSIVE_FORM"]),
    questions: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            label: z.string().min(1).max(500),
            controlName: z.string().min(1).max(200),
            required: z.boolean(),
            type: z.enum([
              "text",
              "email",
              "tel",
              "url",
              "number",
              "textarea",
              "select",
              "checkbox",
              "radio",
            ]),
            options: z
              .array(z.object({ value: z.string().max(200), label: z.string().max(500) }).strict())
              .max(100),
          })
          .strict(),
      )
      .max(200),
    groups: z.array(PacketQuestionGroupSchema).max(100),
    documentControls: z
      .array(
        z
          .object({
            name: z.string().min(1).max(200),
            documentType: z.enum(["CV", "COVER_LETTER"]),
          })
          .strict(),
      )
      .max(10),
    safeBlockers: z
      .array(
        z.enum([
          "QUESTION_CONTRACT_MISSING",
          "QUESTION_SCHEMA_CHANGED",
          "QUESTION_TYPE_UNSUPPORTED",
          "DOCUMENT_FIELD_UNKNOWN",
          "QUESTION_DUPLICATE",
        ]),
      )
      .max(5),
  })
  .strict();
export type HostedQuestionDiscovery = z.infer<typeof HostedQuestionDiscoverySchema>;

export const HostedMappingSchema = z
  .array(
    z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("ANSWER"),
          controlIndex: z.number().int().min(0).max(199),
          questionId: z.string().min(1).max(200),
        })
        .strict(),
      z
        .object({
          kind: z.literal("DOCUMENT"),
          controlIndex: z.number().int().min(0).max(199),
          documentId: z.string().min(1).max(200),
        })
        .strict(),
    ]),
  )
  .max(200);
export type HostedMapping = z.infer<typeof HostedMappingSchema>;
export const HostedPreviewSchema = z
  .object({
    sessionId: z.uuid(),
    capabilityDigest: z.string().regex(/^[a-f0-9]{64}$/),
    packetDigest: z.string().regex(/^[a-f0-9]{64}$/),
    formDigest: z.string().regex(/^[a-f0-9]{64}$/),
    mappingDigest: z.string().regex(/^[a-f0-9]{64}$/),
    valuesDigest: z.string().regex(/^[a-f0-9]{64}$/),
    uploadsDigest: z.string().regex(/^[a-f0-9]{64}$/),
    documentDigests: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(20),
    materialDiffCount: z.literal(0),
    preparedAt: z.iso.datetime(),
  })
  .strict();
export type HostedPreview = z.infer<typeof HostedPreviewSchema>;
export type HostedUploadProof = {
  documentId: string;
  digest: string;
  byteLength: number;
  proof: "LOCAL_ATTACHED" | "REMOTE_BYTES_VERIFIED";
  acknowledgementId: string | null;
};
export type HostedVerifiedArtifact = {
  documentId: string;
  digest: string;
  fileName: string;
  mimeType: "application/pdf";
  bytes: Uint8Array;
};
export interface HostedApplicationDriver {
  readonly adapterVersion: typeof HOSTED_ADAPTER_VERSION;
  inspect(capability: HostedCapability): Promise<HostedForm>;
  map(
    capability: HostedCapability,
    packet: ApplicationPacket,
    mapping: HostedMapping,
  ): Promise<void>;
  fill(packet: ApplicationPacket, mapping: HostedMapping): Promise<void>;
  upload(
    artifacts: readonly HostedVerifiedArtifact[],
    mapping: HostedMapping,
  ): Promise<HostedUploadProof[]>;
  verify(
    packet: ApplicationPacket,
    mapping: HostedMapping,
    proofs: readonly HostedUploadProof[],
  ): Promise<{ valuesDigest: string; uploadsDigest: string }>;
  submit(): Promise<{
    state: "CONFIRMED_SUBMITTED" | "OUTCOME_UNKNOWN";
    confirmationDigest: string | null;
    safeStopCode: string | null;
  }>;
  close(): Promise<void>;
}
