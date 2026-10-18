import "server-only";

import { dirname } from "node:path";
import { z } from "zod";
import {
  R2CalibrationIntakeRepository,
  currentR2CalibrationEngine,
  readCurrentCalibrationQualification,
  type R2CalibrationComparison,
  type R2CurrentCalibrationCampaign,
} from "@applypilot/database";
import {
  R2CalibrationIdSchema,
  R2CalibrationDigestSchema,
  R2_CALIBRATION_MAXIMUM_MEMBERS,
  type R2CalibrationOwnerGate,
  type R2CalibrationAssessment,
  type R2CalibrationThresholdPrecommit,
  type ValidatedR2CalibrationSafety,
  R2_CALIBRATION_SAFETY_GATES,
} from "@applypilot/fit-scorer";
import type { CandidateProfile } from "@applypilot/candidate-profile";
import { getLocalDatabase } from "./local-database";
import { resolveLocalDataDirectory } from "./local-data-directory";
import {
  readCurrentR2CalibrationSafety,
  readCurrentR2CalibrationProfileHash,
} from "../../../scripts/lib/r2-calibration-safety";

// All returned codes are fixed. Zod/SQLite/provider/profile exceptions never become rendered text.
const safeCodes = new Set([
  "R2_CALIBRATION_ACTIVE_PROFILE_REQUIRED",
  "R2_CALIBRATION_PROFILE_CHANGED",
  "R2_CALIBRATION_PROFILE_BINDING_INVALID",
  "R2_CALIBRATION_RETAINED_SOURCE_REQUIRED",
  "R2_CALIBRATION_SOURCE_LINEAGE_REQUIRED",
  "R2_CALIBRATION_CORRECTION_REPLAY_UNSUPPORTED",
  "R2_CALIBRATION_JOB_CHANGED",
  "R2_CALIBRATION_CONTEXT_STALE",
  "R2_CALIBRATION_CORPUS_NOT_UNIQUE",
  "R2_CALIBRATION_CORPUS_KNOWN_DUPLICATE",
  "R2_CALIBRATION_CAMPAIGN_NOT_FOUND",
  "R2_CALIBRATION_CANDIDATE_LIMIT",
  "R2_CALIBRATION_EVENT_LIMIT",
  "R2_CALIBRATION_QUALIFICATION_LIMIT",
  "R2_CALIBRATION_SAFETY_EVIDENCE_INVALID",
  "R2_CALIBRATION_SAFETY_EVIDENCE_REQUIRED",
  "R2_CALIBRATION_ASSESSMENT_CHANGED",
  "R2_CALIBRATION_NOT_QUALIFIABLE",
]);

export interface CalibrationMemberView {
  id: string;
  jobId: string;
  jobVersionId: string;
  sourceObservationId: string;
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl: string | null;
  source: string;
  region: string;
  tenant: string;
  externalId: string;
  observedAt: string;
  verifiedAt: string;
  parserVersion: string;
  normalizationVersion: string;
  unresolvedDirectDuplicateCount: number;
  eligibility: string;
  score: number;
  recommended: boolean;
  coveragePercent: number;
}
export interface CalibrationCampaignView {
  id: string;
  contextDigest: string;
  memberDigest: string;
  corpusVersion: string;
  thresholds: R2CalibrationThresholdPrecommit;
  members: CalibrationMemberView[];
  labels: Array<{
    id: string;
    comparisonId: string;
    revision: number;
    label: string;
    occupationalFamily: string;
  }>;
  pairs: Array<{
    id: string;
    leftComparisonId: string;
    rightComparisonId: string;
    preferredComparisonId: string;
    revision: number;
  }>;
  assessment: R2CalibrationAssessment;
  assessmentDigest: string;
  readyForOwnerApproval: boolean;
  safetyStatus: "CURRENT" | "NOT_CURRENT";
  safetyProofs: Array<{ gate: string; status: "PASS" | "MISSING" }>;
  safetyBundleDigest: string | null;
}
export interface CalibrationView {
  status: "READY" | "MIGRATION_REQUIRED" | "PROFILE_REQUIRED" | "UNAVAILABLE";
  safeCode: string | null;
  currentQualificationRunId: string | null;
  currentQualificationCampaignId: string | null;
  verifiedContext: Array<{ reference: string; summary: string }>;
  candidates: ReturnType<R2CalibrationIntakeRepository["listCandidates"]>;
  campaigns: ReturnType<R2CalibrationIntakeRepository["listCampaigns"]>;
  selection: { jobIds: string[]; contextDigest: string; members: CalibrationMemberView[] } | null;
  campaign: CalibrationCampaignView | null;
}

