import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

import {
  R2CalibrationCampaignRequestSchema,
  R2CalibrationLabelRequestSchema,
  R2CalibrationPairRequestSchema,
  R2CalibrationDigestSchema,
  R2CalibrationIdSchema,
  R2_CALIBRATION_INTAKE_VERSION,
  R2_OCCUPATION_TAXONOMY_VERSION,
  r2CalibrationCreateBinding,
  r2CalibrationLabelBinding,
  r2CalibrationPairBinding,
  r2CalibrationOwnerProvenance,
  r2CalibrationSafetyDigest,
  executeR2GoldenCorpus,
  assessR2GoldenExecution,
  evaluateR2GoldenRanking,
  type R2CalibrationOwnerGate,
  type R2CalibrationOwnerApproval,
  type ValidatedR2CalibrationSafety,
} from "@applypilot/fit-scorer";

import { R2Repository } from "./r2-repository";
import {
  readR2CalibrationSelection,
  readCurrentR2CalibrationCampaign,
  readR2CalibrationProfile,
  bindR2CalibrationComparison,
  calibrationComparisonId,
  calibrationCampaignDigest,
  calibrationEventDigest,
  assertUniqueCalibrationMembers,
  assessCurrentR2CalibrationCampaign,
  type R2CalibrationCampaign,
  type R2CalibrationLabelEvent,
  type R2CalibrationPairEvent,
} from "./r2-calibration-currentness";

const digest = r2CalibrationSafetyDigest;

export interface R2CalibrationCandidate {
  jobId: string;
  jobVersionId: string;
  title: string;
  company: string;
  source: string | null;
  tenant: string | null;
  externalId: string | null;
  retainedPayloadAvailable: boolean;
  /** Necessary retained-data checks only; selected preview still validates the exact full subject. */
  availabilityHint:
    | "PROVISIONAL"
    | "RETAINED_SOURCE_MISSING"
    | "UNSUPPORTED_PROVIDER"
    | "QUALIFIED_LINEAGE_MISSING"
    | "OWNER_CORRECTION_UNSUPPORTED";
}

