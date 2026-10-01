"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { SourceCapabilityViewBindingSchema } from "@applypilot/job-sources";
import { consumeLocalMutationNonce } from "@web/lib/local-mutation-security";
import {
  approveOwnerSourceCapability,
  cancelSourceRun,
  revokeSourceCapability,
  runOwnerApprovedSource,
} from "@web/lib/source-workspace";

function capabilityBinding(formData: FormData) {
  const rawVersion = formData.get("capabilityVersion");
  const version =
    typeof rawVersion === "string" && /^[1-9]\d*$/.test(rawVersion)
      ? Number(rawVersion)
      : Number.NaN;
  const parsed = SourceCapabilityViewBindingSchema.safeParse({
    capabilityId: formData.get("capabilityId"),
    version,
    capabilityDigest: formData.get("capabilityDigest"),
  });
  if (!parsed.success) throw new Error("SOURCE_CAPABILITY_VIEW_STALE");
  return parsed.data;
}

function confirm(formData: FormData, phrase: string): void {
  if (formData.get("ownerConfirmed") !== "yes" || formData.get("confirmationText") !== phrase) {
    throw new Error("EXACT_OWNER_CONFIRMATION_REQUIRED");
  }
}

export async function startSourceRunAction(formData: FormData) {
  const gateProof = await consumeLocalMutationNonce("SOURCE_RUN_START", formData);
  const binding = capabilityBinding(formData);
  confirm(formData, `RUN ${binding.capabilityId}`);
  await runOwnerApprovedSource(binding, gateProof);
  revalidatePath("/sources");
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  redirect("/sources");
}

export async function approveSourceCapabilityAction(formData: FormData) {
  const gateProof = await consumeLocalMutationNonce("SOURCE_CAPABILITY_APPROVE", formData);
  const binding = capabilityBinding(formData);
  confirm(formData, `APPROVE ${binding.capabilityId}`);
  await approveOwnerSourceCapability(binding, gateProof);
  revalidatePath("/sources");
  redirect("/sources");
}

export async function revokeSourceAction(formData: FormData) {
  await consumeLocalMutationNonce("SOURCE_REVOKE", formData);
  const binding = capabilityBinding(formData);
  confirm(formData, `REVOKE ${binding.capabilityId}`);
  await revokeSourceCapability(binding);
  revalidatePath("/sources");
  redirect("/sources");
}

export async function cancelSourceRunAction(formData: FormData) {
  await consumeLocalMutationNonce("SOURCE_RUN_CANCEL", formData);
  const runId = z
    .string()
    .regex(/^[A-Za-z0-9:._-]{1,200}$/)
    .parse(formData.get("runId"));
  confirm(formData, `CANCEL ${runId}`);
  cancelSourceRun(runId);
  revalidatePath("/sources");
  redirect("/sources");
}
