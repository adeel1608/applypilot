"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  ManualApplicationOutcomes,
  type ManualApplicationOutcome,
} from "@web/lib/application-outcomes";
import { recordManualApplicationOutcome } from "@web/lib/beta-workspace";
import { consumeLocalMutationNonce } from "@web/lib/local-mutation-security";

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
