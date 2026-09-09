import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

import BetterSqlite3 from "better-sqlite3";

import { R2ARepository } from "@applypilot/database";
import { normalizeR2AJobEvidence } from "@applypilot/job-importer";
import { fixtureJob } from "../tests/fixture-data";

const filename = "applypilot.e2e.sqlite";
const dataDirectory = resolve("data");
const databasePath = join(dataDirectory, filename);
const privateDocumentDirectory = join(dataDirectory, "private", "e2e-documents");
const pdfPath = join(privateDocumentDirectory, "fictional-preview.pdf");
const docxPath = join(privateDocumentDirectory, "fictional-download.docx");
mkdirSync(dataDirectory, { recursive: true });
for (const suffix of ["", "-shm", "-wal"]) {
  const target = `${databasePath}${suffix}`;
  if (existsSync(target)) unlinkSync(target);
}

const environment = {
  ...process.env,
  APPLYPILOT_DB_PATH: databasePath,
  APPLYPILOT_DB_FILENAME: filename,
  APPLYPILOT_PROFILE_FILENAME: "profile.e2e.private.json",
  APPLYPILOT_SYNTHETIC_MODE: "1",
};
const sqlite = new BetterSqlite3(databasePath);
try {
  sqlite.exec(
    [
      "0000_applypilot_foundation.sql",
      "0001_real_world_job_intake.sql",
      "0002_personal_live_beta_core.sql",
      "0003_r2a_evidence_normalization.sql",
    ]
      .map((file) => readFileSync(resolve("packages", "database", "drizzle", file), "utf8"))
      .join("\n"),
  );
  const now = "2026-09-08T00:00:00.000Z";
  const pdf = Buffer.from("%PDF-1.4\nfictional e2e preview\n");
  const docx = Buffer.from("PKfictional e2e download");
  const sourceText = `Title: Fictional Document Role
Company: Example Local Co
Location: Sydney NSW 2000
Employment type: Part-time
Requirements
- Two years customer support experience preferred
- Valid Australian work rights required
Documents
- CV required
- Cover letter not required`;
  const job = {
    ...fixtureJob("job-retail-sales-assistant"),
    id: "job-e2e-document",
    title: "Fictional Document Role",
    company: "Example Local Co",
    category: "Fixture",
    location: "Sydney NSW 2000",
    suburb: "Sydney",
    state: "NSW" as const,
    postcode: "2000",
  };
  mkdirSync(privateDocumentDirectory, { recursive: true });
  writeFileSync(pdfPath, pdf);
  writeFileSync(docxPath, docx);
  sqlite
    .prepare(
      `INSERT INTO jobs
        (id,title,company,category,location,employment_type,normalized_json,application_status,
         date_discovered,created_at,updated_at)
       VALUES ('job-e2e-document','Fictional Document Role','Example Local Co','Fixture',
         'Sydney NSW 2000',?,?, 'NEW',?,?,?)`,
    )
    .run(job.employmentType, JSON.stringify(job), now, now, now);
  sqlite
    .prepare(
      "INSERT INTO candidate_profiles (id,active_version_id,created_at,updated_at) VALUES ('profile:e2e',NULL,?,?)",
    )
    .run(now, now);
  sqlite
    .prepare(
      `INSERT INTO candidate_profile_versions
        (id,profile_id,version,schema_version,snapshot_json,content_hash,created_at)
       VALUES ('profile-version:e2e','profile:e2e',1,1,'{}',?,?)`,
    )
    .run("a".repeat(64), now);
  sqlite.prepare("UPDATE candidate_profiles SET active_version_id = 'profile-version:e2e'").run();
  sqlite
    .prepare(
      `INSERT INTO source_observations
        (id,job_id,source_record_id,source,tenant,external_id,source_url,acquisition_method,
         content_hash,raw_snapshot_reference,observed_at,posted_at,expires_at,parser_version,
         policy_version,run_id,supersedes_observation_id)
       VALUES ('observation:e2e','job-e2e-document',NULL,'UNKNOWN',NULL,NULL,NULL,
         'USER_SUPPLIED_CONTENT',?,'fixture:r2a-e2e',?,NULL,NULL,'3.1.0',NULL,NULL,NULL)`,
    )
    .run(createHash("sha256").update(sourceText).digest("hex"), now);
  sqlite
    .prepare(
      `INSERT INTO job_versions
        (id,job_id,version,normalized_json,content_digest,source_observation_id,created_at)
       VALUES ('job-version:e2e','job-e2e-document',1,?,?,'observation:e2e',?)`,
    )
    .run(JSON.stringify(job), "b".repeat(64), now);
  new R2ARepository(sqlite, () => new Date(now)).recordNormalization(
    "job-version:e2e",
    normalizeR2AJobEvidence({
      sourceText,
      sourceObservationId: "observation:e2e",
      explicitLocation: "Sydney NSW 2000",
    }),
  );
  const invalidJob = {
    ...job,
    id: "job-e2e-r2a-invalid",
    title: "Fictional Corrupt Evidence Role",
  };
  sqlite
    .prepare(
      `INSERT INTO jobs
        (id,title,company,category,location,employment_type,normalized_json,application_status,
         date_discovered,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,'NEW',?,?,?)`,
    )
    .run(
      invalidJob.id,
      invalidJob.title,
      invalidJob.company,
      invalidJob.category,
      invalidJob.location,
      invalidJob.employmentType,
      JSON.stringify(invalidJob),
      now,
      now,
      now,
    );
  sqlite
    .prepare(
      `INSERT INTO source_observations
        (id,job_id,source_record_id,source,tenant,external_id,source_url,acquisition_method,
         content_hash,raw_snapshot_reference,observed_at,posted_at,expires_at,parser_version,
         policy_version,run_id,supersedes_observation_id)
       VALUES ('observation:e2e-invalid','job-e2e-r2a-invalid',NULL,'UNKNOWN',NULL,NULL,NULL,
         'USER_SUPPLIED_CONTENT',?,'fixture:r2a-invalid',?,NULL,NULL,'3.1.0',NULL,NULL,NULL)`,
    )
    .run(createHash("sha256").update(sourceText).digest("hex"), now);
  sqlite
    .prepare(
      `INSERT INTO job_versions
        (id,job_id,version,normalized_json,content_digest,source_observation_id,created_at)
       VALUES ('job-version:e2e-invalid','job-e2e-r2a-invalid',1,?,?,'observation:e2e-invalid',?)`,
    )
    .run(JSON.stringify(invalidJob), "c".repeat(64), now);
  new R2ARepository(sqlite, () => new Date(now)).recordNormalization(
    "job-version:e2e-invalid",
    normalizeR2AJobEvidence({
      sourceText,
      sourceObservationId: "observation:e2e-invalid",
      explicitLocation: "Sydney NSW 2000",
    }),
  );
  sqlite
    .prepare(
      `UPDATE job_field_evidence_v2 SET excerpt_hash = ?
       WHERE job_version_id = 'job-version:e2e-invalid' AND rowid =
         (SELECT min(rowid) FROM job_field_evidence_v2
          WHERE job_version_id = 'job-version:e2e-invalid')`,
    )
    .run("f".repeat(64));
  const insertArtifact = sqlite.prepare(
    `INSERT INTO document_artifacts
      (id,job_id,job_version_id,profile_version_id,type,template,format,file_name,local_path,
       content_digest,claim_evidence_json,layout_result_json,version,stale,created_at)
     VALUES (?,'job-e2e-document','job-version:e2e','profile-version:e2e','CV','fictional',
       ?,?,?,?,'[]','{}',1,0,?)`,
  );
  insertArtifact.run(
    "document:e2e-pdf",
    "PDF",
    "Fictional Preview.pdf",
    "e2e-documents/fictional-preview.pdf",
    createHash("sha256").update(pdf).digest("hex"),
    now,
  );
  insertArtifact.run(
    "document:e2e-docx",
    "DOCX",
    "Fictional Download.docx",
    "e2e-documents/fictional-download.docx",
    createHash("sha256").update(docx).digest("hex"),
    now,
  );
} finally {
  sqlite.close();
}

const server = spawn(
  process.execPath,
  [resolve("node_modules", "next", "dist", "bin", "next"), "dev", "-H", "127.0.0.1", "-p", "3100"],
  { cwd: resolve("apps/web"), env: environment, stdio: "inherit" },
);
function cleanup(): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const target = `${databasePath}${suffix}`;
    try {
      if (existsSync(target)) unlinkSync(target);
    } catch {
      // The ignored fictional test database is removed on the next E2E startup if Windows is still releasing it.
    }
  }
  for (const target of [pdfPath, docxPath]) {
    try {
      if (existsSync(target)) unlinkSync(target);
    } catch {
      // Exact fictional test artifact is removed on the next E2E startup.
    }
  }
  try {
    rmdirSync(privateDocumentDirectory);
  } catch {
    // The ignored directory is retained if it is not empty or Windows is still releasing it.
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});
