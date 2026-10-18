import { createHash } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

import {
  CandidateProfileSchema,
  candidateProfileContentHash,
  type CandidateProfile,
} from "@applypilot/candidate-profile";
import {
  evaluateR2Eligibility,
  R2_ELIGIBILITY_ENGINE_VERSION,
  type R2EligibilityResult,
} from "@applypilot/eligibility-engine";
import {
  assessR2Calibration,
  r2OrdinalBand,
  scoreR2JobFit,
  R2_FIT_SCORER_VERSION,
  R2_FIT_WEIGHT_VERSION,
  R2_GOLDEN_CORPUS_VERSION,
  R2_UNREVIEWED_CALIBRATION_CONTEXT,
  R2CalibrationCampaignRequestSchema,
  R2CalibrationLabelRequestSchema,
  R2CalibrationPairRequestSchema,
  R2CalibrationThresholdPrecommitSchema,
  R2CalibrationSafetyBundleSchema,
  R2CalibrationSafetyEngineSchema,
  R2CalibrationSafetyGatesSchema,
  R2CalibrationDigestSchema,
  R2CalibrationIdSchema,
  R2_CALIBRATION_INTAKE_VERSION,
  R2_OCCUPATION_TAXONOMY_VERSION,
  R2_CALIBRATION_MAXIMUM_MEMBERS,
  assertR2CalibrationOwnerProvenance,
  r2CalibrationCreateBinding,
  r2CalibrationLabelBinding,
  r2CalibrationPairBinding,
  r2CalibrationSafetyDigest,
  type R2CalibrationAssessment,
  type R2CalibrationGateInput,
  type R2CalibrationOwnerApproval,
  type R2CalibrationOwnerProvenance,
  type R2CalibrationThresholdPrecommit,
  type R2CalibrationSafetyEngine,
  type ValidatedR2CalibrationSafety,
  type R2FitResult,
  type R2CalibrationLabelRequest,
  type R2CalibrationPairRequest,
} from "@applypilot/fit-scorer";
import {
  JobSchema,
  R2A_PARSER_VERSION,
  R2A_NORMALIZATION_VERSION,
  R2A_EVIDENCE_CONTRACT_VERSION,
  type Job,
  type R2ANormalization,
} from "@applypilot/job-model";
import {
  SourceCapabilityV2Schema,
  SourceRequestBindingSchema,
  sourceRequestBindingDigest,
} from "@applypilot/job-sources";

import { normalizeRetainedSourcePosting } from "./retained-source-projection";

const digest = r2CalibrationSafetyDigest;
const maximumJsonBytes = 16 * 1024 * 1024;

export function calibrationJson(input: string): unknown {
  if (typeof input !== "string" || Buffer.byteLength(input) > maximumJsonBytes)
    throw new Error("R2_CALIBRATION_EVIDENCE_INVALID");
  return JSON.parse(input);
}

export function currentR2CalibrationEngine(): R2CalibrationSafetyEngine {
  return R2CalibrationSafetyEngineSchema.parse({
    parserVersion: R2A_PARSER_VERSION,
    normalizationVersion: R2A_NORMALIZATION_VERSION,
    evidenceContractVersion: R2A_EVIDENCE_CONTRACT_VERSION,
    eligibilityEngineVersion: R2_ELIGIBILITY_ENGINE_VERSION,
    scorerVersion: R2_FIT_SCORER_VERSION,
    weightVersion: R2_FIT_WEIGHT_VERSION,
    goldenCorpusVersion: R2_GOLDEN_CORPUS_VERSION,
  });
}

export interface R2CalibrationProfileContext {
  profileVersionId: string;
  profileHash: string;
  profile: CandidateProfile;
}

/** No profile creation, activation or inference: a single genuine stored active snapshot is required. */
export function readR2CalibrationProfile(
  sqlite: BetterSqlite3.Database,
  expectedHash?: string,
): R2CalibrationProfileContext {
  const rows = sqlite
    .prepare(
      `SELECT v.id,p.id AS profileId,v.content_hash AS hash,v.snapshot_json AS json
    FROM candidate_profiles p JOIN candidate_profile_versions v ON v.id=p.active_version_id AND v.profile_id=p.id`,
    )
    .all() as Array<{ id: string; profileId: string; hash: string; json: string }>;
  if (rows.length !== 1) throw new Error("R2_CALIBRATION_ACTIVE_PROFILE_REQUIRED");
  const row = rows[0]!;
  const profile = CandidateProfileSchema.parse(calibrationJson(row.json));
  const profileHash = candidateProfileContentHash(profile);
  if (
    profile.profileId !== row.profileId ||
    profileHash !== row.hash ||
    (expectedHash !== undefined && expectedHash !== profileHash)
  )
    throw new Error("R2_CALIBRATION_PROFILE_CHANGED");
  return { profileVersionId: R2CalibrationIdSchema.parse(row.id), profileHash, profile };
}

