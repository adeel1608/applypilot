import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import {
  isVerified,
  type CandidateProfile,
  verifiedCandidateName,
} from "@applypilot/candidate-profile";
import type { Job } from "@applypilot/job-model";
import { normalizeText, VerificationStatus } from "@applypilot/shared";

export const ResumeTemplateCategory = {
  CASUAL_GENERAL: "casual-general",
  RETAIL_CUSTOMER_SERVICE: "retail-customer-service",
  HOSPITALITY_FRONT_OF_HOUSE: "hospitality-front-of-house",
  ADMIN_RECEPTION: "admin-reception",
  WAREHOUSE_OPERATIONS: "warehouse-operations",
  TECHNICAL_CASUAL: "technical-casual",
  ENGINEERING_GENERAL: "engineering-general",
  ROBOTICS_MECHATRONICS: "robotics-mechatronics",
  AUTOMATION_CONTROLS: "automation-controls",
  EMBEDDED_SYSTEMS: "embedded-systems",
} as const;

export type ResumeTemplateCategory =
  (typeof ResumeTemplateCategory)[keyof typeof ResumeTemplateCategory];

export interface FactBoundClaim {
  text: string;
  factReferences: string[];
}

export interface ResumeDocument {
  candidateName: string;
  contactLine: string;
  targetRole: string;
  targetCompany: string;
  template: ResumeTemplateCategory;
  pageLimit: 1 | 2;
  summary: FactBoundClaim[];
  skills: FactBoundClaim[];
  employment: Array<{
    heading: string;
    dates: string;
    claims: FactBoundClaim[];
  }>;
  education: Array<{
    heading: string;
    dates: string;
    factReferences: string[];
  }>;
  achievements: FactBoundClaim[];
}

export interface ResumeValidationResult {
  valid: boolean;
  errors: string[];
}

const engineeringTemplates = new Set<ResumeTemplateCategory>([
  ResumeTemplateCategory.ENGINEERING_GENERAL,
  ResumeTemplateCategory.ROBOTICS_MECHATRONICS,
  ResumeTemplateCategory.AUTOMATION_CONTROLS,
  ResumeTemplateCategory.EMBEDDED_SYSTEMS,
]);

export function selectResumeTemplate(job: Job): ResumeTemplateCategory {
  const search = normalizeText(`${job.title} ${job.category} ${job.description}`);
  if (/robot|mechatronic/.test(search)) return ResumeTemplateCategory.ROBOTICS_MECHATRONICS;
  if (/automation|control|plc/.test(search)) return ResumeTemplateCategory.AUTOMATION_CONTROLS;
  if (/embedded|firmware/.test(search)) return ResumeTemplateCategory.EMBEDDED_SYSTEMS;
  if (/engineering|engineer/.test(search)) return ResumeTemplateCategory.ENGINEERING_GENERAL;
  if (/warehouse|pick pack|distribution/.test(search))
    return ResumeTemplateCategory.WAREHOUSE_OPERATIONS;
  if (/admin|reception|office/.test(search)) return ResumeTemplateCategory.ADMIN_RECEPTION;
  if (/hospitality|restaurant|front of house|fast food/.test(search)) {
    return ResumeTemplateCategory.HOSPITALITY_FRONT_OF_HOUSE;
  }
  if (/retail|customer service|sales assistant/.test(search)) {
    return ResumeTemplateCategory.RETAIL_CUSTOMER_SERVICE;
  }
  if (/technical|technology/.test(search)) return ResumeTemplateCategory.TECHNICAL_CASUAL;
  return ResumeTemplateCategory.CASUAL_GENERAL;
}

function verifiedFactIds(profile: CandidateProfile): Set<string> {
  const ids = new Set<string>();
  const factEntries = [
    ["identity.firstName", profile.identity.firstName],
    ["identity.lastName", profile.identity.lastName],
    ["contact.email", profile.contact.email],
    ["contact.phone", profile.contact.phone],
    ["location.suburb", profile.location.suburb],
    ["location.state", profile.location.state],
  ] as const;
  for (const [id, fact] of factEntries) {
    if (isVerified(fact)) ids.add(id);
  }
  for (const value of [
    ...profile.skills,
    ...profile.employment,
    ...profile.education,
    ...profile.verifiedAchievements,
    ...profile.languages,
    ...profile.licences,
    ...profile.certifications,
  ]) {
    if (value.verification === VerificationStatus.VERIFIED) ids.add(value.id);
  }
  return ids;
}

