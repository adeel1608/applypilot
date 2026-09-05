"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import {
  ImportValidationError,
  evaluateJobUrlPolicy,
  prepareJobImport,
} from "@applypilot/job-importer";
import { candidateProfileProvider } from "@web/lib/candidate-profile-provider";
import { getJobImportRepository } from "@web/lib/local-database";

export interface ImportPreviewRecordDto {
  recordId: string;
  ordinal: number;
  splitStatus: string;
  detectedSource: string;
  sourceConfidence: string;
  acquisitionMethod: string;
  title: string;
  company: string;
  location: string;
  category: string;
  externalId: string;
  sourceUrl: string;
  excerpt: string;
  warnings: Array<{ code: string; message: string; field?: string }>;
  duplicateDecision: string;
}

export interface ImportActionState {
  status: "IDLE" | "ERROR" | "URL_POLICY" | "PREVIEW" | "CONFIRMED";
  message?: string;
  urlPolicy?: {
    decision: string;
    detectedSource: string;
    reasonCode: string;
  };
  preview?: {
    importId: string;
    previewToken: string;
    expiresAt: string;
    detectedSource: string;
    acquisitionMethod: string;
    records: ImportPreviewRecordDto[];
  };
  result?: {
    imported: number;
    updated: number;
    duplicates: number;
    skipped: number;
  };
}

async function assertLocalRequest(): Promise<void> {
  const requestHeaders = await headers();
  const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "")
    .toLowerCase()
    .trim();
  if (!/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host) && !/^\[::1\](?::\d+)?$/.test(host)) {
    throw new Error("LOCAL_REQUEST_REQUIRED");
  }
}

function safeMessage(error: unknown): string {
  if (error instanceof ImportValidationError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) {
    const messages: Record<string, string> = {
      LOCAL_REQUEST_REQUIRED: "Imports are available only through the local ApplyPilot server.",
      MISSING_REQUIRED_IMPORT_FIELDS:
        "Complete the title, company, location, and description before importing.",
      REVIEW_ACKNOWLEDGEMENT_REQUIRED:
        "Acknowledge the split warning before importing this record.",
      UPDATE_REVIEW_REQUIRED:
        "This identity already exists with changed content. Confirm the update explicitly.",
      IDENTITY_CONFLICT:
        "The external ID and canonical URL match different stored jobs. Resolve this conflict manually.",
      INVALID_PREVIEW_TOKEN: "This preview expired or is no longer valid. Prepare it again.",
      PREVIEW_NOT_CONFIRMABLE: "This preview was already confirmed or is no longer available.",
    };
    return messages[error.message] ?? "The import could not be completed safely.";
  }
  return "The import could not be completed safely.";
}

