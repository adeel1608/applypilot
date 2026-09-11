"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { consumeLocalMutationNonce } from "@web/lib/local-mutation-security";
import {
  cancelSourceRun,
  revokeSourceCapability,
  runOwnerApprovedLeverSource,
} from "@web/lib/source-workspace";

const capabilityId = (formData: FormData) =>
  z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/)
    .parse(formData.get("capabilityId"));

function confirm(formData: FormData, phrase: string): void {
  if (formData.get("ownerConfirmed") !== "yes" || formData.get("confirmationText") !== phrase) {
    throw new Error("EXACT_OWNER_CONFIRMATION_REQUIRED");
  }
}

export async function startSourceRunAction(formData: FormData) {
  await consumeLocalMutationNonce("SOURCE_RUN_START", formData);
  const id = capabilityId(formData);
  confirm(formData, `RUN ${id}`);
  await runOwnerApprovedLeverSource(id);
  revalidatePath("/sources");
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  redirect("/sources");
}

export async function revokeSourceAction(formData: FormData) {
  await consumeLocalMutationNonce("SOURCE_REVOKE", formData);
  const id = capabilityId(formData);
  confirm(formData, `REVOKE ${id}`);
  await revokeSourceCapability(id);
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
