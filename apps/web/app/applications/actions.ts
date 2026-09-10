"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  ManualApplicationOutcomes,
  type ManualApplicationOutcome,
} from "@web/lib/application-outcomes";
import { recordManualApplicationOutcome } from "@web/lib/beta-workspace";
import { consumeLocalMutationNonce } from "@web/lib/local-mutation-security";
import { persistApprovedRunnerTarget, revokeRunnerTarget } from "@web/lib/runner-workspace";

function runnerCapabilityId(formData: FormData): string {
  const value = String(formData.get("capabilityId") ?? "");
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(value)) throw new Error("INVALID_RUNNER_CAPABILITY_ID");
  return value;
}

function exactConfirmation(formData: FormData, phrase: string): void {
  if (formData.get("ownerConfirmed") !== "yes" || formData.get("confirmationText") !== phrase) {
    throw new Error("EXACT_OWNER_CONFIRMATION_REQUIRED");
  }
}

export async function approveRunnerTargetAction(formData: FormData) {
  await consumeLocalMutationNonce("RUNNER_TARGET_APPROVE", formData);
  const id = runnerCapabilityId(formData);
  exactConfirmation(formData, `APPROVE ${id}`);
  await persistApprovedRunnerTarget(id);
  revalidatePath("/applications");
  redirect("/applications");
}

export async function revokeRunnerTargetAction(formData: FormData) {
  await consumeLocalMutationNonce("RUNNER_TARGET_REVOKE", formData);
  const id = runnerCapabilityId(formData);
  exactConfirmation(formData, `REVOKE ${id}`);
  await revokeRunnerTarget(id);
  revalidatePath("/applications");
  redirect("/applications");
}

export async function recordManualOutcomeAction(formData: FormData) {
  await consumeLocalMutationNonce("APPLICATION_OUTCOME", formData);
  const applicationId = String(formData.get("applicationId") ?? "");
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(applicationId)) {
    throw new Error("INVALID_APPLICATION_ID");
  }
  const outcome = String(formData.get("outcome") ?? "");
  if (!ManualApplicationOutcomes.includes(outcome as ManualApplicationOutcome)) {
    throw new Error("INVALID_APPLICATION_OUTCOME");
  }
  if (formData.get("ownerConfirmed") !== "yes") {
    throw new Error("OWNER_OUTCOME_CONFIRMATION_REQUIRED");
  }
  recordManualApplicationOutcome(applicationId, outcome as ManualApplicationOutcome);
  revalidatePath("/applications");
  redirect("/applications");
}
