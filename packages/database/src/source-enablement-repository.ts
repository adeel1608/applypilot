import { createHash, randomUUID } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";
import {
  SourceCapabilityV2Schema,
  SourceOwnerActionSchema,
  SourceOwnerReceiptStateSchema,
  SourceProviderDriftDiagnosticSchema,
  SourceRecordUnusableDiagnosticSchema,
  runLeverDetailSourceDiscovery,
  runLeverSourceDiscovery,
  runGreenhouseDetailSourceDiscovery,
  runGreenhouseSourceDiscovery,
  sourceCapabilityDigest,
  sourceCapabilityReadiness,
  SourceSchemaDiagnosticSchema,
  SourcePersistenceDiagnosticSchema,
  SourceStopCodeSchema,
  SourceTransportLifecycleStageSchema,
  validateSourceAuditMetadata,
  type LeverPageV2,
  type LeverPostingRecordV2,
  type LeverDetailSourceRunResult,
  type GreenhouseDetailV2,
  type GreenhousePageV2,
  type GreenhousePostingRecordV2,
  type GreenhouseSourceRunSink,
  type SourceCapabilityV2,
  type SourceRunBudget,
  type SourceRunSink,
  type SourceOwnerReceiptChain,
  type SourceOperation,
  type SourceSchemaDiagnostic,
  type SourcePersistenceDiagnostic,
  type SourcePersistencePhase,
  type SourceTransportLifecycleStage,
  type SecureSourceTransportDependencies,
  SourcePersistenceError,
  createSourcePersistenceDiagnostic,
} from "@applypilot/job-sources";
import {
  readGreenhousePostingV2FromPayload,
  readLeverPostingV2FromPayload,
} from "@applypilot/job-sources";
import {
  ParsedJobFieldsSchema,
  normalizeR2AJobEvidence,
  serializeR2AStructuredSource,
} from "@applypilot/job-importer";
import {
  JobSchema,
  R2A_NORMALIZATION_VERSION,
  R2A_PARSER_VERSION,
  assertR2ASourcePointers,
  type Job,
  type R2ANormalization,
} from "@applypilot/job-model";
import { ObservationIdentitySchema, type ObservationIdentity } from "@applypilot/job-normalizer";

import { normalizeImportedJob } from "./job-import-repository";
import { BetaRepository, immutableR2ADerivationDigest } from "./beta-repository";
import { R2ARepository } from "./r2a-repository";
import { R2Repository } from "./r2-repository";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function ownerConfirmationDigestsMatch(
  capabilityId: string,
  approvalConfirmationDigest: string,
  startConfirmationDigest: string,
): boolean {
  const combinedDigest = sha256(`APPROVE AND RUN ${capabilityId}`);
  return (
    (approvalConfirmationDigest === sha256(`APPROVE ${capabilityId}`) &&
      startConfirmationDigest === sha256(`RUN ${capabilityId}`)) ||
    (approvalConfirmationDigest === combinedDigest && startConfirmationDigest === combinedDigest)
  );
}

const SOURCE_OWNER_START_RECEIPT_TTL_MS = 5 * 60 * 1000;

interface PersistenceContext {
  phase: SourcePersistencePhase;
  recordIndex: number | null;
  externalId: string | null;
  provider: "LEVER" | "GREENHOUSE";
  pageProviderRecordCount: number;
  acceptedRecordCount: number;
  unusableRecordCount: number;
}

export interface SourceOwnerActionGateProof {
  action: "SOURCE_CAPABILITY_APPROVE" | "SOURCE_RUN_START";
  consumedAt: string;
  loopbackValidated: true;
  localSessionValidated: true;
  nonceConsumed: true;
}

export type SourceOwnerApprovalStatus =
  | "MIGRATION_REQUIRED"
  | "APPROVAL_REQUIRED"
  | "CURRENT"
  | "CONSUMED"
  | "EXPIRED"
  | "REVOKED"
  | "SUPERSEDED";

export interface SourceOwnerApprovalStatusResult {
  state: SourceOwnerApprovalStatus;
  receiptId: string | null;
  canStart: boolean;
}

function detailPageDigest(
  externalId: string,
  record: LeverPostingRecordV2 | GreenhousePostingRecordV2,
): string {
  return sha256(`GET_JOB\n${externalId}\n${record.externalId}\n${record.contentDigest}`);
}

function employmentType(
  value: string | null,
): "CASUAL" | "PART_TIME" | "FULL_TIME" | "CONTRACT" | "INTERNSHIP" | "UNKNOWN" {
  if (!value) return "UNKNOWN";
  if (/part[ -]?time/i.test(value)) return "PART_TIME";
  if (/full[ -]?time/i.test(value)) return "FULL_TIME";
  if (/casual/i.test(value)) return "CASUAL";
  if (/intern/i.test(value)) return "INTERNSHIP";
  if (/contract|temporary|fixed[ -]?term/i.test(value)) return "CONTRACT";
  return "UNKNOWN";
}

function structuredLeverRecord(
  record: LeverPostingRecordV2,
  capability: SourceCapabilityV2,
): Record<string, unknown> {
  const locations = record.allLocations.length
    ? record.allLocations
    : record.location
      ? [record.location]
      : [];
  const sections = record.sections.map(({ heading, content, kind }) => ({
    heading,
    content,
    kind,
  }));
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    identifier: { name: capability.tenant, value: record.externalId },
    title: record.title,
    hiringOrganization: { name: capability.alias },
    jobLocation: locations.map((location) => ({ address: location })),
    employmentType: record.commitment,
    description: record.description,
    datePosted: record.postedAt,
    jobLocationType: record.workplaceType,
    baseSalary: record.salaryRange
      ? {
          currency: record.salaryRange.currency,
          value: {
            minValue: record.salaryRange.min,
            maxValue: record.salaryRange.max,
            unitText: record.salaryRange.interval,
          },
        }
      : null,
    sourceUrl: record.sourceUrl,
    applicationUrl: record.applicationUrl,
    department: record.department,
    team: record.team,
    country: record.country,
    sourceSections: sections,
    requirementTexts: evidenceLines(record, "REQUIREMENTS"),
    responsibilities: evidenceLines(record, "RESPONSIBILITIES"),
    benefitTexts: sections.filter(({ kind }) => kind === "BENEFITS").map(({ content }) => content),
  };
}

export function structuredGreenhouseRecord(
  record: GreenhousePostingRecordV2,
  capability: SourceCapabilityV2,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    identifier: { name: capability.tenant, value: record.externalId },
    title: record.title,
    hiringOrganization: { name: capability.alias },
    jobLocation: [{ address: record.location }],
    description: record.description,
    datePosted: null,
    dateModified: record.updatedAt,
    sourceUrl: record.sourceUrl,
    applicationUrl: record.applicationUrl,
    departments: record.departments,
    offices: record.offices,
    providerMetadata: record.metadata,
  };
}

/** Opaque provider fields remain in rawPayload and are not R2A evidence inputs. */
export function structuredGreenhouseEvidenceRecord(
  record: GreenhousePostingRecordV2,
  capability: SourceCapabilityV2,
): Record<string, unknown> {
  const evidenceRecord = structuredGreenhouseRecord(record, capability);
  delete evidenceRecord.departments;
  delete evidenceRecord.offices;
  delete evidenceRecord.providerMetadata;
  return evidenceRecord;
}

const evidenceChunkLength = 500;

function boundedEvidenceChunks(value: string): string[] {
  const chunks: string[] = [];
  let remainder = value.trim();
  while (remainder) {
    if (remainder.length <= evidenceChunkLength) {
      chunks.push(remainder);
      break;
    }
    let end = evidenceChunkLength;
    if (/^[\uDC00-\uDFFF]$/.test(remainder[end] ?? "")) end -= 1;
    const candidate = remainder.slice(0, end);
    const trailingWord = candidate.search(/\s+\S*$/);
    const splitAt = trailingWord >= evidenceChunkLength / 2 ? trailingWord : end;
    const chunk = remainder.slice(0, splitAt).trim();
    if (chunk) chunks.push(chunk);
    remainder = remainder.slice(splitAt).trimStart();
  }
  return chunks;
}

function evidenceLines(record: LeverPostingRecordV2, kind: "REQUIREMENTS" | "RESPONSIBILITIES") {
  return record.sections
    .filter((section) => section.kind === kind)
    .flatMap(({ content }) => content.split("\n"))
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap(boundedEvidenceChunks)
    .slice(0, 500)
    .map((line) => line.slice(0, evidenceChunkLength));
}

export interface PersistedSourcePageResult {
  createdJobIds: string[];
  duplicateObservationCount: number;
}

export interface R2ADerivationResult {
  verificationId: string;
  sourceObservationId: string;
  parentJobVersionId: string;
  derivedJobVersionId: string;
  parserVersion: string;
  normalizationVersion: string;
  derivationDigest: string;
  created: boolean;
}

/**
 * Ephemeral reconstruction from immutable source bytes. This is intentionally
 * not a QualifiedVerificationEvidence and has no persistence/authority fields.
 */
export interface PersistedSourceInspection {
  readonly marker: "PAGE_PERSISTED_INSPECTION_ONLY";
  readonly inspectionOnly: true;
  readonly verificationId: string;
  readonly runId: string;
  readonly source: "LEVER";
  readonly tenant: string;
  readonly externalId: string;
  readonly capabilityId: string;
  readonly capabilityVersion: number;
  readonly capabilityDigest: string;
  readonly sourceObservationId: string;
  readonly jobId: string;
  readonly parentJobVersionId: string;
  readonly sourceQualificationState: "PAGE_PERSISTED";
  readonly sourceRunStatus: "STOPPED";
  readonly sourceStopCode: "RUN_TIMEOUT";
  readonly verifiedAt: string;
  readonly providerDriftWarnings: readonly {
    readonly issueCategory: "PROVIDER_ENUM_DRIFT";
    readonly field: "workplaceType";
    readonly expectedStructuralType: "enum";
    readonly recordIndex: number;
  }[];
  readonly job: Job;
  readonly normalization: R2ANormalization;
}

