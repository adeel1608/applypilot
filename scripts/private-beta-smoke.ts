import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import JSZip from "jszip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { ApplicationPacketSchema, type ApplicationPacket } from "@applypilot/application-runner";
import { BetaRepository, JobImportRepository } from "@applypilot/database";
import {
  coverLetterEssentialContent,
  coverLetterFileName,
  coverLetterRequirementStatus,
  generateBasicCoverLetter,
  renderCoverLetterDocx,
  renderCoverLetterPdf,
} from "@applypilot/cover-letter-engine";
import {
  CandidateProfileSchema,
  type CandidateProfileProvider,
} from "@applypilot/candidate-profile";
import { JobSchema } from "@applypilot/job-model";
import {
  generateResumeDocument,
  renderResumeDocx,
  renderResumePdf,
  resumeEssentialContent,
  resumeFileName,
} from "@applypilot/resume-engine";
import { normalizeText } from "@applypilot/shared";
import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeArtifactText(value: string): string {
  return normalizeText(
    value
      .replace(/<[^>]+>/g, " ")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function containsTokenSequence(normalizedArtifact: string, expected: string): boolean {
  const artifactTokens = normalizedArtifact.split(" ");
  const expectedTokens = normalizeText(expected).split(" ");
  let cursor = 0;
  for (const token of expectedTokens) {
    const index = artifactTokens.indexOf(token, cursor);
    if (index < 0) return false;
    cursor = index + 1;
  }
  return true;
}

async function extractPdfText(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const pdf = await getDocument({ data: bytes }).promise;
  const text = (
    await Promise.all(
      Array.from({ length: pdf.numPages }, async (_, index) => {
        const page = await pdf.getPage(index + 1);
        const content = await page.getTextContent();
        return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      }),
    )
  ).join(" ");
  return { pages: pdf.numPages, text: normalizeArtifactText(text) };
}

async function main(): Promise<void> {
  const root = repositoryRoot();
  const databasePath = localDatabasePath();
  const profilePath = join(root, "data", "profile.private.json");
  const profile = CandidateProfileSchema.parse(JSON.parse(readFileSync(profilePath, "utf8")));
  const provider: CandidateProfileProvider = {
    resolve: async () => ({ state: "PRIVATE_LOCAL_PROFILE", profile }),
  };
  const sqlite = new BetterSqlite3(databasePath, { fileMustExist: true });
  sqlite.pragma("foreign_keys = ON");
  try {
    if (Number(sqlite.pragma("user_version", { simple: true })) !== 2) {
      throw new Error("BETA_SCHEMA_REQUIRED");
    }
    if (sqlite.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new Error("DATABASE_INTEGRITY_FAILED");
    }
    if ((sqlite.pragma("foreign_key_check") as unknown[]).length) {
      throw new Error("DATABASE_FOREIGN_KEY_FAILED");
    }
    const jobs = sqlite
      .prepare("SELECT id, normalized_json AS normalizedJson FROM jobs")
      .all() as Array<{
      id: string;
      normalizedJson: string;
    }>;
    if (jobs.length !== 1) throw new Error("PRESERVED_SINGLE_JOB_REQUIRED");
    const priorMaterialCount = Number(
      sqlite
        .prepare(
          `SELECT (SELECT count(*) FROM document_artifacts) +
                  (SELECT count(*) FROM application_packets) +
                  (SELECT count(*) FROM applications)`,
        )
        .pluck()
        .get(),
    );
    if (priorMaterialCount !== 0) throw new Error("PRIVATE_SMOKE_ALREADY_MATERIALIZED");
    const job = JobSchema.parse(JSON.parse(jobs[0]!.normalizedJson));
    const importer = new JobImportRepository(sqlite);
    const evaluationState = await importer.reevaluateExistingJob(job.id, provider);
    if (evaluationState !== "PRIVATE_LOCAL_PROFILE") {
      throw new Error("PRIVATE_REEVALUATION_FAILED");
    }
    const state = sqlite
      .prepare(
        `SELECT
           (SELECT id FROM job_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1) AS jobVersionId,
           (SELECT id FROM evaluation_versions WHERE job_id = ? ORDER BY evaluated_at DESC, rowid DESC LIMIT 1) AS evaluationVersionId,
           (SELECT profile_version_id FROM evaluation_versions WHERE job_id = ? ORDER BY evaluated_at DESC, rowid DESC LIMIT 1) AS profileVersionId,
           (SELECT eligibility_status FROM evaluation_versions WHERE job_id = ? ORDER BY evaluated_at DESC, rowid DESC LIMIT 1) AS eligibilityStatus,
           (SELECT coverage_json FROM evaluation_versions WHERE job_id = ? ORDER BY evaluated_at DESC, rowid DESC LIMIT 1) AS coverageJson`,
      )
      .get(job.id, job.id, job.id, job.id, job.id) as {
      jobVersionId: string | null;
      evaluationVersionId: string | null;
      profileVersionId: string | null;
      eligibilityStatus: "ELIGIBLE" | "INELIGIBLE" | "REVIEW_REQUIRED" | null;
      coverageJson: string | null;
    };
    if (
      !state.jobVersionId ||
      !state.evaluationVersionId ||
      !state.profileVersionId ||
      !state.eligibilityStatus ||
      !state.coverageJson
    ) {
      throw new Error("BETA_EVALUATION_VERSION_MISSING");
    }
    const beta = new BetaRepository(sqlite);
    beta.setQueueState({
      jobId: job.id,
      state: "REVIEWING",
      evaluationVersionId: state.evaluationVersionId,
      reasonCode: "OWNER_PRIVATE_SMOKE_REVIEW",
    });
    beta.setQueueState({
      jobId: job.id,
      state: "SHORTLISTED",
      evaluationVersionId: state.evaluationVersionId,
      reasonCode: "OWNER_PRIVATE_SMOKE_SHORTLIST",
    });

    const document = generateResumeDocument(profile, job);
    const artifactKey = randomUUID();
    const directory = join("documents", job.id.replace(/[^A-Za-z0-9._-]/g, "_"));
    const pdfRelative = join(directory, `${artifactKey}.pdf`);
    const docxRelative = join(directory, `${artifactKey}.docx`);
    const privateRoot = join(root, "data", "private");
    const fittedDocument = await renderResumePdf(document, pdfRelative, privateRoot);
    await renderResumeDocx(fittedDocument, docxRelative, privateRoot);
    const [pdfBytes, docxBytes] = await Promise.all([
      readFile(join(privateRoot, pdfRelative)),
      readFile(join(privateRoot, docxRelative)),
    ]);
    const pdf = await extractPdfText(new Uint8Array(pdfBytes));
    const archive = await JSZip.loadAsync(docxBytes);
    const documentXml = await archive.file("word/document.xml")!.async("string");
    const docxText = normalizeArtifactText(documentXml);
    for (const [index, content] of resumeEssentialContent(fittedDocument).entries()) {
      const normalizedContent = normalizeText(content);
      const pdfMatch = pdf.text.includes(normalizedContent);
      const docxMatch = containsTokenSequence(docxText, content);
      if (!pdfMatch || !docxMatch) {
        throw new Error(
          `DOCUMENT_ESSENTIAL_CONTENT_PARITY_FAILED index=${index} pdf=${pdfMatch ? "PASS" : "FAIL"} docx=${docxMatch ? "PASS" : "FAIL"}`,
        );
      }
    }
    if (pdf.pages < 1 || pdf.pages > fittedDocument.pageLimit)
      throw new Error("DOCUMENT_PAGE_LIMIT_FAILED");
    const claimReferences = [
      ...fittedDocument.summary,
      ...fittedDocument.skills,
      ...fittedDocument.employment.flatMap(({ claims }) => claims),
      ...fittedDocument.projects.flatMap(({ claims }) => claims),
      ...fittedDocument.achievements,
    ].flatMap(({ factReferences }) => factReferences);
    const displayName = resumeFileName(profile, job.company);
    const common = {
      jobId: job.id,
      jobVersionId: state.jobVersionId,
      profileVersionId: state.profileVersionId,
      type: "CV" as const,
      template: fittedDocument.template,
      claimEvidence: [...new Set(claimReferences)],
      layoutResult: {
        rendererVersion: "resume-engine-beta-core-1",
        claimRuleVersion: "semantic-claims-1",
        pageLimit: fittedDocument.pageLimit,
        pageCount: pdf.pages,
        essentialContentParity: true,
        minimumPointSize: 10,
      },
    };
    const pdfArtifact = beta.recordDocumentArtifact({
      ...common,
      format: "PDF",
      fileName: displayName,
      localPath: pdfRelative,
      contentDigest: digest(pdfBytes),
    });
    const docxArtifact = beta.recordDocumentArtifact({
      ...common,
      format: "DOCX",
      fileName: displayName.replace(/\.pdf$/i, ".docx"),
      localPath: docxRelative,
      contentDigest: digest(docxBytes),
      layoutResult: { ...common.layoutResult, pageCount: null },
    });
    beta.approveDocument({ documentArtifactId: pdfArtifact.id, contentDigest: digest(pdfBytes) });
    beta.approveDocument({ documentArtifactId: docxArtifact.id, contentDigest: digest(docxBytes) });

    const letterDecision = coverLetterRequirementStatus(job);
    const packetDocuments: ApplicationPacket["documents"] = [
      {
        id: pdfArtifact.id,
        type: "CV" as const,
        fileName: displayName,
        digest: digest(pdfBytes),
        approved: true,
        stale: false,
        required: true,
      },
    ];
    let documentCount = 2;
    if (letterDecision === "REQUIRED") {
      const letter = generateBasicCoverLetter(profile, job);
      const letterKey = randomUUID();
      const letterPdfRelative = join(directory, `${letterKey}-letter.pdf`);
      const letterDocxRelative = join(directory, `${letterKey}-letter.docx`);
      await renderCoverLetterPdf(letter, letterPdfRelative, privateRoot);
      await renderCoverLetterDocx(letter, letterDocxRelative, privateRoot);
      const [letterPdfBytes, letterDocxBytes] = await Promise.all([
        readFile(join(privateRoot, letterPdfRelative)),
        readFile(join(privateRoot, letterDocxRelative)),
      ]);
      const letterPdf = await extractPdfText(new Uint8Array(letterPdfBytes));
      const letterArchive = await JSZip.loadAsync(letterDocxBytes);
      const letterXml = await letterArchive.file("word/document.xml")!.async("string");
      const letterDocxText = normalizeArtifactText(letterXml);
      for (const content of coverLetterEssentialContent(letter)) {
        const normalizedContent = normalizeText(content);
        if (
          !letterPdf.text.includes(normalizedContent) ||
          !containsTokenSequence(letterDocxText, content)
        ) {
          throw new Error("COVER_LETTER_CONTENT_PARITY_FAILED");
        }
      }
      if (letterPdf.pages !== 1) throw new Error("COVER_LETTER_PAGE_LIMIT_FAILED");
      const letterName = coverLetterFileName(profile, job.company);
      const letterCommon = {
        jobId: job.id,
        jobVersionId: state.jobVersionId,
        profileVersionId: state.profileVersionId,
        type: "COVER_LETTER" as const,
        template: `letter-${letter.tone.toLowerCase()}`,
        claimEvidence: [
          ...new Set(letter.claims.flatMap(({ profileFactReferences }) => profileFactReferences)),
        ],
        layoutResult: {
          rendererVersion: "cover-letter-engine-beta-core-1",
          claimRuleVersion: "semantic-claims-1",
          pageLimit: 1,
          essentialContentParity: true,
          requiresHumanReview: true,
        },
      };
      const letterPdfArtifact = beta.recordDocumentArtifact({
        ...letterCommon,
        format: "PDF",
        fileName: letterName,
        localPath: letterPdfRelative,
        contentDigest: digest(letterPdfBytes),
        layoutResult: { ...letterCommon.layoutResult, pageCount: 1 },
      });
      const letterDocxArtifact = beta.recordDocumentArtifact({
        ...letterCommon,
        format: "DOCX",
        fileName: letterName.replace(/\.pdf$/i, ".docx"),
        localPath: letterDocxRelative,
        contentDigest: digest(letterDocxBytes),
        layoutResult: { ...letterCommon.layoutResult, pageCount: null },
      });
      beta.approveDocument({
        documentArtifactId: letterPdfArtifact.id,
        contentDigest: digest(letterPdfBytes),
      });
      beta.approveDocument({
        documentArtifactId: letterDocxArtifact.id,
        contentDigest: digest(letterDocxBytes),
      });
      packetDocuments.push({
        id: letterPdfArtifact.id,
        type: "COVER_LETTER",
        fileName: letterName,
        digest: digest(letterPdfBytes),
        approved: true,
        stale: false,
        required: true,
      });
      documentCount = 4;
    }
    const packet = ApplicationPacketSchema.parse({
      id: randomUUID(),
      jobId: job.id,
      jobVersionId: state.jobVersionId,
      profileVersionId: state.profileVersionId,
      evaluationVersionId: state.evaluationVersionId,
      eligibilityStatus: state.eligibilityStatus,
      targetUrl: null,
      targetHost: null,
      jobExpired: false,
      duplicateDanger: false,
      versionsCurrent: true,
      documents: packetDocuments,
      answers: [],
    });
    const packetResult = beta.persistApplicationPacket(packet);
    if (packetResult.status !== "REVIEW_REQUIRED")
      throw new Error("PRIVATE_PACKET_MUST_REQUIRE_REVIEW");
    beta.setQueueState({
      jobId: job.id,
      state: "PREPARING",
      evaluationVersionId: state.evaluationVersionId,
      reasonCode: "OWNER_PRIVATE_PACKET_PREPARED",
    });
    const applicationId = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO applications
          (id, job_id, profile_version_id, status, source, resume_document_id,
           cover_letter_document_id, submitted_at, created_at, updated_at)
         VALUES (?, ?, ?, 'DISCOVERED', ?, NULL, NULL, NULL, ?, ?)`,
      )
      .run(applicationId, job.id, state.profileVersionId, job.source, now, now);
    for (const toStatus of ["DISCOVERED", "REVIEWING", "SHORTLISTED", "PREPARING"] as const) {
      beta.appendApplicationEvent({
        applicationId,
        packetId: packet.id,
        toStatus,
        eventType: `OWNER_${toStatus}`,
        actor: "LOCAL_USER",
        idempotencyKey: `private-smoke:${applicationId}:${toStatus}`,
        metadata: { packetVersion: packetResult.version },
      });
    }
    if (sqlite.pragma("integrity_check", { simple: true }) !== "ok") {
      throw new Error("POST_SMOKE_INTEGRITY_FAILED");
    }
    if ((sqlite.pragma("foreign_key_check") as unknown[]).length) {
      throw new Error("POST_SMOKE_FOREIGN_KEY_FAILED");
    }
    console.log(
      `PRIVATE_BETA_SMOKE_COMPLETE jobs=1 evaluation=PRIVATE_LOCAL_PROFILE queue=PREPARING documents=${documentCount} document_parity=PASS cover_letter=${letterDecision} packet=REVIEW_REQUIRED timeline_events=4 real_source_calls=0 real_application_actions=0 integrity=PASS foreign_key_issues=0`,
    );
  } finally {
    sqlite.close();
  }
}

void main();