export async function prepareImportAction(
  _previous: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  try {
    await assertLocalRequest();
    const inputType = String(formData.get("inputType") ?? "PASTED_SINGLE");
    if (inputType === "URL") {
      const value = String(formData.get("url") ?? "");
      const policy = evaluateJobUrlPolicy(value);
      return {
        status: "URL_POLICY",
        urlPolicy: {
          decision: policy.decision,
          detectedSource: policy.detectedSource,
          reasonCode: policy.reasonCode,
        },
        message:
          policy.decision === "USER_CONTENT_REQUIRED"
            ? "Open the job page, copy the visible job content, and paste it here."
            : policy.decision === "REVIEW_REQUIRED"
              ? "ApplyPilot has no approved fetch provider for this URL. Copy and paste the visible job content instead."
              : "This URL cannot be imported automatically.",
      };
    }
    const repository = getJobImportRepository();
    if (!repository) {
      return {
        status: "ERROR",
        message: "The local import database is not ready. Run: npm run db:migrate -- --confirm",
      };
    }
    const sourceHintValue = String(formData.get("sourceHint") ?? "");
    let content: string | Uint8Array;
    let originalFilename: string | null = null;
    let declaredMimeType: string | null = null;
    let acquisitionMethod: "USER_SUPPLIED_CONTENT" | "FILE_UPLOAD" = "USER_SUPPLIED_CONTENT";
    if (inputType === "FILE_UPLOAD") {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return { status: "ERROR", message: "Choose a supported UTF-8 file to import." };
      }
      content = new Uint8Array(await file.arrayBuffer());
      originalFilename = file.name;
      declaredMimeType = file.type;
      acquisitionMethod = "FILE_UPLOAD";
    } else {
      content = String(formData.get("content") ?? "");
    }
    const prepared = prepareJobImport({
      inputType: inputType as "PASTED_SINGLE" | "PASTED_MULTI" | "PASTED_HTML" | "FILE_UPLOAD",
      acquisitionMethod,
      content,
      sourceHint: sourceHintValue
        ? (sourceHintValue as Parameters<typeof prepareJobImport>[0]["sourceHint"])
        : null,
      originalFilename,
      declaredMimeType,
    });
    const staged = repository.stage(prepared);
    return {
      status: "PREVIEW",
      message: `Review ${staged.records.length} detected job${staged.records.length === 1 ? "" : "s"} before confirming.`,
      preview: {
        importId: staged.importId,
        previewToken: staged.previewToken,
        expiresAt: staged.expiresAt,
        detectedSource: prepared.document.detectedSource,
        acquisitionMethod: prepared.document.acquisitionMethod,
        records: staged.records.map((record) => ({
          recordId: record.recordId,
          ordinal: record.ordinal,
          splitStatus: record.splitStatus,
          detectedSource: record.sourceDetection.source,
          sourceConfidence: record.sourceDetection.confidence,
          acquisitionMethod: prepared.document.acquisitionMethod,
          title: record.fields.title?.slice(0, 300) ?? "",
          company: record.fields.company?.slice(0, 300) ?? "",
          location: record.fields.location?.slice(0, 500) ?? "",
          category: record.fields.category?.slice(0, 300) ?? "",
          externalId: record.fields.externalId?.slice(0, 2048) ?? "",
          sourceUrl: record.fields.sourceUrl?.slice(0, 2048) ?? "",
          excerpt: record.excerpt,
          warnings: record.warnings,
          duplicateDecision: record.duplicateDecision,
        })),
      },
    };
  } catch (error) {
    return { status: "ERROR", message: safeMessage(error) };
  }
}

export async function confirmImportAction(
  _previous: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  try {
    await assertLocalRequest();
    const repository = getJobImportRepository();
    if (!repository) throw new Error("DATABASE_NOT_READY");
    const importId = String(formData.get("importId") ?? "");
    const previewToken = String(formData.get("previewToken") ?? "");
    const recordIds = formData.getAll("recordId").map(String);
    const selections = recordIds.map((recordId) => {
      const edit = (field: string): string | undefined => {
        const value = formData.get(`${field}:${recordId}`);
        return typeof value === "string" ? value.trim() : undefined;
      };
      const description = edit("description");
      return {
        recordId,
        selected: formData.get(`selected:${recordId}`) === "on",
        acknowledgedWarnings:
          formData.get(`acknowledge:${recordId}`) === "on" ? ["SPLIT_REVIEW_REQUIRED"] : [],
        allowUpdate: formData.get(`allowUpdate:${recordId}`) === "on",
        edits: {
          title: edit("title") || null,
          company: edit("company") || null,
          location: edit("location") || null,
          category: edit("category") || null,
          externalId: edit("externalId") || null,
          sourceUrl: edit("sourceUrl") || null,
          ...(description ? { description } : {}),
        },
      };
    });
    const result = await repository.confirm(
      importId,
      previewToken,
      selections,
      candidateProfileProvider,
    );
    revalidatePath("/dashboard");
    revalidatePath("/jobs");
    return {
      status: "CONFIRMED",
      message: "Import confirmation completed.",
      result: {
        imported: result.imported,
        updated: result.updated,
        duplicates: result.duplicates,
        skipped: result.skipped,
      },
    };
  } catch (error) {
    return { status: "ERROR", message: safeMessage(error) };
  }
}
