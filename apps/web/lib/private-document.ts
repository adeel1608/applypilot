import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";

import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

const ArtifactIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/);

export interface PrivateDocumentPayload {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
  format: "PDF" | "DOCX";
}

function safeDownloadName(fileName: string, format: "PDF" | "DOCX"): string {
  const extension = format === "PDF" ? ".pdf" : ".docx";
  const cleaned = basename(fileName)
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\/;\r\n]/g, "_")
    .trim();
  const safe = cleaned || `applypilot-document${extension}`;
  return safe.toLowerCase().endsWith(extension) ? safe : `${safe}${extension}`;
}

function confinedTo(root: string, target: string): boolean {
  const child = relative(root, target);
  return child !== "" && !child.startsWith("..") && !isAbsolute(child);
}

export async function readPrivateDocumentArtifact(
  sqlite: BetterSqlite3.Database,
  privateRoot: string,
  artifactIdInput: string,
): Promise<PrivateDocumentPayload> {
  const artifactId = ArtifactIdSchema.parse(artifactIdInput);
  const artifact = sqlite
    .prepare(
      `SELECT type, format, file_name AS fileName, local_path AS localPath,
              content_digest AS contentDigest, stale
       FROM document_artifacts WHERE id = ?`,
    )
    .get(artifactId) as
    | {
        type: string;
        format: string;
        fileName: string;
        localPath: string;
        contentDigest: string;
        stale: number;
      }
    | undefined;
  if (!artifact) throw new Error("DOCUMENT_ARTIFACT_NOT_FOUND");
  if (artifact.stale) throw new Error("DOCUMENT_ARTIFACT_STALE");
  if (!["CV", "COVER_LETTER"].includes(artifact.type)) {
    throw new Error("DOCUMENT_ARTIFACT_TYPE_UNSAFE");
  }
  if (artifact.format !== "PDF" && artifact.format !== "DOCX") {
    throw new Error("DOCUMENT_ARTIFACT_FORMAT_UNSAFE");
  }
  if (isAbsolute(artifact.localPath)) throw new Error("DOCUMENT_PATH_ESCAPE");
  const resolvedRoot = await realpath(resolve(privateRoot));
  const lexicalTarget = resolve(resolvedRoot, artifact.localPath);
  if (!confinedTo(resolvedRoot, lexicalTarget)) throw new Error("DOCUMENT_PATH_ESCAPE");
  let resolvedTarget: string;
  try {
    resolvedTarget = await realpath(lexicalTarget);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("DOCUMENT_FILE_NOT_FOUND");
    }
    throw error;
  }
  if (!confinedTo(resolvedRoot, resolvedTarget)) throw new Error("DOCUMENT_PATH_ESCAPE");
  const handle = await open(resolvedTarget, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error("DOCUMENT_FILE_NOT_REGULAR");
    const buffer = await handle.readFile();
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== artifact.contentDigest) throw new Error("DOCUMENT_DIGEST_MISMATCH");
    if (artifact.format === "PDF" && buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("DOCUMENT_CONTENT_INVALID");
    }
    if (artifact.format === "DOCX" && buffer.subarray(0, 2).toString("ascii") !== "PK") {
      throw new Error("DOCUMENT_CONTENT_INVALID");
    }
    return {
      bytes: new Uint8Array(buffer),
      contentType:
        artifact.format === "PDF"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: safeDownloadName(artifact.fileName, artifact.format),
      format: artifact.format,
    };
  } finally {
    await handle.close();
  }
}
