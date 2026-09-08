import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ApplicationPacketSchema, type ApplicationPacket } from "@applypilot/application-runner";
import {
  coverLetterFileName,
  coverLetterRequirementStatus,
  generateBasicCoverLetter,
  renderCoverLetterDocx,
  renderCoverLetterPdf,
} from "@applypilot/cover-letter-engine";
import type { EligibilityReason } from "@applypilot/eligibility-engine";
import type { FitContribution } from "@applypilot/fit-scorer";
import {
  EvaluationCoverageSchema,
  JobSchema,
  type EvaluationCoverage,
  type Job,
} from "@applypilot/job-model";
import {
  generateResumeDocument,
  renderResumeDocx,
  renderResumePdf,
  resumeFileName,
} from "@applypilot/resume-engine";
import { candidateProfileProvider } from "@web/lib/candidate-profile-provider";
import {
  getBetaRepository,
  getJobImportRepository,
  getLocalDatabase,
  hasBetaSchema,
} from "@web/lib/local-database";
import { resolveLocalDataDirectory } from "@web/lib/local-data-directory";

interface JobListRow {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  dateDiscovered: string;
  employmentType: string;
  jobVersionId: string | null;
  evaluationVersionId: string | null;
  eligibilityStatus: string | null;
  fitScore: number | null;
  coverageJson: string | null;
  evaluationStale: number | null;
  queueState: string | null;
  queueReason: string | null;
}

export interface BetaJobListItem {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  dateDiscovered: string;
  employmentType: string;
  jobVersionId: string | null;
  evaluationVersionId: string | null;
  eligibilityStatus: "ELIGIBLE" | "INELIGIBLE" | "REVIEW_REQUIRED" | null;
  fitScore: number | null;
  coverage: EvaluationCoverage | null;
  evaluationStale: boolean;
  queueState: "REVIEWING" | "SHORTLISTED" | "SKIPPED" | "PREPARING" | null;
  queueReason: string | null;
}

export interface BetaDocumentItem {
  id: string;
  type: "CV" | "COVER_LETTER" | "OTHER";
  format: "PDF" | "DOCX";
  fileName: string;
  template: string;
  contentDigest: string;
  version: number;
  stale: boolean;
  approved: boolean;
  createdAt: string;
}

export interface BetaJobDetail {
  job: Job;
  jobVersionId: string | null;
  sourceObservationId: string | null;
  evaluationVersionId: string | null;
  eligibilityStatus: BetaJobListItem["eligibilityStatus"];
  eligibilityReasons: EligibilityReason[];
  fitScore: number | null;
  fitContributions: FitContribution[];
  coverage: EvaluationCoverage | null;
  evaluationStale: boolean;
  queueState: BetaJobListItem["queueState"];
  requirements: Array<{
    kind: string;
    modality: string;
    certainty: string;
    originalText: string;
    normalizedProposition: string;
  }>;
  documents: BetaDocumentItem[];
  packet: null | {
    id: string;
    version: number;
    status: string;
    blockers: string[];
    warnings: string[];
    createdAt: string;
  };
}

function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function betaSqlite() {
  const local = getLocalDatabase();
  return local && hasBetaSchema(local.sqlite) ? local.sqlite : null;
}