function context() {
  const local = getLocalDatabase();
  if (!local) throw new Error("R2_CALIBRATION_DATABASE_REQUIRED");
  const repository = new R2CalibrationIntakeRepository(local.sqlite);
  if (!repository.available()) throw new Error("R2_CALIBRATION_MIGRATION_REQUIRED");
  const root = dirname(resolveLocalDataDirectory());
  const profileHash = readCurrentR2CalibrationProfileHash(root);
  const profile = repository.currentProfile();
  if (profile.profileHash !== profileHash) throw new Error("R2_CALIBRATION_PROFILE_CHANGED");
  return { local, repository, root, profileHash, profile };
}

function safety(root: string): ValidatedR2CalibrationSafety | null {
  try {
    return readCurrentR2CalibrationSafety(root);
  } catch {
    return null;
  }
}

function verifiedContext(profile: CandidateProfile): CalibrationView["verifiedContext"] {
  const output: CalibrationView["verifiedContext"] = [];
  if (profile.workRights.verification === "VERIFIED")
    output.push({
      reference: "workRights",
      summary: `${profile.workRights.value.country}: ${profile.workRights.value.status}; maximum hours per fortnight: ${profile.workRights.value.maximumHoursPerFortnight ?? "UNKNOWN"}; limit time basis: ${profile.workRights.value.hoursLimitTimeBasis?.verification === "VERIFIED" ? profile.workRights.value.hoursLimitTimeBasis.kind : "UNKNOWN"}`,
    });
  for (const [path, fact] of [
    ["transport.vehicleAccess", profile.transport.vehicleAccess],
    ["transport.maximumCommuteKm", profile.transport.maximumCommuteKm],
    ["transport.maximumCommuteMinutes", profile.transport.maximumCommuteMinutes],
  ] as const)
    if (fact?.verification === "VERIFIED")
      output.push({ reference: path, summary: String(fact.value) });
  for (const row of profile.availability.recurring)
    if (row.verification === "VERIFIED")
      output.push({
        reference: "availability.recurring",
        summary: `${row.day} ${row.startTime}–${row.endTime}: ${row.available ? "available" : "unavailable"}`,
      });
  for (const row of profile.skills)
    if (row.verification === "VERIFIED")
      output.push({ reference: `skills:${row.id}`, summary: row.name });
  for (const row of profile.licences)
    if (row.verification === "VERIFIED")
      output.push({ reference: `licences:${row.id}`, summary: row.name });
  for (const row of profile.certifications)
    if (row.verification === "VERIFIED")
      output.push({ reference: `certifications:${row.id}`, summary: row.name });
  for (const row of profile.education)
    if (row.verification === "VERIFIED")
      output.push({
        reference: `education:${row.id}`,
        summary: `${row.qualification} — ${row.field} (${row.status})`,
      });
  for (const row of profile.employment)
    if (row.verification === "VERIFIED")
      output.push({
        reference: `employment:${row.id}`,
        summary: `${row.title}: ${row.responsibilities.join("; ")}`,
      });
  for (const [path, fact] of Object.entries(profile.preferences)) {
    if (
      fact &&
      typeof fact === "object" &&
      "verification" in fact &&
      fact.verification === "VERIFIED" &&
      "value" in fact
    )
      output.push({
        reference: `preferences.${path}`,
        summary: Array.isArray(fact.value) ? fact.value.join(", ") : String(fact.value),
      });
  }
  return output;
}

function memberView(row: R2CalibrationComparison): CalibrationMemberView {
  return {
    id: row.id,
    jobId: row.jobId,
    jobVersionId: row.jobVersionId,
    sourceObservationId: row.sourceObservationId,
    title: row.job.title,
    company: row.job.company,
    location: row.job.location,
    description: row.job.description,
    sourceUrl: row.job.sourceUrl,
    source: row.source,
    region: row.region,
    tenant: row.tenant,
    externalId: row.externalId,
    observedAt: row.observedAt,
    verifiedAt: row.verifiedAt,
    parserVersion: row.engine.parserVersion,
    normalizationVersion: row.engine.normalizationVersion,
    unresolvedDirectDuplicateCount: row.unresolvedDirectDuplicateCount,
    eligibility: row.eligibility.status,
    score: row.fit.score,
    recommended: row.fit.recommended,
    coveragePercent: row.eligibility.coveragePercent,
  };
}