export function validateResumeTruth(
  document: ResumeDocument,
  profile: CandidateProfile,
): ResumeValidationResult {
  const verifiedIds = verifiedFactIds(profile);
  const claims = [
    ...document.summary,
    ...document.skills,
    ...document.employment.flatMap(({ claims: employmentClaims }) => employmentClaims),
    ...document.achievements,
  ];
  const errors: string[] = [];
  for (const claim of claims) {
    if (claim.factReferences.length === 0) {
      errors.push(`Claim has no profile provenance: ${claim.text}`);
    }
    for (const reference of claim.factReferences) {
      if (!verifiedIds.has(reference)) {
        errors.push(`Claim references an unverified or missing fact ${reference}: ${claim.text}`);
      }
    }
  }
  for (const forbiddenClaim of profile.forbiddenClaims) {
    const normalizedForbidden = normalizeText(forbiddenClaim);
    if (
      claims.some(({ text }) => {
        const normalizedClaim = normalizeText(text);
        return (
          normalizedClaim.includes(normalizedForbidden) ||
          normalizedForbidden.includes(normalizedClaim)
        );
      })
    ) {
      errors.push(`Document contains forbidden claim: ${forbiddenClaim}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function generateResumeDocument(profile: CandidateProfile, job: Job): ResumeDocument {
  const candidateName = verifiedCandidateName(profile);
  if (!candidateName || !isVerified(profile.contact.email) || !isVerified(profile.contact.phone)) {
    throw new Error("Verified candidate name, email and phone are required to generate a resume");
  }

  const template = selectResumeTemplate(job);
  const skills = profile.skills
    .filter(({ verification }) => verification === VerificationStatus.VERIFIED)
    .filter(({ name }) =>
      job.requiredSkills.some((required) => {
        const skill = normalizeText(name);
        const requirement = normalizeText(required);
        return skill.includes(requirement) || requirement.includes(skill);
      }),
    )
    .map(({ id, name }) => ({ text: name, factReferences: [id] }));

  const education = profile.education
    .filter(({ verification }) => verification === VerificationStatus.VERIFIED)
    .map((item) => ({
      heading: `${item.qualification}, ${item.field} - ${item.institution}`,
      dates: `${item.startDate ?? ""} - ${item.endDate ?? "Present"}`,
      factReferences: [item.id],
    }));

  const summarySource =
    skills[0] ??
    profile.skills
      .filter(({ verification }) => verification === VerificationStatus.VERIFIED)
      .map(({ id, name }) => ({ text: name, factReferences: [id] }))[0];
  const summary = summarySource
    ? [
        {
          text: `Candidate with verified ${summarySource.text.toLocaleLowerCase("en-AU")} capability seeking to contribute to ${job.title}.`,
          factReferences: summarySource.factReferences,
        },
      ]
    : [];

  const document: ResumeDocument = {
    candidateName,
    contactLine: `${profile.contact.phone.value} | ${profile.contact.email.value}`,
    targetRole: job.title,
    targetCompany: job.company,
    template,
    pageLimit: engineeringTemplates.has(template) ? 2 : 1,
    summary,
    skills,
    employment: profile.employment
      .filter(({ verification }) => verification === VerificationStatus.VERIFIED)
      .map((role) => ({
        heading: `${role.title} - ${role.employer}`,
        dates: `${role.startDate} - ${role.endDate ?? "Present"}`,
        claims: role.responsibilities.map((text) => ({ text, factReferences: [role.id] })),
      })),
    education,
    achievements: profile.verifiedAchievements.map(({ id, statement }) => ({
      text: statement,
      factReferences: [id],
    })),
  };

  const validation = validateResumeTruth(document, profile);
  if (!validation.valid) {
    throw new Error(`Resume truth validation failed: ${validation.errors.join("; ")}`);
  }
  return document;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bulletList(claims: FactBoundClaim[]): string {
  return `<ul>${claims.map(({ text }) => `<li>${escapeHtml(text)}</li>`).join("")}</ul>`;
}

export function renderResumeHtml(document: ResumeDocument): string {
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(document.candidateName)} CV</title>
  <style>
    @page { size: A4; margin: 15mm 17mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: white; color: black; }
    body { font-family: "Times New Roman", Times, serif; font-size: 10.5pt; line-height: 1.28; }
    h1 { margin: 0; text-align: center; font-size: 18pt; font-weight: bold; }
    .contact { margin: 2mm 0 4mm; text-align: center; }
    h2 { margin: 3.5mm 0 1.5mm; border-bottom: 0.6pt solid black; font-size: 12pt; text-transform: uppercase; }
    h3 { margin: 2mm 0 0; font-size: 10.5pt; }
    p { margin: 0 0 1.5mm; }
    ul { margin: 1mm 0 2mm 5mm; padding-left: 4mm; }
    li { margin: 0 0 0.8mm; }
    .dates { display: block; margin: 0.5mm 0 1mm; font-size: 10pt; font-weight: normal; }
    .education-entry { margin-bottom: 2mm; }
    .target { text-align: center; margin-bottom: 2mm; }
  </style>
</head>
<body>
  <h1>${escapeHtml(document.candidateName)}</h1>
  <p class="contact">${escapeHtml(document.contactLine)}</p>
  <p class="target">Application: ${escapeHtml(document.targetRole)} - ${escapeHtml(document.targetCompany)}</p>
  <h2>Professional profile</h2>
  ${document.summary.map(({ text }) => `<p>${escapeHtml(text)}</p>`).join("")}
  <h2>Verified skills</h2>
  ${bulletList(document.skills)}
  <h2>Experience</h2>
  ${document.employment
    .map(
      ({ heading, dates, claims }) =>
        `<section><h3>${escapeHtml(heading)}</h3><p class="dates">${escapeHtml(dates)}</p>${bulletList(claims)}</section>`,
    )
    .join("")}
  <h2>Education</h2>
  ${document.education
    .map(
      ({ heading, dates }) =>
        `<p class="education-entry"><strong>${escapeHtml(heading)}</strong><span class="dates">${escapeHtml(dates)}</span></p>`,
    )
    .join("")}
  <h2>Verified achievements</h2>
  ${bulletList(document.achievements)}
</body>
</html>`;
}

export function resumeFileName(profile: CandidateProfile, company: string): string {
  const firstName = profile.identity.firstName.value;
  return profile.documentFileNameTemplate
    .replaceAll("{firstName}", firstName)
    .replaceAll("{firstNameUpper}", firstName.toLocaleUpperCase("en-AU"))
    .replaceAll("{company}", company.replace(/[<>:"/\\|?*]/g, "").trim());
}

export async function renderResumePdf(document: ResumeDocument, outputPath: string): Promise<void> {
  const { chromium } = await import("playwright");
  await mkdir(dirname(outputPath), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(renderResumeHtml(document), { waitUntil: "load" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      tagged: true,
    });
  } finally {
    await browser.close();
  }
}