export function listBetaJobs(): BetaJobListItem[] {
  const sqlite = betaSqlite();
  if (!sqlite) return [];
  const rows = sqlite
    .prepare(
      `SELECT j.id, j.title, j.company, j.location, j.employment_type AS employmentType,
         json_extract(j.normalized_json, '$.source') AS source,
         j.date_discovered AS dateDiscovered,
         v.id AS jobVersionId, e.id AS evaluationVersionId,
         e.eligibility_status AS eligibilityStatus, e.fit_score AS fitScore,
         e.coverage_json AS coverageJson, e.stale AS evaluationStale,
         q.state AS queueState, q.reason_code AS queueReason
       FROM jobs j
       LEFT JOIN job_versions v ON v.id = (
         SELECT id FROM job_versions WHERE job_id = j.id ORDER BY version DESC LIMIT 1)
       LEFT JOIN evaluation_versions e ON e.id = (
         SELECT id FROM evaluation_versions WHERE job_id = j.id ORDER BY evaluated_at DESC, rowid DESC LIMIT 1)
       LEFT JOIN job_queue_entries q ON q.job_id = j.id
       ORDER BY CASE q.state WHEN 'SHORTLISTED' THEN 0 WHEN 'PREPARING' THEN 1
         WHEN 'REVIEWING' THEN 2 WHEN 'SKIPPED' THEN 4 ELSE 3 END,
         e.fit_score DESC, j.date_discovered DESC`,
    )
    .all() as JobListRow[];
  return rows.map((row) => ({
    ...row,
    eligibilityStatus: row.eligibilityStatus as BetaJobListItem["eligibilityStatus"],
    coverage: row.coverageJson
      ? EvaluationCoverageSchema.parse(parseJson(row.coverageJson, {}))
      : null,
    evaluationStale: Boolean(row.evaluationStale),
    queueState: row.queueState as BetaJobListItem["queueState"],
  }));
}

function listDocuments(sqlite: NonNullable<ReturnType<typeof betaSqlite>>, jobId: string) {
  const rows = sqlite
    .prepare(
      `SELECT d.id, d.type, d.format, d.file_name AS fileName, d.template,
         d.content_digest AS contentDigest, d.version, d.stale, d.created_at AS createdAt,
         EXISTS(SELECT 1 FROM document_approvals a WHERE a.document_artifact_id = d.id
           AND a.content_digest = d.content_digest AND a.invalidated_at IS NULL) AS approved
       FROM document_artifacts d WHERE d.job_id = ? ORDER BY d.created_at DESC, d.format`,
    )
    .all(jobId) as Array<{
    id: string;
    type: BetaDocumentItem["type"];
    format: BetaDocumentItem["format"];
    fileName: string;
    template: string;
    contentDigest: string;
    version: number;
    stale: number;
    approved: number;
    createdAt: string;
  }>;
  return rows.map((row) => ({
    ...row,
    stale: Boolean(row.stale),
    approved: Boolean(row.approved),
  }));
}

export function getBetaJob(jobId: string): BetaJobDetail | null {
  const sqlite = betaSqlite();
  if (!sqlite) return null;
  const row = sqlite
    .prepare(
      `SELECT j.normalized_json AS normalizedJson, v.id AS jobVersionId,
         v.source_observation_id AS sourceObservationId, e.id AS evaluationVersionId,
         e.eligibility_status AS eligibilityStatus, e.eligibility_reasons_json AS reasonsJson,
         e.fit_score AS fitScore, e.fit_contributions_json AS contributionsJson,
         e.coverage_json AS coverageJson, e.stale AS evaluationStale, q.state AS queueState
       FROM jobs j
       LEFT JOIN job_versions v ON v.id = (
         SELECT id FROM job_versions WHERE job_id = j.id ORDER BY version DESC LIMIT 1)
       LEFT JOIN evaluation_versions e ON e.id = (
         SELECT id FROM evaluation_versions WHERE job_id = j.id ORDER BY evaluated_at DESC, rowid DESC LIMIT 1)
       LEFT JOIN job_queue_entries q ON q.job_id = j.id WHERE j.id = ?`,
    )
    .get(jobId) as
    | {
        normalizedJson: string;
        jobVersionId: string | null;
        sourceObservationId: string | null;
        evaluationVersionId: string | null;
        eligibilityStatus: BetaJobListItem["eligibilityStatus"];
        reasonsJson: string | null;
        fitScore: number | null;
        contributionsJson: string | null;
        coverageJson: string | null;
        evaluationStale: number | null;
        queueState: BetaJobListItem["queueState"];
      }
    | undefined;
  if (!row) return null;
  const requirementRows = row.jobVersionId
    ? (sqlite
        .prepare(
          `SELECT kind, modality, certainty, original_text AS originalText,
             normalized_proposition AS normalizedProposition
           FROM requirement_evidence WHERE job_version_id = ? ORDER BY start_offset LIMIT 100`,
        )
        .all(row.jobVersionId) as BetaJobDetail["requirements"])
    : [];
  const packetRow = sqlite
    .prepare(
      `SELECT id, version, status, readiness_json AS readinessJson, created_at AS createdAt
       FROM application_packets WHERE job_id = ? ORDER BY version DESC LIMIT 1`,
    )
    .get(jobId) as
    | { id: string; version: number; status: string; readinessJson: string; createdAt: string }
    | undefined;
  const readiness = packetRow
    ? parseJson<{ blockers?: string[]; warnings?: string[] }>(packetRow.readinessJson, {})
    : null;
  return {
    job: JobSchema.parse(JSON.parse(row.normalizedJson)),
    jobVersionId: row.jobVersionId,
    sourceObservationId: row.sourceObservationId,
    evaluationVersionId: row.evaluationVersionId,
    eligibilityStatus: row.eligibilityStatus,
    eligibilityReasons: parseJson(row.reasonsJson, []),
    fitScore: row.fitScore,
    fitContributions: parseJson(row.contributionsJson, []),
    coverage: row.coverageJson
      ? EvaluationCoverageSchema.parse(parseJson(row.coverageJson, {}))
      : null,
    evaluationStale: Boolean(row.evaluationStale),
    queueState: row.queueState,
    requirements: requirementRows,
    documents: listDocuments(sqlite, jobId),
    packet: packetRow
      ? {
          id: packetRow.id,
          version: packetRow.version,
          status: packetRow.status,
          blockers: readiness?.blockers ?? [],
          warnings: readiness?.warnings ?? [],
          createdAt: packetRow.createdAt,
        }
      : null,
  };
}