/** All writes require the server's consumed owner gate; read methods never prepare or mutate a corpus. */
export class R2CalibrationIntakeRepository {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = randomUUID,
  ) {}

  available(): boolean {
    return Boolean(
      this.sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='r2_calibration_campaigns'",
        )
        .get(),
    );
  }

  listCandidates(): R2CalibrationCandidate[] {
    const rows = this.sqlite
      .prepare(
        `WITH current_job AS (
        SELECT id,job_id,source_observation_id,ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY version DESC) AS rank
        FROM job_versions)
      SELECT j.id AS jobId,v.id AS jobVersionId,j.title,j.company,o.source,o.tenant,o.external_id AS externalId,
        CASE WHEN p.observation_id IS NULL THEN 0 ELSE 1 END AS retainedPayloadAvailable,
        EXISTS(SELECT 1 FROM job_corrections x WHERE x.job_id=j.id) AS hasCorrection,
        CASE WHEN p.content_digest=o.content_hash AND EXISTS(
          SELECT 1 FROM source_run_checkpoints originalRun
          JOIN source_capability_versions originalCapability
            ON originalCapability.id=originalRun.capability_version_id
            AND originalCapability.configuration_digest=originalRun.capability_digest
          WHERE originalRun.id=o.run_id AND originalRun.status='COMPLETE'
            AND originalCapability.source=o.source AND originalCapability.tenant=o.tenant
            AND originalCapability.parser_version=o.parser_version AND originalCapability.policy_version=o.policy_version
        ) AND EXISTS(
          SELECT 1 FROM source_record_verifications verification
          JOIN source_run_checkpoints run ON run.id=verification.run_id AND run.status='COMPLETE'
            AND run.capability_version_id=verification.capability_version_id
          JOIN source_capability_versions capability ON capability.id=verification.capability_version_id
            AND capability.configuration_digest=run.capability_digest AND capability.source=verification.source
            AND capability.tenant=verification.tenant AND capability.parser_version=verification.parser_version
            AND capability.policy_version=verification.policy_version
          JOIN source_run_pages page ON page.id=verification.page_id AND page.run_id=verification.run_id
            AND page.page_digest=verification.page_digest AND verification.record_index<page.record_count
          LEFT JOIN source_derivation_bindings binding ON binding.verification_id=verification.id
            AND binding.source_observation_id=verification.source_observation_id AND binding.content_hash=verification.content_hash
            AND binding.parent_job_version_id=verification.job_version_id AND binding.derived_job_version_id=v.id
          WHERE verification.source_observation_id=o.id AND verification.source=o.source AND verification.tenant=o.tenant
            AND verification.external_id=o.external_id AND verification.content_hash=o.content_hash
            AND verification.disposition='ACCEPTED' AND verification.qualification_state='QUALIFIED'
            AND (verification.job_version_id=v.id OR binding.id IS NOT NULL)
        ) THEN 1 ELSE 0 END AS hasQualifiedLineage
      FROM jobs j JOIN current_job v ON v.job_id=j.id AND v.rank=1
      LEFT JOIN source_observations o ON o.id=v.source_observation_id
      LEFT JOIN source_observation_payloads p ON p.observation_id=o.id ORDER BY j.title,j.id LIMIT 2001`,
      )
      .all() as Array<
      Omit<R2CalibrationCandidate, "retainedPayloadAvailable" | "availabilityHint"> & {
        retainedPayloadAvailable: number;
        hasCorrection: number;
        hasQualifiedLineage: number;
      }
    >;
    if (rows.length > 2000) throw new Error("R2_CALIBRATION_CANDIDATE_LIMIT");
    return rows.map(({ hasCorrection, hasQualifiedLineage, ...row }) => ({
      ...row,
      retainedPayloadAvailable: Boolean(row.retainedPayloadAvailable),
      availabilityHint: !["LEVER", "GREENHOUSE"].includes(row.source ?? "")
        ? "UNSUPPORTED_PROVIDER"
        : !row.retainedPayloadAvailable
          ? "RETAINED_SOURCE_MISSING"
          : hasCorrection
            ? "OWNER_CORRECTION_UNSUPPORTED"
            : !hasQualifiedLineage
              ? "QUALIFIED_LINEAGE_MISSING"
              : "PROVISIONAL",
    }));
  }

  listCampaigns(): Array<{
    id: string;
    createdAt: string;
    thresholdsVersion: string;
    memberCount: number;
  }> {
    return this.sqlite
      .prepare(
        `SELECT c.id,c.created_at AS createdAt,c.thresholds_version AS thresholdsVersion,
      (SELECT COUNT(*) FROM r2_calibration_comparisons m WHERE m.campaign_id=c.id) AS memberCount
      FROM r2_calibration_campaigns c ORDER BY c.created_at DESC,c.rowid DESC LIMIT 100`,
      )
      .all() as Array<{
      id: string;
      createdAt: string;
      thresholdsVersion: string;
      memberCount: number;
    }>;
  }

  previewCampaign(jobIds: string[], expectedProfileHash?: string) {
    return readR2CalibrationSelection(this.sqlite, jobIds, expectedProfileHash);
  }

  private audit(
    type: "campaign_precommitted" | "label_recorded" | "pair_recorded" | "qualification_approved",
    entityId: string,
    counts: { members?: number; revision?: number },
  ): void {
    const metadata = z
      .object({
        version: z.literal(R2_CALIBRATION_INTAKE_VERSION),
        members: z.number().int().nonnegative().max(300).optional(),
        revision: z.number().int().positive().optional(),
      })
      .strict()
      .parse({ version: R2_CALIBRATION_INTAKE_VERSION, ...counts });
    this.sqlite
      .prepare(
        "INSERT INTO r2_audit_events (id,event_type,entity_type,entity_id,safe_metadata_json,occurred_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        this.id(),
        `r2.calibration.intake.${type}`,
        "calibration_intake",
        entityId,
        JSON.stringify(metadata),
        this.now().toISOString(),
      );
  }

  createCampaign(
    input: unknown,
    ownerGate: R2CalibrationOwnerGate,
    expectedProfileHash?: string,
  ): string {
    const request = R2CalibrationCampaignRequestSchema.parse(input);
    request.jobIds.sort();
    return this.sqlite
      .transaction(() => {
        const selection = readR2CalibrationSelection(
          this.sqlite,
          request.jobIds,
          expectedProfileHash,
        );
        if (selection.contextDigest !== request.expectedContextDigest)
          throw new Error("R2_CALIBRATION_CONTEXT_STALE");
        const id = R2CalibrationIdSchema.parse(this.id()),
          createdAt = this.now().toISOString();
        const provenance = r2CalibrationOwnerProvenance(
          "CREATE",
          r2CalibrationCreateBinding(request),
          ownerGate,
          createdAt,
        );
        const comparisons = selection.comparisons.map((member) =>
          bindR2CalibrationComparison(
            member,
            calibrationComparisonId(id, member.jobId),
            selection.profile,
          ),
        );
        assertUniqueCalibrationMembers(this.sqlite, comparisons);
        const memberDigest = digest(comparisons.map((m) => ({ id: m.id, digest: digest(m) })));
        const body: Omit<R2CalibrationCampaign, "campaignDigest"> = {
          id,
          engine: comparisons[0]!.engine,
          engineDigest: comparisons[0]!.engineDigest,
          profileVersionId: selection.profile.profileVersionId,
          profileHash: selection.profile.profileHash,
          memberDigest,
          corpusVersion: `r2-private-v1:${memberDigest.slice(0, 32)}`,
          taxonomyVersion: R2_OCCUPATION_TAXONOMY_VERSION,
          thresholds: request.thresholds,
          thresholdsDigest: digest(request.thresholds),
          createRequest: request,
          provenance,
          gateDigest: digest(provenance.gate),
          createdAt,
        };
        this.sqlite
          .prepare(
            `INSERT INTO r2_calibration_campaigns
        (id,schema_version,engine_json,engine_digest,profile_version_id,profile_hash,member_digest,corpus_version,taxonomy_version,
         thresholds_version,thresholds_json,thresholds_digest,create_request_json,provenance_json,gate_digest,campaign_digest,created_at)
        VALUES (?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            JSON.stringify(body.engine),
            body.engineDigest,
            body.profileVersionId,
            body.profileHash,
            memberDigest,
            body.corpusVersion,
            body.taxonomyVersion,
            request.thresholds.version,
            JSON.stringify(request.thresholds),
            body.thresholdsDigest,
            JSON.stringify(request),
            JSON.stringify(provenance),
            body.gateDigest,
            calibrationCampaignDigest(body),
            createdAt,
          );
        for (const comparison of comparisons)
          this.sqlite
            .prepare(
              `INSERT INTO r2_calibration_comparisons
        (id,campaign_id,job_id,job_version_id,source_observation_id,original_identity,snapshot_json,snapshot_digest,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              comparison.id,
              id,
              comparison.jobId,
              comparison.jobVersionId,
              comparison.sourceObservationId,
              comparison.originalIdentity,
              JSON.stringify(comparison),
              digest(comparison),
              createdAt,
            );
        this.audit("campaign_precommitted", id, { members: comparisons.length });
        return id;
      })
      .immediate();
  }

  readCampaign(campaignId: string, expectedProfileHash?: string) {
    return readCurrentR2CalibrationCampaign(this.sqlite, campaignId, expectedProfileHash);
  }

  recordLabel(
    input: unknown,
    ownerGate: R2CalibrationOwnerGate,
    expectedProfileHash?: string,
  ): string {
    const request = R2CalibrationLabelRequestSchema.parse(input);
    return this.sqlite
      .transaction(() => {
        const state = this.readCampaign(request.campaignId, expectedProfileHash);
        const previous = state.labels.find((l) => l.comparisonId === request.comparisonId);
        if (
          state.contextDigest !== request.expectedContextDigest ||
          request.previousEventId !== (previous?.id ?? null) ||
          !state.comparisons.some((m) => m.id === request.comparisonId)
        )
          throw new Error("R2_CALIBRATION_CONTEXT_STALE");
        const createdAt = this.now().toISOString();
        const provenance = r2CalibrationOwnerProvenance(
          "LABEL",
          r2CalibrationLabelBinding(request),
          ownerGate,
          createdAt,
        );
        const body: Omit<R2CalibrationLabelEvent, "eventDigest"> = {
          id: R2CalibrationIdSchema.parse(this.id()),
          campaignId: request.campaignId,
          comparisonId: request.comparisonId,
          revision: (previous?.revision ?? 0) + 1,
          supersedesId: previous?.id ?? null,
          request,
          provenance,
          createdAt,
        };
        this.sqlite
          .prepare(
            `INSERT INTO r2_calibration_label_events
        (id,campaign_id,comparison_id,revision,supersedes_id,label,occupational_family,request_json,provenance_json,gate_digest,event_digest,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            body.id,
            body.campaignId,
            body.comparisonId,
            body.revision,
            body.supersedesId,
            request.label,
            request.occupationalFamily,
            JSON.stringify(request),
            JSON.stringify(provenance),
            digest(provenance.gate),
            calibrationEventDigest(body),
            createdAt,
          );
        this.audit("label_recorded", body.id, { revision: body.revision });
        return body.id;
      })
      .immediate();
  }

  recordPair(
    input: unknown,
    ownerGate: R2CalibrationOwnerGate,
    expectedProfileHash?: string,
  ): string {
    const request = R2CalibrationPairRequestSchema.parse(input);
    return this.sqlite
      .transaction(() => {
        const state = this.readCampaign(request.campaignId, expectedProfileHash);
        const [left, right] = [request.leftComparisonId, request.rightComparisonId].sort() as [
          string,
          string,
        ];
        const previous = state.pairs.find(
          (p) => p.leftComparisonId === left && p.rightComparisonId === right,
        );
        const members = new Set(state.comparisons.map((m) => m.id));
        if (
          state.contextDigest !== request.expectedContextDigest ||
          request.previousEventId !== (previous?.id ?? null) ||
          !members.has(left) ||
          !members.has(right)
        )
          throw new Error("R2_CALIBRATION_CONTEXT_STALE");
        const createdAt = this.now().toISOString();
        const provenance = r2CalibrationOwnerProvenance(
          "PAIR",
          r2CalibrationPairBinding(request),
          ownerGate,
          createdAt,
        );
        const body: Omit<R2CalibrationPairEvent, "eventDigest"> = {
          id: R2CalibrationIdSchema.parse(this.id()),
          campaignId: request.campaignId,
          leftComparisonId: left,
          rightComparisonId: right,
          preferredComparisonId: request.preferredComparisonId,
          revision: (previous?.revision ?? 0) + 1,
          supersedesId: previous?.id ?? null,
          request,
          provenance,
          createdAt,
        };
        this.sqlite
          .prepare(
            `INSERT INTO r2_calibration_pair_events
        (id,campaign_id,left_comparison_id,right_comparison_id,preferred_comparison_id,revision,supersedes_id,
          request_json,provenance_json,gate_digest,event_digest,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            body.id,
            body.campaignId,
            left,
            right,
            body.preferredComparisonId,
            body.revision,
            body.supersedesId,
            JSON.stringify(request),
            JSON.stringify(provenance),
            digest(provenance.gate),
            calibrationEventDigest(body),
            createdAt,
          );
        this.audit("pair_recorded", body.id, { revision: body.revision });
        return body.id;
      })
      .immediate();
  }

  previewAssessment(
    campaignId: string,
    safety: ValidatedR2CalibrationSafety | null,
    expectedProfileHash?: string,
  ) {
    return assessCurrentR2CalibrationCampaign(
      this.readCampaign(campaignId, expectedProfileHash),
      safety,
    );
  }

  approveQualification(
    input: { campaignId: string; assessmentDigest: string },
    ownerGate: R2CalibrationOwnerGate,
    safety: ValidatedR2CalibrationSafety,
    expectedProfileHash?: string,
  ): string {
    const campaignId = R2CalibrationIdSchema.parse(input.campaignId),
      expectedAssessmentDigest = R2CalibrationDigestSchema.parse(input.assessmentDigest);
    return this.sqlite
      .transaction(() => {
        const state = this.readCampaign(campaignId, expectedProfileHash);
        const preApproval = assessCurrentR2CalibrationCampaign(state, safety);
        if (preApproval.assessmentDigest !== expectedAssessmentDigest)
          throw new Error("R2_CALIBRATION_ASSESSMENT_CHANGED");
        if (!preApproval.readyForOwnerApproval) throw new Error("R2_CALIBRATION_NOT_QUALIFIABLE");
        const createdAt = this.now().toISOString(),
          approvalId = R2CalibrationIdSchema.parse(this.id());
        const provenance = r2CalibrationOwnerProvenance(
          "QUAL",
          { campaignId, assessmentDigest: expectedAssessmentDigest },
          ownerGate,
          createdAt,
        );
        const approval: R2CalibrationOwnerApproval = {
          approvalId,
          approvedAt: createdAt,
          performanceThresholdVersion: state.campaign.thresholds.version,
          safetyGateVersion: safety.gates.version,
          approved: true,
        };
        const approved = assessCurrentR2CalibrationCampaign(state, safety, approval);
        if (approved.assessment.state !== "CALIBRATED" || approved.assessment.blockerCodes.length)
          throw new Error("R2_CALIBRATION_NOT_QUALIFIABLE");
        const executed = executeR2GoldenCorpus();
        if (executed.some((e) => assessR2GoldenExecution(e).length))
          throw new Error("R2_CALIBRATION_GOLDEN_REGRESSION");
        const metrics = evaluateR2GoldenRanking(
          executed.map((e) => ({
            id: e.fixture.id,
            roleFamily: e.fixture.roleFamily,
            eligibility: e.eligibility.status,
            score: e.fit.score,
            expectedBand: e.fixture.expectedBand,
          })),
          approved.gate,
        );
        const snapshot = { version: R2_CALIBRATION_INTAKE_VERSION, preApproval, approved };
        const snapshotDigest = digest(snapshot);
        const runId = new R2Repository(this.sqlite, this.now, this.id).recordCalibrationRun({
          metrics,
          gate: approved.gate,
          evidenceVersion: R2_CALIBRATION_INTAKE_VERSION,
          privateEvidenceDigest: snapshotDigest,
          scorerVersion: state.campaign.engine.scorerVersion,
          weightVersion: state.campaign.engine.weightVersion,
          corpusVersion: state.campaign.engine.goldenCorpusVersion,
        });
        this.sqlite
          .prepare(
            `INSERT INTO r2_calibration_intake_qualifications
        (run_id,campaign_id,assessment_digest,snapshot_json,snapshot_digest,safety_bundle_digest,approval_id,provenance_json,gate_digest,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            runId,
            campaignId,
            expectedAssessmentDigest,
            JSON.stringify(snapshot),
            snapshotDigest,
            safety.bundleDigest,
            approvalId,
            JSON.stringify(provenance),
            digest(provenance.gate),
            createdAt,
          );
        this.audit("qualification_approved", runId, { members: state.comparisons.length });
        return runId;
      })
      .immediate();
  }

  currentProfile() {
    return readR2CalibrationProfile(this.sqlite);
  }
}