function campaignView(
  state: R2CurrentCalibrationCampaign,
  preview: ReturnType<R2CalibrationIntakeRepository["previewAssessment"]>,
): CalibrationCampaignView {
  return {
    id: state.campaign.id,
    contextDigest: state.contextDigest,
    memberDigest: state.campaign.memberDigest,
    corpusVersion: state.campaign.corpusVersion,
    thresholds: state.campaign.thresholds,
    members: state.comparisons.map(memberView),
    labels: state.labels.map((e) => ({
      id: e.id,
      comparisonId: e.comparisonId,
      revision: e.revision,
      label: e.request.label,
      occupationalFamily: e.request.occupationalFamily,
    })),
    pairs: state.pairs.map((e) => ({
      id: e.id,
      leftComparisonId: e.leftComparisonId,
      rightComparisonId: e.rightComparisonId,
      preferredComparisonId: e.preferredComparisonId,
      revision: e.revision,
    })),
    assessment: preview.assessment,
    assessmentDigest: preview.assessmentDigest,
    readyForOwnerApproval: preview.readyForOwnerApproval,
    safetyStatus: preview.safetyBundleDigest ? "CURRENT" : "NOT_CURRENT",
    safetyProofs: R2_CALIBRATION_SAFETY_GATES.map((gate) => ({
      gate,
      status: preview.safetyBundleDigest ? "PASS" : "MISSING",
    })),
    safetyBundleDigest: preview.safetyBundleDigest,
  };
}

export async function getCalibrationView(
  query: { jobIds?: string[]; campaignId?: string } = {},
): Promise<CalibrationView> {
  const view: CalibrationView = {
    status: "UNAVAILABLE",
    safeCode: null,
    currentQualificationRunId: null,
    currentQualificationCampaignId: null,
    verifiedContext: [],
    candidates: [],
    campaigns: [],
    selection: null,
    campaign: null,
  };
  try {
    const c = context();
    view.status = "READY";
    view.verifiedContext = verifiedContext(c.profile.profile);
    view.candidates = c.repository.listCandidates();
    view.campaigns = c.repository.listCampaigns();
    const currentSafety = safety(c.root);
    if (currentSafety) {
      const qualification = readCurrentCalibrationQualification(c.local.sqlite, {
        expectedEngine: currentR2CalibrationEngine(),
        profileVersionId: c.profile.profileVersionId,
        profileHash: c.profileHash,
        safetyEvidence: currentSafety,
      });
      view.currentQualificationRunId = qualification?.runId ?? null;
      view.currentQualificationCampaignId = qualification?.campaignId ?? null;
    }
    if (query.jobIds?.length) {
      const jobIds = z
        .array(R2CalibrationIdSchema)
        .max(R2_CALIBRATION_MAXIMUM_MEMBERS)
        .parse(query.jobIds);
      const preview = c.repository.previewCampaign(jobIds, c.profileHash);
      view.selection = {
        jobIds: preview.jobIds,
        contextDigest: preview.contextDigest,
        members: preview.comparisons.map(memberView),
      };
    }
    if (query.campaignId) {
      const state = c.repository.readCampaign(
        R2CalibrationIdSchema.parse(query.campaignId),
        c.profileHash,
      );
      view.campaign = campaignView(
        state,
        c.repository.previewAssessment(state.campaign.id, currentSafety, c.profileHash),
      );
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    view.safeCode = safeCodes.has(code) ? code : "R2_CALIBRATION_UNAVAILABLE";
    if (code === "R2_CALIBRATION_MIGRATION_REQUIRED" || code === "R2_CALIBRATION_DATABASE_REQUIRED")
      view.status = "MIGRATION_REQUIRED";
    else if (
      [
        "R2_CALIBRATION_ACTIVE_PROFILE_REQUIRED",
        "R2_CALIBRATION_PROFILE_CHANGED",
        "R2_CALIBRATION_PROFILE_BINDING_INVALID",
      ].includes(code)
    )
      view.status = "PROFILE_REQUIRED";
    else if (view.status !== "READY") view.status = "UNAVAILABLE";
  }
  return view;
}

function safeMutation<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    throw new Error(safeCodes.has(code) ? code : "R2_CALIBRATION_ACTION_REJECTED");
  }
}
export async function createCalibrationCampaign(
  input: unknown,
  gate: R2CalibrationOwnerGate,
): Promise<string> {
  return safeMutation(() => {
    const c = context();
    return c.repository.createCampaign(input, gate, c.profileHash);
  });
}
export async function recordCalibrationLabel(
  input: unknown,
  gate: R2CalibrationOwnerGate,
): Promise<string> {
  return safeMutation(() => {
    const c = context();
    return c.repository.recordLabel(input, gate, c.profileHash);
  });
}
export async function recordCalibrationPair(
  input: unknown,
  gate: R2CalibrationOwnerGate,
): Promise<string> {
  return safeMutation(() => {
    const c = context();
    return c.repository.recordPair(input, gate, c.profileHash);
  });
}
export async function approveCalibrationQualification(
  input: { campaignId: string; assessmentDigest: string },
  gate: R2CalibrationOwnerGate,
): Promise<string> {
  return safeMutation(() => {
    const c = context();
    R2CalibrationDigestSchema.parse(input.assessmentDigest);
    return c.repository.approveQualification(
      input,
      gate,
      readCurrentR2CalibrationSafety(c.root),
      c.profileHash,
    );
  });
}