export async function reevaluateBetaJob(jobId: string): Promise<string> {
  const sqlite = betaSqlite();
  const importer = getJobImportRepository();
  if (!sqlite || !importer) throw new Error("BETA_DATABASE_NOT_READY");
  const resolution = await candidateProfileProvider.resolve("REAL_IMPORTED_JOB");
  if (resolution.state !== "PRIVATE_LOCAL_PROFILE") throw new Error("PRIVATE_PROFILE_REQUIRED");
  const legacyResult = await importer.reevaluateExistingJob(jobId, candidateProfileProvider);
  if (legacyResult !== "PRIVATE_LOCAL_PROFILE")
    throw new Error("PRIVATE_PROFILE_EVALUATION_FAILED");
  const row = sqlite
    .prepare(
      `SELECT id FROM evaluation_versions WHERE job_id = ?
       ORDER BY evaluated_at DESC, rowid DESC LIMIT 1`,
    )
    .get(jobId) as { id: string } | undefined;
  if (!row) throw new Error("BETA_VERSION_STATE_MISSING");
  return row.id;
}

export async function generatePrivateCv(jobId: string): Promise<{ pdfId: string; docxId: string }> {
  const sqlite = betaSqlite();
  const beta = getBetaRepository();
  if (!sqlite || !beta) throw new Error("BETA_DATABASE_NOT_READY");
  const resolution = await candidateProfileProvider.resolve("REAL_IMPORTED_JOB");
  if (resolution.state !== "PRIVATE_LOCAL_PROFILE") throw new Error("PRIVATE_PROFILE_REQUIRED");
  const detail = getBetaJob(jobId);
  if (!detail?.jobVersionId) throw new Error("JOB_VERSION_NOT_FOUND");
  const profileVersion = sqlite
    .prepare("SELECT active_version_id AS id FROM candidate_profiles WHERE id = ?")
    .get(resolution.profile.profileId) as { id: string | null } | undefined;
  if (!profileVersion?.id) throw new Error("PROFILE_VERSION_NOT_FOUND");
  const document = generateResumeDocument(resolution.profile, detail.job);
  const artifactKey = randomUUID();
  const directory = join("documents", jobId.replace(/[^A-Za-z0-9._-]/g, "_"));
  const displayName = resumeFileName(resolution.profile, detail.job.company);
  const stem = displayName.replace(/\.pdf$/i, "");
  const pdfRelative = join(directory, `${artifactKey}.pdf`);
  const docxRelative = join(directory, `${artifactKey}.docx`);
  const privateRoot = join(resolveLocalDataDirectory(), "private");
  const fittedDocument = await renderResumePdf(document, pdfRelative, privateRoot);
  await renderResumeDocx(fittedDocument, docxRelative, privateRoot);
  const [pdfBytes, docxBytes] = await Promise.all([
    readFile(join(privateRoot, pdfRelative)),
    readFile(join(privateRoot, docxRelative)),
  ]);
  if (pdfBytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("PDF_INVALID");
  if (docxBytes.subarray(0, 2).toString("ascii") !== "PK") throw new Error("DOCX_INVALID");
  const pages = pdfBytes.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  if (pages < 1 || pages > fittedDocument.pageLimit) throw new Error("PDF_PAGE_LIMIT_EXCEEDED");
  const claimReferences = [
    ...fittedDocument.summary,
    ...fittedDocument.skills,
    ...fittedDocument.employment.flatMap(({ claims }) => claims),
    ...fittedDocument.projects.flatMap(({ claims }) => claims),
    ...fittedDocument.achievements,
  ].flatMap(({ factReferences }) => factReferences);
  const common = {
    jobId,
    jobVersionId: detail.jobVersionId,
    profileVersionId: profileVersion.id,
    type: "CV" as const,
    template: fittedDocument.template,
    claimEvidence: [...new Set(claimReferences)],
    layoutResult: {
      rendererVersion: "resume-engine-beta-core-1",
      claimRuleVersion: "semantic-claims-1",
      pageLimit: fittedDocument.pageLimit,
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
  return { pdfId: pdf.id, docxId: docx.id };
}

export async function generatePrivateCoverLetter(
  jobId: string,
): Promise<{ pdfId: string; docxId: string }> {
  const sqlite = betaSqlite();
  const beta = getBetaRepository();
  if (!sqlite || !beta) throw new Error("BETA_DATABASE_NOT_READY");
  const resolution = await candidateProfileProvider.resolve("REAL_IMPORTED_JOB");
  if (resolution.state !== "PRIVATE_LOCAL_PROFILE") throw new Error("PRIVATE_PROFILE_REQUIRED");
  const detail = getBetaJob(jobId);
  if (!detail?.jobVersionId) throw new Error("JOB_VERSION_NOT_FOUND");
  const profileVersion = sqlite
    .prepare("SELECT active_version_id AS id FROM candidate_profiles WHERE id = ?")
    .get(resolution.profile.profileId) as { id: string | null } | undefined;
  if (!profileVersion?.id) throw new Error("PROFILE_VERSION_NOT_FOUND");
  const document = generateBasicCoverLetter(resolution.profile, detail.job);
  const artifactKey = randomUUID();
  const directory = join("documents", jobId.replace(/[^A-Za-z0-9._-]/g, "_"));
  const pdfRelative = join(directory, `${artifactKey}-letter.pdf`);
  const docxRelative = join(directory, `${artifactKey}-letter.docx`);
  const privateRoot = join(resolveLocalDataDirectory(), "private");
  await renderCoverLetterPdf(document, pdfRelative, privateRoot);
  await renderCoverLetterDocx(document, docxRelative, privateRoot);
  const [pdfBytes, docxBytes] = await Promise.all([
    readFile(join(privateRoot, pdfRelative)),
    readFile(join(privateRoot, docxRelative)),
  ]);
  if (pdfBytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("PDF_INVALID");
  if (docxBytes.subarray(0, 2).toString("ascii") !== "PK") throw new Error("DOCX_INVALID");
  const pages = pdfBytes.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
  if (pages !== 1) throw new Error("COVER_LETTER_PAGE_LIMIT_EXCEEDED");
  const displayName = coverLetterFileName(resolution.profile, detail.job.company);
  const common = {
    jobId,
    jobVersionId: detail.jobVersionId,
    profileVersionId: profileVersion.id,
    type: "COVER_LETTER" as const,
    template: `letter-${document.tone.toLowerCase()}`,
    claimEvidence: [
      ...new Set(document.claims.flatMap(({ profileFactReferences }) => profileFactReferences)),
    ],
    layoutResult: {
      rendererVersion: "cover-letter-engine-beta-core-1",
      claimRuleVersion: "semantic-claims-1",
      pageLimit: 1,
      pageCount: pages,
      requiresHumanReview: true,
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
    fileName: displayName.replace(/\.pdf$/i, ".docx"),
    localPath: docxRelative,
    contentDigest: createHash("sha256").update(docxBytes).digest("hex"),
    layoutResult: { ...common.layoutResult, pageCount: null, structureValidated: true },
  });
  return { pdfId: pdf.id, docxId: docx.id };
}

export function approvePrivateDocument(documentArtifactId: string, contentDigest: string): string {
  const beta = getBetaRepository();
  if (!beta) throw new Error("BETA_DATABASE_NOT_READY");
  return beta.approveDocument({ documentArtifactId, contentDigest });
}

export function setBetaQueueState(
  jobId: string,
  state: "REVIEWING" | "SHORTLISTED" | "SKIPPED" | "PREPARING",
): void {
  const detail = getBetaJob(jobId);
  const beta = getBetaRepository();
  if (!detail || !beta) throw new Error("BETA_JOB_NOT_FOUND");
  beta.setQueueState({
    jobId,
    state,
    evaluationVersionId: detail.evaluationVersionId,
    reasonCode: `OWNER_${state}`,
  });
}

export async function correctBetaJob(
  jobId: string,
  input: { title: string; company: string; location: string; category: string },
): Promise<void> {
  const detail = getBetaJob(jobId);
  const beta = getBetaRepository();
  if (!detail || !beta) throw new Error("BETA_JOB_NOT_FOUND");
  const changedFields = (Object.keys(input) as Array<keyof typeof input>).filter(
    (field) => input[field].trim() !== detail.job[field],
  );
  if (!changedFields.length) throw new Error("CORRECTION_HAS_NO_CHANGE");
  const job = JobSchema.parse({
    ...detail.job,
    title: input.title.trim(),
    company: input.company.trim(),
    location: input.location.trim(),
    category: input.category.trim(),
    dateUpdated: new Date().toISOString(),
    eligibilityStatus: null,
    eligibilityReasons: [],
    fitScore: null,
    fitReasons: [],
  });
  beta.recordOwnerCorrection({ job, reasonCode: "OWNER_REVIEWED_FIELDS", changedFields });
  await reevaluateBetaJob(jobId);
}

export function preparePrivatePacket(jobId: string): { packetId: string; status: string } {
  const sqlite = betaSqlite();
  const beta = getBetaRepository();
  const detail = getBetaJob(jobId);
  if (
    !sqlite ||
    !beta ||
    !detail?.jobVersionId ||
    !detail.evaluationVersionId ||
    !detail.eligibilityStatus
  ) {
    throw new Error("BETA_JOB_NOT_READY");
  }
  const profileVersion = sqlite
    .prepare("SELECT profile_version_id AS id FROM evaluation_versions WHERE id = ?")
    .get(detail.evaluationVersionId) as { id: string } | undefined;
  if (!profileVersion) throw new Error("PROFILE_VERSION_NOT_FOUND");
  const currentDocuments = detail.documents.filter(
    ({ stale, approved, format }) => !stale && approved && format === "PDF",
  );
  const packet = ApplicationPacketSchema.parse({
    id: randomUUID(),
    jobId,
    jobVersionId: detail.jobVersionId,
    profileVersionId: profileVersion.id,
    evaluationVersionId: detail.evaluationVersionId,
    eligibilityStatus: detail.eligibilityStatus,
    targetUrl: null,
    targetHost: null,
    jobExpired: false,
    duplicateDanger: false,
    versionsCurrent: !detail.evaluationStale,
    documents: currentDocuments.map((document) => ({
      id: document.id,
      type: document.type,
      fileName: document.fileName,
      digest: document.contentDigest,
      approved: document.approved,
      stale: document.stale,
      required:
        document.type === "CV" ||
        (document.type === "COVER_LETTER" &&
          coverLetterRequirementStatus(detail.job) === "REQUIRED"),
    })),
    answers: [],
  } satisfies ApplicationPacket);
  const result = beta.persistApplicationPacket(packet);
  setBetaQueueState(jobId, "PREPARING");
  const now = new Date().toISOString();
  let application = sqlite
    .prepare("SELECT id FROM applications WHERE job_id = ? ORDER BY created_at LIMIT 1")
    .get(jobId) as { id: string } | undefined;
  if (!application) {
    application = { id: randomUUID() };
    sqlite
      .prepare(
        `INSERT INTO applications
          (id, job_id, profile_version_id, status, source, resume_document_id,
           cover_letter_document_id, submitted_at, created_at, updated_at)
         VALUES (?, ?, ?, 'DISCOVERED', ?, NULL, NULL, NULL, ?, ?)`,
      )
      .run(application.id, jobId, profileVersion.id, detail.job.source, now, now);
  }
  const transitions = ["DISCOVERED", "REVIEWING", "SHORTLISTED", "PREPARING"] as const;
  for (const toStatus of transitions) {
    try {
      beta.appendApplicationEvent({
        applicationId: application.id,
        packetId: packet.id,
        toStatus,
        eventType: `OWNER_${toStatus}`,
        actor: "LOCAL_USER",
        idempotencyKey: `packet:${packet.id}:${toStatus}`,
        metadata: { packetVersion: result.version },
      });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("transition")) throw error;
    }
  }
  return { packetId: result.packetId, status: result.status };
}

export interface BetaApplicationListItem {
  id: string;
  jobId: string;
  title: string;
  company: string;
  status: string;
  packetStatus: string | null;
  packetVersion: number | null;
  blockers: string[];
  timeline: Array<{ toStatus: string; eventType: string; occurredAt: string }>;
}

export function listBetaApplications(): BetaApplicationListItem[] {
  const sqlite = betaSqlite();
  if (!sqlite) return [];
  const rows = sqlite
    .prepare(
      `SELECT a.id, a.job_id AS jobId, j.title, j.company, a.status,
         p.status AS packetStatus, p.version AS packetVersion, p.readiness_json AS readinessJson
       FROM applications a JOIN jobs j ON j.id = a.job_id
       LEFT JOIN application_packets p ON p.id = (
         SELECT id FROM application_packets WHERE job_id = a.job_id ORDER BY version DESC LIMIT 1)
       ORDER BY a.updated_at DESC`,
    )
    .all() as Array<{
    id: string;
    jobId: string;
    title: string;
    company: string;
    status: string;
    packetStatus: string | null;
    packetVersion: number | null;
    readinessJson: string | null;
  }>;
  return rows.map((row) => ({
    ...row,
    blockers: parseJson<{ blockers?: string[] }>(row.readinessJson, {}).blockers ?? [],
    timeline: sqlite
      .prepare(
        `SELECT to_status AS toStatus, event_type AS eventType, occurred_at AS occurredAt
         FROM application_events_v2 WHERE application_id = ? ORDER BY occurred_at, rowid`,
      )
      .all(row.id) as BetaApplicationListItem["timeline"],
  }));
}

export function getSourceCapabilitySummary(): {
  status: "SOURCE_READY_AWAITING_TENANT" | "SOURCE_ALLOWLIST_READY";
  capabilities: Array<{ source: string; approved: boolean; expiresAt: string }>;
} {
  const sqlite = betaSqlite();
  if (!sqlite) return { status: "SOURCE_READY_AWAITING_TENANT", capabilities: [] };
  const rows = sqlite
    .prepare(
      `SELECT source, approved, expires_at AS expiresAt FROM capability_configs
       ORDER BY source, expires_at DESC`,
    )
    .all() as Array<{ source: string; approved: number; expiresAt: string }>;
  return {
    status: rows.length ? "SOURCE_ALLOWLIST_READY" : "SOURCE_READY_AWAITING_TENANT",
    capabilities: rows.map(({ source, approved, expiresAt }) => ({
      source,
      approved: Boolean(approved),
      expiresAt,
    })),
  };
}