export class SourceEnablementRepository implements SourceRunSink, GreenhouseSourceRunSink {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
    private readonly hooks: {
      beforeQualification?: (runId: string) => void;
      beforePersistencePhase?: (phase: SourcePersistencePhase, recordIndex: number | null) => void;
    } = {},
  ) {}

  private setPersistencePhase(
    context: PersistenceContext,
    phase: SourcePersistencePhase,
    recordIndex: number | null,
    externalId: string | null,
  ): void {
    context.phase = phase;
    context.recordIndex = recordIndex;
    context.externalId = externalId;
    this.hooks.beforePersistencePhase?.(phase, recordIndex);
  }

  private persistenceFailure(error: unknown, context: PersistenceContext): SourcePersistenceError {
    return new SourcePersistenceError(
      createSourcePersistenceDiagnostic({
        phase: context.phase,
        recordIndex: context.recordIndex,
        externalId: context.externalId,
        provider: context.provider,
        error,
        pageProviderRecordCount: context.pageProviderRecordCount,
        acceptedRecordCount: context.acceptedRecordCount,
        unusableRecordCount: context.unusableRecordCount,
      }),
    );
  }

  available(): boolean {
    return Boolean(
      this.sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_capability_versions'",
        )
        .get(),
    );
  }

  ownerActionReceiptSchemaAvailable(): boolean {
    return this.hasOwnerReceiptSchema();
  }

  /**
   * Re-derive current local R2A evidence from one immutable, already persisted
   * Lever payload. This path is transport-free and never creates a provider
   * verification row or mutates historical observations/job versions.
   */
  rederiveLeverObservation(input: { verificationId: string; now?: string }): R2ADerivationResult {
    return this.rederiveSourceObservation(input, "LEVER");
  }

  rederiveGreenhouseObservation(input: {
    verificationId: string;
    now?: string;
  }): R2ADerivationResult {
    return this.rederiveSourceObservation(input, "GREENHOUSE");
  }

  /** Provider-neutral immutable-payload rederivation, transport-free. */
  private rederiveSourceObservation(
    input: { verificationId: string; now?: string },
    expectedSource: "LEVER" | "GREENHOUSE",
  ): R2ADerivationResult {
    const bindingTable = Boolean(
      this.sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_derivation_bindings'",
        )
        .get(),
    );
    if (!bindingTable) throw new Error("R2A_DERIVATION_SCHEMA_REQUIRED");
    const row = this.sqlite
      .prepare(
        [
          "SELECT v.id AS verificationId,v.job_version_id AS parentJobVersionId,",
          "v.source_observation_id AS sourceObservationId,v.content_hash AS contentHash,",
          "v.source,v.tenant,v.external_id AS externalId,v.disposition,",
          "v.qualification_state AS qualificationState,o.job_id AS jobId,o.run_id AS observationRunId,",
          "o.content_hash AS observationContentHash,o.source AS observationSource,o.tenant AS observationTenant,",
          "o.external_id AS observationExternalId,p.payload_json AS payloadJson,p.content_digest AS payloadDigest,",
          "c.capability_id AS capabilityId,c.version,",
          "c.source AS capabilitySource,c.alias,c.tenant AS capabilityTenant,c.region,",
          "c.allowed_host AS allowedHost,c.allowed_path_prefix AS allowedPathPrefix,",
          "c.allowed_operations_json AS allowedOperationsJson,c.approval_state AS approvalState,",
          "c.approval_reference AS approvalReference,c.approved_at AS approvedAt,",
          "c.policy_version AS policyVersion,c.policy_reviewed_at AS policyReviewedAt,",
          "c.policy_expires_at AS policyExpiresAt,c.capability_expires_at AS capabilityExpiresAt,",
          "c.request_budget AS requestBudget,c.record_cap AS recordCap,c.page_size_cap AS pageSizeCap,",
          "c.response_byte_limit AS responseByteLimit,c.request_timeout_ms AS requestTimeoutMs,",
          "c.run_timeout_ms AS runTimeoutMs,c.max_redirects AS maxRedirects,c.max_retries AS maxRetries,",
          "c.max_concurrency AS maxConcurrency,c.parser_version AS sourceParserVersion,",
          "c.created_at AS capabilityCreatedAt,",
          "c.revoked_at AS revokedAt,c.revocation_reason AS revocationReason",
          "FROM source_record_verifications v",
          "JOIN source_observations o ON o.id=v.source_observation_id",
          "JOIN source_observation_payloads p ON p.observation_id=o.id",
          "JOIN source_capability_versions c ON c.id=v.capability_version_id",
          "WHERE v.id=?",
        ].join(" "),
      )
      .get(input.verificationId) as
      | (Record<string, unknown> & {
          verificationId: string;
          parentJobVersionId: string;
          sourceObservationId: string;
          contentHash: string;
          source: string;
          tenant: string | null;
          externalId: string | null;
          disposition: string;
          qualificationState: string;
          jobId: string;
          observationRunId: string | null;
          observationContentHash: string;
          observationSource: string;
          observationTenant: string | null;
          observationExternalId: string | null;
          payloadJson: string;
          payloadDigest: string;
          capabilityId: string;
          version: number;
          capabilitySource: string;
          alias: string;
          capabilityTenant: string;
          region: string;
          allowedHost: string;
          allowedPathPrefix: string;
          allowedOperationsJson: string;
          approvalState: string;
          approvalReference: string | null;
          approvedAt: string | null;
          policyVersion: string;
          policyReviewedAt: string;
          policyExpiresAt: string;
          capabilityExpiresAt: string;
          requestBudget: number;
          recordCap: number;
          pageSizeCap: number;
          responseByteLimit: number;
          requestTimeoutMs: number;
          runTimeoutMs: number;
          maxRedirects: number;
          maxRetries: number;
          maxConcurrency: number;
          sourceParserVersion: string;
          capabilityCreatedAt: string;
          revokedAt: string | null;
          revocationReason: string | null;
        })
      | undefined;
    if (!row) throw new Error("R2A_VERIFICATION_NOT_FOUND");
    if (row.source !== expectedSource) throw new Error("R2A_SOURCE_REDERIVATION_MISMATCH");
    if (row.disposition !== "ACCEPTED" || row.qualificationState !== "QUALIFIED") {
      throw new Error("R2A_VERIFICATION_NOT_QUALIFIED");
    }
    if (
      !row.observationRunId ||
      row.source !== row.observationSource ||
      row.tenant !== row.observationTenant ||
      row.externalId !== row.observationExternalId ||
      row.contentHash !== row.observationContentHash ||
      row.payloadDigest !== row.observationContentHash ||
      (expectedSource === "LEVER" && sha256(row.payloadJson) !== row.payloadDigest)
    ) {
      throw new Error("R2A_IMMUTABLE_PAYLOAD_IDENTITY_MISMATCH");
    }
    const qualified = new BetaRepository(this.sqlite, this.now).getLatestQualifiedVerification(
      row.jobId,
      row.parentJobVersionId,
    );
    if (!qualified || qualified.verificationId !== row.verificationId) {
      throw new Error("R2A_VERIFICATION_NOT_CURRENT");
    }
    const capability = SourceCapabilityV2Schema.parse({
      schemaVersion: 2,
      capabilityId: row.capabilityId,
      version: row.version,
      predecessorVersion: null,
      source: row.capabilitySource,
      alias: row.alias,
      tenant: row.capabilityTenant,
      region: row.region,
      allowedHost: row.allowedHost,
      allowedPathPrefix: row.allowedPathPrefix,
      allowedOperations: JSON.parse(row.allowedOperationsJson),
      approvalState: row.approvalState,
      approvalReference: row.approvalReference,
      approvedAt: row.approvedAt,
      policyVersion: row.policyVersion,
      policyReviewedAt: row.policyReviewedAt,
      policyExpiresAt: row.policyExpiresAt,
      capabilityExpiresAt: row.capabilityExpiresAt,
      requestBudget: row.requestBudget,
      recordCap: row.recordCap,
      pageSizeCap: row.pageSizeCap,
      responseByteLimit: row.responseByteLimit,
      requestTimeoutMs: row.requestTimeoutMs,
      runTimeoutMs: row.runTimeoutMs,
      maxRedirects: row.maxRedirects,
      maxRetries: row.maxRetries,
      maxConcurrency: row.maxConcurrency,
      parserVersion: row.sourceParserVersion,
      createdAt: row.capabilityCreatedAt,
      updatedAt: row.capabilityCreatedAt,
      revokedAt: row.revokedAt,
      revocationReason: row.revocationReason,
    });
    if (capability.source !== expectedSource || capability.tenant !== row.tenant) {
      throw new Error("R2A_REDERIVED_RECORD_IDENTITY_MISMATCH");
    }
    const record =
      expectedSource === "GREENHOUSE"
        ? readGreenhousePostingV2FromPayload({
            payload: JSON.parse(row.payloadJson),
            capability,
          })
        : readLeverPostingV2FromPayload({
            payload: JSON.parse(row.payloadJson),
            capability,
          });
    if (record.externalId !== row.externalId || record.contentDigest !== row.contentHash) {
      throw new Error("R2A_REDERIVED_RECORD_IDENTITY_MISMATCH");
    }
    const existing = this.sqlite
      .prepare(
        "SELECT source_observation_id AS sourceObservationId,parent_job_version_id AS parentJobVersionId,derived_job_version_id AS derivedJobVersionId,derivation_digest AS derivationDigest FROM source_derivation_bindings WHERE verification_id=? AND source_observation_id=? AND parser_version=? AND normalization_version=?",
      )
      .get(
        row.verificationId,
        row.sourceObservationId,
        R2A_PARSER_VERSION,
        R2A_NORMALIZATION_VERSION,
      ) as
      | {
          sourceObservationId: string;
          parentJobVersionId: string;
          derivedJobVersionId: string;
          derivationDigest: string;
        }
      | undefined;
    if (existing) {
      const expected = immutableR2ADerivationDigest({
        verificationId: row.verificationId,
        sourceObservationId: row.sourceObservationId,
        contentHash: row.contentHash,
        parentJobVersionId: row.parentJobVersionId,
        derivedJobVersionId: existing.derivedJobVersionId,
        parserVersion: R2A_PARSER_VERSION,
        normalizationVersion: R2A_NORMALIZATION_VERSION,
      });
      if (
        existing.sourceObservationId !== row.sourceObservationId ||
        existing.parentJobVersionId !== row.parentJobVersionId ||
        existing.derivationDigest !== expected
      ) {
        throw new Error("R2A_DERIVATION_BINDING_CONFLICT");
      }
      return {
        verificationId: row.verificationId,
        sourceObservationId: row.sourceObservationId,
        parentJobVersionId: row.parentJobVersionId,
        derivedJobVersionId: existing.derivedJobVersionId,
        parserVersion: R2A_PARSER_VERSION,
        normalizationVersion: R2A_NORMALIZATION_VERSION,
        derivationDigest: expected,
        created: false,
      };
    }
    const isLever = record.source === "LEVER";
    const location = isLever
      ? (record.location ?? record.allLocations[0] ?? null)
      : record.location;
    if (!location || !record.description.trim())
      throw new Error("SOURCE_RECORD_REQUIRED_FIELD_MISSING");
    const structured = isLever
      ? structuredLeverRecord(record, capability)
      : structuredGreenhouseRecord(record, capability);
    const r2aStructured = isLever
      ? structured
      : structuredGreenhouseEvidenceRecord(record, capability);
    const fields = ParsedJobFieldsSchema.parse({
      externalId: record.externalId,
      sourceUrl: record.sourceUrl,
      applicationUrl: record.applicationUrl,
      requisitionId: null,
      title: record.title,
      company: capability.alias,
      location,
      category: isLever
        ? ([record.department, record.team].find(
            (value): value is string => typeof value === "string" && value.length <= 128 * 1_024,
          ) ?? null)
        : null,
      description: record.description,
      salaryText: null,
      employmentType: isLever ? employmentType(record.commitment) : "UNKNOWN",
      requirements: isLever ? evidenceLines(record, "REQUIREMENTS") : [],
      responsibilities: isLever ? evidenceLines(record, "RESPONSIBILITIES") : [],
      datePosted: isLever ? record.postedAt : null,
      coverLetterRequired: null,
    });
    const job = normalizeImportedJob(
      fields,
      record.source,
      {
        importId: "R2A_REDERIVATION:" + row.verificationId,
        recordId: row.sourceObservationId,
        parserVersion: capability.parserVersion,
        acquisitionMethod: "APPROVED_SOURCE_FETCH",
        contentHash: record.contentDigest,
        now: input.now ?? this.now().toISOString(),
        editedFields: [],
      },
      row.jobId,
    );
    const normalization = normalizeR2AJobEvidence({
      sourceText: serializeR2AStructuredSource(r2aStructured),
      sourceObservationId: row.sourceObservationId,
      structured: r2aStructured,
      diagnosticStructure: structured,
      explicitLocation: location,
    });
    const derived = new BetaRepository(this.sqlite, this.now).recordJobVersion({
      job,
      sourceObservationId: row.sourceObservationId,
      r2aNormalization: normalization,
    });
    const derivationDigest = immutableR2ADerivationDigest({
      verificationId: row.verificationId,
      sourceObservationId: row.sourceObservationId,
      contentHash: row.contentHash,
      parentJobVersionId: row.parentJobVersionId,
      derivedJobVersionId: derived.id,
      parserVersion: R2A_PARSER_VERSION,
      normalizationVersion: R2A_NORMALIZATION_VERSION,
    });
    this.sqlite
      .prepare(
        "INSERT INTO source_derivation_bindings (id,verification_id,source_observation_id,content_hash,parent_job_version_id,derived_job_version_id,parser_version,normalization_version,derivation_digest,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "r2a-derivation-" + sha256(derivationDigest).slice(0, 32),
        row.verificationId,
        row.sourceObservationId,
        row.contentHash,
        row.parentJobVersionId,
        derived.id,
        R2A_PARSER_VERSION,
        R2A_NORMALIZATION_VERSION,
        derivationDigest,
        input.now ?? this.now().toISOString(),
      );
    return {
      verificationId: row.verificationId,
      sourceObservationId: row.sourceObservationId,
      parentJobVersionId: row.parentJobVersionId,
      derivedJobVersionId: derived.id,
      parserVersion: R2A_PARSER_VERSION,
      normalizationVersion: R2A_NORMALIZATION_VERSION,
      derivationDigest,
      created: derived.created,
    };
  }

  /**
   * Reconstruct current R2A evidence for exactly one accepted page-persisted
   * Lever record from a safely stopped, owner-bound run. This method is
   * inspection-only: it issues SELECT statements and invokes pure parsers; it
   * never changes qualification, source history, normalization, evaluation,
   * queue, packet, or authority state.
   */
  inspectPersistedLeverVerification(input: { verificationId: string }): PersistedSourceInspection {
    const row = this.sqlite
      .prepare(
        `SELECT v.id AS verificationId,v.run_id AS runId,v.capability_version_id AS capabilityVersionId,
                v.page_id AS pageId,v.source,v.tenant,v.external_id AS externalId,
                v.record_index AS recordIndex,v.page_digest AS pageDigest,v.content_hash AS contentHash,
                v.source_observation_id AS sourceObservationId,v.job_version_id AS parentJobVersionId,
                v.disposition,v.qualification_state AS qualificationState,v.parser_version AS parserVersion,
                v.policy_version AS verificationPolicyVersion,v.verified_at AS verifiedAt,
                r.status AS runStatus,r.safe_error_code AS stopCode,r.operation AS operation,
                r.capability_version_id AS runCapabilityVersionId,r.capability_digest AS runCapabilityDigest,
                p.page_number AS pageNumber,p.page_digest AS persistedPageDigest,p.record_count AS pageRecordCount,
                o.id AS observationId,o.job_id AS observationJobId,o.run_id AS observationRunId,
                o.source AS observationSource,o.tenant AS observationTenant,o.external_id AS observationExternalId,
                o.content_hash AS observationContentHash,o.parser_version AS observationParserVersion,
                o.policy_version AS observationPolicyVersion,
                payload.payload_json AS payloadJson,payload.content_digest AS payloadDigest,
                jv.id AS jobVersionId,jv.job_id AS jobVersionJobId,
                jv.source_observation_id AS jobVersionObservationId,jv.content_digest AS jobVersionContentDigest
         FROM source_record_verifications v
         JOIN source_run_checkpoints r ON r.id=v.run_id
         JOIN source_run_pages p ON p.id=v.page_id AND p.run_id=v.run_id
         JOIN source_capability_versions c ON c.id=v.capability_version_id
         JOIN source_observations o ON o.id=v.source_observation_id
         JOIN source_observation_payloads payload ON payload.observation_id=o.id
         JOIN job_versions jv ON jv.id=v.job_version_id
         WHERE v.id=?`,
      )
      .get(input.verificationId) as
      | {
          verificationId: string;
          runId: string;
          capabilityVersionId: string;
          pageId: string;
          source: string;
          tenant: string | null;
          externalId: string | null;
          recordIndex: number;
          pageDigest: string;
          contentHash: string | null;
          sourceObservationId: string | null;
          parentJobVersionId: string | null;
          disposition: string;
          qualificationState: string;
          parserVersion: string;
          verificationPolicyVersion: string | null;
          verifiedAt: string;
          runStatus: string;
          stopCode: string | null;
          operation: string;
          runCapabilityVersionId: string;
          runCapabilityDigest: string;
          pageNumber: number;
          persistedPageDigest: string;
          pageRecordCount: number;
          observationId: string;
          observationJobId: string;
          observationRunId: string | null;
          observationSource: string;
          observationTenant: string | null;
          observationExternalId: string | null;
          observationContentHash: string;
          observationParserVersion: string;
          observationPolicyVersion: string | null;
          payloadJson: string;
          payloadDigest: string;
          jobVersionId: string;
          jobVersionJobId: string;
          jobVersionObservationId: string | null;
          jobVersionContentDigest: string;
        }
      | undefined;
    if (!row) throw new Error("STOPPED_RUN_INSPECTION_VERIFICATION_NOT_FOUND");
    if (
      row.disposition !== "ACCEPTED" ||
      row.qualificationState !== "PAGE_PERSISTED" ||
      row.source !== "LEVER" ||
      !row.tenant ||
      !row.externalId ||
      !row.sourceObservationId ||
      !row.parentJobVersionId
    ) {
      throw new Error("STOPPED_RUN_INSPECTION_VERIFICATION_STATE_NOT_ALLOWED");
    }
    if (row.runStatus !== "STOPPED" || row.stopCode !== "RUN_TIMEOUT") {
      throw new Error("STOPPED_RUN_INSPECTION_RUN_NOT_ALLOWED");
    }
    if (this.getRunOwnerProvenance(row.runId) !== "OWNER_RECEIPTS_BOUND") {
      throw new Error("STOPPED_RUN_INSPECTION_OWNER_PROVENANCE_REQUIRED");
    }
    if (
      row.runCapabilityVersionId !== row.capabilityVersionId ||
      row.runCapabilityDigest.length !== 64 ||
      row.pageDigest !== row.persistedPageDigest ||
      row.recordIndex < 0 ||
      row.recordIndex >= row.pageRecordCount
    ) {
      throw new Error("STOPPED_RUN_INSPECTION_PAGE_OR_RUN_BINDING_MISMATCH");
    }
    if (
      row.observationId !== row.sourceObservationId ||
      row.observationRunId !== row.runId ||
      row.source !== row.observationSource ||
      row.tenant !== row.observationTenant ||
      row.externalId !== row.observationExternalId ||
      row.contentHash !== row.observationContentHash ||
      row.contentHash !== row.payloadDigest ||
      row.parentJobVersionId !== row.jobVersionId ||
      row.jobVersionJobId !== row.observationJobId ||
      row.jobVersionObservationId !== row.sourceObservationId ||
      row.jobVersionContentDigest !== row.contentHash ||
      sha256(row.payloadJson) !== row.payloadDigest
    ) {
      throw new Error("STOPPED_RUN_INSPECTION_IMMUTABLE_IDENTITY_MISMATCH");
    }

    const capabilityRow = this.sqlite
      .prepare(
        `SELECT c.id,c.capability_id AS capabilityId,c.version,c.predecessor_id AS predecessorId,
                predecessor.version AS predecessorVersion,c.source,c.alias,c.tenant,c.region,
                c.allowed_host AS allowedHost,c.allowed_path_prefix AS allowedPathPrefix,
                c.allowed_operations_json AS allowedOperationsJson,c.approval_state AS approvalState,
                c.approval_reference AS approvalReference,c.approved_at AS approvedAt,
                c.policy_version AS policyVersion,c.policy_reviewed_at AS policyReviewedAt,
                c.policy_expires_at AS policyExpiresAt,c.capability_expires_at AS capabilityExpiresAt,
                c.request_budget AS requestBudget,c.record_cap AS recordCap,c.page_size_cap AS pageSizeCap,
                c.response_byte_limit AS responseByteLimit,c.request_timeout_ms AS requestTimeoutMs,
                c.run_timeout_ms AS runTimeoutMs,c.max_redirects AS maxRedirects,c.max_retries AS maxRetries,
                c.max_concurrency AS maxConcurrency,c.parser_version AS capabilityParserVersion,
                c.configuration_digest AS configurationDigest,c.created_at AS createdAt,
                c.revoked_at AS revokedAt,c.revocation_reason AS revocationReason
         FROM source_capability_versions c
         LEFT JOIN source_capability_versions predecessor ON predecessor.id=c.predecessor_id
         WHERE c.id=?`,
      )
      .get(row.capabilityVersionId) as
      | {
          id: string;
          capabilityId: string;
          version: number;
          predecessorId: string | null;
          predecessorVersion: number | null;
          source: string;
          alias: string;
          tenant: string;
          region: string;
          allowedHost: string;
          allowedPathPrefix: string;
          allowedOperationsJson: string;
          approvalState: string;
          approvalReference: string | null;
          approvedAt: string | null;
          policyVersion: string;
          policyReviewedAt: string;
          policyExpiresAt: string;
          capabilityExpiresAt: string;
          requestBudget: number;
          recordCap: number;
          pageSizeCap: number;
          responseByteLimit: number;
          requestTimeoutMs: number;
          runTimeoutMs: number;
          maxRedirects: number;
          maxRetries: number;
          maxConcurrency: number;
          capabilityParserVersion: string;
          configurationDigest: string;
          createdAt: string;
          revokedAt: string | null;
          revocationReason: string | null;
        }
      | undefined;
    if (!capabilityRow) throw new Error("STOPPED_RUN_INSPECTION_CAPABILITY_NOT_FOUND");
    let capability: SourceCapabilityV2;
    try {
      capability = SourceCapabilityV2Schema.parse({
        schemaVersion: 2,
        capabilityId: capabilityRow.capabilityId,
        version: capabilityRow.version,
        predecessorVersion: capabilityRow.predecessorVersion,
        source: capabilityRow.source,
        alias: capabilityRow.alias,
        tenant: capabilityRow.tenant,
        region: capabilityRow.region,
        allowedHost: capabilityRow.allowedHost,
        allowedPathPrefix: capabilityRow.allowedPathPrefix,
        allowedOperations: JSON.parse(capabilityRow.allowedOperationsJson) as unknown,
        approvalState: capabilityRow.approvalState,
        approvalReference: capabilityRow.approvalReference,
        approvedAt: capabilityRow.approvedAt,
        policyVersion: capabilityRow.policyVersion,
        policyReviewedAt: capabilityRow.policyReviewedAt,
        policyExpiresAt: capabilityRow.policyExpiresAt,
        capabilityExpiresAt: capabilityRow.capabilityExpiresAt,
        requestBudget: capabilityRow.requestBudget,
        recordCap: capabilityRow.recordCap,
        pageSizeCap: capabilityRow.pageSizeCap,
        responseByteLimit: capabilityRow.responseByteLimit,
        requestTimeoutMs: capabilityRow.requestTimeoutMs,
        runTimeoutMs: capabilityRow.runTimeoutMs,
        maxRedirects: capabilityRow.maxRedirects,
        maxRetries: capabilityRow.maxRetries,
        maxConcurrency: capabilityRow.maxConcurrency,
        parserVersion: capabilityRow.capabilityParserVersion,
        createdAt: capabilityRow.createdAt,
        updatedAt: capabilityRow.createdAt,
        revokedAt: capabilityRow.revokedAt,
        revocationReason: capabilityRow.revocationReason,
      });
    } catch {
      throw new Error("STOPPED_RUN_INSPECTION_CAPABILITY_INVALID");
    }
    // The capability digest was calculated from the original validated capability before
    // persistence. The schema stores created_at but does not store updatedAt independently,
    // so recomputing the digest from this reconstructed view can silently change its inputs.
    // Bind the inspection to the persisted digest roots instead: capability version row,
    // run, owner receipts, and owner binding are checked against the same immutable digest.
    const capabilityDigest = capabilityRow.configurationDigest;
    if (
      capabilityRow.id !== row.capabilityVersionId ||
      capabilityRow.source !== "LEVER" ||
      capabilityRow.tenant !== row.tenant ||
      capabilityRow.version < 1 ||
      !/^[a-f0-9]{64}$/.test(capabilityDigest) ||
      row.runCapabilityDigest !== capabilityDigest ||
      row.operation !== "LIST_JOBS" ||
      !capability.allowedOperations.includes(row.operation) ||
      row.parserVersion !== capability.parserVersion ||
      row.verificationPolicyVersion !== capability.policyVersion ||
      row.observationParserVersion !== capability.parserVersion ||
      row.observationPolicyVersion !== capability.policyVersion
    ) {
      throw new Error("STOPPED_RUN_INSPECTION_CAPABILITY_BINDING_MISMATCH");
    }

    const pageRecordCounts = new Map(
      (
        this.sqlite
          .prepare(
            "SELECT page_number AS pageNumber,record_count AS recordCount FROM source_run_pages WHERE run_id=?",
          )
          .all(row.runId) as Array<{ pageNumber: number; recordCount: number }>
      ).map(({ pageNumber, recordCount }) => [pageNumber, recordCount]),
    );
    const auditRows = this.sqlite
      .prepare(
        `SELECT event_type AS eventType,redacted_metadata_json AS metadataJson
         FROM audit_events WHERE entity_type='source_run' AND entity_id=?
           AND event_type IN ('source.page.persisted','source.record.unusable',
             'source.provider.drift','source.run.stopped')
         ORDER BY rowid`,
      )
      .all(row.runId) as Array<{ eventType: string; metadataJson: string }>;
    let auditedPageNumber: number | null = null;
    let stoppedAuditCount = 0;
    const auditedProviderDrift: Array<{
      issueCategory: "PROVIDER_ENUM_DRIFT";
      field: "workplaceType";
      expectedStructuralType: "enum";
      recordIndex: number;
    }> = [];
    for (const audit of auditRows) {
      let metadata: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(audit.metadataJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        metadata = parsed as Record<string, unknown>;
      } catch {
        throw new Error("STOPPED_RUN_INSPECTION_AUDIT_INVALID");
      }
      if (audit.eventType === "source.page.persisted") {
        const pageNumber = metadata.pageNumber;
        if (
          typeof pageNumber !== "number" ||
          !Number.isInteger(pageNumber) ||
          !pageRecordCounts.has(pageNumber)
        ) {
          throw new Error("STOPPED_RUN_INSPECTION_AUDIT_PAGE_MISMATCH");
        }
        auditedPageNumber = pageNumber;
      } else if (audit.eventType === "source.run.stopped") {
        stoppedAuditCount += 1;
        if (metadata.code !== "RUN_TIMEOUT" || metadata.schemaDiagnostic !== undefined) {
          throw new Error("STOPPED_RUN_INSPECTION_SCHEMA_OR_STOP_DIAGNOSTIC");
        }
      } else if (audit.eventType === "source.record.unusable") {
        const diagnostic = SourceRecordUnusableDiagnosticSchema.safeParse(metadata);
        if (!diagnostic.success || auditedPageNumber === null) {
          throw new Error("STOPPED_RUN_INSPECTION_AUDIT_INVALID");
        }
        const pageCount = pageRecordCounts.get(auditedPageNumber);
        if (diagnostic.data.recordIndex >= (pageCount ?? 0)) {
          throw new Error("STOPPED_RUN_INSPECTION_AUDIT_INDEX_OUT_OF_RANGE");
        }
        if (
          auditedPageNumber === row.pageNumber &&
          diagnostic.data.recordIndex === row.recordIndex
        ) {
          throw new Error("STOPPED_RUN_INSPECTION_ACCEPTED_UNUSABLE_CONFLICT");
        }
      } else if (audit.eventType === "source.provider.drift") {
        const diagnostic = SourceProviderDriftDiagnosticSchema.safeParse(metadata);
        if (!diagnostic.success || auditedPageNumber === null) {
          throw new Error("STOPPED_RUN_INSPECTION_AUDIT_INVALID");
        }
        const pageCount = pageRecordCounts.get(auditedPageNumber);
        if (
          diagnostic.data.recordIndex === undefined ||
          diagnostic.data.recordIndex >= (pageCount ?? 0)
        ) {
          throw new Error("STOPPED_RUN_INSPECTION_UNSCOPED_PROVIDER_DRIFT");
        }
        if (
          auditedPageNumber === row.pageNumber &&
          diagnostic.data.recordIndex === row.recordIndex
        ) {
          auditedProviderDrift.push({ ...diagnostic.data, recordIndex: row.recordIndex });
        }
      }
    }
    if (stoppedAuditCount !== 1) throw new Error("STOPPED_RUN_INSPECTION_STOP_AUDIT_REQUIRED");

    let payload: unknown;
    try {
      payload = JSON.parse(row.payloadJson) as unknown;
    } catch {
      throw new Error("STOPPED_RUN_INSPECTION_PAYLOAD_INVALID");
    }
    let record: LeverPostingRecordV2;
    try {
      record = readLeverPostingV2FromPayload({ payload, capability });
    } catch {
      throw new Error("STOPPED_RUN_INSPECTION_REPARSE_FAILED");
    }
    const observedDrift = [...record.providerDriftDiagnostics]
      .map(({ issueCategory, field, expectedStructuralType }) => ({
        issueCategory,
        field,
        expectedStructuralType,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const auditedDrift = [...auditedProviderDrift]
      .map(({ issueCategory, field, expectedStructuralType }) => ({
        issueCategory,
        field,
        expectedStructuralType,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (
      record.externalId !== row.externalId ||
      record.contentDigest !== row.contentHash ||
      JSON.stringify(observedDrift) !== JSON.stringify(auditedDrift) ||
      record.providerDriftDiagnostics.some(
        (diagnostic) =>
          diagnostic.issueCategory !== "PROVIDER_ENUM_DRIFT" ||
          diagnostic.field !== "workplaceType" ||
          diagnostic.expectedStructuralType !== "enum" ||
          diagnostic.recordIndex !== 0,
      )
    ) {
      throw new Error("STOPPED_RUN_INSPECTION_REPARSED_IDENTITY_OR_DRIFT_MISMATCH");
    }
    const identity = `${record.source}\n${record.region}\n${record.tenant}\n${record.externalId}`;
    const expectedJobId = `source-job-${sha256(identity).slice(0, 32)}`;
    if (expectedJobId !== row.jobVersionJobId || row.observationJobId !== expectedJobId) {
      throw new Error("STOPPED_RUN_INSPECTION_OBSERVATION_JOB_MISMATCH");
    }
    const location = record.location ?? record.allLocations[0] ?? null;
    if (!location || !record.description.trim()) {
      throw new Error("STOPPED_RUN_INSPECTION_REQUIRED_SOURCE_FIELD_MISSING");
    }
    const structured = structuredLeverRecord(record, capability);
    const fields = ParsedJobFieldsSchema.parse({
      externalId: record.externalId,
      sourceUrl: record.sourceUrl,
      applicationUrl: record.applicationUrl,
      requisitionId: null,
      title: record.title,
      company: capability.alias,
      location,
      category:
        [record.department, record.team].find(
          (value): value is string => typeof value === "string" && value.length <= 128 * 1_024,
        ) ?? null,
      description: record.description,
      salaryText: null,
      employmentType: employmentType(record.commitment),
      requirements: evidenceLines(record, "REQUIREMENTS"),
      responsibilities: evidenceLines(record, "RESPONSIBILITIES"),
      datePosted: record.postedAt,
      coverLetterRequired: null,
    });
    const job = normalizeImportedJob(
      fields,
      "LEVER",
      {
        importId: `INSPECTION_ONLY:${row.verificationId}`,
        recordId: row.sourceObservationId,
        parserVersion: capability.parserVersion,
        acquisitionMethod: "APPROVED_SOURCE_FETCH",
        contentHash: record.contentDigest,
        now: row.verifiedAt,
        editedFields: [],
      },
      row.jobVersionJobId,
    );
    const sourceText = serializeR2AStructuredSource(structured);
    const normalization = normalizeR2AJobEvidence({
      sourceText,
      sourceObservationId: row.sourceObservationId,
      structured,
      explicitLocation: location,
    });
    assertR2ASourcePointers(normalization, sourceText);
    const allPointers = [
      ...normalization.fieldEvidence.map(({ source }) => source),
      ...normalization.requirementEvidence.map(({ source }) => source),
      ...normalization.coverage.flatMap(({ unparsedSpans }) => unparsedSpans),
    ];
    if (
      allPointers.some((pointer) => sha256(pointer.excerpt) !== pointer.excerptHash) ||
      normalization.sourceObservationId !== row.sourceObservationId ||
      normalization.parserVersion !== R2A_PARSER_VERSION ||
      normalization.normalizationVersion !== R2A_NORMALIZATION_VERSION
    ) {
      throw new Error("STOPPED_RUN_INSPECTION_R2A_POINTER_OR_VERSION_INVALID");
    }
    return {
      marker: "PAGE_PERSISTED_INSPECTION_ONLY",
      inspectionOnly: true,
      verificationId: row.verificationId,
      runId: row.runId,
      source: "LEVER",
      tenant: row.tenant,
      externalId: row.externalId,
      capabilityId: capability.capabilityId,
      capabilityVersion: capability.version,
      capabilityDigest,
      sourceObservationId: row.sourceObservationId,
      jobId: row.jobVersionJobId,
      parentJobVersionId: row.parentJobVersionId,
      sourceQualificationState: "PAGE_PERSISTED",
      sourceRunStatus: "STOPPED",
      sourceStopCode: "RUN_TIMEOUT",
      verifiedAt: row.verifiedAt,
      providerDriftWarnings: auditedProviderDrift.map(
        ({ issueCategory, field, expectedStructuralType, recordIndex }) => ({
          issueCategory,
          field,
          expectedStructuralType,
          recordIndex,
        }),
      ),
      job: JobSchema.parse(job),
      normalization,
    };
  }

  persistCapabilityVersion(input: SourceCapabilityV2): { id: string; created: boolean } {
    if (!this.available()) throw new Error("SOURCE_V2_SCHEMA_REQUIRED");
    const capability = SourceCapabilityV2Schema.parse(input);
    const digest = sourceCapabilityDigest(capability);
    const existing = this.sqlite
      .prepare(
        `SELECT id, configuration_digest AS digest FROM source_capability_versions
         WHERE capability_id = ? AND version = ?`,
      )
      .get(capability.capabilityId, capability.version) as
      | { id: string; digest: string }
      | undefined;
    if (existing) {
      if (existing.digest !== digest) throw new Error("CAPABILITY_IMMUTABLE_VERSION_CONFLICT");
      return { id: existing.id, created: false };
    }
    const latest = this.sqlite
      .prepare(
        `SELECT id, version FROM source_capability_versions
         WHERE capability_id = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(capability.capabilityId) as { id: string; version: number } | undefined;
    if (
      (latest &&
        (capability.version !== latest.version + 1 ||
          capability.predecessorVersion !== latest.version)) ||
      (!latest && (capability.version !== 1 || capability.predecessorVersion !== null))
    ) {
      throw new Error("CAPABILITY_VERSION_SEQUENCE_INVALID");
    }
    const id = this.id();
    this.sqlite
      .prepare(
        `INSERT INTO source_capability_versions
          (id, capability_id, version, predecessor_id, source, alias, tenant, region,
           allowed_host, allowed_path_prefix, allowed_operations_json, approval_state,
           approval_reference, approved_at, policy_version, policy_reviewed_at, policy_expires_at,
           capability_expires_at, request_budget, record_cap, page_size_cap, response_byte_limit,
           request_timeout_ms, run_timeout_ms, max_redirects, max_retries, max_concurrency,
           parser_version, configuration_digest, revoked_at, revocation_reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        capability.capabilityId,
        capability.version,
        latest?.id ?? null,
        capability.source,
        capability.alias,
        capability.tenant,
        capability.region,
        capability.allowedHost,
        capability.allowedPathPrefix,
        JSON.stringify(capability.allowedOperations),
        capability.approvalState,
        capability.approvalReference,
        capability.approvedAt,
        capability.policyVersion,
        capability.policyReviewedAt,
        capability.policyExpiresAt,
        capability.capabilityExpiresAt,
        capability.requestBudget,
        capability.recordCap,
        capability.pageSizeCap,
        capability.responseByteLimit,
        capability.requestTimeoutMs,
        capability.runTimeoutMs,
        capability.maxRedirects,
        capability.maxRetries,
        capability.maxConcurrency,
        capability.parserVersion,
        digest,
        capability.revokedAt,
        capability.revocationReason,
        this.now().toISOString(),
      );
    const audit = validateSourceAuditMetadata("source.capability.versioned", {
      capabilityId: capability.capabilityId,
      version: capability.version,
      state: capability.approvalState,
    });
    this.audit("source.capability.versioned", "source_capability", capability.capabilityId, audit);
    if (this.hasOwnerReceiptSchema()) {
      const staleReceipts = this.sqlite
        .prepare(
          `SELECT id,action FROM source_owner_action_receipts
           WHERE capability_id=? AND capability_version_id<>? AND state='ACTIVE'`,
        )
        .all(capability.capabilityId, id) as Array<{ id: string; action: "APPROVE" | "START" }>;
      for (const receipt of staleReceipts) {
        this.terminalizeOwnerReceipt(receipt.id, receipt.action, "REVOKED");
      }
    }
    return { id, created: true };
  }

  recordOwnerApprovalReceipt(input: {
    capability: SourceCapabilityV2;
    gateProof: SourceOwnerActionGateProof;
    ownerConfirmed: true;
  }): { id: string; created: true } {
    this.requireOwnerReceiptSchema();
    const capability = SourceCapabilityV2Schema.parse(input.capability);
    if (input.ownerConfirmed !== true) throw new Error("EXACT_OWNER_CONFIRMATION_REQUIRED");
    this.assertGateProof(input.gateProof, "SOURCE_CAPABILITY_APPROVE");
    const now = this.now();
    if (sourceCapabilityReadiness(capability, now).status !== "SOURCE_ENABLED") {
      throw new Error("SOURCE_CAPABILITY_NOT_ENABLED");
    }
    const digest = sourceCapabilityDigest(capability);
    const version = this.assertPersistedCapabilityCurrent(capability, digest);
    const approvalReference = capability.approvalReference;
    if (!approvalReference) throw new Error("SOURCE_APPROVAL_REFERENCE_REQUIRED");
    const timestamp = now.toISOString();
    const receiptId = this.id();
    return this.sqlite
      .transaction(() => {
        const active = this.sqlite
          .prepare(
            `SELECT 1 FROM source_owner_action_receipts
             WHERE capability_version_id=? AND action='APPROVE' AND state='ACTIVE' LIMIT 1`,
          )
          .get(version.id);
        if (active) throw new Error("SOURCE_OWNER_APPROVAL_ALREADY_ACTIVE");
        this.insertOwnerReceipt({
          id: receiptId,
          action: "APPROVE",
          capability,
          capabilityVersionId: version.id,
          capabilityDigest: digest,
          approvalReference,
          operation: null,
          receiptExpiresAt: null,
          confirmationDigest: sha256(`APPROVE ${capability.capabilityId}`),
          nonceAction: "SOURCE_CAPABILITY_APPROVE",
          gateProof: input.gateProof,
          predecessorReceiptId: null,
          state: "ACTIVE",
          consumedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        this.auditOwnerApprovalRecorded(receiptId, capability, digest);
        return { id: receiptId, created: true as const };
      })
      .immediate();
  }

  createOwnerApprovalAndStartReceipt(input: {
    capability: SourceCapabilityV2;
    operation: SourceOperation;
    approvalGateProof: SourceOwnerActionGateProof;
    startGateProof: SourceOwnerActionGateProof;
    confirmationText: string;
    ownerConfirmed: true;
  }): SourceOwnerReceiptChain {
    this.requireOwnerReceiptSchema();
    const capability = SourceCapabilityV2Schema.parse(input.capability);
    const expectedConfirmation = `APPROVE AND RUN ${capability.capabilityId}`;
    if (input.ownerConfirmed !== true || input.confirmationText !== expectedConfirmation) {
      throw new Error("EXACT_OWNER_CONFIRMATION_REQUIRED");
    }
    this.assertGateProof(input.approvalGateProof, "SOURCE_CAPABILITY_APPROVE");
    this.assertGateProof(input.startGateProof, "SOURCE_RUN_START");
    if (!capability.allowedOperations.includes(input.operation)) {
      throw new Error("OPERATION_NOT_APPROVED");
    }

    const now = this.now();
    if (sourceCapabilityReadiness(capability, now).status !== "SOURCE_ENABLED") {
      throw new Error("SOURCE_CAPABILITY_NOT_ENABLED");
    }
    const digest = sourceCapabilityDigest(capability);
    const version = this.assertPersistedCapabilityCurrent(capability, digest);
    const approvalReference = capability.approvalReference;
    if (!approvalReference) throw new Error("SOURCE_APPROVAL_REFERENCE_REQUIRED");

    const timestamp = now.toISOString();
    const approvalReceiptId = this.id();
    const startReceiptId = this.id();
    const receiptExpiresAt = new Date(
      now.getTime() + SOURCE_OWNER_START_RECEIPT_TTL_MS,
    ).toISOString();
    const confirmationDigest = sha256(expectedConfirmation);

    return this.sqlite
      .transaction(() => {
        const current = this.currentCapability(capability.capabilityId);
        if (
          !current ||
          current.id !== version.id ||
          current.version !== capability.version ||
          current.digest !== digest
        ) {
          throw new Error("CAPABILITY_CHANGED");
        }
        const priorOwnerAction = this.sqlite
          .prepare(
            `SELECT 1 FROM source_owner_action_receipts
             WHERE capability_version_id=? LIMIT 1`,
          )
          .get(version.id);
        const priorRun = this.sqlite
          .prepare(`SELECT 1 FROM source_run_checkpoints WHERE capability_version_id=? LIMIT 1`)
          .get(version.id);
        if (priorOwnerAction || priorRun) throw new Error("SOURCE_OWNER_ACTION_ALREADY_RECORDED");

        this.insertOwnerReceipt({
          id: approvalReceiptId,
          action: "APPROVE",
          capability,
          capabilityVersionId: version.id,
          capabilityDigest: digest,
          approvalReference,
          operation: null,
          receiptExpiresAt: null,
          confirmationDigest,
          nonceAction: "SOURCE_CAPABILITY_APPROVE",
          gateProof: input.approvalGateProof,
          predecessorReceiptId: null,
          state: "ACTIVE",
          consumedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        this.auditOwnerApprovalRecorded(approvalReceiptId, capability, digest);

        const consumed = this.sqlite
          .prepare(
            `UPDATE source_owner_action_receipts SET state='CONSUMED',consumed_at=?,updated_at=?
             WHERE id=? AND action='APPROVE' AND state='ACTIVE'`,
          )
          .run(timestamp, timestamp, approvalReceiptId).changes;
        if (consumed !== 1) throw new Error("SOURCE_OWNER_APPROVAL_REPLAYED");

        this.insertOwnerReceipt({
          id: startReceiptId,
          action: "START",
          capability,
          capabilityVersionId: version.id,
          capabilityDigest: digest,
          approvalReference,
          operation: input.operation,
          receiptExpiresAt,
          confirmationDigest,
          nonceAction: "SOURCE_RUN_START",
          gateProof: input.startGateProof,
          predecessorReceiptId: approvalReceiptId,
          state: "ACTIVE",
          consumedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        this.auditOwnerReceiptTerminal(approvalReceiptId, "APPROVE", "CONSUMED");
        const audit = validateSourceAuditMetadata("source.owner.start-recorded", {
          receiptId: startReceiptId,
          approvalReceiptId,
          capabilityId: capability.capabilityId,
          capabilityVersion: capability.version,
          capabilityDigest: digest,
          operation: input.operation,
          state: "ACTIVE",
        });
        this.audit(
          "source.owner.start-recorded",
          "source_owner_action_receipt",
          startReceiptId,
          audit,
        );
        return { approvalReceiptId, startReceiptId };
      })
      .immediate();
  }

  getOwnerApprovalStatus(capabilityInput: SourceCapabilityV2): SourceOwnerApprovalStatusResult {
    if (!this.hasOwnerReceiptSchema()) {
      return { state: "MIGRATION_REQUIRED", receiptId: null, canStart: false };
    }
    const capability = SourceCapabilityV2Schema.parse(capabilityInput);
    const digest = sourceCapabilityDigest(capability);
    const current = this.currentCapability(capability.capabilityId);
    if (!current) return { state: "APPROVAL_REQUIRED", receiptId: null, canStart: false };
    if (current.version !== capability.version || current.digest !== digest) {
      return { state: "SUPERSEDED", receiptId: null, canStart: false };
    }
    const row = this.sqlite
      .prepare(
        `SELECT id,state,capability_digest AS capabilityDigest,
                approval_reference AS approvalReference,source,tenant,
                policy_version AS policyVersion,policy_expires_at AS policyExpiresAt,
                capability_expires_at AS capabilityExpiresAt
         FROM source_owner_action_receipts
         WHERE capability_version_id=? AND action='APPROVE'
         ORDER BY created_at DESC,rowid DESC LIMIT 1`,
      )
      .get(current.id) as
      | {
          id: string;
          state: string;
          capabilityDigest: string;
          approvalReference: string;
          source: string;
          tenant: string;
          policyVersion: string;
          policyExpiresAt: string;
          capabilityExpiresAt: string;
        }
      | undefined;
    if (!row) return { state: "APPROVAL_REQUIRED", receiptId: null, canStart: false };
    if (
      row.capabilityDigest !== digest ||
      row.approvalReference !== capability.approvalReference ||
      row.source !== capability.source ||
      row.tenant !== capability.tenant ||
      row.policyVersion !== capability.policyVersion ||
      row.policyExpiresAt !== capability.policyExpiresAt ||
      row.capabilityExpiresAt !== capability.capabilityExpiresAt
    ) {
      return { state: "SUPERSEDED", receiptId: row.id, canStart: false };
    }
    if (
      Date.parse(row.policyExpiresAt) <= this.now().getTime() ||
      Date.parse(row.capabilityExpiresAt) <= this.now().getTime()
    ) {
      this.terminalizeOwnerReceipt(row.id, "APPROVE", "EXPIRED");
      return { state: "EXPIRED", receiptId: row.id, canStart: false };
    }
    if (row.state === "REVOKED" || row.state === "FAILED") {
      return { state: "REVOKED", receiptId: row.id, canStart: false };
    }
    if (row.state === "CONSUMED") {
      return { state: "CONSUMED", receiptId: row.id, canStart: false };
    }
    if (
      row.state !== "ACTIVE" ||
      sourceCapabilityReadiness(capability, this.now()).status !== "SOURCE_ENABLED"
    ) {
      return { state: "REVOKED", receiptId: row.id, canStart: false };
    }
    return { state: "CURRENT", receiptId: row.id, canStart: true };
  }

  createOwnerStartReceipt(input: {
    capability: SourceCapabilityV2;
    operation: SourceOperation;
    gateProof: SourceOwnerActionGateProof;
    ownerConfirmed: true;
  }): SourceOwnerReceiptChain {
    this.requireOwnerReceiptSchema();
    const capability = SourceCapabilityV2Schema.parse(input.capability);
    if (input.ownerConfirmed !== true) throw new Error("EXACT_OWNER_CONFIRMATION_REQUIRED");
    this.assertGateProof(input.gateProof, "SOURCE_RUN_START");
    if (!capability.allowedOperations.includes(input.operation)) {
      throw new Error("OPERATION_NOT_APPROVED");
    }
    const now = this.now();
    if (sourceCapabilityReadiness(capability, now).status !== "SOURCE_ENABLED") {
      throw new Error("SOURCE_CAPABILITY_NOT_ENABLED");
    }
    const digest = sourceCapabilityDigest(capability);
    const version = this.assertPersistedCapabilityCurrent(capability, digest);
    const approvalStatus = this.getOwnerApprovalStatus(capability);
    if (approvalStatus.state === "EXPIRED" && approvalStatus.receiptId) {
      this.terminalizeOwnerReceipt(approvalStatus.receiptId, "APPROVE", "EXPIRED");
    }
    if (approvalStatus.state !== "CURRENT" || !approvalStatus.receiptId) {
      throw new Error("SOURCE_OWNER_APPROVAL_REQUIRED");
    }
    const approvalReceiptId = approvalStatus.receiptId;
    const startReceiptId = this.id();
    const timestamp = now.toISOString();
    const receiptExpiresAt = new Date(
      now.getTime() + SOURCE_OWNER_START_RECEIPT_TTL_MS,
    ).toISOString();
    return this.sqlite
      .transaction(() => {
        const approval = this.sqlite
          .prepare(
            `SELECT id,state,confirmation_digest AS confirmationDigest,
                    capability_version_id AS capabilityVersionId,
                    capability_digest AS capabilityDigest,approval_reference AS approvalReference,
                    source,tenant,policy_version AS policyVersion,
                    policy_expires_at AS policyExpiresAt,
                    capability_expires_at AS capabilityExpiresAt
             FROM source_owner_action_receipts WHERE id=? AND action='APPROVE'`,
          )
          .get(approvalReceiptId) as
          | {
              id: string;
              state: string;
              confirmationDigest: string;
              capabilityVersionId: string;
              capabilityDigest: string;
              approvalReference: string;
              source: string;
              tenant: string;
              policyVersion: string;
              policyExpiresAt: string;
              capabilityExpiresAt: string;
            }
          | undefined;
        if (
          !approval ||
          approval.state !== "ACTIVE" ||
          approval.capabilityVersionId !== version.id ||
          approval.capabilityDigest !== digest ||
          approval.confirmationDigest !== sha256(`APPROVE ${capability.capabilityId}`) ||
          approval.approvalReference !== capability.approvalReference ||
          approval.source !== capability.source ||
          approval.tenant !== capability.tenant ||
          approval.policyVersion !== capability.policyVersion ||
          approval.policyExpiresAt !== capability.policyExpiresAt ||
          approval.capabilityExpiresAt !== capability.capabilityExpiresAt
        ) {
          throw new Error("SOURCE_OWNER_APPROVAL_STALE");
        }
        const consumed = this.sqlite
          .prepare(
            `UPDATE source_owner_action_receipts SET state='CONSUMED',consumed_at=?,updated_at=?
             WHERE id=? AND action='APPROVE' AND state='ACTIVE'`,
          )
          .run(timestamp, timestamp, approvalReceiptId).changes;
        if (consumed !== 1) throw new Error("SOURCE_OWNER_APPROVAL_REPLAYED");
        this.insertOwnerReceipt({
          id: startReceiptId,
          action: "START",
          capability,
          capabilityVersionId: version.id,
          capabilityDigest: digest,
          approvalReference: capability.approvalReference!,
          operation: input.operation,
          receiptExpiresAt,
          confirmationDigest: sha256(`RUN ${capability.capabilityId}`),
          nonceAction: "SOURCE_RUN_START",
          gateProof: input.gateProof,
          predecessorReceiptId: approvalReceiptId,
          state: "ACTIVE",
          consumedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        this.auditOwnerReceiptTerminal(approvalReceiptId, "APPROVE", "CONSUMED");
        const audit = validateSourceAuditMetadata("source.owner.start-recorded", {
          receiptId: startReceiptId,
          approvalReceiptId,
          capabilityId: capability.capabilityId,
          capabilityVersion: capability.version,
          capabilityDigest: digest,
          operation: input.operation,
          state: "ACTIVE",
        });
        this.audit(
          "source.owner.start-recorded",
          "source_owner_action_receipt",
          startReceiptId,
          audit,
        );
        return { approvalReceiptId, startReceiptId };
      })
      .immediate();
  }

  failOwnerStartReceipt(receiptId: string): void {
    if (!this.hasOwnerReceiptSchema()) return;
    this.sqlite
      .transaction(() => {
        const row = this.sqlite
          .prepare(
            `SELECT 1 FROM source_owner_action_receipts
             WHERE id=? AND action='START' AND state='ACTIVE'`,
          )
          .get(receiptId);
        if (!row) return;
        const binding = this.sqlite
          .prepare("SELECT 1 FROM source_run_owner_bindings WHERE start_receipt_id=? LIMIT 1")
          .get(receiptId);
        if (binding) return;
        const changed = this.sqlite
          .prepare(
            `UPDATE source_owner_action_receipts SET state='FAILED',updated_at=?
             WHERE id=? AND action='START' AND state='ACTIVE'`,
          )
          .run(this.now().toISOString(), receiptId).changes;
        if (changed) this.auditOwnerReceiptTerminal(receiptId, "START", "FAILED");
      })
      .immediate();
  }

  getRunOwnerProvenance(
    runId: string,
  ):
    | "OWNER_RECEIPTS_BOUND"
    | "LEGACY_OWNER_PROVENANCE_UNVERIFIED"
    | "OWNER_RECEIPT_BINDING_INVALID" {
    if (!this.hasOwnerReceiptSchema()) return "LEGACY_OWNER_PROVENANCE_UNVERIFIED";
    const row = this.sqlite
      .prepare(
        `SELECT b.run_id AS runId,b.approval_receipt_id AS approvalReceiptId,
                b.start_receipt_id AS startReceiptId,b.capability_digest AS bindingDigest,
                b.operation AS bindingOperation,r.capability_digest AS runDigest,
                r.operation AS runOperation,c.capability_id AS capabilityId,c.version AS version,
                c.source AS currentSource,c.tenant AS currentTenant,
                a.action AS approvalAction,a.state AS approvalState,
                s.action AS startAction,s.state AS startState,
                s.predecessor_receipt_id AS predecessorReceiptId,
                a.capability_id AS approvalCapabilityId,a.capability_version AS approvalVersion,
                a.capability_digest AS approvalDigest,a.approval_reference AS approvalReference,
                a.source AS approvalSource,a.tenant AS approvalTenant,
                a.policy_version AS approvalPolicyVersion,a.policy_expires_at AS approvalPolicyExpiresAt,
                a.capability_expires_at AS approvalCapabilityExpiresAt,
                a.confirmation_digest AS approvalConfirmationDigest,a.nonce_action AS approvalNonceAction,
                a.loopback_validated AS approvalLoopbackValidated,
                a.local_session_validated AS approvalSessionValidated,
                a.nonce_consumed AS approvalNonceConsumed,a.owner_confirmed AS approvalOwnerConfirmed,
                s.capability_id AS startCapabilityId,s.capability_version AS startVersion,
                s.capability_digest AS startDigest,s.operation AS startOperation,
                s.approval_reference AS startApprovalReference,s.source AS startSource,
                s.tenant AS startTenant,s.policy_version AS startPolicyVersion,
                s.policy_expires_at AS startPolicyExpiresAt,
                s.capability_expires_at AS startCapabilityExpiresAt,
                s.confirmation_digest AS startConfirmationDigest,s.nonce_action AS startNonceAction,
                s.loopback_validated AS startLoopbackValidated,
                s.local_session_validated AS startSessionValidated,
                s.nonce_consumed AS startNonceConsumed,s.owner_confirmed AS startOwnerConfirmed
         FROM source_run_owner_bindings b
         JOIN source_run_checkpoints r ON r.id=b.run_id
         JOIN source_capability_versions c ON c.id=r.capability_version_id
         JOIN source_owner_action_receipts a ON a.id=b.approval_receipt_id
         JOIN source_owner_action_receipts s ON s.id=b.start_receipt_id
         WHERE b.run_id=?`,
      )
      .get(runId) as
      | {
          runId: string;
          approvalReceiptId: string;
          startReceiptId: string;
          bindingDigest: string;
          bindingOperation: string;
          runDigest: string;
          runOperation: string;
          capabilityId: string;
          version: number;
          currentSource: string;
          currentTenant: string;
          approvalAction: string;
          approvalState: string;
          startAction: string;
          startState: string;
          predecessorReceiptId: string;
          approvalCapabilityId: string;
          approvalVersion: number;
          approvalDigest: string;
          approvalReference: string;
          approvalSource: string;
          approvalTenant: string;
          approvalPolicyVersion: string;
          approvalPolicyExpiresAt: string;
          approvalCapabilityExpiresAt: string;
          approvalConfirmationDigest: string;
          approvalNonceAction: string;
          approvalLoopbackValidated: number;
          approvalSessionValidated: number;
          approvalNonceConsumed: number;
          approvalOwnerConfirmed: number;
          startCapabilityId: string;
          startVersion: number;
          startDigest: string;
          startOperation: string;
          startApprovalReference: string;
          startSource: string;
          startTenant: string;
          startPolicyVersion: string;
          startPolicyExpiresAt: string;
          startCapabilityExpiresAt: string;
          startConfirmationDigest: string;
          startNonceAction: string;
          startLoopbackValidated: number;
          startSessionValidated: number;
          startNonceConsumed: number;
          startOwnerConfirmed: number;
        }
      | undefined;
    if (!row) return "LEGACY_OWNER_PROVENANCE_UNVERIFIED";
    const valid =
      row.approvalAction === "APPROVE" &&
      row.approvalState === "CONSUMED" &&
      row.startAction === "START" &&
      row.startState === "CONSUMED" &&
      row.predecessorReceiptId === row.approvalReceiptId &&
      row.capabilityId === row.approvalCapabilityId &&
      row.capabilityId === row.startCapabilityId &&
      row.version === row.approvalVersion &&
      row.version === row.startVersion &&
      row.runDigest === row.bindingDigest &&
      row.runDigest === row.approvalDigest &&
      row.runDigest === row.startDigest &&
      row.approvalReference === row.startApprovalReference &&
      row.approvalReference !== "" &&
      row.approvalSource === row.currentSource &&
      row.startSource === row.currentSource &&
      row.approvalTenant === row.currentTenant &&
      row.startTenant === row.currentTenant &&
      row.approvalPolicyVersion === row.startPolicyVersion &&
      row.approvalPolicyExpiresAt === row.startPolicyExpiresAt &&
      row.approvalCapabilityExpiresAt === row.startCapabilityExpiresAt &&
      ownerConfirmationDigestsMatch(
        row.capabilityId,
        row.approvalConfirmationDigest,
        row.startConfirmationDigest,
      ) &&
      row.approvalNonceAction === "SOURCE_CAPABILITY_APPROVE" &&
      row.startNonceAction === "SOURCE_RUN_START" &&
      row.approvalLoopbackValidated === 1 &&
      row.approvalSessionValidated === 1 &&
      row.approvalNonceConsumed === 1 &&
      row.approvalOwnerConfirmed === 1 &&
      row.startLoopbackValidated === 1 &&
      row.startSessionValidated === 1 &&
      row.startNonceConsumed === 1 &&
      row.startOwnerConfirmed === 1 &&
      row.runOperation === row.bindingOperation &&
      row.runOperation === row.startOperation;
    return valid ? "OWNER_RECEIPTS_BOUND" : "OWNER_RECEIPT_BINDING_INVALID";
  }

  start(input: {
    capability: SourceCapabilityV2;
    capabilityDigest: string;
    operation: SourceOperation;
    startedAt: string;
    ownerApprovalReceiptId: string;
    ownerStartReceiptId: string;
  }): string {
    try {
      this.requireOwnerReceiptSchema();
      const capability = SourceCapabilityV2Schema.parse(input.capability);
      const currentTime = this.now();
      const startedTime = Date.parse(input.startedAt);
      if (!Number.isFinite(startedTime) || Math.abs(startedTime - currentTime.getTime()) > 60_000) {
        throw new Error("SOURCE_RUN_START_TIMESTAMP_INVALID");
      }
      if (!capability.allowedOperations.includes(input.operation)) {
        throw new Error("OPERATION_NOT_APPROVED");
      }
      if (sourceCapabilityReadiness(capability, currentTime).status !== "SOURCE_ENABLED") {
        throw new Error("SOURCE_CAPABILITY_NOT_ENABLED");
      }
      const digest = sourceCapabilityDigest(capability);
      if (digest !== input.capabilityDigest) throw new Error("CAPABILITY_CHANGED");
      const row = this.assertPersistedCapabilityCurrent(capability, digest);
      const runId = this.id();
      return this.sqlite
        .transaction(() => {
          const current = this.currentCapability(capability.capabilityId);
          if (
            !current ||
            current.id !== row.id ||
            current.version !== capability.version ||
            current.digest !== digest
          ) {
            throw new Error("CAPABILITY_CHANGED");
          }
          const receipt = this.sqlite
            .prepare(
              `SELECT s.id AS startReceiptId,s.action AS startAction,s.state AS startState,
                      s.capability_version_id AS startCapabilityVersionId,
                      s.capability_id AS startCapabilityId,s.capability_version AS startVersion,
                      s.capability_digest AS startDigest,s.approval_reference AS startApprovalReference,
                      s.source AS startSource,s.tenant AS startTenant,s.operation AS startOperation,
                      s.policy_version AS startPolicyVersion,s.policy_expires_at AS startPolicyExpiresAt,
                      s.capability_expires_at AS startCapabilityExpiresAt,
                      s.receipt_expires_at AS receiptExpiresAt,s.confirmation_digest AS startConfirmationDigest,
                      s.nonce_action AS startNonceAction,s.loopback_validated AS startLoopbackValidated,
                      s.gate_consumed_at AS startGateConsumedAt,s.created_at AS startCreatedAt,
                      s.local_session_validated AS startSessionValidated,s.nonce_consumed AS startNonceConsumed,
                      s.owner_confirmed AS startOwnerConfirmed,s.predecessor_receipt_id AS predecessorReceiptId,
                      a.id AS approvalReceiptId,a.action AS approvalAction,a.state AS approvalState,
                      a.capability_version_id AS approvalCapabilityVersionId,
                      a.capability_id AS approvalCapabilityId,a.capability_version AS approvalVersion,
                      a.capability_digest AS approvalDigest,a.approval_reference AS approvalReference,
                      a.source AS approvalSource,a.tenant AS approvalTenant,a.operation AS approvalOperation,
                      a.policy_version AS approvalPolicyVersion,a.policy_expires_at AS approvalPolicyExpiresAt,
                      a.capability_expires_at AS approvalCapabilityExpiresAt,
                      a.confirmation_digest AS approvalConfirmationDigest,a.nonce_action AS approvalNonceAction,
                      a.gate_consumed_at AS approvalGateConsumedAt,a.created_at AS approvalCreatedAt,
                      a.loopback_validated AS approvalLoopbackValidated,
                      a.local_session_validated AS approvalSessionValidated,
                      a.nonce_consumed AS approvalNonceConsumed,a.owner_confirmed AS approvalOwnerConfirmed,
                      a.consumed_at AS approvalConsumedAt
               FROM source_owner_action_receipts s
               JOIN source_owner_action_receipts a ON a.id=s.predecessor_receipt_id
               WHERE s.id=? AND a.id=?`,
            )
            .get(input.ownerStartReceiptId, input.ownerApprovalReceiptId) as
            | Record<string, string | number | null>
            | undefined;
          if (!receipt) throw new Error("SOURCE_OWNER_RECEIPT_CHAIN_REQUIRED");
          const receiptExpiresAt = Date.parse(String(receipt.receiptExpiresAt ?? ""));
          const approvalConsumedAt = Date.parse(String(receipt.approvalConsumedAt ?? ""));
          const receiptCreatedAt = Date.parse(String(receipt.startCreatedAt ?? ""));
          const startGateConsumedAt = Date.parse(String(receipt.startGateConsumedAt ?? ""));
          const approvalGateConsumedAt = Date.parse(String(receipt.approvalGateConsumedAt ?? ""));
          const approvalCreatedAt = Date.parse(String(receipt.approvalCreatedAt ?? ""));
          const receiptsMatch =
            receipt.startAction === "START" &&
            receipt.startState === "ACTIVE" &&
            receipt.approvalAction === "APPROVE" &&
            receipt.approvalState === "CONSUMED" &&
            receipt.predecessorReceiptId === input.ownerApprovalReceiptId &&
            receipt.startCapabilityVersionId === row.id &&
            receipt.approvalCapabilityVersionId === row.id &&
            receipt.startCapabilityId === capability.capabilityId &&
            receipt.approvalCapabilityId === capability.capabilityId &&
            receipt.startVersion === capability.version &&
            receipt.approvalVersion === capability.version &&
            receipt.startDigest === digest &&
            receipt.approvalDigest === digest &&
            receipt.startApprovalReference === capability.approvalReference &&
            receipt.approvalReference === capability.approvalReference &&
            receipt.startSource === capability.source &&
            receipt.approvalSource === capability.source &&
            receipt.startTenant === capability.tenant &&
            receipt.approvalTenant === capability.tenant &&
            receipt.startOperation === input.operation &&
            receipt.approvalOperation === null &&
            receipt.startPolicyVersion === capability.policyVersion &&
            receipt.approvalPolicyVersion === capability.policyVersion &&
            receipt.startPolicyExpiresAt === capability.policyExpiresAt &&
            receipt.approvalPolicyExpiresAt === capability.policyExpiresAt &&
            receipt.startCapabilityExpiresAt === capability.capabilityExpiresAt &&
            receipt.approvalCapabilityExpiresAt === capability.capabilityExpiresAt &&
            ownerConfirmationDigestsMatch(
              capability.capabilityId,
              String(receipt.approvalConfirmationDigest ?? ""),
              String(receipt.startConfirmationDigest ?? ""),
            ) &&
            receipt.startNonceAction === "SOURCE_RUN_START" &&
            receipt.approvalNonceAction === "SOURCE_CAPABILITY_APPROVE" &&
            receipt.startLoopbackValidated === 1 &&
            receipt.startSessionValidated === 1 &&
            receipt.startNonceConsumed === 1 &&
            receipt.startOwnerConfirmed === 1 &&
            Number.isFinite(startGateConsumedAt) &&
            startGateConsumedAt <= receiptCreatedAt &&
            currentTime.getTime() - startGateConsumedAt <= 15 * 60_000 &&
            receipt.approvalLoopbackValidated === 1 &&
            receipt.approvalSessionValidated === 1 &&
            receipt.approvalNonceConsumed === 1 &&
            receipt.approvalOwnerConfirmed === 1 &&
            Number.isFinite(approvalGateConsumedAt) &&
            approvalGateConsumedAt <= approvalCreatedAt &&
            Number.isFinite(receiptExpiresAt) &&
            receiptExpiresAt > currentTime.getTime() &&
            Number.isFinite(approvalConsumedAt) &&
            Number.isFinite(receiptCreatedAt) &&
            Number.isFinite(approvalCreatedAt) &&
            Math.abs(approvalConsumedAt - receiptCreatedAt) < 1000;
          if (!receiptsMatch) throw new Error("SOURCE_OWNER_RECEIPT_CHAIN_INVALID");
          const active = this.sqlite
            .prepare(
              `SELECT 1 FROM source_run_checkpoints
               WHERE capability_version_id=? AND status='RUNNING' LIMIT 1`,
            )
            .get(row.id);
          if (active) throw new Error("CONCURRENT_RUN");
          this.sqlite
            .prepare(
              `INSERT INTO source_run_checkpoints
                (id, capability_version_id, capability_digest, operation, status, current_cursor,
                 next_cursor, seen_page_digests_json, request_count, page_count, record_count, byte_count,
                 retry_count, redirect_count, safe_error_code, retry_after, owner_started_at,
                 owner_cancelled_at, completed_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'RUNNING', NULL, ?, '[]', 0, 0, 0, 0, 0, 0, NULL, NULL, ?, NULL, NULL, ?, ?)`,
            )
            .run(
              runId,
              row.id,
              digest,
              input.operation,
              input.operation === "LIST_JOBS" ? "0" : null,
              input.startedAt,
              input.startedAt,
              input.startedAt,
            );
          const consumed = this.sqlite
            .prepare(
              `UPDATE source_owner_action_receipts SET state='CONSUMED',consumed_at=?,updated_at=?
               WHERE id=? AND action='START' AND state='ACTIVE' AND receipt_expires_at>?`,
            )
            .run(
              input.startedAt,
              currentTime.toISOString(),
              input.ownerStartReceiptId,
              currentTime.toISOString(),
            ).changes;
          if (consumed !== 1) throw new Error("SOURCE_OWNER_START_RECEIPT_REPLAYED");
          this.sqlite
            .prepare(
              `INSERT INTO source_run_owner_bindings
                (run_id,approval_receipt_id,start_receipt_id,capability_digest,operation,created_at)
               VALUES (?,?,?,?,?,?)`,
            )
            .run(
              runId,
              input.ownerApprovalReceiptId,
              input.ownerStartReceiptId,
              digest,
              input.operation,
              input.startedAt,
            );
          const startedAudit = validateSourceAuditMetadata("source.run.started", {
            runId,
            capabilityId: capability.capabilityId,
            capabilityVersion: capability.version,
            operation: input.operation,
          });
          this.audit("source.run.started", "source_run", runId, startedAudit);
          const bindingAudit = validateSourceAuditMetadata("source.run.owner-bound", {
            runId,
            approvalReceiptId: input.ownerApprovalReceiptId,
            startReceiptId: input.ownerStartReceiptId,
            capabilityId: capability.capabilityId,
            capabilityVersion: capability.version,
            capabilityDigest: digest,
            operation: input.operation,
          });
          this.audit("source.run.owner-bound", "source_run", runId, bindingAudit);
          this.auditOwnerReceiptTerminal(input.ownerStartReceiptId, "START", "CONSUMED");
          return runId;
        })
        .immediate();
    } catch (error) {
      this.failOwnerStartReceipt(input.ownerStartReceiptId);
      throw error;
    }
  }

  assertCapabilityCurrent(input: {
    runId: string;
    capabilityId: string;
    capabilityVersion: number;
    capabilityDigest: string;
  }): void {
    const run = this.sqlite
      .prepare(
        `SELECT r.status, r.capability_digest AS digest, c.capability_id AS capabilityId,
                c.version
         FROM source_run_checkpoints r
         JOIN source_capability_versions c ON c.id = r.capability_version_id
         WHERE r.id = ?`,
      )
      .get(input.runId) as
      | { status: string; digest: string; capabilityId: string; version: number }
      | undefined;
    const current = this.currentCapability(input.capabilityId);
    if (
      !run ||
      run.status !== "RUNNING" ||
      run.capabilityId !== input.capabilityId ||
      run.version !== input.capabilityVersion ||
      run.digest !== input.capabilityDigest ||
      current?.version !== input.capabilityVersion ||
      current.digest !== input.capabilityDigest
    ) {
      throw new Error("CAPABILITY_CHANGED");
    }
  }

  persistPage(input: {
    runId: string;
    capability: SourceCapabilityV2;
    page: LeverPageV2 | GreenhousePageV2;
    budget: SourceRunBudget;
    observedAt: string;
  }): void {
    const capability = SourceCapabilityV2Schema.parse(input.capability);
    const persistenceContext: PersistenceContext = {
      phase: "UNKNOWN_PERSISTENCE",
      recordIndex: null,
      externalId: null,
      provider: capability.source,
      pageProviderRecordCount: input.page.providerRecordCount,
      acceptedRecordCount: input.page.acceptedRecords.length,
      unusableRecordCount: input.page.unusableRecordCount,
    };
    try {
      const result = this.sqlite.transaction(() => {
        this.setPersistencePhase(persistenceContext, "UNKNOWN_PERSISTENCE", null, null);
        this.setPersistencePhase(persistenceContext, "CAPABILITY_ASSERT", null, null);
        this.assertCapabilityCurrent({
          runId: input.runId,
          capabilityId: capability.capabilityId,
          capabilityVersion: capability.version,
          capabilityDigest: sourceCapabilityDigest(capability),
        });
        const capabilityRow = this.sqlite
          .prepare(`SELECT id FROM source_capability_versions WHERE capability_id=? AND version=?`)
          .get(capability.capabilityId, capability.version) as { id: string } | undefined;
        if (!capabilityRow) throw new Error("SOURCE_CAPABILITY_VERSION_REQUIRED");
        const pageNumber = input.budget.pages;
        const logicalPage = this.sqlite
          .prepare(
            `SELECT id, page_digest AS pageDigest FROM source_run_pages
           WHERE run_id=? AND page_number=? AND cursor=? AND next_cursor IS ?`,
          )
          .get(
            input.runId,
            pageNumber,
            String(input.page.cursor),
            input.page.nextCursor === null ? null : String(input.page.nextCursor),
          ) as { id: string; pageDigest: string } | undefined;
        // Replay is keyed by the logical request/cursor, not by content alone.
        // A different cursor returning identical content is a distinct operation.
        if (logicalPage) {
          if (logicalPage.pageDigest !== input.page.pageDigest) {
            throw new Error("SOURCE_PAGE_REPLAY_CONFLICT");
          }
          return {
            createdJobIds: [],
            duplicateObservationCount: input.page.acceptedRecords.length,
          };
        }
        const createdJobIds: string[] = [];
        let duplicateObservationCount = 0;
        const persistedRecords: Array<{
          record: LeverPostingRecordV2 | GreenhousePostingRecordV2;
          recordIndex: number;
          persisted: ReturnType<SourceEnablementRepository["persistProviderObservation"]>;
        }> = [];
        const unusableIndexes = new Set(
          input.page.safeUnusableDiagnostics.map(({ recordIndex }) => recordIndex),
        );
        const acceptedEntries =
          input.page.acceptedRecordEntries ??
          (() => {
            let providerIndex = 0;
            return input.page.acceptedRecords.map((record) => {
              while (unusableIndexes.has(providerIndex)) providerIndex += 1;
              const entry = { record, recordIndex: providerIndex };
              providerIndex += 1;
              return entry;
            });
          })();
        const pageExternalIds = new Set<string>();
        for (const { record, recordIndex } of acceptedEntries) {
          this.setPersistencePhase(
            persistenceContext,
            "SOURCE_IDENTITY",
            recordIndex,
            record.externalId,
          );
          if (pageExternalIds.has(record.externalId)) {
            throw new Error("SOURCE_PAGE_DUPLICATE_EXTERNAL_ID");
          }
          pageExternalIds.add(record.externalId);
          const persisted = this.persistProviderObservation(
            record,
            capability,
            input.runId,
            input.observedAt,
            persistenceContext,
            recordIndex,
          );
          persistedRecords.push({ record, recordIndex, persisted });
          if (persisted.created) createdJobIds.push(persisted.jobId);
          else duplicateObservationCount += 1;
        }
        this.setPersistencePhase(persistenceContext, "PAGE_INSERT", null, null);
        const pageId = this.id();
        this.sqlite
          .prepare(
            `INSERT INTO source_run_pages
            (id, run_id, page_number, cursor, next_cursor, page_digest, request_count,
             record_count, byte_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            pageId,
            input.runId,
            pageNumber,
            String(input.page.cursor),
            input.page.nextCursor === null ? null : String(input.page.nextCursor),
            input.page.pageDigest,
            input.page.requestCount,
            input.page.providerRecordCount,
            input.page.byteCount,
            input.observedAt,
          );
        if (this.hasVerificationLedger()) {
          for (const { record, recordIndex, persisted } of persistedRecords) {
            this.setPersistencePhase(
              persistenceContext,
              "VERIFICATION_INSERT",
              recordIndex,
              record.externalId,
            );
            this.recordVerification({
              id: this.id(),
              runId: input.runId,
              capabilityVersionId: capabilityRow.id,
              pageId,
              source: capability.source,
              tenant: capability.tenant,
              externalId: record.externalId,
              recordIndex,
              pageDigest: input.page.pageDigest,
              contentHash: record.contentDigest,
              sourceObservationId: persisted.observationId,
              jobVersionId: persisted.jobVersionId,
              disposition: "ACCEPTED",
              qualificationState: "PAGE_PERSISTED",
              parserVersion: capability.parserVersion,
              policyVersion: capability.policyVersion,
              verifiedAt: input.observedAt,
              createdAt: input.observedAt,
            });
          }
          for (const diagnostic of input.page.safeUnusableDiagnostics) {
            this.setPersistencePhase(
              persistenceContext,
              "VERIFICATION_INSERT",
              diagnostic.recordIndex,
              null,
            );
            this.recordVerification({
              id: this.id(),
              runId: input.runId,
              capabilityVersionId: capabilityRow.id,
              pageId,
              source: capability.source,
              tenant: capability.tenant,
              externalId: null,
              recordIndex: diagnostic.recordIndex,
              pageDigest: input.page.pageDigest,
              contentHash: null,
              sourceObservationId: null,
              jobVersionId: null,
              disposition: "UNUSABLE",
              qualificationState: "PAGE_PERSISTED",
              parserVersion: capability.parserVersion,
              policyVersion: capability.policyVersion,
              verifiedAt: input.observedAt,
              createdAt: input.observedAt,
            });
          }
        }
        this.setPersistencePhase(persistenceContext, "CHECKPOINT_UPDATE", null, null);
        const digests = this.sqlite
          .prepare("SELECT page_digest FROM source_run_pages WHERE run_id = ? ORDER BY page_number")
          .all(input.runId)
          .map((row) => (row as { page_digest: string }).page_digest);
        this.sqlite
          .prepare(
            `UPDATE source_run_checkpoints SET current_cursor = ?, next_cursor = ?,
             seen_page_digests_json = ?, request_count = ?, page_count = ?, record_count = ?,
             byte_count = ?, retry_count = ?, redirect_count = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            String(input.page.cursor),
            input.page.nextCursor === null ? null : String(input.page.nextCursor),
            JSON.stringify(digests),
            input.budget.attempts,
            input.budget.pages,
            input.budget.records,
            input.budget.bytes,
            input.budget.retries,
            input.budget.redirects,
            input.observedAt,
            input.runId,
          );
        const providerDriftDiagnostics =
          "providerDriftDiagnostics" in input.page ? input.page.providerDriftDiagnostics : [];
        this.setPersistencePhase(persistenceContext, "PAGE_AUDIT", null, null);
        const audit = validateSourceAuditMetadata("source.page.persisted", {
          runId: input.runId,
          pageNumber,
          requestCount: input.page.requestCount,
          recordCount: input.page.providerRecordCount,
          providerRecordCount: input.page.providerRecordCount,
          acceptedRecordCount: input.page.acceptedRecords.length,
          unusableRecordCount: input.page.unusableRecordCount,
          providerDriftWarningCount: providerDriftDiagnostics.length,
          persistedObservationCount: createdJobIds.length,
          byteCount: input.page.byteCount,
        });
        this.audit("source.page.persisted", "source_run", input.runId, audit);
        for (const diagnostic of input.page.safeUnusableDiagnostics) {
          const safeDiagnostic = SourceRecordUnusableDiagnosticSchema.parse(diagnostic);
          const unusableAudit = validateSourceAuditMetadata(
            "source.record.unusable",
            safeDiagnostic,
          );
          this.audit("source.record.unusable", "source_run", input.runId, unusableAudit);
        }
        for (const diagnostic of providerDriftDiagnostics) {
          const safeDiagnostic = SourceProviderDriftDiagnosticSchema.parse(diagnostic);
          const driftAudit = validateSourceAuditMetadata("source.provider.drift", safeDiagnostic);
          this.audit("source.provider.drift", "source_run", input.runId, driftAudit);
        }
        return { createdJobIds, duplicateObservationCount };
      })();
      void result;
    } catch (error) {
      throw this.persistenceFailure(error, persistenceContext);
    }
  }

  persistGreenhousePage(input: {
    runId: string;
    capability: SourceCapabilityV2;
    page: GreenhousePageV2;
    budget: SourceRunBudget;
    observedAt: string;
  }): void {
    if (input.capability.source !== "GREENHOUSE") throw new Error("SOURCE_MISMATCH");
    this.persistPage(input);
  }

  persistDetail(input: {
    runId: string;
    capability: SourceCapabilityV2;
    externalId: string;
    record: LeverPostingRecordV2 | GreenhousePostingRecordV2;
    pageDigest: string;
    budget: SourceRunBudget;
    observedAt: string;
  }): void {
    const capability = SourceCapabilityV2Schema.parse(input.capability);
    if (capability.source !== input.record.source) throw new Error("SOURCE_MISMATCH");
    if (input.record.externalId !== input.externalId) {
      throw new Error("SOURCE_DETAIL_ID_MISMATCH");
    }
    if (detailPageDigest(input.externalId, input.record) !== input.pageDigest) {
      throw new Error("SOURCE_DETAIL_DIGEST_MISMATCH");
    }
    const persistenceContext: PersistenceContext = {
      phase: "UNKNOWN_PERSISTENCE",
      recordIndex: 0,
      externalId: input.externalId,
      provider: capability.source,
      pageProviderRecordCount: 1,
      acceptedRecordCount: 1,
      unusableRecordCount: 0,
    };
    try {
      this.sqlite.transaction(() => {
        this.setPersistencePhase(persistenceContext, "UNKNOWN_PERSISTENCE", null, null);
        this.setPersistencePhase(persistenceContext, "CAPABILITY_ASSERT", null, null);
        this.assertCapabilityCurrent({
          runId: input.runId,
          capabilityId: capability.capabilityId,
          capabilityVersion: capability.version,
          capabilityDigest: sourceCapabilityDigest(capability),
        });
        const run = this.sqlite
          .prepare("SELECT operation FROM source_run_checkpoints WHERE id=?")
          .get(input.runId) as { operation: string } | undefined;
        if (!run || run.operation !== "GET_JOB") throw new Error("SOURCE_OPERATION_MISMATCH");
        const capabilityRow = this.sqlite
          .prepare(`SELECT id FROM source_capability_versions WHERE capability_id=? AND version=?`)
          .get(capability.capabilityId, capability.version) as { id: string } | undefined;
        if (!capabilityRow) throw new Error("SOURCE_CAPABILITY_VERSION_REQUIRED");
        const cursor = `GET_JOB:${input.externalId}`;
        const existingPage = this.sqlite
          .prepare(
            `SELECT id, page_digest AS pageDigest FROM source_run_pages
           WHERE run_id=? AND page_number=1 AND cursor=? AND next_cursor IS NULL`,
          )
          .get(input.runId, cursor) as { id: string; pageDigest: string } | undefined;
        if (existingPage) {
          if (existingPage.pageDigest !== input.pageDigest)
            throw new Error("SOURCE_PAGE_REPLAY_CONFLICT");
          return;
        }
        const persisted = this.persistProviderObservation(
          input.record,
          capability,
          input.runId,
          input.observedAt,
          persistenceContext,
          0,
        );
        if (!persisted.jobVersionId) throw new Error("SOURCE_JOB_VERSION_REQUIRED");
        this.setPersistencePhase(persistenceContext, "PAGE_INSERT", 0, input.externalId);
        const pageId = this.id();
        this.sqlite
          .prepare(
            `INSERT INTO source_run_pages
            (id,run_id,page_number,cursor,next_cursor,page_digest,request_count,record_count,byte_count,created_at)
           VALUES (?,?,?,?,NULL,?,?,?,?,?)`,
          )
          .run(
            pageId,
            input.runId,
            1,
            cursor,
            input.pageDigest,
            input.budget.attempts,
            1,
            input.budget.bytes,
            input.observedAt,
          );
        if (!this.hasVerificationLedger()) throw new Error("SOURCE_VERIFICATION_LEDGER_REQUIRED");
        this.setPersistencePhase(persistenceContext, "VERIFICATION_INSERT", 0, input.externalId);
        this.recordVerification({
          id: this.id(),
          runId: input.runId,
          capabilityVersionId: capabilityRow.id,
          pageId,
          source: capability.source,
          tenant: capability.tenant,
          externalId: input.externalId,
          recordIndex: 0,
          pageDigest: input.pageDigest,
          contentHash: input.record.contentDigest,
          sourceObservationId: persisted.observationId,
          jobVersionId: persisted.jobVersionId,
          disposition: "ACCEPTED",
          qualificationState: "PAGE_PERSISTED",
          parserVersion: capability.parserVersion,
          policyVersion: capability.policyVersion,
          verifiedAt: input.observedAt,
          createdAt: input.observedAt,
        });
        this.setPersistencePhase(persistenceContext, "CHECKPOINT_UPDATE", null, null);
        this.sqlite
          .prepare(
            `UPDATE source_run_checkpoints SET current_cursor=?, next_cursor=NULL,
             seen_page_digests_json=?, request_count=?, page_count=?, record_count=?, byte_count=?,
             retry_count=?, redirect_count=?, updated_at=? WHERE id=?`,
          )
          .run(
            cursor,
            JSON.stringify([input.pageDigest]),
            input.budget.attempts,
            input.budget.pages,
            input.budget.records,
            input.budget.bytes,
            input.budget.retries,
            input.budget.redirects,
            input.observedAt,
            input.runId,
          );
        this.setPersistencePhase(persistenceContext, "PAGE_AUDIT", null, null);
        const audit = validateSourceAuditMetadata("source.page.persisted", {
          runId: input.runId,
          pageNumber: 1,
          requestCount: input.budget.attempts,
          recordCount: 1,
          providerRecordCount: 1,
          acceptedRecordCount: 1,
          unusableRecordCount: 0,
          providerDriftWarningCount: 0,
          persistedObservationCount: persisted.created ? 1 : 0,
          byteCount: input.budget.bytes,
        });
        this.audit("source.page.persisted", "source_run", input.runId, audit);
      })();
    } catch (error) {
      throw this.persistenceFailure(error, persistenceContext);
    }
  }

  persistGreenhouseDetail(input: {
    runId: string;
    capability: SourceCapabilityV2;
    externalId: string;
    detail: GreenhouseDetailV2;
    budget: SourceRunBudget;
    observedAt: string;
  }): void {
    if (input.capability.source !== "GREENHOUSE") throw new Error("SOURCE_MISMATCH");
    this.persistDetail({
      runId: input.runId,
      capability: input.capability,
      externalId: input.externalId,
      record: input.detail.record,
      pageDigest: input.detail.pageDigest,
      budget: input.budget,
      observedAt: input.observedAt,
    });
  }

  complete(input: { runId: string; budget: SourceRunBudget; completedAt: string }): void {
    const persistenceContext: PersistenceContext = {
      phase: "UNKNOWN_PERSISTENCE",
      recordIndex: null,
      externalId: null,
      provider: input.budget.capability.source,
      pageProviderRecordCount: input.budget.records,
      acceptedRecordCount: 0,
      unusableRecordCount: input.budget.records,
    };
    try {
      this.sqlite.transaction(() => {
        this.setPersistencePhase(persistenceContext, "UNKNOWN_PERSISTENCE", null, null);
        persistenceContext.acceptedRecordCount = Number(
          this.sqlite
            .prepare("SELECT count(*) FROM source_observations WHERE run_id=?")
            .pluck()
            .get(input.runId),
        );
        persistenceContext.unusableRecordCount = this.hasVerificationLedger()
          ? Number(
              this.sqlite
                .prepare(
                  "SELECT count(*) FROM source_record_verifications WHERE run_id=? AND disposition='UNUSABLE'",
                )
                .pluck()
                .get(input.runId),
            )
          : Math.max(0, input.budget.records - persistenceContext.acceptedRecordCount);
        this.setPersistencePhase(persistenceContext, "COMPLETE_STATUS", null, null);
        this.finish(
          input.runId,
          "COMPLETE",
          input.budget,
          null,
          null,
          null,
          null,
          input.completedAt,
        );
        this.setPersistencePhase(persistenceContext, "COMPLETE_QUALIFICATION", null, null);
        this.hooks.beforeQualification?.(input.runId);
        if (this.hasVerificationLedger()) {
          this.sqlite
            .prepare(
              `UPDATE source_record_verifications
               SET qualification_state='QUALIFIED'
               WHERE run_id=? AND disposition='ACCEPTED' AND qualification_state='PAGE_PERSISTED'`,
            )
            .run(input.runId);
        }
      })();
    } catch (error) {
      throw this.persistenceFailure(error, persistenceContext);
    }
  }

  stop(input: {
    runId: string;
    budget: SourceRunBudget;
    code: string;
    retryAfter: string | null;
    transportStage: SourceTransportLifecycleStage | null;
    schemaDiagnostic: SourceSchemaDiagnostic | null;
    persistenceDiagnostic?: SourcePersistenceDiagnostic;
    stoppedAt: string;
  }): void {
    this.finish(
      input.runId,
      "STOPPED",
      input.budget,
      input.code,
      input.retryAfter,
      input.transportStage,
      input.schemaDiagnostic,
      input.stoppedAt,
      input.persistenceDiagnostic ?? null,
    );
  }

  jobIdsForRun(runId: string): string[] {
    this.reconcileCompletedRun(runId);
    if (
      this.hasQualifiedLedgerRows(runId) &&
      this.sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_record_verifications'",
        )
        .get()
    ) {
      return (
        this.sqlite
          .prepare(
            `SELECT DISTINCT j.job_id AS jobId
             FROM source_record_verifications v JOIN job_versions j ON j.id=v.job_version_id
             WHERE v.run_id=? AND v.disposition='ACCEPTED' AND v.qualification_state='QUALIFIED'
             ORDER BY j.job_id`,
          )
          .all(runId) as Array<{ jobId: string }>
      ).map(({ jobId }) => jobId);
    }
    return (
      this.sqlite
        .prepare(
          `SELECT DISTINCT job_id AS jobId FROM source_observations
           WHERE run_id = ? AND job_id IS NOT NULL ORDER BY observed_at, id`,
        )
        .all(runId) as Array<{ jobId: string }>
    ).map(({ jobId }) => jobId);
  }

  pipelineWorkForCompletedRun(
    runId: string,
  ): Array<{ jobId: string; evaluationId: string | null }> {
    const run = this.sqlite
      .prepare(
        `SELECT r.status,c.capability_id AS capabilityId
         FROM source_run_checkpoints r
         JOIN source_capability_versions c ON c.id=r.capability_version_id
         WHERE r.id=?`,
      )
      .get(runId) as { status: string; capabilityId: string } | undefined;
    if (!run || run.status !== "COMPLETE") throw new Error("SOURCE_RUN_NOT_COMPLETE");
    this.reconcileCompletedRun(runId);
    const useLedger = this.hasQualifiedLedgerRows(runId);
    const jobs = this.sqlite
      .prepare(
        useLedger
          ? `SELECT DISTINCT j.job_id AS jobId
             FROM source_record_verifications v JOIN job_versions j ON j.id=v.job_version_id
             WHERE v.run_id=? AND v.disposition='ACCEPTED' AND v.qualification_state='QUALIFIED'
             ORDER BY j.job_id`
          : `SELECT DISTINCT o.job_id AS jobId
             FROM source_observations o
             WHERE o.run_id=? AND o.job_id IS NOT NULL
             ORDER BY o.observed_at,o.id`,
      )
      .all(runId) as Array<{ jobId: string }>;
    const work: Array<{ jobId: string; evaluationId: string | null }> = [];
    for (const { jobId } of jobs) {
      const version = this.sqlite
        .prepare("SELECT id FROM job_versions WHERE job_id=? ORDER BY version DESC LIMIT 1")
        .get(jobId) as { id: string } | undefined;
      if (!version) throw new Error("SOURCE_JOB_VERSION_REQUIRED");
      const evaluation = this.sqlite
        .prepare(
          `SELECT id FROM r2_evaluation_versions
           WHERE job_id=? AND job_version_id=? AND stale=0
             AND EXISTS (SELECT 1 FROM candidate_profiles
               WHERE active_version_id=r2_evaluation_versions.profile_version_id)
           ORDER BY evaluated_at DESC,rowid DESC LIMIT 1`,
        )
        .get(jobId, version.id) as { id: string } | undefined;
      if (!evaluation) {
        work.push({ jobId, evaluationId: null });
        continue;
      }
      const queue = this.sqlite
        .prepare(
          `SELECT freshness,r2_evaluation_id AS evaluationId
           FROM r2_queue_decision_versions WHERE job_id=? ORDER BY version DESC LIMIT 1`,
        )
        .get(jobId) as { freshness: string; evaluationId: string } | undefined;
      if (queue?.freshness === "CURRENT" && queue.evaluationId === evaluation.id) continue;
      work.push({ jobId, evaluationId: evaluation.id });
    }
    return work;
  }

  recovery(runId: string) {
    const row = this.sqlite
      .prepare(
        `SELECT status, operation, request_count AS requestCount, page_count AS pageCount,
                record_count AS recordCount, next_cursor AS nextCursor,
                safe_error_code AS safeErrorCode, retry_after AS retryAfter,
                (SELECT count(*) FROM audit_events a
                 WHERE a.event_type='source.record.unusable' AND a.entity_type='source_run'
                   AND a.entity_id=source_run_checkpoints.id) AS unusableRecordCount,
                (SELECT count(*) FROM audit_events a
                 WHERE a.event_type='source.provider.drift' AND a.entity_type='source_run'
                   AND a.entity_id=source_run_checkpoints.id) AS providerDriftWarningCount,
                (SELECT coalesce(sum(p.record_count),0) FROM source_run_pages p
                 WHERE p.run_id=source_run_checkpoints.id) AS persistedPageProviderRecordCount,
                (SELECT count(*) FROM source_observations o
                 WHERE o.run_id=source_run_checkpoints.id) AS persistedObservationCount,
                (SELECT json_extract(a.redacted_metadata_json, '$.transportStage')
                 FROM audit_events a
                 WHERE a.event_type='source.run.stopped' AND a.entity_type='source_run'
                   AND a.entity_id=source_run_checkpoints.id
                 ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 1) AS transportStage,
                (SELECT json_extract(a.redacted_metadata_json, '$.schemaDiagnostic.field')
                 FROM audit_events a WHERE a.event_type='source.run.stopped'
                   AND a.entity_type='source_run' AND a.entity_id=source_run_checkpoints.id
                 ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 1) AS schemaField,
                (SELECT json_extract(a.redacted_metadata_json, '$.schemaDiagnostic.expectedStructuralType')
                 FROM audit_events a WHERE a.event_type='source.run.stopped'
                   AND a.entity_type='source_run' AND a.entity_id=source_run_checkpoints.id
                 ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 1) AS schemaExpectedType,
                (SELECT json_extract(a.redacted_metadata_json, '$.schemaDiagnostic.issueCategory')
                 FROM audit_events a WHERE a.event_type='source.run.stopped'
                   AND a.entity_type='source_run' AND a.entity_id=source_run_checkpoints.id
                 ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 1) AS schemaIssueCategory,
                (SELECT json_extract(a.redacted_metadata_json, '$.schemaDiagnostic.recordIndex')
                 FROM audit_events a WHERE a.event_type='source.run.stopped'
                   AND a.entity_type='source_run' AND a.entity_id=source_run_checkpoints.id
                 ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 1) AS schemaRecordIndex,
                (SELECT json_extract(a.redacted_metadata_json, '$.persistenceDiagnostic')
                 FROM audit_events a WHERE a.event_type='source.run.stopped'
                   AND a.entity_type='source_run' AND a.entity_id=source_run_checkpoints.id
                 ORDER BY a.occurred_at DESC,a.rowid DESC LIMIT 1) AS persistenceDiagnosticJson
         FROM source_run_checkpoints WHERE id = ?`,
      )
      .get(runId) as
      | (Record<string, unknown> & {
          transportStage: unknown;
          schemaField: unknown;
          schemaExpectedType: unknown;
          schemaIssueCategory: unknown;
          schemaRecordIndex: unknown;
        })
      | undefined;
    if (!row) return undefined;
    const stage = SourceTransportLifecycleStageSchema.safeParse(row.transportStage);
    const diagnostic = SourceSchemaDiagnosticSchema.safeParse({
      field: row.schemaField,
      expectedStructuralType: row.schemaExpectedType,
      issueCategory: row.schemaIssueCategory,
      ...(row.schemaRecordIndex === null ? {} : { recordIndex: row.schemaRecordIndex }),
    });
    let persistenceDiagnostic: SourcePersistenceDiagnostic | null = null;
    if (typeof row.persistenceDiagnosticJson === "string") {
      try {
        const parsed = SourcePersistenceDiagnosticSchema.safeParse(
          JSON.parse(row.persistenceDiagnosticJson),
        );
        if (parsed.success) persistenceDiagnostic = parsed.data;
      } catch {
        persistenceDiagnostic = null;
      }
    }
    return {
      status: row.status,
      operation: row.operation,
      requestCount: row.requestCount,
      pageCount: row.pageCount,
      recordCount: row.recordCount,
      providerRecordCount: row.recordCount,
      acceptedRecordCount: Math.max(
        0,
        Number(row.persistedPageProviderRecordCount) - Number(row.unusableRecordCount),
      ),
      unusableRecordCount: row.unusableRecordCount,
      providerDriftWarningCount: row.providerDriftWarningCount,
      persistedObservationCount: row.persistedObservationCount,
      nextCursor: row.nextCursor,
      safeErrorCode: row.safeErrorCode,
      retryAfter: row.retryAfter,
      transportStage: stage.success ? stage.data : null,
      schemaDiagnostic: diagnostic.success ? diagnostic.data : null,
      persistenceDiagnostic,
    };
  }

  cancel(runId: string, cancelledAt = this.now().toISOString()): void {
    if (!/^[A-Za-z0-9:._-]{1,200}$/.test(runId)) throw new Error("SOURCE_RUN_ID_INVALID");
    const run = this.sqlite
      .prepare(
        `SELECT status,request_count AS requestCount,record_count AS recordCount
         FROM source_run_checkpoints WHERE id=?`,
      )
      .get(runId) as { status: string; requestCount: number; recordCount: number } | undefined;
    if (!run) throw new Error("SOURCE_RUN_NOT_FOUND");
    if (run.status !== "RUNNING") throw new Error("SOURCE_RUN_NOT_ACTIVE");
    this.sqlite
      .prepare(
        `UPDATE source_run_checkpoints SET status='STOPPED',safe_error_code='OWNER_CANCELLED',
         owner_cancelled_at=?,completed_at=?,updated_at=? WHERE id=? AND status='RUNNING'`,
      )
      .run(cancelledAt, cancelledAt, cancelledAt, runId);
    const audit = validateSourceAuditMetadata("source.run.stopped", {
      runId,
      code: "OWNER_CANCELLED",
      transportStage: null,
      requestCount: run.requestCount,
      recordCount: run.recordCount,
    });
    this.audit("source.run.stopped", "source_run", runId, audit);
  }

  private hasOwnerReceiptSchema(): boolean {
    const tables = this.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?)")
      .all("source_owner_action_receipts", "source_run_owner_bindings") as Array<{ name: string }>;
    return tables.length === 2;
  }

  private requireOwnerReceiptSchema(): void {
    if (!this.hasOwnerReceiptSchema()) throw new Error("SOURCE_OWNER_RECEIPT_SCHEMA_REQUIRED");
  }

  private assertGateProof(
    proof: SourceOwnerActionGateProof,
    action: SourceOwnerActionGateProof["action"],
  ): void {
    if (
      !proof ||
      proof.action !== action ||
      proof.loopbackValidated !== true ||
      proof.localSessionValidated !== true ||
      proof.nonceConsumed !== true
    ) {
      throw new Error("LOCAL_MUTATION_GATE_REQUIRED");
    }
    const consumedAt = Date.parse(proof.consumedAt);
    const now = this.now().getTime();
    if (
      !Number.isFinite(consumedAt) ||
      consumedAt > now + 30_000 ||
      now - consumedAt > 15 * 60_000
    ) {
      throw new Error("LOCAL_MUTATION_GATE_EXPIRED");
    }
  }

  private assertPersistedCapabilityCurrent(
    capability: SourceCapabilityV2,
    digest: string,
  ): { id: string; version: number; digest: string } {
    const current = this.currentCapability(capability.capabilityId);
    if (!current || current.version !== capability.version || current.digest !== digest) {
      throw new Error("CAPABILITY_CHANGED");
    }
    const row = this.sqlite
      .prepare(
        `SELECT source,tenant,approval_state AS approvalState,
                approval_reference AS approvalReference,policy_version AS policyVersion,
                policy_expires_at AS policyExpiresAt,
                capability_expires_at AS capabilityExpiresAt
         FROM source_capability_versions WHERE id=?`,
      )
      .get(current.id) as
      | {
          source: string;
          tenant: string;
          approvalState: string;
          approvalReference: string | null;
          policyVersion: string;
          policyExpiresAt: string;
          capabilityExpiresAt: string;
        }
      | undefined;
    if (
      !row ||
      row.source !== capability.source ||
      row.tenant !== capability.tenant ||
      row.approvalState !== capability.approvalState ||
      row.approvalReference !== capability.approvalReference ||
      row.policyVersion !== capability.policyVersion ||
      row.policyExpiresAt !== capability.policyExpiresAt ||
      row.capabilityExpiresAt !== capability.capabilityExpiresAt
    ) {
      throw new Error("CAPABILITY_CHANGED");
    }
    return current;
  }

  private insertOwnerReceipt(input: {
    id: string;
    action: "APPROVE" | "START";
    capability: SourceCapabilityV2;
    capabilityVersionId: string;
    capabilityDigest: string;
    approvalReference: string;
    operation: SourceOperation | null;
    receiptExpiresAt: string | null;
    confirmationDigest: string;
    nonceAction: "SOURCE_CAPABILITY_APPROVE" | "SOURCE_RUN_START";
    gateProof: SourceOwnerActionGateProof;
    predecessorReceiptId: string | null;
    state: "ACTIVE" | "CONSUMED" | "REVOKED" | "EXPIRED" | "FAILED";
    consumedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }): void {
    const action = SourceOwnerActionSchema.parse(input.action);
    const state = SourceOwnerReceiptStateSchema.parse(input.state);
    this.sqlite
      .prepare(
        `INSERT INTO source_owner_action_receipts
          (id,action,capability_version_id,capability_id,capability_version,capability_digest,
           approval_reference,source,tenant,operation,policy_version,policy_expires_at,
           capability_expires_at,receipt_expires_at,confirmation_digest,nonce_action,
           gate_consumed_at,loopback_validated,local_session_validated,nonce_consumed,owner_confirmed,
           predecessor_receipt_id,state,consumed_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        action,
        input.capabilityVersionId,
        input.capability.capabilityId,
        input.capability.version,
        input.capabilityDigest,
        input.approvalReference,
        input.capability.source,
        input.capability.tenant,
        input.operation,
        input.capability.policyVersion,
        input.capability.policyExpiresAt,
        input.capability.capabilityExpiresAt,
        input.receiptExpiresAt,
        input.confirmationDigest,
        input.nonceAction,
        input.gateProof.consumedAt,
        1,
        1,
        1,
        1,
        input.predecessorReceiptId,
        state,
        input.consumedAt,
        input.createdAt,
        input.updatedAt,
      );
  }

  private auditOwnerApprovalRecorded(
    receiptId: string,
    capability: SourceCapabilityV2,
    capabilityDigest: string,
  ): void {
    const audit = validateSourceAuditMetadata("source.owner.approval-recorded", {
      receiptId,
      capabilityId: capability.capabilityId,
      capabilityVersion: capability.version,
      capabilityDigest,
      state: "ACTIVE",
    });
    this.audit("source.owner.approval-recorded", "source_owner_action_receipt", receiptId, audit);
  }

  private auditOwnerReceiptTerminal(
    receiptId: string,
    action: "APPROVE" | "START",
    state: "CONSUMED" | "REVOKED" | "EXPIRED" | "FAILED",
  ): void {
    const audit = validateSourceAuditMetadata("source.owner.receipt-terminal", {
      receiptId,
      action,
      state,
    });
    this.audit("source.owner.receipt-terminal", "source_owner_action_receipt", receiptId, audit);
  }

  private terminalizeOwnerReceipt(
    receiptId: string,
    action: "APPROVE" | "START",
    state: "REVOKED" | "EXPIRED" | "FAILED",
  ): void {
    const changed = this.sqlite
      .prepare(
        `UPDATE source_owner_action_receipts SET state=?,updated_at=?
         WHERE id=? AND action=? AND state='ACTIVE'`,
      )
      .run(state, this.now().toISOString(), receiptId, action).changes;
    if (changed) this.auditOwnerReceiptTerminal(receiptId, action, state);
  }

  private currentCapability(
    capabilityId: string,
  ): { id: string; version: number; digest: string } | undefined {
    return this.sqlite
      .prepare(
        `SELECT id, version, configuration_digest AS digest FROM source_capability_versions
         WHERE capability_id = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(capabilityId) as { id: string; version: number; digest: string } | undefined;
  }

  private hasVerificationLedger(): boolean {
    return Boolean(
      this.sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_record_verifications'",
        )
        .get(),
    );
  }

  private hasQualifiedLedgerRows(runId: string): boolean {
    if (!this.hasVerificationLedger()) return false;
    return Boolean(
      this.sqlite
        .prepare(
          `SELECT 1 FROM source_record_verifications
           WHERE run_id=? AND disposition='ACCEPTED' AND qualification_state='QUALIFIED' LIMIT 1`,
        )
        .get(runId),
    );
  }

  /** Reconciles a terminal COMPLETE run after a crash between finish and qualification. */
  reconcileCompletedRun(runId: string): number {
    if (!this.hasVerificationLedger()) return 0;
    const row = this.sqlite
      .prepare("SELECT status FROM source_run_checkpoints WHERE id=?")
      .get(runId) as { status: string } | undefined;
    if (!row || row.status !== "COMPLETE") return 0;
    return this.sqlite
      .prepare(
        `UPDATE source_record_verifications SET qualification_state='QUALIFIED'
         WHERE run_id=? AND disposition='ACCEPTED' AND qualification_state='PAGE_PERSISTED'`,
      )
      .run(runId).changes;
  }

  private recordVerification(input: {
    id: string;
    runId: string;
    capabilityVersionId: string;
    pageId: string;
    source: string;
    tenant: string;
    externalId: string | null;
    recordIndex: number;
    pageDigest: string;
    contentHash: string | null;
    sourceObservationId: string | null;
    jobVersionId: string | null;
    disposition: "ACCEPTED" | "UNUSABLE";
    qualificationState: "PAGE_PERSISTED" | "QUALIFIED";
    parserVersion: string;
    policyVersion: string | null;
    verifiedAt: string;
    createdAt: string;
  }): void {
    try {
      this.sqlite
        .prepare(
          `INSERT INTO source_record_verifications
         (id,run_id,capability_version_id,page_id,source,tenant,external_id,record_index,
          page_digest,content_hash,source_observation_id,job_version_id,disposition,
          qualification_state,parser_version,policy_version,verified_at,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          input.id,
          input.runId,
          input.capabilityVersionId,
          input.pageId,
          input.source,
          input.tenant,
          input.externalId,
          input.recordIndex,
          input.pageDigest,
          input.contentHash,
          input.sourceObservationId,
          input.jobVersionId,
          input.disposition,
          input.qualificationState,
          input.parserVersion,
          input.policyVersion,
          input.verifiedAt,
          input.createdAt,
        );
    } catch (error) {
      const existing = this.sqlite
        .prepare(
          `SELECT source,tenant,external_id AS externalId,record_index AS recordIndex,
                  page_digest AS pageDigest,content_hash AS contentHash,
                  source_observation_id AS sourceObservationId,job_version_id AS jobVersionId,
                  disposition,qualification_state AS qualificationState,parser_version AS parserVersion,
                  policy_version AS policyVersion,verified_at AS verifiedAt,created_at AS createdAt
           FROM source_record_verifications
           WHERE run_id=? AND page_id=? AND record_index=? AND disposition=?`,
        )
        .get(input.runId, input.pageId, input.recordIndex, input.disposition) as
        | Record<string, unknown>
        | undefined;
      if (
        !existing ||
        existing.source !== input.source ||
        existing.tenant !== input.tenant ||
        existing.externalId !== input.externalId ||
        existing.pageDigest !== input.pageDigest ||
        existing.contentHash !== input.contentHash ||
        existing.sourceObservationId !== input.sourceObservationId ||
        existing.jobVersionId !== input.jobVersionId ||
        existing.qualificationState !== input.qualificationState ||
        existing.parserVersion !== input.parserVersion ||
        existing.policyVersion !== input.policyVersion ||
        existing.verifiedAt !== input.verifiedAt
      ) {
        throw new Error("SOURCE_VERIFICATION_CONFLICT", { cause: error });
      }
      // Identical insertion is safe only for an exact replay; the caller's
      // logical-page guard normally handles this before reaching the insert.
    }
  }

  private resolveOrCreateJobSource(input: {
    preferredId: string;
    name: string;
    capabilitiesJson: string;
    observedAt: string;
  }): string {
    const existingByName = this.sqlite
      .prepare("SELECT id FROM job_sources WHERE name=?")
      .get(input.name) as { id: string } | undefined;
    const preferredIdOwner = this.sqlite
      .prepare("SELECT name FROM job_sources WHERE id=?")
      .get(input.preferredId) as { name: string } | undefined;
    if (preferredIdOwner && preferredIdOwner.name !== input.name) {
      throw new Error("JOB_SOURCE_IDENTITY_CONFLICT");
    }
    if (existingByName) {
      this.sqlite
        .prepare("UPDATE job_sources SET capabilities_json=?,updated_at=? WHERE id=?")
        .run(input.capabilitiesJson, input.observedAt, existingByName.id);
      return existingByName.id;
    }

    try {
      this.sqlite
        .prepare(
          `INSERT INTO job_sources (id,name,capabilities_json,enabled,created_at,updated_at)
           VALUES (?,?,?,1,?,?) ON CONFLICT(name) DO NOTHING`,
        )
        .run(
          input.preferredId,
          input.name,
          input.capabilitiesJson,
          input.observedAt,
          input.observedAt,
        );
    } catch (error) {
      const conflictingOwner = this.sqlite
        .prepare("SELECT name FROM job_sources WHERE id=?")
        .get(input.preferredId) as { name: string } | undefined;
      if (conflictingOwner && conflictingOwner.name !== input.name) {
        throw new Error("JOB_SOURCE_IDENTITY_CONFLICT", { cause: error });
      }
      throw error;
    }
    const resolved = this.sqlite
      .prepare("SELECT id FROM job_sources WHERE name=?")
      .get(input.name) as { id: string } | undefined;
    if (!resolved) throw new Error("JOB_SOURCE_IDENTITY_RESOLUTION_FAILED");
    this.sqlite
      .prepare("UPDATE job_sources SET capabilities_json=?,updated_at=? WHERE id=?")
      .run(input.capabilitiesJson, input.observedAt, resolved.id);
    return resolved.id;
  }

  private persistProviderObservation(
    record: LeverPostingRecordV2 | GreenhousePostingRecordV2,
    capability: SourceCapabilityV2,
    runId: string,
    observedAt: string,
    persistenceContext: PersistenceContext,
    recordIndex: number,
  ): {
    jobId: string;
    created: boolean;
    observationId: string;
    jobVersionId: string | null;
  } {
    this.setPersistencePhase(persistenceContext, "SOURCE_IDENTITY", recordIndex, record.externalId);
    if (
      record.source !== capability.source ||
      record.region !== capability.region ||
      record.tenant !== capability.tenant
    ) {
      throw new Error("SOURCE_RECORD_CAPABILITY_MISMATCH");
    }
    const isLever = record.source === "LEVER";
    const location = isLever
      ? (record.location ?? record.allLocations[0] ?? null)
      : record.location;
    if (!location || !record.description.trim())
      throw new Error("SOURCE_RECORD_REQUIRED_FIELD_MISSING");
    const identity = `${record.source}\n${record.region}\n${record.tenant}\n${record.externalId}`;
    const jobId = `source-job-${sha256(identity).slice(0, 32)}`;
    const observationId = `source-observation-${sha256(`${identity}\n${record.contentDigest}`)}`;
    this.setPersistencePhase(persistenceContext, "SOURCE_IDENTITY", recordIndex, record.externalId);
    const existingObservation = this.sqlite
      .prepare("SELECT 1 FROM source_observations WHERE id = ?")
      .get(observationId);
    if (existingObservation) {
      const existingVersion = this.sqlite
        .prepare(
          `SELECT id FROM job_versions
           WHERE source_observation_id=? ORDER BY version DESC LIMIT 1`,
        )
        .get(observationId) as { id: string } | undefined;
      return {
        jobId,
        created: false,
        observationId,
        jobVersionId: existingVersion?.id ?? null,
      };
    }
    this.setPersistencePhase(
      persistenceContext,
      "JOB_NORMALIZATION",
      recordIndex,
      record.externalId,
    );
    const structured = isLever
      ? structuredLeverRecord(record, capability)
      : structuredGreenhouseRecord(record, capability);
    const r2aStructured = isLever
      ? structured
      : structuredGreenhouseEvidenceRecord(record, capability);
    const sourceText = serializeR2AStructuredSource(r2aStructured);
    const fields = ParsedJobFieldsSchema.parse({
      externalId: record.externalId,
      sourceUrl: record.sourceUrl,
      applicationUrl: record.applicationUrl,
      requisitionId: null,
      title: record.title,
      company: capability.alias,
      location,
      category: isLever
        ? ([record.department, record.team].find(
            (value): value is string => typeof value === "string" && value.length <= 128 * 1_024,
          ) ?? null)
        : null,
      description: record.description,
      salaryText: null,
      employmentType: isLever ? employmentType(record.commitment) : "UNKNOWN",
      requirements: isLever ? evidenceLines(record, "REQUIREMENTS") : [],
      responsibilities: isLever ? evidenceLines(record, "RESPONSIBILITIES") : [],
      datePosted: isLever ? record.postedAt : null,
      coverLetterRequired: null,
    });
    const job = normalizeImportedJob(
      fields,
      record.source,
      {
        importId: runId,
        recordId: observationId,
        parserVersion: capability.parserVersion,
        acquisitionMethod: "APPROVED_SOURCE_FETCH",
        contentHash: record.contentDigest,
        now: observedAt,
        editedFields: [],
      },
      jobId,
    );
    const sourceName = `${record.source}:${capability.region}:${capability.tenant}`;
    const sourceDigest = sha256(`${capability.region}\n${capability.tenant}`).slice(0, 24);
    this.setPersistencePhase(persistenceContext, "SOURCE_IDENTITY", recordIndex, record.externalId);
    const sourceId = this.resolveOrCreateJobSource({
      preferredId: isLever ? `source-lever-${sourceDigest}` : `source-greenhouse-${sourceDigest}`,
      name: sourceName,
      capabilitiesJson: JSON.stringify({
        reader: isLever ? "R1B" : "GREENHOUSE_V2",
        version: capability.parserVersion,
      }),
      observedAt,
    });
    this.setPersistencePhase(persistenceContext, "JOB_UPSERT", recordIndex, record.externalId);
    const exists = this.sqlite.prepare("SELECT 1 FROM jobs WHERE id = ?").get(jobId);
    if (!exists) {
      this.sqlite
        .prepare(
          `INSERT INTO jobs
            (id,title,company,category,location,employment_type,normalized_json,eligibility_status,
             fit_score,application_status,date_posted,date_discovered,date_updated,created_at,updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'NEW', ?, ?, NULL, ?, ?)`,
        )
        .run(
          job.id,
          job.title,
          job.company,
          job.category,
          job.location,
          job.employmentType,
          JSON.stringify(job),
          job.datePosted,
          observedAt,
          observedAt,
          observedAt,
        );
    } else {
      this.sqlite
        .prepare(
          `UPDATE jobs SET title=?, company=?, category=?, location=?, employment_type=?,
             normalized_json=?, eligibility_status=NULL, fit_score=NULL, date_posted=?,
             date_updated=?, updated_at=? WHERE id=?`,
        )
        .run(
          job.title,
          job.company,
          job.category,
          job.location,
          job.employmentType,
          JSON.stringify(job),
          job.datePosted,
          observedAt,
          observedAt,
          job.id,
        );
    }
    const sourceRecordId = `source-record-${sha256(identity)}`;
    this.setPersistencePhase(
      persistenceContext,
      "SOURCE_RECORD_UPSERT",
      recordIndex,
      record.externalId,
    );
    this.sqlite
      .prepare(
        `INSERT INTO job_source_records
          (id,job_id,source_id,external_id,source_url,raw_payload_json,payload_hash,discovered_at,
           fetched_at,identity_kind,identity_value,acquisition_method)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EXTERNAL_ID', ?, 'APPROVED_SOURCE_FETCH')
         ON CONFLICT(source_id,identity_kind,identity_value) DO UPDATE SET
           job_id=excluded.job_id, source_url=excluded.source_url,
           fetched_at=excluded.fetched_at`,
      )
      .run(
        sourceRecordId,
        jobId,
        sourceId,
        record.externalId,
        record.sourceUrl,
        JSON.stringify(record.rawPayload),
        record.contentDigest,
        observedAt,
        observedAt,
        record.externalId,
      );
    this.setPersistencePhase(
      persistenceContext,
      "SOURCE_RECORD_LOOKUP",
      recordIndex,
      record.externalId,
    );
    const persistedSourceRecord = this.sqlite
      .prepare(
        `SELECT id FROM job_source_records
         WHERE source_id = ? AND identity_kind = 'EXTERNAL_ID' AND identity_value = ?`,
      )
      .get(sourceId, record.externalId) as { id: string } | undefined;
    if (!persistedSourceRecord) throw new Error("PERSISTENCE_FAILED");
    const previousObservation = this.sqlite
      .prepare(
        `SELECT id FROM source_observations
         WHERE source_record_id=? ORDER BY observed_at DESC,rowid DESC LIMIT 1`,
      )
      .get(persistedSourceRecord.id) as { id: string } | undefined;
    this.setPersistencePhase(
      persistenceContext,
      "OBSERVATION_INSERT",
      recordIndex,
      record.externalId,
    );
    this.sqlite
      .prepare(
        `INSERT INTO source_observations
          (id,job_id,source_record_id,source,tenant,external_id,source_url,acquisition_method,
           content_hash,raw_snapshot_reference,observed_at,posted_at,expires_at,parser_version,
           policy_version,run_id,supersedes_observation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'APPROVED_SOURCE_FETCH', ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        observationId,
        jobId,
        persistedSourceRecord.id,
        record.source,
        capability.tenant,
        record.externalId,
        record.sourceUrl,
        record.contentDigest,
        `source_observation_payloads:${observationId}`,
        observedAt,
        isLever ? record.postedAt : null,
        capability.parserVersion,
        capability.policyVersion,
        runId,
        previousObservation?.id ?? null,
      );
    this.setPersistencePhase(persistenceContext, "PAYLOAD_INSERT", recordIndex, record.externalId);
    this.sqlite
      .prepare(
        `INSERT INTO source_observation_payloads
          (observation_id,payload_json,content_digest,created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(observationId, JSON.stringify(record.rawPayload), record.contentDigest, observedAt);
    const version = Number(
      this.sqlite
        .prepare("SELECT coalesce(max(version),0)+1 FROM job_versions WHERE job_id = ?")
        .pluck()
        .get(jobId),
    );
    const jobVersionId = `source-job-version-${sha256(`${jobId}\n${version}\n${record.contentDigest}`)}`;
    this.setPersistencePhase(
      persistenceContext,
      "JOB_VERSION_INSERT",
      recordIndex,
      record.externalId,
    );
    this.sqlite
      .prepare(
        `INSERT INTO job_versions
          (id,job_id,version,normalized_json,content_digest,source_observation_id,created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        jobVersionId,
        jobId,
        version,
        JSON.stringify(job),
        record.contentDigest,
        observationId,
        observedAt,
      );
    this.setPersistencePhase(
      persistenceContext,
      "R2A_NORMALIZATION",
      recordIndex,
      record.externalId,
    );
    const normalization = normalizeR2AJobEvidence({
      sourceText,
      sourceObservationId: observationId,
      structured: r2aStructured,
      diagnosticStructure: structured,
      explicitLocation: location,
    });
    this.setPersistencePhase(persistenceContext, "R2A_PERSIST", recordIndex, record.externalId);
    new R2ARepository(this.sqlite, this.now).recordNormalization(jobVersionId, normalization);
    this.setPersistencePhase(
      persistenceContext,
      "DUPLICATE_SUGGESTION",
      recordIndex,
      record.externalId,
    );
    this.suggestCrossSourceDuplicates(
      observationId,
      capability.source,
      capability.tenant,
      persistenceContext,
      recordIndex,
      record.externalId,
    );
    return { jobId, created: true, observationId, jobVersionId };
  }

  private observationIdentity(
    observationId: string,
    persistenceContext: PersistenceContext,
    recordIndex: number,
    externalId: string,
  ): ObservationIdentity {
    this.setPersistencePhase(persistenceContext, "DUPLICATE_IDENTITY", recordIndex, externalId);
    const row = this.sqlite
      .prepare(
        `SELECT o.id AS observationId,o.source,o.tenant,o.external_id AS externalId,
         v.normalized_json AS normalizedJson FROM source_observations o
         JOIN job_versions v ON v.id=(SELECT first.id FROM job_versions first
           WHERE first.source_observation_id=o.id ORDER BY first.version,first.rowid LIMIT 1)
         WHERE o.id=?`,
      )
      .get(observationId) as
      | {
          observationId: string;
          source: string;
          tenant: string | null;
          externalId: string | null;
          normalizedJson: string;
        }
      | undefined;
    if (!row) throw new Error("R2_DUPLICATE_OBSERVATION_VERSION_REQUIRED");
    const job = JobSchema.parse(JSON.parse(row.normalizedJson));
    return ObservationIdentitySchema.parse({
      observationId: row.observationId,
      source: row.source,
      tenant: row.tenant,
      externalId: row.externalId,
      applicationUrl: job.sourceMetadata.applicationUrl ?? null,
      requisitionId: job.sourceMetadata.requisitionId ?? null,
      company: job.company,
      title: job.title,
      location: job.location,
      employmentType: job.employmentType,
      datePosted: job.datePosted,
      description: job.description,
    });
  }

  private suggestCrossSourceDuplicates(
    observationId: string,
    source: string,
    tenant: string,
    persistenceContext: PersistenceContext,
    recordIndex: number,
    externalId: string,
  ): void {
    const r2 = new R2Repository(this.sqlite, this.now);
    if (!r2.available()) return;
    const candidateIds = this.sqlite
      .prepare(
        `SELECT id FROM source_observations
         WHERE id<>? AND NOT (source=? AND coalesce(tenant,'')=?)
         ORDER BY observed_at DESC,rowid DESC LIMIT 200`,
      )
      .all(observationId, source, tenant) as Array<{ id: string }>;
    const current = this.observationIdentity(
      observationId,
      persistenceContext,
      recordIndex,
      externalId,
    );
    for (const candidate of candidateIds) {
      this.setPersistencePhase(persistenceContext, "DUPLICATE_SUGGESTION", recordIndex, externalId);
      r2.suggestDuplicate(
        current,
        this.observationIdentity(candidate.id, persistenceContext, recordIndex, externalId),
      );
    }
  }

  private finish(
    runId: string,
    status: "COMPLETE" | "STOPPED",
    budget: SourceRunBudget,
    code: string | null,
    retryAfter: string | null,
    transportStage: SourceTransportLifecycleStage | null,
    schemaDiagnostic: SourceSchemaDiagnostic | null,
    completedAt: string,
    persistenceDiagnostic: SourcePersistenceDiagnostic | null = null,
  ): void {
    const result = this.sqlite
      .prepare(
        `UPDATE source_run_checkpoints SET status=?, request_count=?, page_count=?, record_count=?,
           byte_count=?, retry_count=?, redirect_count=?, safe_error_code=?, retry_after=?,
           completed_at=?, updated_at=? WHERE id=? AND status='RUNNING'`,
      )
      .run(
        status,
        budget.attempts,
        budget.pages,
        budget.records,
        budget.bytes,
        budget.retries,
        budget.redirects,
        code,
        retryAfter,
        completedAt,
        completedAt,
        runId,
      );
    if (result.changes !== 1) {
      const existing = this.sqlite
        .prepare("SELECT status FROM source_run_checkpoints WHERE id=?")
        .get(runId) as { status: string } | undefined;
      if (existing?.status === "STOPPED") return;
      throw new Error("SOURCE_RUN_NOT_ACTIVE");
    }
    if (code) {
      const audit = validateSourceAuditMetadata("source.run.stopped", {
        runId,
        code: SourceStopCodeSchema.safeParse(code).success ? code : "PERSISTENCE_FAILED",
        transportStage,
        ...(code === "SCHEMA_CHANGED" && schemaDiagnostic ? { schemaDiagnostic } : {}),
        ...(persistenceDiagnostic
          ? {
              persistenceDiagnostic: SourcePersistenceDiagnosticSchema.parse(persistenceDiagnostic),
            }
          : {}),
        requestCount: budget.attempts,
        recordCount: budget.records,
      });
      this.audit("source.run.stopped", "source_run", runId, audit);
    } else {
      const audit = validateSourceAuditMetadata("source.run.completed", {
        runId,
        requestCount: budget.attempts,
        pageCount: budget.pages,
        recordCount: budget.records,
      });
      this.audit("source.run.completed", "source_run", runId, audit);
    }
  }

  private audit(eventType: string, entityType: string, entityId: string, metadata: object): void {
    this.sqlite
      .prepare(
        `INSERT INTO audit_events
         (id,event_type,entity_type,entity_id,actor,redacted_metadata_json,occurred_at)
         VALUES (?,?,?,?, 'SYSTEM', ?, ?)`,
      )
      .run(
        this.id(),
        eventType,
        entityType,
        entityId,
        JSON.stringify(metadata),
        this.now().toISOString(),
      );
  }
}

export async function runLeverSourceToQueue(input: {
  capability: SourceCapabilityV2;
  repository: SourceEnablementRepository;
  ownerReceiptChain: SourceOwnerReceiptChain;
  evaluateJob(jobId: string): Promise<string | null>;
  queueJob(jobId: string, evaluationId: string): Promise<void> | void;
  now?: () => Date;
  signal?: AbortSignal;
  dependencies?: SecureSourceTransportDependencies;
}) {
  let result;
  try {
    result = await runLeverSourceDiscovery({
      capability: input.capability,
      sink: input.repository,
      ownerReceiptChain: input.ownerReceiptChain,
      now: input.now,
      signal: input.signal,
      dependencies: input.dependencies,
    });
  } catch (error) {
    input.repository.failOwnerStartReceipt(input.ownerReceiptChain.startReceiptId);
    throw error;
  }
  const queuedJobIds: string[] = [];
  if (result.status === "COMPLETE") {
    for (const work of input.repository.pipelineWorkForCompletedRun(result.runId)) {
      const { jobId } = work;
      const evaluationId = work.evaluationId ?? (await input.evaluateJob(jobId));
      if (!evaluationId) continue;
      await input.queueJob(jobId, evaluationId);
      queuedJobIds.push(jobId);
    }
  }
  return { ...result, queuedJobIds };
}

export async function runLeverDetailToQueue(input: {
  capability: SourceCapabilityV2;
  repository: SourceEnablementRepository;
  ownerReceiptChain: SourceOwnerReceiptChain;
  externalId: string;
  evaluateJob(jobId: string): Promise<string | null>;
  queueJob(jobId: string, evaluationId: string): Promise<void> | void;
  now?: () => Date;
  signal?: AbortSignal;
  dependencies?: SecureSourceTransportDependencies;
}): Promise<LeverDetailSourceRunResult & { queuedJobIds: string[] }> {
  let result: LeverDetailSourceRunResult;
  try {
    result = await runLeverDetailSourceDiscovery({
      capability: input.capability,
      sink: input.repository,
      ownerReceiptChain: input.ownerReceiptChain,
      externalId: input.externalId,
      now: input.now,
      signal: input.signal,
      dependencies: input.dependencies,
    });
  } catch (error) {
    input.repository.failOwnerStartReceipt(input.ownerReceiptChain.startReceiptId);
    throw error;
  }
  const queuedJobIds: string[] = [];
  if (result.status === "COMPLETE") {
    for (const work of input.repository.pipelineWorkForCompletedRun(result.runId)) {
      const evaluationId = work.evaluationId ?? (await input.evaluateJob(work.jobId));
      if (!evaluationId) continue;
      await input.queueJob(work.jobId, evaluationId);
      queuedJobIds.push(work.jobId);
    }
  }
  return { ...result, queuedJobIds };
}

export async function runGreenhouseSourceToQueue(input: {
  capability: SourceCapabilityV2;
  repository: SourceEnablementRepository;
  ownerReceiptChain: SourceOwnerReceiptChain;
  evaluateJob(jobId: string): Promise<string | null>;
  queueJob(jobId: string, evaluationId: string): Promise<void> | void;
  now?: () => Date;
  signal?: AbortSignal;
  dependencies?: SecureSourceTransportDependencies;
}) {
  let result;
  try {
    result = await runGreenhouseSourceDiscovery({
      capability: input.capability,
      sink: input.repository,
      ownerReceiptChain: input.ownerReceiptChain,
      now: input.now,
      signal: input.signal,
      dependencies: input.dependencies,
    });
  } catch (error) {
    input.repository.failOwnerStartReceipt(input.ownerReceiptChain.startReceiptId);
    throw error;
  }
  const queuedJobIds: string[] = [];
  if (result.status === "COMPLETE") {
    for (const work of input.repository.pipelineWorkForCompletedRun(result.runId)) {
      const { jobId } = work;
      const evaluationId = work.evaluationId ?? (await input.evaluateJob(jobId));
      if (!evaluationId) continue;
      await input.queueJob(jobId, evaluationId);
      queuedJobIds.push(jobId);
    }
  }
  return { ...result, queuedJobIds };
}

export async function runGreenhouseDetailToQueue(input: {
  capability: SourceCapabilityV2;
  repository: SourceEnablementRepository;
  ownerReceiptChain: SourceOwnerReceiptChain;
  externalId: string;
  evaluateJob(jobId: string): Promise<string | null>;
  queueJob(jobId: string, evaluationId: string): Promise<void> | void;
  now?: () => Date;
  signal?: AbortSignal;
  dependencies?: SecureSourceTransportDependencies;
}) {
  let result;
  try {
    result = await runGreenhouseDetailSourceDiscovery({
      capability: input.capability,
      sink: input.repository,
      ownerReceiptChain: input.ownerReceiptChain,
      externalId: input.externalId,
      now: input.now,
      signal: input.signal,
      dependencies: input.dependencies,
    });
  } catch (error) {
    input.repository.failOwnerStartReceipt(input.ownerReceiptChain.startReceiptId);
    throw error;
  }
  const queuedJobIds: string[] = [];
  if (result.status === "COMPLETE") {
    for (const work of input.repository.pipelineWorkForCompletedRun(result.runId)) {
      const { jobId } = work;
      const evaluationId = work.evaluationId ?? (await input.evaluateJob(jobId));
      if (!evaluationId) continue;
      await input.queueJob(jobId, evaluationId);
      queuedJobIds.push(jobId);
    }
  }
  return { ...result, queuedJobIds };
}