export interface R2CalibrationComparison {
  schemaVersion: 1;
  purpose: "CALIBRATION_OFFLINE";
  id: string;
  jobId: string;
  jobVersionId: string;
  sourceObservationId: string;
  originalIdentity: string;
  source: "LEVER" | "GREENHOUSE";
  region: "GLOBAL" | "EU";
  tenant: string;
  externalId: string;
  contentHash: string;
  payloadSha256: string;
  sourceTextDigest: string;
  verifiedAt: string;
  observedAt: string;
  verificationId: string;
  verificationDigest: string;
  canonicalJobDigest: string;
  duplicateContextDigest: string;
  unresolvedDirectDuplicateCount: number;
  profileVersionId: string;
  profileHash: string;
  engine: R2CalibrationSafetyEngine;
  engineDigest: string;
  job: Job;
  normalization: R2ANormalization;
  eligibility: R2EligibilityResult;
  fit: R2FitResult;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Rebuild from the latest immutable canonical job and its exact retained qualified source lineage. */
export function deriveR2CalibrationComparison(
  sqlite: BetterSqlite3.Database,
  input: {
    jobId: string;
    comparisonId: string;
    profile: R2CalibrationProfileContext;
  },
): R2CalibrationComparison {
  const jobId = R2CalibrationIdSchema.parse(input.jobId),
    comparisonId = R2CalibrationIdSchema.parse(input.comparisonId);
  const row = sqlite
    .prepare(
      `SELECT jv.id AS jobVersionId,jv.normalized_json AS jobJson,
    o.id AS observationId,o.source,o.tenant,o.external_id AS externalId,o.content_hash AS contentHash,
    o.observed_at AS observedAt,o.run_id AS observationRunId,p.payload_json AS payloadJson,p.content_digest AS payloadDigest
    FROM job_versions jv JOIN source_observations o ON o.id=jv.source_observation_id AND o.job_id=jv.job_id
    JOIN source_observation_payloads p ON p.observation_id=o.id
    WHERE jv.job_id=? ORDER BY jv.version DESC LIMIT 1`,
    )
    .get(jobId) as
    | {
        jobVersionId: string;
        jobJson: string;
        observationId: string;
        source: string;
        tenant: string;
        externalId: string;
        contentHash: string;
        observedAt: string;
        observationRunId: string;
        payloadJson: string;
        payloadDigest: string;
      }
    | undefined;
  if (!row || !["LEVER", "GREENHOUSE"].includes(row.source))
    throw new Error("R2_CALIBRATION_RETAINED_SOURCE_REQUIRED");
  const job = JobSchema.parse(calibrationJson(row.jobJson));
  const latest = sqlite
    .prepare("SELECT id FROM job_versions WHERE job_id=? ORDER BY version DESC LIMIT 1")
    .get(jobId) as { id: string };
  if (job.id !== jobId || latest.id !== row.jobVersionId)
    throw new Error("R2_CALIBRATION_JOB_CHANGED");
  // Owner correction replay is intentionally unsupported here; silently discarding it would change the subject.
  if (sqlite.prepare("SELECT 1 FROM job_corrections WHERE job_id=? LIMIT 1").get(jobId))
    throw new Error("R2_CALIBRATION_CORRECTION_REPLAY_UNSUPPORTED");
  const verification = sqlite
    .prepare(
      `SELECT v.*,c.*,
      v.id AS verificationId,v.job_version_id AS providerJobVersionId,v.verified_at AS verifiedAt,
      c.id AS capabilityVersionId,c.source AS capabilitySource,c.tenant AS capabilityTenant,
      c.parser_version AS capabilityParser,c.created_at AS capabilityCreatedAt,predecessor.version AS predecessorVersion,
      b.id AS derivationBindingId,b.derivation_digest AS derivationDigest,b.parser_version AS derivationParser,
      b.normalization_version AS derivationNormalizer
    FROM source_record_verifications v
    JOIN source_run_checkpoints r ON r.id=v.run_id AND r.status='COMPLETE' AND r.capability_version_id=v.capability_version_id
    JOIN source_capability_versions c ON c.id=v.capability_version_id AND c.configuration_digest=r.capability_digest
      AND c.source=v.source AND c.tenant=v.tenant AND c.parser_version=v.parser_version AND c.policy_version=v.policy_version
    LEFT JOIN source_capability_versions predecessor ON predecessor.id=c.predecessor_id
    JOIN source_run_pages p ON p.id=v.page_id AND p.run_id=v.run_id AND p.page_digest=v.page_digest AND v.record_index<p.record_count
    LEFT JOIN source_derivation_bindings b ON b.verification_id=v.id AND b.source_observation_id=v.source_observation_id
      AND b.content_hash=v.content_hash AND b.parent_job_version_id=v.job_version_id AND b.derived_job_version_id=?
    WHERE v.source_observation_id=? AND v.source=? AND v.tenant=? AND v.external_id=? AND v.content_hash=?
      AND v.disposition='ACCEPTED' AND v.qualification_state='QUALIFIED'
      AND (v.job_version_id=? OR b.id IS NOT NULL)
    ORDER BY v.verified_at DESC,v.rowid DESC LIMIT 1`,
    )
    .get(
      row.jobVersionId,
      row.observationId,
      row.source,
      row.tenant,
      row.externalId,
      row.contentHash,
      row.jobVersionId,
    ) as Record<string, unknown> | undefined;
  if (!verification || row.payloadDigest !== row.contentHash || !row.observationRunId)
    throw new Error("R2_CALIBRATION_SOURCE_LINEAGE_REQUIRED");
  const historicalRun = sqlite
    .prepare(
      `SELECT 1 FROM source_run_checkpoints r JOIN source_capability_versions c
      ON c.id=r.capability_version_id AND c.configuration_digest=r.capability_digest
    JOIN source_observations o ON o.run_id=r.id AND o.source=c.source AND o.tenant=c.tenant
      AND o.parser_version=c.parser_version AND o.policy_version=c.policy_version
    WHERE o.id=? AND r.status='COMPLETE'`,
    )
    .get(row.observationId);
  if (!historicalRun) throw new Error("R2_CALIBRATION_SOURCE_LINEAGE_REQUIRED");
  // Same immutable derivation formula as the existing canonical repository, using its historical versions.
  if (
    verification.derivationBindingId &&
    verification.derivationDigest !==
      sha256(
        [
          verification.verificationId,
          row.observationId,
          row.contentHash,
          verification.providerJobVersionId,
          row.jobVersionId,
          verification.derivationParser,
          verification.derivationNormalizer,
        ].join("\n"),
      )
  )
    throw new Error("R2_CALIBRATION_SOURCE_LINEAGE_REQUIRED");
  const requestRow = sqlite
    .prepare(
      "SELECT request_json,request_digest FROM source_capability_request_bindings WHERE capability_version_id=?",
    )
    .get(verification.capabilityVersionId) as
    | { request_json: string; request_digest: string }
    | undefined;
  const requestBinding = requestRow
    ? SourceRequestBindingSchema.parse(calibrationJson(requestRow.request_json))
    : undefined;
  if (requestBinding && sourceRequestBindingDigest(requestBinding) !== requestRow!.request_digest)
    throw new Error("R2_CALIBRATION_SOURCE_LINEAGE_REQUIRED");
  const capability = SourceCapabilityV2Schema.parse({
    schemaVersion: 2,
    capabilityId: verification.capability_id,
    version: verification.version,
    predecessorVersion: verification.predecessorVersion,
    source: verification.capabilitySource,
    alias: verification.alias,
    tenant: verification.capabilityTenant,
    region: verification.region,
    allowedHost: verification.allowed_host,
    allowedPathPrefix: verification.allowed_path_prefix,
    allowedOperations: calibrationJson(String(verification.allowed_operations_json)),
    approvalState: verification.approval_state,
    approvalReference: verification.approval_reference,
    approvedAt: verification.approved_at,
    policyVersion: verification.policy_version,
    policyReviewedAt: verification.policy_reviewed_at,
    policyExpiresAt: verification.policy_expires_at,
    capabilityExpiresAt: verification.capability_expires_at,
    requestBudget: verification.request_budget,
    recordCap: verification.record_cap,
    pageSizeCap: verification.page_size_cap,
    responseByteLimit: verification.response_byte_limit,
    requestTimeoutMs: verification.request_timeout_ms,
    runTimeoutMs: verification.run_timeout_ms,
    maxRedirects: verification.max_redirects,
    maxRetries: verification.max_retries,
    maxConcurrency: verification.max_concurrency,
    parserVersion: verification.capabilityParser,
    createdAt: verification.capabilityCreatedAt,
    updatedAt: verification.capabilityCreatedAt,
    revokedAt: verification.revoked_at,
    revocationReason: verification.revocation_reason,
    ...(requestBinding ? { requestBinding } : {}),
  });
  const source = row.source as "LEVER" | "GREENHOUSE",
    payloadSha256 = sha256(row.payloadJson);
  const retained = normalizeRetainedSourcePosting({
    payloadJson: row.payloadJson,
    capability,
    job,
    expected: {
      source,
      region: capability.region,
      tenant: row.tenant,
      externalId: row.externalId,
      sourceObservationId: row.observationId,
      contentHash: row.contentHash,
      payloadSha256,
    },
  });
  const engine = currentR2CalibrationEngine(),
    normalization = retained.normalization;
  const eligibility = evaluateR2Eligibility({
    profile: input.profile.profile,
    normalization,
    evaluatedAt: row.observedAt,
    bindings: {
      jobVersionId: row.jobVersionId,
      currentJobVersionId: row.jobVersionId,
      profileVersionId: input.profile.profileVersionId,
      currentProfileVersionId: input.profile.profileVersionId,
      evidenceContractVersion: normalization.evidenceContractVersion,
      currentEvidenceContractVersion: engine.evidenceContractVersion,
      evaluationVersionId: comparisonId,
    },
  });
  const fit = scoreR2JobFit({
    profile: input.profile.profile,
    normalization,
    eligibility,
    calibrationContext: R2_UNREVIEWED_CALIBRATION_CONTEXT,
  });
  const duplicates = sqlite
    .prepare(
      `SELECT c.id,c.state,c.evidence_digest AS evidenceDigest,
      (SELECT d.version FROM r2_duplicate_decision_versions d WHERE d.candidate_id=c.id ORDER BY d.version DESC LIMIT 1) AS decisionVersion
    FROM r2_duplicate_candidates c WHERE c.left_observation_id IN (SELECT id FROM source_observations WHERE job_id=?)
      OR c.right_observation_id IN (SELECT id FROM source_observations WHERE job_id=?) ORDER BY c.id`,
    )
    .all(jobId, jobId) as Array<{ state: string }>;
  return {
    schemaVersion: 1,
    purpose: "CALIBRATION_OFFLINE",
    id: comparisonId,
    jobId,
    jobVersionId: row.jobVersionId,
    sourceObservationId: row.observationId,
    originalIdentity: digest({
      source,
      region: capability.region,
      tenant: row.tenant,
      externalId: row.externalId,
    }),
    source,
    region: capability.region,
    tenant: row.tenant,
    externalId: row.externalId,
    contentHash: row.contentHash,
    payloadSha256,
    sourceTextDigest: retained.sourceTextDigest,
    observedAt: z.iso.datetime().parse(row.observedAt),
    verifiedAt: z.iso.datetime().parse(verification.verifiedAt),
    verificationId: R2CalibrationIdSchema.parse(verification.verificationId),
    verificationDigest: digest({ verification, requestBinding: requestBinding ?? null }),
    canonicalJobDigest: digest(job),
    duplicateContextDigest: digest(duplicates),
    unresolvedDirectDuplicateCount: duplicates.filter((d) => d.state === "SUGGESTED").length,
    profileVersionId: input.profile.profileVersionId,
    profileHash: input.profile.profileHash,
    engine,
    engineDigest: digest(engine),
    job,
    normalization,
    eligibility,
    fit,
  };
}

export function calibrationComparisonId(campaignId: string, jobId: string): string {
  return `r2cmp_${digest({ campaignId, jobId }).slice(0, 40)}`;
}

/** Reuse source parsing only within this verified read snapshot; recompute the actual bound evaluator results. */
export function bindR2CalibrationComparison(
  comparison: R2CalibrationComparison,
  comparisonId: string,
  profile: R2CalibrationProfileContext,
): R2CalibrationComparison {
  const id = R2CalibrationIdSchema.parse(comparisonId);
  const eligibility = evaluateR2Eligibility({
    profile: profile.profile,
    normalization: comparison.normalization,
    evaluatedAt: comparison.observedAt,
    bindings: { ...comparison.eligibility.bindings, evaluationVersionId: id },
  });
  const fit = scoreR2JobFit({
    profile: profile.profile,
    normalization: comparison.normalization,
    eligibility,
    calibrationContext: R2_UNREVIEWED_CALIBRATION_CONTEXT,
  });
  return { ...comparison, id, eligibility, fit };
}

export function assertUniqueCalibrationMembers(
  sqlite: BetterSqlite3.Database,
  members: R2CalibrationComparison[],
): void {
  if (
    !members.length ||
    members.length > R2_CALIBRATION_MAXIMUM_MEMBERS ||
    new Set(members.map((m) => m.jobId)).size !== members.length ||
    new Set(members.map((m) => m.originalIdentity)).size !== members.length
  )
    throw new Error("R2_CALIBRATION_CORPUS_NOT_UNIQUE");
  const jobs = new Set(members.map((m) => m.jobId));
  // Known direct owner-linked jobs cannot be counted twice. Suggestions remain visible, not auto-cleared.
  for (const member of members) {
    const links = sqlite
      .prepare(
        `SELECT l.job_id AS leftJobId,r.job_id AS rightJobId FROM r2_duplicate_candidates c
      JOIN source_observations l ON l.id=c.left_observation_id JOIN source_observations r ON r.id=c.right_observation_id
      WHERE c.state='LINKED' AND (l.job_id=? OR r.job_id=?)`,
      )
      .all(member.jobId, member.jobId) as Array<{ leftJobId: string; rightJobId: string }>;
    if (
      links.some(
        (l) => l.leftJobId !== l.rightJobId && jobs.has(l.leftJobId) && jobs.has(l.rightJobId),
      )
    )
      throw new Error("R2_CALIBRATION_CORPUS_KNOWN_DUPLICATE");
  }
}

export function validateCalibrationSafety(
  safety: ValidatedR2CalibrationSafety,
  engine: R2CalibrationSafetyEngine,
): ValidatedR2CalibrationSafety {
  const bundle = R2CalibrationSafetyBundleSchema.parse(safety.bundle);
  const gates = R2CalibrationSafetyGatesSchema.parse(safety.gates);
  const engineDigest = digest(engine);
  if (
    safety.bundleDigest !== digest(bundle) ||
    safety.engineDigest !== engineDigest ||
    digest(bundle.engine) !== engineDigest ||
    safety.head !== bundle.head ||
    safety.tree !== bundle.tree ||
    Object.entries(gates).some(([k, v]) => k !== "version" && v !== true) ||
    safety.gates.version !== `r2-safety-v1:${safety.bundleDigest}`
  )
    throw new Error("R2_CALIBRATION_SAFETY_EVIDENCE_REQUIRED");
  return safety;
}

export interface R2CalibrationSelection {
  jobIds: string[];
  profile: R2CalibrationProfileContext;
  comparisons: R2CalibrationComparison[];
  contextDigest: string;
}

export function readR2CalibrationSelection(
  sqlite: BetterSqlite3.Database,
  jobIdsInput: string[],
  expectedProfileHash?: string,
): R2CalibrationSelection {
  const jobIds = z
    .array(R2CalibrationIdSchema)
    .min(1)
    .max(R2_CALIBRATION_MAXIMUM_MEMBERS)
    .parse(jobIdsInput)
    .sort();
  if (new Set(jobIds).size !== jobIds.length) throw new Error("R2_CALIBRATION_CORPUS_NOT_UNIQUE");
  const profile = readR2CalibrationProfile(sqlite, expectedProfileHash);
  const comparisons = jobIds.map((jobId) =>
    deriveR2CalibrationComparison(sqlite, {
      jobId,
      comparisonId: calibrationComparisonId("PREVIEW", jobId),
      profile,
    }),
  );
  assertUniqueCalibrationMembers(sqlite, comparisons);
  return {
    jobIds,
    profile,
    comparisons,
    contextDigest: digest({
      version: R2_CALIBRATION_INTAKE_VERSION,
      taxonomy: R2_OCCUPATION_TAXONOMY_VERSION,
      engine: currentR2CalibrationEngine(),
      profileVersionId: profile.profileVersionId,
      profileHash: profile.profileHash,
      comparisons,
    }),
  };
}

export interface R2CalibrationCampaign {
  id: string;
  engine: R2CalibrationSafetyEngine;
  engineDigest: string;
  profileVersionId: string;
  profileHash: string;
  memberDigest: string;
  corpusVersion: string;
  taxonomyVersion: string;
  thresholds: R2CalibrationThresholdPrecommit;
  thresholdsDigest: string;
  createRequest: z.infer<typeof R2CalibrationCampaignRequestSchema>;
  provenance: R2CalibrationOwnerProvenance;
  gateDigest: string;
  createdAt: string;
  campaignDigest: string;
}

export function calibrationCampaignDigest(
  campaign: Omit<R2CalibrationCampaign, "campaignDigest">,
): string {
  return digest(campaign);
}

export interface R2CalibrationLabelEvent {
  id: string;
  campaignId: string;
  comparisonId: string;
  revision: number;
  supersedesId: string | null;
  request: R2CalibrationLabelRequest;
  provenance: R2CalibrationOwnerProvenance;
  createdAt: string;
  eventDigest: string;
}
export interface R2CalibrationPairEvent {
  id: string;
  campaignId: string;
  leftComparisonId: string;
  rightComparisonId: string;
  preferredComparisonId: string;
  revision: number;
  supersedesId: string | null;
  request: R2CalibrationPairRequest;
  provenance: R2CalibrationOwnerProvenance;
  createdAt: string;
  eventDigest: string;
}
export interface R2CurrentCalibrationCampaign {
  campaign: R2CalibrationCampaign;
  profile: R2CalibrationProfileContext;
  comparisons: R2CalibrationComparison[];
  labels: R2CalibrationLabelEvent[];
  pairs: R2CalibrationPairEvent[];
  contextDigest: string;
  eventCount: number;
}

export function calibrationEventDigest(
  event: Omit<R2CalibrationLabelEvent | R2CalibrationPairEvent, "eventDigest">,
): string {
  return digest(event);
}

/** Every event advances one immutable hash chain, including revisions across both judgment kinds. */
export function nextCalibrationContext(previousContextDigest: string, eventDigest: string): string {
  return digest({ domain: "applypilot.calibration.events.v1", previousContextDigest, eventDigest });
}

export function readCurrentR2CalibrationCampaign(
  sqlite: BetterSqlite3.Database,
  campaignIdInput: string,
  expectedProfileHash?: string,
): R2CurrentCalibrationCampaign {
  const campaignId = R2CalibrationIdSchema.parse(campaignIdInput);
  const raw = sqlite
    .prepare("SELECT * FROM r2_calibration_campaigns WHERE id=?")
    .get(campaignId) as Record<string, string> | undefined;
  if (!raw) throw new Error("R2_CALIBRATION_CAMPAIGN_NOT_FOUND");
  const createRequest = R2CalibrationCampaignRequestSchema.parse(
    calibrationJson(raw.create_request_json!),
  );
  const campaign: R2CalibrationCampaign = {
    id: campaignId,
    engine: R2CalibrationSafetyEngineSchema.parse(calibrationJson(raw.engine_json!)),
    engineDigest: R2CalibrationDigestSchema.parse(raw.engine_digest),
    profileVersionId: R2CalibrationIdSchema.parse(raw.profile_version_id),
    profileHash: R2CalibrationDigestSchema.parse(raw.profile_hash),
    memberDigest: R2CalibrationDigestSchema.parse(raw.member_digest),
    corpusVersion: String(raw.corpus_version),
    taxonomyVersion: String(raw.taxonomy_version),
    thresholds: R2CalibrationThresholdPrecommitSchema.parse(calibrationJson(raw.thresholds_json!)),
    thresholdsDigest: R2CalibrationDigestSchema.parse(raw.thresholds_digest),
    createRequest,
    provenance: assertR2CalibrationOwnerProvenance(
      calibrationJson(raw.provenance_json!),
      "CREATE",
      r2CalibrationCreateBinding(createRequest),
    ),
    gateDigest: R2CalibrationDigestSchema.parse(raw.gate_digest),
    createdAt: z.iso.datetime().parse(raw.created_at),
    campaignDigest: R2CalibrationDigestSchema.parse(raw.campaign_digest),
  };
  const { campaignDigest, ...campaignBody } = campaign;
  if (
    Number(raw.schema_version) !== 1 ||
    campaign.taxonomyVersion !== R2_OCCUPATION_TAXONOMY_VERSION ||
    campaign.engineDigest !== digest(currentR2CalibrationEngine()) ||
    campaign.engineDigest !== digest(campaign.engine) ||
    campaign.thresholds.version !== raw.thresholds_version ||
    digest(campaign.thresholds) !== campaign.thresholdsDigest ||
    digest(campaign.createRequest.thresholds) !== campaign.thresholdsDigest ||
    campaign.gateDigest !== digest(campaign.provenance.gate) ||
    campaign.createdAt !== campaign.provenance.recordedAt ||
    calibrationCampaignDigest(campaignBody) !== campaignDigest
  )
    throw new Error("R2_CALIBRATION_CAMPAIGN_BINDING_INVALID");
  const selection = readR2CalibrationSelection(sqlite, createRequest.jobIds, expectedProfileHash);
  if (
    selection.contextDigest !== createRequest.expectedContextDigest ||
    campaign.profileVersionId !== selection.profile.profileVersionId ||
    campaign.profileHash !== selection.profile.profileHash
  )
    throw new Error("R2_CALIBRATION_CONTEXT_STALE");
  const rows = sqlite
    .prepare(
      "SELECT * FROM r2_calibration_comparisons WHERE campaign_id=? ORDER BY job_id LIMIT 301",
    )
    .all(campaignId) as Array<Record<string, string>>;
  if (rows.length !== createRequest.jobIds.length)
    throw new Error("R2_CALIBRATION_COMPARISON_INCOMPLETE");
  const currentMembers = new Map(selection.comparisons.map((m) => [m.jobId, m]));
  const comparisons = rows.map((row) => {
    const member = currentMembers.get(row.job_id!);
    if (!member) throw new Error("R2_CALIBRATION_COMPARISON_CHANGED");
    const expected = bindR2CalibrationComparison(
      member,
      calibrationComparisonId(campaignId, row.job_id!),
      selection.profile,
    );
    if (
      row.id !== expected.id ||
      row.campaign_id !== campaignId ||
      row.job_version_id !== expected.jobVersionId ||
      row.source_observation_id !== expected.sourceObservationId ||
      row.original_identity !== expected.originalIdentity ||
      row.snapshot_digest !== digest(expected) ||
      digest(calibrationJson(row.snapshot_json!)) !== digest(expected) ||
      row.created_at !== campaign.createdAt
    )
      throw new Error("R2_CALIBRATION_COMPARISON_CHANGED");
    return expected;
  });
  assertUniqueCalibrationMembers(sqlite, comparisons);
  if (
    campaign.memberDigest !== digest(comparisons.map((m) => ({ id: m.id, digest: digest(m) }))) ||
    campaign.corpusVersion !== `r2-private-v1:${campaign.memberDigest.slice(0, 32)}`
  )
    throw new Error("R2_CALIBRATION_MEMBER_DIGEST_INVALID");
  const labelRows = sqlite
    .prepare("SELECT * FROM r2_calibration_label_events WHERE campaign_id=? LIMIT 100001")
    .all(campaignId) as Array<Record<string, string | number | null>>;
  const pairRows = sqlite
    .prepare("SELECT * FROM r2_calibration_pair_events WHERE campaign_id=? LIMIT 100001")
    .all(campaignId) as Array<Record<string, string | number | null>>;
  if (labelRows.length + pairRows.length > 100000) throw new Error("R2_CALIBRATION_EVENT_LIMIT");
  const memberIds = new Set(comparisons.map((m) => m.id));
  const events: Array<R2CalibrationLabelEvent | R2CalibrationPairEvent> = [];
  for (const row of labelRows) {
    const request = R2CalibrationLabelRequestSchema.parse(
      calibrationJson(String(row.request_json)),
    );
    const event: R2CalibrationLabelEvent = {
      id: R2CalibrationIdSchema.parse(row.id),
      campaignId,
      comparisonId: R2CalibrationIdSchema.parse(row.comparison_id),
      revision: z.number().int().positive().parse(row.revision),
      supersedesId:
        row.supersedes_id === null ? null : R2CalibrationIdSchema.parse(row.supersedes_id),
      request,
      provenance: assertR2CalibrationOwnerProvenance(
        calibrationJson(String(row.provenance_json)),
        "LABEL",
        r2CalibrationLabelBinding(request),
      ),
      createdAt: z.iso.datetime().parse(row.created_at),
      eventDigest: R2CalibrationDigestSchema.parse(row.event_digest),
    };
    const { eventDigest, ...body } = event;
    if (
      !memberIds.has(event.comparisonId) ||
      request.campaignId !== campaignId ||
      request.comparisonId !== event.comparisonId ||
      request.previousEventId !== event.supersedesId ||
      request.label !== row.label ||
      request.occupationalFamily !== row.occupational_family ||
      row.gate_digest !== digest(event.provenance.gate) ||
      event.createdAt !== event.provenance.recordedAt ||
      digest(body) !== eventDigest
    )
      throw new Error("R2_CALIBRATION_LABEL_PROVENANCE_INVALID");
    events.push(event);
  }
  for (const row of pairRows) {
    const request = R2CalibrationPairRequestSchema.parse(calibrationJson(String(row.request_json)));
    const [left, right] = [request.leftComparisonId, request.rightComparisonId].sort() as [
      string,
      string,
    ];
    const event: R2CalibrationPairEvent = {
      id: R2CalibrationIdSchema.parse(row.id),
      campaignId,
      leftComparisonId: left,
      rightComparisonId: right,
      preferredComparisonId: request.preferredComparisonId,
      revision: z.number().int().positive().parse(row.revision),
      supersedesId:
        row.supersedes_id === null ? null : R2CalibrationIdSchema.parse(row.supersedes_id),
      request,
      provenance: assertR2CalibrationOwnerProvenance(
        calibrationJson(String(row.provenance_json)),
        "PAIR",
        r2CalibrationPairBinding(request),
      ),
      createdAt: z.iso.datetime().parse(row.created_at),
      eventDigest: R2CalibrationDigestSchema.parse(row.event_digest),
    };
    const { eventDigest, ...body } = event;
    if (
      !memberIds.has(left) ||
      !memberIds.has(right) ||
      request.campaignId !== campaignId ||
      request.previousEventId !== event.supersedesId ||
      left !== row.left_comparison_id ||
      right !== row.right_comparison_id ||
      event.preferredComparisonId !== row.preferred_comparison_id ||
      row.gate_digest !== digest(event.provenance.gate) ||
      event.createdAt !== event.provenance.recordedAt ||
      digest(body) !== eventDigest
    )
      throw new Error("R2_CALIBRATION_PAIR_PROVENANCE_INVALID");
    events.push(event);
  }
  const byPriorContext = new Map<string, R2CalibrationLabelEvent | R2CalibrationPairEvent>();
  for (const event of events) {
    if (byPriorContext.has(event.request.expectedContextDigest))
      throw new Error("R2_CALIBRATION_EVENT_CHAIN_INVALID");
    byPriorContext.set(event.request.expectedContextDigest, event);
  }
  let contextDigest = digest({ campaignDigest, memberDigest: campaign.memberDigest });
  const labels = new Map<string, R2CalibrationLabelEvent>(),
    pairs = new Map<string, R2CalibrationPairEvent>();
  let read = 0;
  while (byPriorContext.has(contextDigest)) {
    const event = byPriorContext.get(contextDigest)!;
    byPriorContext.delete(contextDigest);
    const label = "comparisonId" in event;
    const key = label
      ? event.comparisonId
      : `${event.leftComparisonId}\n${event.rightComparisonId}`;
    const previous = label ? labels.get(key) : pairs.get(key);
    if (
      event.supersedesId !== (previous?.id ?? null) ||
      event.revision !== (previous?.revision ?? 0) + 1 ||
      Date.parse(event.createdAt) < Date.parse(previous?.createdAt ?? campaign.createdAt)
    )
      throw new Error("R2_CALIBRATION_EVENT_CHAIN_INVALID");
    if (label) labels.set(key, event);
    else pairs.set(key, event);
    contextDigest = nextCalibrationContext(contextDigest, event.eventDigest);
    read++;
  }
  if (read !== events.length) throw new Error("R2_CALIBRATION_EVENT_CHAIN_INVALID");
  return {
    campaign,
    profile: selection.profile,
    comparisons,
    labels: [...labels.values()].sort((a, b) => a.comparisonId.localeCompare(b.comparisonId)),
    pairs: [...pairs.values()].sort(
      (a, b) =>
        a.leftComparisonId.localeCompare(b.leftComparisonId) ||
        a.rightComparisonId.localeCompare(b.rightComparisonId),
    ),
    contextDigest,
    eventCount: events.length,
  };
}

export interface R2CalibrationAssessmentPreview {
  campaignId: string;
  contextDigest: string;
  memberDigest: string;
  engineDigest: string;
  thresholdsDigest: string;
  safetyBundleDigest: string | null;
  safetyHead: string | null;
  safetyTree: string | null;
  gate: R2CalibrationGateInput;
  assessment: R2CalibrationAssessment;
  assessmentDigest: string;
  readyForOwnerApproval: boolean;
}

export function assessCurrentR2CalibrationCampaign(
  state: R2CurrentCalibrationCampaign,
  safetyInput: ValidatedR2CalibrationSafety | null,
  ownerApproval: R2CalibrationOwnerApproval | null = null,
): R2CalibrationAssessmentPreview {
  const safety = safetyInput ? validateCalibrationSafety(safetyInput, state.campaign.engine) : null;
  const members = new Map(state.comparisons.map((m) => [m.id, m]));
  const gate: R2CalibrationGateInput = {
    sourceLabelCount: state.labels.length,
    sourcePairCount: state.pairs.length,
    labels: state.labels.map((event) => {
      const comparison = members.get(event.comparisonId)!;
      const complete = event.request.occupationalFamily !== "UNKNOWN";
      return {
        id: event.id,
        roleFamily: event.request.occupationalFamily,
        ownerLabel: event.request.label,
        eligibility: complete ? comparison.eligibility.status : null,
        ordinalBand: complete
          ? r2OrdinalBand(comparison.eligibility.status, comparison.fit.score)
          : null,
        recommended: complete ? comparison.fit.recommended : null,
      };
    }),
    pairs: state.pairs.map((event) => {
      const preferred = members.get(event.preferredComparisonId)!;
      const other = members.get(
        event.preferredComparisonId === event.leftComparisonId
          ? event.rightComparisonId
          : event.leftComparisonId,
      )!;
      return { id: event.id, preferredScore: preferred.fit.score, otherScore: other.fit.score };
    }),
    performanceThresholds: state.campaign.thresholds,
    safetyGates: safety?.gates ?? null,
    ownerApproval,
  };
  const assessment = assessR2Calibration(gate);
  const body = {
    campaignId: state.campaign.id,
    contextDigest: state.contextDigest,
    memberDigest: state.campaign.memberDigest,
    engineDigest: state.campaign.engineDigest,
    thresholdsDigest: state.campaign.thresholdsDigest,
    safetyBundleDigest: safety?.bundleDigest ?? null,
    safetyHead: safety?.head ?? null,
    safetyTree: safety?.tree ?? null,
    gate,
    assessment,
  };
  return {
    ...body,
    assessmentDigest: digest(body),
    readyForOwnerApproval:
      ownerApproval === null &&
      assessment.sourceLabelCount >= 30 &&
      assessment.blockerCodes.length === 1 &&
      assessment.blockerCodes[0] === "CALIBRATION_OWNER_APPROVAL_REQUIRED",
  };
}

export interface R2CurrentCalibrationQualification {
  runId: string;
  campaignId: string;
  assessmentDigest: string;
  engineDigest: string;
  memberDigest: string;
}
export interface R2CurrentCalibrationQualificationInput {
  runId: string;
  expectedEngine: R2CalibrationSafetyEngine;
  profileVersionId: string;
  profileHash: string;
  safetyEvidence: ValidatedR2CalibrationSafety;
}

/** Legacy aggregate runs do not certify new current operations. No historical row is rewritten. */
export function assertCurrentCalibrationQualification(
  sqlite: BetterSqlite3.Database,
  input: R2CurrentCalibrationQualificationInput,
): R2CurrentCalibrationQualification {
  const runId = R2CalibrationIdSchema.parse(input.runId),
    engine = R2CalibrationSafetyEngineSchema.parse(input.expectedEngine);
  const safety = validateCalibrationSafety(input.safetyEvidence, engine);
  const row = sqlite
    .prepare(
      `SELECT q.*,r.scorer_version,r.weight_version,r.corpus_version,r.state,
      old.private_evidence_digest,old.owner_approval_id,old.owner_approved_at,old.performance_threshold_version,
      old.safety_gate_version,old.blocker_codes_json,old.source_label_count,old.compared_label_count,
      old.source_pair_count,old.compared_pair_count,old.label_agreement_basis_points,old.pair_agreement_basis_points
    FROM r2_calibration_intake_qualifications q JOIN r2_calibration_runs r ON r.id=q.run_id
    JOIN r2_calibration_qualifications old ON old.run_id=q.run_id WHERE q.run_id=?`,
    )
    .get(runId) as Record<string, string | number> | undefined;
  if (!row) throw new Error("R2_CALIBRATION_INTAKE_PROVENANCE_REQUIRED");
  const state = readCurrentR2CalibrationCampaign(
    sqlite,
    String(row.campaign_id),
    input.profileHash,
  );
  if (
    state.profile.profileVersionId !== input.profileVersionId ||
    state.profile.profileHash !== input.profileHash ||
    state.campaign.engineDigest !== digest(engine) ||
    digest(engine) !== digest(currentR2CalibrationEngine())
  )
    throw new Error("R2_CALIBRATION_CONTEXT_STALE");
  const preApproval = assessCurrentR2CalibrationCampaign(state, safety);
  const binding = { campaignId: state.campaign.id, assessmentDigest: preApproval.assessmentDigest };
  const provenance = assertR2CalibrationOwnerProvenance(
    calibrationJson(String(row.provenance_json)),
    "QUAL",
    binding,
  );
  const approval: R2CalibrationOwnerApproval = {
    approvalId: R2CalibrationIdSchema.parse(row.approval_id),
    approvedAt: provenance.recordedAt,
    performanceThresholdVersion: state.campaign.thresholds.version,
    safetyGateVersion: safety.gates.version,
    approved: true,
  };
  const approved = assessCurrentR2CalibrationCampaign(state, safety, approval);
  const snapshot = { version: R2_CALIBRATION_INTAKE_VERSION, preApproval, approved };
  if (
    !preApproval.readyForOwnerApproval ||
    approved.assessment.state !== "CALIBRATED" ||
    approved.assessment.blockerCodes.length ||
    row.assessment_digest !== preApproval.assessmentDigest ||
    row.safety_bundle_digest !== safety.bundleDigest ||
    row.snapshot_digest !== digest(snapshot) ||
    digest(calibrationJson(String(row.snapshot_json))) !== digest(snapshot) ||
    row.private_evidence_digest !== digest(snapshot) ||
    row.gate_digest !== digest(provenance.gate) ||
    row.created_at !== provenance.recordedAt ||
    row.owner_approval_id !== approval.approvalId ||
    row.owner_approved_at !== approval.approvedAt ||
    row.performance_threshold_version !== approval.performanceThresholdVersion ||
    row.safety_gate_version !== approval.safetyGateVersion ||
    row.blocker_codes_json !== "[]" ||
    row.state !== "CALIBRATED" ||
    row.scorer_version !== engine.scorerVersion ||
    row.weight_version !== engine.weightVersion ||
    row.corpus_version !== engine.goldenCorpusVersion ||
    row.source_label_count !== approved.assessment.sourceLabelCount ||
    row.compared_label_count !== approved.assessment.comparedLabelCount ||
    row.source_pair_count !== approved.assessment.sourcePairCount ||
    row.compared_pair_count !== approved.assessment.comparedPairCount ||
    row.label_agreement_basis_points !== approved.assessment.labelAgreementBasisPoints ||
    row.pair_agreement_basis_points !== approved.assessment.pairAgreementBasisPoints
  )
    throw new Error("R2_CALIBRATION_QUALIFICATION_STALE");
  return {
    runId,
    campaignId: state.campaign.id,
    assessmentDigest: preApproval.assessmentDigest,
    engineDigest: state.campaign.engineDigest,
    memberDigest: state.campaign.memberDigest,
  };
}

export function readCurrentCalibrationQualification(
  sqlite: BetterSqlite3.Database,
  input: Omit<R2CurrentCalibrationQualificationInput, "runId">,
): R2CurrentCalibrationQualification | null {
  const available = sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='r2_calibration_intake_qualifications'",
    )
    .get();
  if (!available) return null;
  const rows = sqlite
    .prepare(
      "SELECT run_id FROM r2_calibration_intake_qualifications ORDER BY created_at DESC,rowid DESC LIMIT 1001",
    )
    .all() as Array<{ run_id: string }>;
  if (rows.length > 1000) throw new Error("R2_CALIBRATION_QUALIFICATION_LIMIT");
  for (const row of rows) {
    try {
      return assertCurrentCalibrationQualification(sqlite, { ...input, runId: row.run_id });
    } catch {
      /* Stale retained runs stay history. */
    }
  }
  return null;
}
