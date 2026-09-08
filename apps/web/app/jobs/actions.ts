"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  approvePrivateDocument,
  correctBetaJob,
  generatePrivateCoverLetter,
  generatePrivateCv,
  preparePrivatePacket,
  reevaluateBetaJob,
  setBetaQueueState,
} from "@web/lib/beta-workspace";
import { consumeLocalMutationNonce } from "@web/lib/local-mutation-security";
import { coverLetterTones, type CoverLetterTone } from "@applypilot/cover-letter-engine";
import { resumeTemplateCategories, type ResumeTemplateCategory } from "@applypilot/resume-engine";

function jobId(formData: FormData): string {
  const value = String(formData.get("jobId") ?? "");
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(value)) throw new Error("INVALID_JOB_ID");
  return value;
}

function finish(id: string): never {
  revalidatePath("/dashboard");
  revalidatePath("/jobs");
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/applications");
  redirect(`/jobs/${id}`);
}

export async function setQueueStateAction(formData: FormData) {
  await consumeLocalMutationNonce("JOB_QUEUE", formData);
  const id = jobId(formData);
  const ownerState = String(formData.get("queueState") ?? "");
  const mapping = {
    REVIEW_LATER: { state: "REVIEWING", reason: "OWNER_REVIEW_LATER" },
    SHORTLIST: { state: "SHORTLISTED", reason: "OWNER_SHORTLISTED" },
    SKIP: { state: "SKIPPED", reason: "OWNER_SKIPPED" },
    ARCHIVE: { state: "SKIPPED", reason: "OWNER_ARCHIVED" },
    PREPARING: { state: "PREPARING", reason: "OWNER_PREPARING" },
  } as const;
  const selection = mapping[ownerState as keyof typeof mapping];
  if (!selection) {
    throw new Error("INVALID_QUEUE_STATE");
  }
  setBetaQueueState(id, selection.state, selection.reason);
  finish(id);
}

export async function reevaluateJobAction(formData: FormData) {
  await consumeLocalMutationNonce("JOB_REEVALUATE", formData);
  const id = jobId(formData);
  await reevaluateBetaJob(id);
  finish(id);
}

export async function correctJobAction(formData: FormData) {
  await consumeLocalMutationNonce("JOB_CORRECT", formData);
  const id = jobId(formData);
  await correctBetaJob(id, {
    title: String(formData.get("title") ?? ""),
    company: String(formData.get("company") ?? ""),
    location: String(formData.get("location") ?? ""),
    category: String(formData.get("category") ?? ""),
  });
  finish(id);
}

export async function generateCvAction(formData: FormData) {
  await consumeLocalMutationNonce("DOCUMENT_GENERATE", formData);
  const id = jobId(formData);
  const template = String(formData.get("template") ?? "");
  if (!resumeTemplateCategories.includes(template as ResumeTemplateCategory)) {
    throw new Error("INVALID_RESUME_TEMPLATE");
  }
  await generatePrivateCv(id, template as ResumeTemplateCategory);
  finish(id);
}

export async function generateCoverLetterAction(formData: FormData) {
  await consumeLocalMutationNonce("COVER_LETTER_GENERATE", formData);
  const id = jobId(formData);
  const tone = String(formData.get("tone") ?? "");
  if (!coverLetterTones.includes(tone as CoverLetterTone)) {
    throw new Error("INVALID_COVER_LETTER_TONE");
  }
  await generatePrivateCoverLetter(id, tone as CoverLetterTone);
  finish(id);
}

export async function approveDocumentAction(formData: FormData) {
  await consumeLocalMutationNonce("DOCUMENT_APPROVE", formData);
  const id = jobId(formData);
  approvePrivateDocument(
    String(formData.get("documentArtifactId") ?? ""),
    String(formData.get("contentDigest") ?? ""),
  );
  finish(id);
}

export async function preparePacketAction(formData: FormData) {
  await consumeLocalMutationNonce("PACKET_PREPARE", formData);
  const id = jobId(formData);
  preparePrivatePacket(id);
  finish(id);
}
