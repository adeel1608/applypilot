"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  R2CalibrationCampaignRequestSchema,
  R2CalibrationLabelRequestSchema,
  R2CalibrationPairRequestSchema,
  R2CalibrationIdSchema,
  R2CalibrationDigestSchema,
  r2CalibrationCreateBinding,
  r2CalibrationLabelBinding,
  r2CalibrationPairBinding,
  r2CalibrationOwnerAction,
} from "@applypilot/fit-scorer";
import { consumeLocalMutationNonceBatch } from "@web/lib/local-mutation-security";
import {
  createCalibrationCampaign,
  recordCalibrationLabel,
  recordCalibrationPair,
  approveCalibrationQualification,
} from "@web/lib/calibration-workspace";

type CalibrationTarget =
  | "/calibration"
  | `/calibration?campaign=${string}`
  | `/calibration?notice=${"expired" | "rejected"}`;

function one(form: FormData, name: string): string {
  const values = form.getAll(name);
  if (values.length !== 1 || typeof values[0] !== "string")
    throw new Error("R2_CALIBRATION_FIELD_AMBIGUOUS");
  return values[0];
}
function fields(form: FormData, names: string[]): void {
  const allowed = new Set(["mutationNonce", ...names]);
  for (const key of form.keys())
    if (!allowed.has(key) && !key.startsWith("$ACTION_"))
      throw new Error("R2_CALIBRATION_FIELD_INVALID");
}
function integer(form: FormData, name: string): number {
  const value = one(form, name);
  if (value !== value.trim() || !/^(?:0|[1-9][0-9]{0,4})$/.test(value))
    throw new Error("R2_CALIBRATION_THRESHOLD_INVALID");
  return Number(value);
}
function previous(form: FormData): string | null {
  return one(form, "previousEventId") || null;
}
function rejected(error: unknown): "expired" | "rejected" {
  return error instanceof Error && error.message === "MUTATION_NONCE_EXPIRED"
    ? "expired"
    : "rejected";
}
async function gate(action: string, form: FormData) {
  const [proof] = await consumeLocalMutationNonceBatch(
    [{ action, fieldName: "mutationNonce" }] as const,
    form,
  );
  return proof;
}

export async function createCalibrationCampaignAction(form: FormData): Promise<never> {
  let target: CalibrationTarget = "/calibration";
  let success = false;
  try {
    fields(form, [
      "jobId",
      "expectedContextDigest",
      "thresholdVersion",
      "minimumLabelAgreementBasisPoints",
      "minimumPairComparisons",
      "minimumPairAgreementBasisPoints",
    ]);
    const request = R2CalibrationCampaignRequestSchema.parse({
      jobIds: form.getAll("jobId"),
      expectedContextDigest: one(form, "expectedContextDigest"),
      thresholds: {
        version: one(form, "thresholdVersion"),
        minimumLabelAgreementBasisPoints: integer(form, "minimumLabelAgreementBasisPoints"),
        minimumPairComparisons: integer(form, "minimumPairComparisons"),
        minimumPairAgreementBasisPoints: integer(form, "minimumPairAgreementBasisPoints"),
      },
    });
    const proof = await gate(
      r2CalibrationOwnerAction("CREATE", r2CalibrationCreateBinding(request)),
      form,
    );
    const campaignId = await createCalibrationCampaign(request, proof);
    target = `/calibration?campaign=${encodeURIComponent(campaignId)}`;
    success = true;
  } catch (error) {
    target = `/calibration?notice=${rejected(error)}`;
  }
  if (success) revalidatePath("/calibration");
  redirect(target);
}

export async function recordCalibrationLabelAction(form: FormData): Promise<never> {
  let target: CalibrationTarget = "/calibration";
  let success = false;
  try {
    fields(form, [
      "campaignId",
      "comparisonId",
      "expectedContextDigest",
      "previousEventId",
      "label",
      "occupationalFamily",
    ]);
    const request = R2CalibrationLabelRequestSchema.parse({
      campaignId: one(form, "campaignId"),
      comparisonId: one(form, "comparisonId"),
      expectedContextDigest: one(form, "expectedContextDigest"),
      previousEventId: previous(form),
      label: one(form, "label"),
      occupationalFamily: one(form, "occupationalFamily"),
    });
    const proof = await gate(
      r2CalibrationOwnerAction("LABEL", r2CalibrationLabelBinding(request)),
      form,
    );
    await recordCalibrationLabel(request, proof);
    target = `/calibration?campaign=${encodeURIComponent(request.campaignId)}`;
    success = true;
  } catch (error) {
    target = `/calibration?notice=${rejected(error)}`;
  }
  if (success) revalidatePath("/calibration");
  redirect(target);
}

export async function recordCalibrationPairAction(form: FormData): Promise<never> {
  let target: CalibrationTarget = "/calibration";
  let success = false;
  try {
    fields(form, [
      "campaignId",
      "leftComparisonId",
      "rightComparisonId",
      "preferredComparisonId",
      "expectedContextDigest",
      "previousEventId",
    ]);
    const request = R2CalibrationPairRequestSchema.parse({
      campaignId: one(form, "campaignId"),
      leftComparisonId: one(form, "leftComparisonId"),
      rightComparisonId: one(form, "rightComparisonId"),
      preferredComparisonId: one(form, "preferredComparisonId"),
      expectedContextDigest: one(form, "expectedContextDigest"),
      previousEventId: previous(form),
    });
    const proof = await gate(
      r2CalibrationOwnerAction("PAIR", r2CalibrationPairBinding(request)),
      form,
    );
    await recordCalibrationPair(request, proof);
    target = `/calibration?campaign=${encodeURIComponent(request.campaignId)}`;
    success = true;
  } catch (error) {
    target = `/calibration?notice=${rejected(error)}`;
  }
  if (success) revalidatePath("/calibration");
  redirect(target);
}

export async function approveCalibrationQualificationAction(form: FormData): Promise<never> {
  let target: CalibrationTarget = "/calibration";
  let success = false;
  try {
    fields(form, ["campaignId", "assessmentDigest", "approvalChoice"]);
    if (one(form, "approvalChoice") !== "APPROVE")
      throw new Error("R2_CALIBRATION_OWNER_APPROVAL_REQUIRED");
    const request = {
      campaignId: R2CalibrationIdSchema.parse(one(form, "campaignId")),
      assessmentDigest: R2CalibrationDigestSchema.parse(one(form, "assessmentDigest")),
    };
    const proof = await gate(r2CalibrationOwnerAction("QUAL", request), form);
    await approveCalibrationQualification(request, proof);
    target = `/calibration?campaign=${encodeURIComponent(request.campaignId)}`;
    success = true;
  } catch (error) {
    target = `/calibration?notice=${rejected(error)}`;
  }
  if (success) revalidatePath("/calibration");
  redirect(target);
}
