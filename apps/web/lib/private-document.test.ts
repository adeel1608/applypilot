import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { fixtureJob } from "../../../tests/fixture-data";
import { readPrivateDocumentArtifact } from "./private-document";

const roots: string[] = [];

function database(): BetterSqlite3.Database {
  const sqlite = new BetterSqlite3(":memory:");
  for (const name of [
    "0000_applypilot_foundation.sql",
    "0001_real_world_job_intake.sql",
    "0002_personal_live_beta_core.sql",
  ]) {
    sqlite.exec(
      readFileSync(new URL(`../../../packages/database/drizzle/${name}`, import.meta.url), "utf8"),
    );
  }
  const job = fixtureJob("job-retail-sales-assistant");
  const now = "2026-09-08T00:00:00.000Z";
  sqlite
    .prepare(
      `INSERT INTO jobs
        (id,title,company,category,location,employment_type,normalized_json,application_status,
         date_discovered,created_at,updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW', ?, ?, ?)`,
    )
    .run(
      job.id,
      job.title,
      job.company,
      job.category,
      job.location,
      job.employmentType,
      JSON.stringify(job),
      now,
      now,
      now,
    );
  sqlite
    .prepare(
      "INSERT INTO candidate_profiles (id,active_version_id,created_at,updated_at) VALUES ('profile:1','profile-version:1',?,?)",
    )
    .run(now, now);
  sqlite
    .prepare(
      `INSERT INTO candidate_profile_versions
        (id,profile_id,version,schema_version,snapshot_json,content_hash,created_at)
       VALUES ('profile-version:1','profile:1',1,1,'{}',?,?)`,
    )
    .run("a".repeat(64), now);
  sqlite
    .prepare(
      `INSERT INTO job_versions
        (id,job_id,version,normalized_json,content_digest,source_observation_id,created_at)
       VALUES ('job-version:1',?,1,?,?,NULL,?)`,
    )
    .run(job.id, JSON.stringify(job), "b".repeat(64), now);
  return sqlite;
}

async function fixtureArtifact(
  options: {
    bytes?: Buffer;
    localPath?: string;
    stale?: boolean;
    fileName?: string;
    format?: "PDF" | "DOCX";
  } = {},
) {
  const sqlite = database();
  const root = await mkdtemp(join(tmpdir(), "applypilot-private-document-"));
  roots.push(root);
  const privateRoot = join(root, "private");
  await mkdir(join(privateRoot, "documents"), { recursive: true });
  const format = options.format ?? "PDF";
  const bytes = options.bytes ?? Buffer.from("%PDF-1.4\nfictional document\n");
  const localPath = options.localPath ?? `documents/fictional.${format.toLowerCase()}`;
  if (!localPath.startsWith("..")) await writeFile(join(privateRoot, localPath), bytes);
  sqlite
    .prepare(
      `INSERT INTO document_artifacts
        (id,job_id,job_version_id,profile_version_id,type,template,format,file_name,local_path,
         content_digest,claim_evidence_json,layout_result_json,version,stale,created_at)
       VALUES ('document:fixture','job-retail-sales-assistant','job-version:1','profile-version:1',
         'CV','fictional',?,?,?,?, '[]','{}',1,?,'2026-09-08T00:00:00.000Z')`,
    )
    .run(
      format,
      options.fileName ?? `Fictional CV.${format.toLowerCase()}`,
      localPath,
      createHash("sha256").update(bytes).digest("hex"),
      options.stale ? 1 : 0,
    );
  return { sqlite, privateRoot, bytes };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("private document artifact reads", () => {
  it("serves an unapproved draft PDF by artifact ID with safe metadata", async () => {
    const fixture = await fixtureArtifact({ fileName: 'Fictional "CV"; review.pdf' });
    try {
      await expect(
        readPrivateDocumentArtifact(fixture.sqlite, fixture.privateRoot, "document:fixture"),
      ).resolves.toMatchObject({
        bytes: new Uint8Array(fixture.bytes),
        contentType: "application/pdf",
        fileName: "Fictional _CV__ review.pdf",
        format: "PDF",
      });
      expect(fixture.sqlite.prepare("SELECT COUNT(*) FROM document_approvals").pluck().get()).toBe(
        0,
      );
    } finally {
      fixture.sqlite.close();
    }
  });

  it("uses the exact DOCX content type and rejects digest, stale, and path escapes", async () => {
    const docx = await fixtureArtifact({ format: "DOCX", bytes: Buffer.from("PKfictional") });
    try {
      await expect(
        readPrivateDocumentArtifact(docx.sqlite, docx.privateRoot, "document:fixture"),
      ).resolves.toMatchObject({
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        format: "DOCX",
      });
      docx.sqlite
        .prepare("UPDATE document_artifacts SET content_digest = ? WHERE id = 'document:fixture'")
        .run("c".repeat(64));
      await expect(
        readPrivateDocumentArtifact(docx.sqlite, docx.privateRoot, "document:fixture"),
      ).rejects.toThrow("DOCUMENT_DIGEST_MISMATCH");
      docx.sqlite
        .prepare("UPDATE document_artifacts SET stale = 1 WHERE id = 'document:fixture'")
        .run();
      await expect(
        readPrivateDocumentArtifact(docx.sqlite, docx.privateRoot, "document:fixture"),
      ).rejects.toThrow("DOCUMENT_ARTIFACT_STALE");
      docx.sqlite
        .prepare(
          "UPDATE document_artifacts SET stale = 0, local_path = '../outside.docx' WHERE id = 'document:fixture'",
        )
        .run();
      await expect(
        readPrivateDocumentArtifact(docx.sqlite, docx.privateRoot, "document:fixture"),
      ).rejects.toThrow("DOCUMENT_PATH_ESCAPE");
    } finally {
      docx.sqlite.close();
    }
  });
});
