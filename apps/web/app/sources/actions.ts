"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { SourceCapabilityViewBindingSchema } from "@applypilot/job-sources";
import {
  consumeLocalMutationNonce,
  consumeLocalMutationNonceBatch,
} from "@web/lib/local-mutation-security";
import {
  approveAndRunOwnerSource,
  cancelSourceRun,
  revokeSourceCapability,
  runOwnerApprovedSource,
} from "@web/lib/source-workspace";

function oneString(formData: FormData, name: string): string | undefined {
  const values = formData.getAll(name);
  return values.length === 1 && typeof values[0] === "string" ? values[0] : undefined;
}

function capabilityBinding(formData: FormData) {
  const rawVersion = oneString(formData, "capabilityVersion");
  const version =
    typeof rawVersion === "string" && /^[1-9]\d*$/.test(rawVersion)
      ? Number(rawVersion)
      : Number.NaN;
  const parsed = SourceCapabilityViewBindingSchema.safeParse({
    capabilityId: oneString(formData, "capabilityId"),
    version,
    capabilityDigest: oneString(formData, "capabilityDigest"),
  });
  if (!parsed.success) throw new Error("SOURCE_CAPABILITY_VIEW_STALE");
  return parsed.data;
}

function confirm(formData: FormData, phrase: string): void {
  if (
    oneString(formData, "ownerConfirmed") !== "yes" ||
    oneString(formData, "confirmationText") !== phrase
  ) {
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

export async function approveAndStartSourceRunAction(formData: FormData) {
  const [approvalGateProof, startGateProof] = await consumeLocalMutationNonceBatch(
    [
      { action: "SOURCE_CAPABILITY_APPROVE", fieldName: "approvalMutationNonce" },
      { action: "SOURCE_RUN_START", fieldName: "startMutationNonce" },
    ] as const,
    formData,
  );
  const binding = capabilityBinding(formData);
  const confirmationText = `APPROVE AND RUN ${binding.capabilityId}`;
  confirm(formData, confirmationText);
  await approveAndRunOwnerSource(
    binding,
    { approval: approvalGateProof, start: startGateProof },
    confirmationText,
  );
  revalidatePath("/sources");
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
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
