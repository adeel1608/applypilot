import { randomUUID } from "node:crypto";

import { sha256 } from "./identity";
import { IMPORT_LIMITS } from "./limits";
import type {
  ImportWarning,
  SanitizedImportContent,
  SplitImportedJobRecord,
  SplitImportResult,
  SplitStatus,
} from "./types";

function hasJobShape(record: Record<string, unknown>): boolean {
  const type = record["@type"];
  return type === "JobPosting" || Boolean(record.title || record.name || record.jobTitle);
}

function makeRecord(
  ordinal: number,
  text: string,
  structured: Record<string, unknown> | null,
  status: SplitStatus,
  boundaryRuleIds: string[],
  start: number | null,
  end: number | null,
  warnings: ImportWarning[] = [],
): SplitImportedJobRecord {
  const bounded = text.trim();
  if (new TextEncoder().encode(bounded).byteLength > IMPORT_LIMITS.maximumCandidateBytes) {
    throw new Error("CANDIDATE_TOO_LARGE");
  }
  return {
    id: randomUUID(),
    ordinal,
    status,
    text: bounded,
    structured,
    start,
    end,
    contentHash: sha256(structured ? JSON.stringify(structured) : bounded),
    boundaryRuleIds,
    warnings,
  };
}

function overall(records: SplitImportedJobRecord[]): SplitStatus {
  if (!records.length || records.every(({ status }) => status === "FAILED")) return "FAILED";
  return records.every(({ status }) => status === "CONFIDENT") ? "CONFIDENT" : "REVIEW_REQUIRED";
}

export function splitImportedJobs(content: SanitizedImportContent): SplitImportResult {
  let records: SplitImportedJobRecord[] = [];
  if (content.structuredRecords.length) {
    const structuredPostings = content.structuredRecords.filter(
      (record) => record["@type"] === "JobPosting",
    );
    const candidates = (
      structuredPostings.length ? structuredPostings : content.structuredRecords
    ).filter(hasJobShape);
    records = candidates.map((record, index) =>
      makeRecord(
        index + 1,
        JSON.stringify(record),
        record,
        record["@type"] === "JobPosting" ||
          (record["@type"] === "HTMLJobCard" && record.title && record.company && record.url)
          ? "CONFIDENT"
          : "REVIEW_REQUIRED",
        ["STRUCTURED_RECORD"],
        null,
        null,
      ),
    );
  }
  if (!records.length) {
    const delimiter = /^\s*(?:---+\s*JOB\s*---+|={3,}\s*JOB\s*={3,})\s*$/gim;
    const matches = [...content.text.matchAll(delimiter)];
    if (matches.length) {
      const boundaries = [
        0,
        ...matches.map((match) => (match.index ?? 0) + match[0].length),
        content.text.length,
      ];
      const segments = boundaries
        .slice(0, -1)
        .map((start, index) => ({ start, end: boundaries[index + 1]! }))
        .map(({ start, end }) => ({
          start,
          end,
          text: content.text.slice(start, end).replace(delimiter, "").trim(),
        }))
        .filter(({ text }) => text.length > 0);
      records = segments.map(({ start, end, text }, index) =>
        makeRecord(index + 1, text, null, "CONFIDENT", ["EXPLICIT_JOB_DELIMITER"], start, end),
      );
    }
  }
  if (!records.length) {
    const titleMatches = [...content.text.matchAll(/^\s*(?:title|job title|role)\s*:\s*.+$/gim)];
    if (titleMatches.length > 1) {
      records = titleMatches.map((match, index) => {
        const start = match.index ?? 0;
        const end = titleMatches[index + 1]?.index ?? content.text.length;
        return makeRecord(
          index + 1,
          content.text.slice(start, end),
          null,
          "REVIEW_REQUIRED",
          ["REPEATED_LABELLED_TITLE"],
          start,
          end,
          [
            {
              code: "VERIFY_SPLIT_BOUNDARY",
              message: "Review this inferred job boundary before importing.",
            },
          ],
        );
      });
    }
  }
  if (!records.length && content.text.trim()) {
    records = [
      makeRecord(
        1,
        content.text,
        null,
        "REVIEW_REQUIRED",
        ["SINGLE_RECORD_FALLBACK"],
        0,
        content.text.length,
      ),
    ];
  }
  if (records.length > IMPORT_LIMITS.maximumJobs) {
    throw new Error("TOO_MANY_JOBS");
  }
  const status = overall(records);
  return {
    status,
    records,
    warnings:
      status === "REVIEW_REQUIRED"
        ? [
            {
              code: "SPLIT_REVIEW_REQUIRED",
              message: "Review inferred record boundaries and fields before import.",
            },
          ]
        : [],
  };
}
