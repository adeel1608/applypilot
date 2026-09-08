import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

import BetterSqlite3 from "better-sqlite3";

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
    ]
      .map((file) => readFileSync(resolve("packages", "database", "drizzle", file), "utf8"))
      .join("\n"),
  );
  const now = "2026-09-08T00:00:00.000Z";
  const pdf = Buffer.from("%PDF-1.4\nfictional e2e preview\n");
  const docx = Buffer.from("PKfictional e2e download");
  mkdirSync(privateDocumentDirectory, { recursive: true });
  writeFileSync(pdfPath, pdf);
  writeFileSync(docxPath, docx);
  sqlite
    .prepare(
      `INSERT INTO jobs
        (id,title,company,category,location,employment_type,normalized_json,application_status,
         date_discovered,created_at,updated_at)
       VALUES ('job:e2e-document','Fictional Document Role','Example Local Co','Fixture',
         'Sydney NSW','UNKNOWN','{}','NEW',?,?,?)`,
    )
    .run(now, now, now);
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
      `INSERT INTO job_versions
        (id,job_id,version,normalized_json,content_digest,source_observation_id,created_at)
       VALUES ('job-version:e2e','job:e2e-document',1,'{}',?,NULL,?)`,
    )
    .run("b".repeat(64), now);
  const insertArtifact = sqlite.prepare(
    `INSERT INTO document_artifacts
      (id,job_id,job_version_id,profile_version_id,type,template,format,file_name,local_path,
       content_digest,claim_evidence_json,layout_result_json,version,stale,created_at)
     VALUES (?,'job:e2e-document','job-version:e2e','profile-version:e2e','CV','fictional',
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
