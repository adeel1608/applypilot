"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hostedDigest, hostedOwnerAction, safeHostedError } from "@applypilot/application-runner";
import { consumeLocalMutationNonce } from "@web/lib/local-mutation-security";
import {
  exactHostedCapability,
  hostedQuestionReviewView,
  getHostedWorkspaceView,
  reviewHostedPacket,
  runHostedOwnerAction,
  stopHostedSession,
} from "@web/lib/hosted-workspace";

function safeId(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value))
    throw new Error("HOSTED_RENDERED_BINDING_CHANGED");
  return value;
}
function single(data: FormData, key: string): string {
  const values = data.getAll(key);
  if (values.length !== 1 || typeof values[0] !== "string")
    throw new Error("HOSTED_RENDERED_BINDING_CHANGED");
  return values[0];
}
function unambiguousReview(data: FormData): void {
  for (const key of new Set(data.keys()))
    if (/^(alternative|choice|fact):/.test(key)) single(data, key);
}
async function proof(action: string, data: FormData) {
  if (single(data, "ownerConfirmed") !== "yes")
    throw new Error("HOSTED_OWNER_CONFIRMATION_REQUIRED");
  const nonce = single(data, "mutationNonce");
  if (!nonce || nonce.length > 512) throw new Error("HOSTED_OWNER_CONFIRMATION_REQUIRED");
  const gate = await consumeLocalMutationNonce(action, data);
  return {
    ...gate,
    nonceDigest: createHash("sha256").update(nonce).digest("hex"),
    ownerConfirmed: true as const,
  };
}
export async function hostedOwnerActionForm(data: FormData): Promise<void> {
  let safeCode: string | null = null;
  try {
    const id = safeId(single(data, "capabilityId"));
    const versionText = single(data, "version");
    const digest = single(data, "digest");
    if (!/^[1-9][0-9]{0,8}$/.test(versionText) || !/^[a-f0-9]{64}$/.test(digest))
      throw new Error("HOSTED_RENDERED_BINDING_CHANGED");
    const cap = exactHostedCapability(id, Number(versionText), digest);
    const kind = single(data, "kind");
    if (kind !== "INSPECT" && kind !== "DISCLOSE" && kind !== "SUBMIT")
      throw new Error("HOSTED_RENDERED_BINDING_CHANGED");
    const sessionId = kind === "INSPECT" ? "" : safeId(single(data, "sessionId"));
    const session =
      kind === "SUBMIT"
        ? getHostedWorkspaceView().sessions.find((value) => value.id === sessionId)
        : null;
    if (kind === "SUBMIT" && !session?.preview) throw new Error("HOSTED_FINAL_PREVIEW_REQUIRED");
    const action = hostedOwnerAction(
      kind,
      cap,
      sessionId,
      kind === "SUBMIT" ? hostedDigest(session?.preview) : "",
    );
    const phrase =
      kind === "INSPECT"
        ? `INSPECT ${id}`
        : kind === "DISCLOSE"
          ? `DISCLOSE AND PREPARE ${id}`
          : `SUBMIT ${sessionId}`;
    if (single(data, "confirmationText") !== phrase)
      throw new Error("HOSTED_OWNER_CONFIRMATION_REQUIRED");
    await runHostedOwnerAction(kind, cap, sessionId, await proof(action, data));
  } catch (error) {
    safeCode = safeHostedError(error);
  }
  revalidatePath("/applications");
  redirect(safeCode ? `/applications?hostedError=${safeCode}` : "/applications");
}
export async function hostedPacketReviewAction(data: FormData): Promise<void> {
  let safeCode: string | null = null;
  try {
    const id = safeId(single(data, "sessionId"));
    unambiguousReview(data);
    const view = hostedQuestionReviewView(id);
    if (!view?.session.discovery) throw new Error("HOSTED_QUESTION_REVIEW_REQUIRED");
    const action = `HOSTED_QUESTION_REVIEW:${hostedDigest(view.session.capability.subject)}:${hostedDigest(view.session.discovery)}`;
    await reviewHostedPacket(id, data, await proof(action, data));
  } catch (error) {
    safeCode = safeHostedError(error);
  }
  revalidatePath("/applications");
  redirect(safeCode ? `/applications?hostedError=${safeCode}` : "/applications");
}
export async function hostedStopAction(data: FormData): Promise<void> {
  let safeCode: string | null = null;
  try {
    const id = safeId(single(data, "sessionId"));
    await proof(`HOSTED_STOP:${id}`, data);
    await stopHostedSession(id);
  } catch (error) {
    safeCode = safeHostedError(error);
  }
  revalidatePath("/applications");
  redirect(safeCode ? `/applications?hostedError=${safeCode}` : "/applications");
}
