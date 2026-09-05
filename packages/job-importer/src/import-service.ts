import { randomUUID } from "node:crypto";

import { IMPORT_PARSER_VERSION } from "./limits";
import { splitImportedJobs } from "./multi-job-splitter";
import { sanitizeImportContent } from "./sanitize";
import { PrepareJobImportInputSchema } from "./schemas";
import { detectJobSource } from "./source-detector";
import { parseImportedJobRecord } from "./single-job-parser";
import type { BatchDetectedSource, PrepareJobImportInput, PreparedJobImport } from "./types";

function batchSource(sources: string[]): BatchDetectedSource {
  const confident = new Set(sources.filter((source) => source !== "UNKNOWN"));
  if (confident.size > 1) return "MIXED";
  return (confident.values().next().value as BatchDetectedSource | undefined) ?? "UNKNOWN";
}

export function prepareJobImport(
  input: PrepareJobImportInput,
  options: { now?: () => Date; uuid?: () => string } = {},
): PreparedJobImport {
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  const boundary = PrepareJobImportInputSchema.parse({
    ...input,
    content: undefined,
    originalFilename: input.originalFilename,
  });
  const sanitized = sanitizeImportContent({
    content: input.content,
    inputType: boundary.inputType,
    originalFilename: boundary.originalFilename,
    declaredMimeType: boundary.declaredMimeType,
  });
  const split = splitImportedJobs(sanitized);
  const records = split.records.map((record) => {
    const structuredUrl = record.structured
      ? (["url", "sourceUrl", "canonicalUrl"]
          .map((key) => record.structured?.[key])
          .find((value): value is string => typeof value === "string") ?? null)
      : null;
    const provisionalDetection = detectJobSource({
      sourceUrl: structuredUrl ?? boundary.sourceUrl ?? sanitized.links[0] ?? null,
      structured: record.structured,
      text: record.text,
      sourceHint: boundary.sourceHint,
    });
    const provisionalDraft = parseImportedJobRecord(
      record,
      provisionalDetection,
      structuredUrl ?? boundary.sourceUrl ?? sanitized.links[0] ?? null,
      createdAt,
    );
    const finalDetection = detectJobSource({
      sourceUrl: provisionalDraft.fields.sourceUrl,
      structured: record.structured,
      text: record.text,
      sourceHint: boundary.sourceHint,
    });
    return parseImportedJobRecord(
      record,
      finalDetection,
      provisionalDraft.fields.sourceUrl,
      createdAt,
    );
  });
  const detectedSource = batchSource(records.map(({ sourceDetection }) => sourceDetection.source));
  return {
    document: {
      importId: (options.uuid ?? randomUUID)(),
      inputType: boundary.inputType,
      acquisitionMethod: boundary.acquisitionMethod,
      sourceHint: boundary.sourceHint ?? null,
      detectedSource,
      originalFilename: boundary.originalFilename ?? null,
      sourceUrl: boundary.sourceUrl ?? null,
      contentHash: sanitized.contentHash,
      createdAt,
      parserVersion: IMPORT_PARSER_VERSION,
      contentLength: sanitized.contentLength,
      detectedJobs: records.length,
      warnings: [...sanitized.warnings, ...split.warnings],
      content: sanitized.rawText,
    },
    splitStatus: split.status,
    records,
  };
}
