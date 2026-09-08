import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Document, HeadingLevel, Packer, Paragraph, TextRun, convertInchesToTwip } from "docx";

import { type CandidateProfile, verifiedCandidateName } from "@applypilot/candidate-profile";
import type { Job } from "@applypilot/job-model";
import {
  assertPrivateDocumentOutputPath,
  assertPrivatePdfOutputPath,
  preparePrivateOutputTarget,
} from "@applypilot/resume-engine";
import { normalizeText, VerificationStatus } from "@applypilot/shared";

export type CoverLetterRequirementStatus = "REQUIRED" | "OPTIONAL" | "NOT_REQUIRED" | "UNKNOWN";

export interface CoverLetterClaim {
  text: string;
  profileFactReferences: string[];
}

export interface CoverLetterDocument {
  candidateName: string;
  employer: string;
  roleTitle: string;
  salutation: string;
  paragraphs: string[];
  claims: CoverLetterClaim[];
  requiresHumanReview: true;
  tone: CandidateProfile["candidatePreferences"]["coverLetterTone"];
}

export function coverLetterRequirementStatus(job: Job): CoverLetterRequirementStatus {
  const metadata = job.sourceMetadata as
    | { documentRequirementStates?: { coverLetter?: unknown } }
    | undefined;
  const state = metadata?.documentRequirementStates?.coverLetter;
  if (state === "REQUIRED" || state === "NOT_REQUIRED") return state;
  if (job.coverLetterRequired) return "REQUIRED";
  return "UNKNOWN";
}

