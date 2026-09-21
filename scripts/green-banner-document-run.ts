import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CandidateProfileSchema, candidateProfileContentHash } from "@applypilot/candidate-profile";
import {
  BetaRepository,
  assertCurrentDocumentGenerationTuple,
  openApplyPilotDatabase,
} from "@applypilot/database";
import { JobSchema } from "@applypilot/job-model";
import {
  generateResumeDocument,
  renderResumeDocx,
  renderResumePdf,
  resumeFileName,
} from "@applypilot/resume-engine";

import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";

const JOB_ID = "source-job-2a28f2764def648964221b971f7e7546";

async function main(): Promise<void> {
  const root = repositoryRoot();
  const database = openApplyPilotDatabase(localDatabasePath());
  try {
    const sqlite = database.sqlite;
    const profile = CandidateProfileSchema.parse(
      JSON.parse(await readFile(join(root, "data", "profile.private.json"), "utf8")),
    );
    const row = sqlite
      .prepare(
        `SELECT j.normalized_json AS normalizedJson,
                (SELECT id FROM job_versions WHERE job_id=j.id ORDER BY version DESC LIMIT 1) AS jobVersionId,
                (SELECT id FROM evaluation_versions WHERE job_id=j.id ORDER BY evaluated_at DESC,rowid DESC LIMIT 1) AS evaluationVersionId
         FROM jobs j WHERE j.id=?`,
      )
      .get(JOB_ID) as
      | { normalizedJson: string; jobVersionId: string; evaluationVersionId: string }
      | undefined;
    if (!row?.jobVersionId || !row.evaluationVersionId)
      throw new Error("CURRENT_DOCUMENT_TUPLE_REQUIRED");
    const tuple = assertCurrentDocumentGenerationTuple({
      sqlite,
      profile,
      jobVersionId: row.jobVersionId,
      evaluationVersionId: row.evaluationVersionId,
    });
    const job = JobSchema.parse(JSON.parse(row.normalizedJson));
    const privateRoot = join(root, "data", "private");
    const artifactKey = randomUUID();
    const directory = join("documents", JOB_ID);
    const displayName = resumeFileName(profile, job.company);
    const stem = displayName.replace(/\.pdf$/i, "");
    const pdfRelative = join(directory, `${artifactKey}.pdf`);
    const docxRelative = join(directory, `${artifactKey}.docx`);
    const document = generateResumeDocument(profile, job);
    const fitted = await renderResumePdf(document, pdfRelative, privateRoot);
    await renderResumeDocx(fitted, docxRelative, privateRoot);
    const [pdfBytes, docxBytes] = await Promise.all([
      readFile(join(privateRoot, pdfRelative)),
      readFile(join(privateRoot, docxRelative)),
    ]);
    if (pdfBytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("PDF_INVALID");
    if (docxBytes.subarray(0, 2).toString("ascii") !== "PK") throw new Error("DOCX_INVALID");
    const pages = pdfBytes.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
    if (pages < 1 || pages > fitted.pageLimit) throw new Error("PDF_PAGE_LIMIT_EXCEEDED");
    const claimEvidence = [
      ...fitted.summary,
      ...fitted.skills,
      ...fitted.employment.flatMap(({ claims }) => claims),
      ...fitted.projects.flatMap(({ claims }) => claims),
      ...fitted.achievements,
    ].flatMap(({ factReferences }) => factReferences);
    const beta = new BetaRepository(sqlite);
    const common = {
      jobId: JOB_ID,
      jobVersionId: row.jobVersionId,
      profileVersionId: tuple.profileVersionId,
      type: "CV" as const,
      template: fitted.template,
      claimEvidence: [...new Set(claimEvidence)],
      layoutResult: {
        rendererVersion: "resume-engine-beta-core-1",
        claimRuleVersion: "semantic-claims-1",
        pageLimit: fitted.pageLimit,
        pageCount: pages,
        atsText: true,
        minimumPointSize: 10,
      },
    };
    const pdf = beta.recordDocumentArtifact({
      ...common,
      format: "PDF",
      fileName: displayName,
      localPath: pdfRelative,
      contentDigest: createHash("sha256").update(pdfBytes).digest("hex"),
    });
    const docx = beta.recordDocumentArtifact({
      ...common,
      format: "DOCX",
      fileName: `${stem}.docx`,
      localPath: docxRelative,
      contentDigest: createHash("sha256").update(docxBytes).digest("hex"),
      layoutResult: { ...common.layoutResult, pageCount: null, structureValidated: true },
    });
    const profileHash = candidateProfileContentHash(profile);
    console.log(
      JSON.stringify({
        jobId: JOB_ID,
        jobVersionId: row.jobVersionId,
        profileVersionId: tuple.profileVersionId,
        profileHash,
        pdfId: pdf.id,
        pdfDigest: createHash("sha256").update(pdfBytes).digest("hex"),
        docxId: docx.id,
        docxDigest: createHash("sha256").update(docxBytes).digest("hex"),
        pages,
        privateOnly: true,
      }),
    );
  } finally {
    database.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "GREEN_BANNER_DOCUMENT_FAILED");
  process.exitCode = 1;
});