export function validateCoverLetterTruth(
  document: CoverLetterDocument,
  profile: CandidateProfile,
): { valid: boolean; errors: string[] } {
  const verifiedSkills = new Map(
    profile.skills
      .filter(({ verification }) => verification === VerificationStatus.VERIFIED)
      .map(({ id, name }) => [id, normalizeText(name)]),
  );
  const errors: string[] = [];
  for (const claim of document.claims) {
    if (claim.profileFactReferences.length === 0) {
      errors.push(`Claim has no profile provenance: ${claim.text}`);
    }
    for (const reference of claim.profileFactReferences) {
      const evidence = verifiedSkills.get(reference);
      if (!evidence) errors.push(`Claim references an unverified or missing fact ${reference}`);
      else if (!normalizeText(claim.text).includes(evidence)) {
        errors.push(`Claim text is not semantically bound to fact ${reference}`);
      }
    }
  }
  const allText = normalizeText(
    [...document.paragraphs, ...document.claims.map(({ text }) => text)].join(" "),
  );
  for (const forbidden of profile.forbiddenClaims) {
    if (allText.includes(normalizeText(forbidden))) {
      errors.push(`Document contains forbidden claim: ${forbidden}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function generateBasicCoverLetter(profile: CandidateProfile, job: Job): CoverLetterDocument {
  const candidateName = verifiedCandidateName(profile);
  if (!candidateName) {
    throw new Error("A verified candidate name is required to generate a cover letter");
  }
  const relevantSkills = profile.skills
    .filter(({ verification }) => verification === VerificationStatus.VERIFIED)
    .filter(({ name }) =>
      job.requiredSkills.some((required) => required.toLowerCase().includes(name.toLowerCase())),
    )
    .slice(0, 3);
  const claims: CoverLetterClaim[] = relevantSkills.map(({ id, name }) => ({
    text: `My verified ${name.toLocaleLowerCase("en-AU")} capability is relevant to this role.`,
    profileFactReferences: [id],
  }));
  const requirementText = job.requirements.slice(0, 2).join(" and ");
  const evidenceParagraph = claims.length
    ? claims.map(({ text }) => text).join(" ")
    : "I would welcome the opportunity to discuss which verified parts of my background are relevant.";

  const tone = profile.candidatePreferences.coverLetterTone;
  const opening = {
    DIRECT: `I am applying for the ${job.title} position with ${job.company}.`,
    WARM: `I am pleased to apply for the ${job.title} position with ${job.company}.`,
    FORMAL: `Please accept my application for the ${job.title} position with ${job.company}.`,
  }[tone];
  const closing = {
    DIRECT: "Thank you for considering my application.",
    WARM: "Thank you for considering my application; I would value the opportunity to discuss the role.",
    FORMAL:
      "Thank you for your consideration. I would welcome the opportunity to discuss my application.",
  }[tone];
  const document: CoverLetterDocument = {
    candidateName,
    employer: job.company,
    roleTitle: job.title,
    salutation: "Dear Hiring Manager,",
    paragraphs: [
      opening,
      requirementText
        ? `I understand that the role calls for ${requirementText.toLocaleLowerCase("en-AU")}.`
        : "I have reviewed the responsibilities described for the role.",
      evidenceParagraph,
      closing,
    ],
    claims,
    requiresHumanReview: true,
    tone,
  };
  const validation = validateCoverLetterTruth(document, profile);
  if (!validation.valid) {
    throw new Error(`Cover letter truth validation failed: ${validation.errors.join("; ")}`);
  }
  return document;
}

export function coverLetterFileName(profile: CandidateProfile, company: string): string {
  const firstName = profile.identity.firstName.value.toLocaleUpperCase("en-AU");
  const safeCompany = company.replace(/[<>:"/\\|?*]/g, "").trim();
  return `${firstName} COVER LETTER (${safeCompany}).pdf`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function coverLetterEssentialContent(document: CoverLetterDocument): string[] {
  return [
    document.candidateName,
    document.salutation,
    ...document.paragraphs,
    document.candidateName,
  ];
}

export function renderCoverLetterHtml(document: CoverLetterDocument): string {
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8" />
  <style>@page{size:A4;margin:22mm}body{font-family:"Times New Roman",serif;font-size:11pt;line-height:1.45;color:#000}h1{font-size:14pt;margin:0 0 12mm}p{margin:0 0 5mm}</style>
  </head><body><h1>${escapeHtml(document.candidateName)}</h1><p>${escapeHtml(document.salutation)}</p>
  ${document.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
  <p>Yours sincerely,</p><p>${escapeHtml(document.candidateName)}</p></body></html>`;
}

export async function renderCoverLetterPdf(
  document: CoverLetterDocument,
  outputPath: string,
  privateRoot: string,
): Promise<void> {
  const target = assertPrivatePdfOutputPath(outputPath, privateRoot);
  await preparePrivateOutputTarget(target, privateRoot);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(renderCoverLetterHtml(document), { waitUntil: "load" });
    const bytes = await page.pdf({ format: "A4", preferCSSPageSize: true, tagged: true });
    await writeFile(target, bytes, { flag: "wx" });
  } finally {
    await browser.close();
  }
}

export async function renderCoverLetterDocx(
  document: CoverLetterDocument,
  outputPath: string,
  privateRoot: string,
): Promise<void> {
  const target = assertPrivateDocumentOutputPath(outputPath, privateRoot);
  await preparePrivateOutputTarget(target, resolve(privateRoot));
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [
        new TextRun({ text: document.candidateName, bold: true, font: "Times New Roman" }),
      ],
    }),
    new Paragraph({ text: document.salutation }),
    ...document.paragraphs.map((text) => new Paragraph({ text, spacing: { after: 200 } })),
    new Paragraph({ text: "Yours sincerely," }),
    new Paragraph({ text: document.candidateName }),
  ];
  const file = new Document({
    styles: { default: { document: { run: { font: "Times New Roman", size: 22 } } } },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.85),
              right: convertInchesToTwip(0.85),
              bottom: convertInchesToTwip(0.85),
              left: convertInchesToTwip(0.85),
            },
          },
        },
        children,
      },
    ],
  });
  await writeFile(target, await Packer.toBuffer(file), { flag: "wx" });
}
