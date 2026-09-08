import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

import { Document, HeadingLevel, Packer, Paragraph, TextRun, convertInchesToTwip } from "docx";

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

export const resumeTemplateCategories = Object.values(
  ResumeTemplateCategory,
) as ResumeTemplateCategory[];

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
  projects: Array<{
    heading: string;
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

export interface ResumeTemplateDesign {
  id: ResumeTemplateCategory;
  profileHeading: string;
  skillsHeading: string;
  experienceHeading: string;
  educationHeading: string;
  projectsHeading: string;
  typeface: "Times New Roman";
  sectionOrder: Array<
    "SUMMARY" | "SKILLS" | "EXPERIENCE" | "PROJECTS" | "EDUCATION" | "ACHIEVEMENTS"
  >;
  evidencePriorities: string[];
  summaryStrategy: "CAPABILITY" | "SERVICE" | "OPERATIONS" | "TECHNICAL" | "ENGINEERING";
}

const casualOrder: ResumeTemplateDesign["sectionOrder"] = [
  "SUMMARY",
  "SKILLS",
  "EXPERIENCE",
  "EDUCATION",
  "PROJECTS",
  "ACHIEVEMENTS",
];
const engineeringOrder: ResumeTemplateDesign["sectionOrder"] = [
  "SUMMARY",
  "SKILLS",
  "PROJECTS",
  "EXPERIENCE",
  "EDUCATION",
  "ACHIEVEMENTS",
];

function templateDesign(input: Omit<ResumeTemplateDesign, "typeface">): ResumeTemplateDesign {
  return { ...input, typeface: "Times New Roman" };
}

export const resumeTemplateDesigns: Record<ResumeTemplateCategory, ResumeTemplateDesign> = {
  "casual-general": templateDesign({
    id: "casual-general",
    profileHeading: "Profile",
    skillsHeading: "Key strengths",
    experienceHeading: "Experience",
    projectsHeading: "Projects",
    educationHeading: "Education",
    sectionOrder: casualOrder,
    evidencePriorities: ["reliability", "communication", "team"],
    summaryStrategy: "CAPABILITY",
  }),
  "retail-customer-service": templateDesign({
    id: "retail-customer-service",
    profileHeading: "Customer service profile",
    skillsHeading: "Service skills",
    experienceHeading: "Customer-facing experience",
    projectsHeading: "Relevant projects",
    educationHeading: "Education",
    sectionOrder: casualOrder,
    evidencePriorities: ["customer", "service", "communication", "sales"],
    summaryStrategy: "SERVICE",
  }),
  "hospitality-front-of-house": templateDesign({
    id: "hospitality-front-of-house",
    profileHeading: "Hospitality profile",
    skillsHeading: "Front-of-house strengths",
    experienceHeading: "Hospitality experience",
    projectsHeading: "Relevant projects",
    educationHeading: "Training and education",
    sectionOrder: casualOrder,
    evidencePriorities: ["hospitality", "customer", "team", "food"],
    summaryStrategy: "SERVICE",
  }),
  "admin-reception": templateDesign({
    id: "admin-reception",
    profileHeading: "Administrative profile",
    skillsHeading: "Administrative skills",
    experienceHeading: "Professional experience",
    projectsHeading: "Administrative projects",
    educationHeading: "Education",
    sectionOrder: casualOrder,
    evidencePriorities: ["administration", "records", "office", "communication"],
    summaryStrategy: "OPERATIONS",
  }),
  "warehouse-operations": templateDesign({
    id: "warehouse-operations",
    profileHeading: "Operations profile",
    skillsHeading: "Operational strengths",
    experienceHeading: "Operations experience",
    projectsHeading: "Operations projects",
    educationHeading: "Training and education",
    sectionOrder: ["SUMMARY", "SKILLS", "EXPERIENCE", "ACHIEVEMENTS", "EDUCATION", "PROJECTS"],
    evidencePriorities: ["warehouse", "safety", "inventory", "team"],
    summaryStrategy: "OPERATIONS",
  }),
  "technical-casual": templateDesign({
    id: "technical-casual",
    profileHeading: "Technical profile",
    skillsHeading: "Technical capabilities",
    experienceHeading: "Relevant experience",
    projectsHeading: "Technical projects",
    educationHeading: "Technical education",
    sectionOrder: ["SUMMARY", "SKILLS", "PROJECTS", "EDUCATION", "EXPERIENCE", "ACHIEVEMENTS"],
    evidencePriorities: ["technical", "software", "systems", "problem"],
    summaryStrategy: "TECHNICAL",
  }),
  "engineering-general": templateDesign({
    id: "engineering-general",
    profileHeading: "Engineering profile",
    skillsHeading: "Engineering capabilities",
    experienceHeading: "Engineering experience",
    projectsHeading: "Engineering projects",
    educationHeading: "Engineering education",
    sectionOrder: engineeringOrder,
    evidencePriorities: ["engineering", "design", "analysis", "systems"],
    summaryStrategy: "ENGINEERING",
  }),
  "robotics-mechatronics": templateDesign({
    id: "robotics-mechatronics",
    profileHeading: "Robotics and mechatronics profile",
    skillsHeading: "Robotics capabilities",
    experienceHeading: "Project and work experience",
    projectsHeading: "Robotics projects",
    educationHeading: "Mechatronics education",
    sectionOrder: engineeringOrder,
    evidencePriorities: ["robotics", "mechatronics", "control", "mechanical"],
    summaryStrategy: "ENGINEERING",
  }),
  "automation-controls": templateDesign({
    id: "automation-controls",
    profileHeading: "Automation and controls profile",
    skillsHeading: "Controls capabilities",
    experienceHeading: "Automation experience",
    projectsHeading: "Controls projects",
    educationHeading: "Engineering education",
    sectionOrder: engineeringOrder,
    evidencePriorities: ["automation", "control", "plc", "instrumentation"],
    summaryStrategy: "ENGINEERING",
  }),
  "embedded-systems": templateDesign({
    id: "embedded-systems",
    profileHeading: "Embedded systems profile",
    skillsHeading: "Embedded capabilities",
    experienceHeading: "Systems experience",
    projectsHeading: "Embedded systems projects",
    educationHeading: "Technical education",
    sectionOrder: engineeringOrder,
    evidencePriorities: ["embedded", "firmware", "microcontroller", "software"],
    summaryStrategy: "TECHNICAL",
  }),
};

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
    ...profile.projects,
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

function verifiedFactEvidence(profile: CandidateProfile): Map<string, string[]> {
  const evidence = new Map<string, string[]>();
  const add = (id: string, values: Array<string | undefined>) => {
    evidence.set(id, values.filter((value): value is string => Boolean(value)).map(normalizeText));
  };
  add("identity.firstName", [profile.identity.firstName.value]);
  add("identity.lastName", [profile.identity.lastName.value]);
  add("contact.email", [profile.contact.email.value]);
  add("contact.phone", [profile.contact.phone.value]);
  add("location.suburb", [profile.location.suburb.value]);
  add("location.state", [profile.location.state.value]);
  for (const item of profile.skills) add(item.id, [item.name, item.evidence]);
  for (const item of profile.employment) {
    add(item.id, [item.title, item.employer, item.location, ...item.responsibilities]);
  }
  for (const item of profile.projects) {
    add(item.id, [item.name, item.summary, ...item.bullets, ...item.skills]);
  }
  for (const item of profile.education) {
    add(item.id, [item.qualification, item.field, item.institution]);
  }
  for (const item of profile.verifiedAchievements) add(item.id, [item.statement, item.evidence]);
  for (const item of profile.languages) add(item.id, [item.name, item.proficiency]);
  for (const item of profile.licences) add(item.id, [item.name, item.jurisdiction]);
  for (const item of profile.certifications) add(item.id, [item.name, item.issuer]);
  return evidence;
}

export function validateResumeTruth(
  document: ResumeDocument,
  profile: CandidateProfile,
): ResumeValidationResult {
  const verifiedIds = verifiedFactIds(profile);
  const evidenceById = verifiedFactEvidence(profile);
  const claims = [
    ...document.summary,
    ...document.skills,
    ...document.employment.flatMap(({ claims: employmentClaims }) => employmentClaims),
    ...document.projects.flatMap(({ claims: projectClaims }) => projectClaims),
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
        continue;
      }
      const normalizedClaim = normalizeText(claim.text);
      const evidence = evidenceById.get(reference) ?? [];
      if (!evidence.some((value) => value.length >= 2 && normalizedClaim.includes(value))) {
        errors.push(`Claim text is not semantically bound to fact ${reference}: ${claim.text}`);
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

export function generateResumeDocument(
  profile: CandidateProfile,
  job: Job,
  templateOverride?: ResumeTemplateCategory,
): ResumeDocument {
  const candidateName = verifiedCandidateName(profile);
  if (!candidateName || !isVerified(profile.contact.email) || !isVerified(profile.contact.phone)) {
    throw new Error("Verified candidate name, email and phone are required to generate a resume");
  }

  if (templateOverride && !resumeTemplateCategories.includes(templateOverride)) {
    throw new Error("INVALID_RESUME_TEMPLATE");
  }
  const template = templateOverride ?? selectResumeTemplate(job);
  const design = resumeTemplateDesigns[template];
  const jobSignals = [job.title, job.category, ...job.requiredSkills, ...job.requirements]
    .map(normalizeText)
    .join(" ");
  const relevance = (values: string[]) => {
    const text = normalizeText(values.join(" "));
    return (
      design.evidencePriorities.filter((keyword) => text.includes(keyword)).length * 2 +
      job.requiredSkills.filter((required) => {
        const normalized = normalizeText(required);
        return text.includes(normalized) || normalized.includes(text);
      }).length +
      (jobSignals.split(" ").filter((token) => token.length > 3 && text.includes(token)).length > 0
        ? 1
        : 0)
    );
  };
  const skills = profile.skills
    .filter(({ verification }) => verification === VerificationStatus.VERIFIED)
    .filter(({ name }) => {
      const explicitlyRequired = job.requiredSkills.some((required) => {
        const skill = normalizeText(name);
        const requirement = normalizeText(required);
        return skill.includes(requirement) || requirement.includes(skill);
      });
      return explicitlyRequired || relevance([name]) > 0;
    })
    .sort((left, right) => relevance([right.name]) - relevance([left.name]))
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
  const strategyLead = {
    CAPABILITY: "Candidate",
    SERVICE: "Service-focused candidate",
    OPERATIONS: "Operations-focused candidate",
    TECHNICAL: "Technically focused candidate",
    ENGINEERING: "Engineering-focused candidate",
  }[design.summaryStrategy];
  const summary = summarySource
    ? [
        {
          text: `${strategyLead} with verified ${summarySource.text.toLocaleLowerCase("en-AU")} capability seeking to contribute to ${job.title}.`,
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
      .sort(
        (left, right) =>
          relevance([right.title, right.employer, ...right.responsibilities]) -
          relevance([left.title, left.employer, ...left.responsibilities]),
      )
      .map((role) => ({
        heading: `${role.title} - ${role.employer}`,
        dates: `${role.startDate} - ${role.endDate ?? "Present"}`,
        claims: role.responsibilities.map((text) => ({ text, factReferences: [role.id] })),
      })),
    projects: profile.projects
      .filter(({ verification }) => verification === VerificationStatus.VERIFIED)
      .sort(
        (left, right) =>
          relevance([right.name, right.summary, ...right.bullets, ...right.skills]) -
          relevance([left.name, left.summary, ...left.bullets, ...left.skills]),
      )
      .map((project) => ({
        heading: project.name,
        claims: [project.summary, ...project.bullets].map((text) => ({
          text,
          factReferences: [project.id],
        })),
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
  const design = resumeTemplateDesigns[document.template];
  const sections: Record<ResumeTemplateDesign["sectionOrder"][number], string> = {
    SUMMARY: `<h2>${escapeHtml(design.profileHeading)}</h2>${document.summary
      .map(({ text }) => `<p>${escapeHtml(text)}</p>`)
      .join("")}`,
    SKILLS: `<h2>${escapeHtml(design.skillsHeading)}</h2>${bulletList(document.skills)}`,
    EXPERIENCE: `<h2>${escapeHtml(design.experienceHeading)}</h2>${document.employment
      .map(
        ({ heading, dates, claims }) =>
          `<section><h3>${escapeHtml(heading)}</h3><p class="dates">${escapeHtml(dates)}</p>${bulletList(claims)}</section>`,
      )
      .join("")}`,
    PROJECTS: document.projects.length
      ? `<h2>${escapeHtml(design.projectsHeading)}</h2>${document.projects
          .map(
            ({ heading, claims }) =>
              `<section><h3>${escapeHtml(heading)}</h3>${bulletList(claims)}</section>`,
          )
          .join("")}`
      : "",
    EDUCATION: `<h2>${escapeHtml(design.educationHeading)}</h2>${document.education
      .map(
        ({ heading, dates }) =>
          `<p class="education-entry"><strong>${escapeHtml(heading)}</strong><span class="dates">${escapeHtml(dates)}</span></p>`,
      )
      .join("")}`,
    ACHIEVEMENTS: document.achievements.length
      ? `<h2>Verified achievements</h2>${bulletList(document.achievements)}`
      : "",
  };
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(document.candidateName)} CV</title>
  <style>
    @page { size: A4; margin: 15mm 17mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: white; color: black; }
    body { font-family: "${design.typeface}", Arial, sans-serif; font-size: 10.5pt; line-height: 1.28; }
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
<body data-template="${escapeHtml(design.id)}">
  <h1>${escapeHtml(document.candidateName)}</h1>
  <p class="contact">${escapeHtml(document.contactLine)}</p>
  <p class="target">Application: ${escapeHtml(document.targetRole)} - ${escapeHtml(document.targetCompany)}</p>
  ${design.sectionOrder.map((section) => sections[section]).join("\n  ")}
</body>
</html>`;
}

/** Ordered substantive text that every maintained renderer must preserve. */
export function resumeEssentialContent(document: ResumeDocument): string[] {
  const design = resumeTemplateDesigns[document.template];
  const content: string[] = [
    document.candidateName,
    document.contactLine,
    `Application: ${document.targetRole} - ${document.targetCompany}`,
  ];
  const sections: Record<ResumeTemplateDesign["sectionOrder"][number], string[]> = {
    SUMMARY: [design.profileHeading, ...document.summary.map(({ text }) => text)],
    SKILLS: [design.skillsHeading, ...document.skills.map(({ text }) => text)],
    EXPERIENCE: [
      design.experienceHeading,
      ...document.employment.flatMap(({ heading, dates, claims }) => [
        heading,
        dates,
        ...claims.map(({ text }) => text),
      ]),
    ],
    PROJECTS: document.projects.length
      ? [
          design.projectsHeading,
          ...document.projects.flatMap(({ heading, claims }) => [
            heading,
            ...claims.map(({ text }) => text),
          ]),
        ]
      : [],
    EDUCATION: [
      design.educationHeading,
      ...document.education.flatMap(({ heading, dates }) => [heading, dates]),
    ],
    ACHIEVEMENTS: document.achievements.length
      ? ["Verified achievements", ...document.achievements.map(({ text }) => text)]
      : [],
  };
  for (const section of design.sectionOrder) content.push(...sections[section]);
  return content;
}

export function resumeFileName(profile: CandidateProfile, company: string): string {
  const firstName = profile.identity.firstName.value;
  return profile.documentFileNameTemplate
    .replaceAll("{firstName}", firstName)
    .replaceAll("{firstNameUpper}", firstName.toLocaleUpperCase("en-AU"))
    .replaceAll("{company}", company.replace(/[<>:"/\\|?*]/g, "").trim());
}

function assertPrivateOutputPath(
  outputPath: string,
  privateRoot: string,
  extension: ".docx" | ".pdf",
): string {
  const root = resolve(privateRoot);
  if (isAbsolute(outputPath)) throw new Error("ABSOLUTE_DOCUMENT_OUTPUT_FORBIDDEN");
  const segments = outputPath.split(/[\\/]+/);
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  if (
    segments.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.includes(":") ||
        part.endsWith(".") ||
        part.endsWith(" ") ||
        reserved.test(part),
    )
  ) {
    throw new Error("UNSAFE_DOCUMENT_OUTPUT_NAME");
  }
  const target = resolve(root, outputPath);
  const pathSegments = root.split(/[\\/]+/).map((part) => part.toLowerCase());
  if (!pathSegments.includes("private")) throw new Error("PRIVATE_DOCUMENT_ROOT_REQUIRED");
  const fromRoot = relative(root, target);
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) {
    throw new Error("DOCUMENT_OUTPUT_OUTSIDE_PRIVATE_ROOT");
  }
  if (extname(target).toLowerCase() !== extension) {
    throw new Error(extension === ".docx" ? "DOCX_OUTPUT_REQUIRED" : "PDF_OUTPUT_REQUIRED");
  }
  return target;
}

export function assertPrivateDocumentOutputPath(outputPath: string, privateRoot: string): string {
  return assertPrivateOutputPath(outputPath, privateRoot, ".docx");
}

export function assertPrivatePdfOutputPath(outputPath: string, privateRoot: string): string {
  return assertPrivateOutputPath(outputPath, privateRoot, ".pdf");
}

export async function preparePrivateOutputTarget(
  target: string,
  privateRoot: string,
): Promise<void> {
  const root = resolve(privateRoot);
  await mkdir(root, { recursive: true });
  await mkdir(dirname(target), { recursive: true });
  const resolvedRoot = await realpath(root);
  const resolvedParent = await realpath(dirname(target));
  const fromRoot = relative(resolvedRoot, resolvedParent);
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) {
    throw new Error("DOCUMENT_OUTPUT_SYMLINK_ESCAPE");
  }
}

export async function renderResumePdf(
  document: ResumeDocument,
  outputPath: string,
  privateRoot: string,
): Promise<ResumeDocument> {
  const target = assertPrivatePdfOutputPath(outputPath, privateRoot);
  await preparePrivateOutputTarget(target, privateRoot);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const fitted = structuredClone(document);
    while (true) {
      await page.setContent(renderResumeHtml(fitted), { waitUntil: "load" });
      const bytes = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        tagged: true,
      });
      const pages = bytes.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0;
      if (pages >= 1 && pages <= fitted.pageLimit) {
        await writeFile(target, bytes, { flag: "wx" });
        return fitted;
      }
      if (!removeLowestPriorityEvidence(fitted)) throw new Error("PDF_PAGE_LIMIT_EXCEEDED");
    }
  } finally {
    await browser.close();
  }
}

function removeLowestPriorityEvidence(document: ResumeDocument): boolean {
  if (document.achievements.length) {
    document.achievements.pop();
    return true;
  }
  const lastProject = document.projects.at(-1);
  if (lastProject) {
    if (lastProject.claims.length > 1) lastProject.claims.pop();
    else document.projects.pop();
    return true;
  }
  const lastRole = document.employment.at(-1);
  if (lastRole) {
    if (lastRole.claims.length > 1) lastRole.claims.pop();
    else if (document.employment.length > 1) document.employment.pop();
    else if (document.education.length > 1) document.education.pop();
    else if (document.skills.length > 1) document.skills.pop();
    else return false;
    return true;
  }
  if (document.education.length > 1) {
    document.education.pop();
    return true;
  }
  if (document.skills.length > 1) {
    document.skills.pop();
    return true;
  }
  return false;
}

function docxSectionHeading(text: string, typeface: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text, bold: true, font: typeface, size: 22 })],
  });
}

export async function renderResumeDocx(
  document: ResumeDocument,
  outputPath: string,
  privateRoot: string,
): Promise<void> {
  const target = assertPrivateDocumentOutputPath(outputPath, privateRoot);
  const design = resumeTemplateDesigns[document.template];
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: "center",
      children: [new TextRun({ text: document.candidateName, bold: true, font: design.typeface })],
    }),
    new Paragraph({ text: document.contactLine, alignment: "center" }),
    new Paragraph({
      text: `Application: ${document.targetRole} - ${document.targetCompany}`,
      alignment: "center",
    }),
  ];
  const sections: Record<ResumeTemplateDesign["sectionOrder"][number], Paragraph[]> = {
    SUMMARY: [
      docxSectionHeading(design.profileHeading, design.typeface),
      ...document.summary.map(({ text }) => new Paragraph({ text })),
    ],
    SKILLS: [
      docxSectionHeading(design.skillsHeading, design.typeface),
      ...document.skills.map(({ text }) => new Paragraph({ text, bullet: { level: 0 } })),
    ],
    EXPERIENCE: [docxSectionHeading(design.experienceHeading, design.typeface)],
    PROJECTS: document.projects.length
      ? [docxSectionHeading(design.projectsHeading, design.typeface)]
      : [],
    EDUCATION: [docxSectionHeading(design.educationHeading, design.typeface)],
    ACHIEVEMENTS: document.achievements.length
      ? [docxSectionHeading("Verified achievements", design.typeface)]
      : [],
  };
  for (const role of document.employment) {
    sections.EXPERIENCE.push(
      new Paragraph({ children: [new TextRun({ text: role.heading, bold: true })] }),
      new Paragraph({ text: role.dates }),
      ...role.claims.map(({ text }) => new Paragraph({ text, bullet: { level: 0 } })),
    );
  }
  for (const project of document.projects) {
    sections.PROJECTS.push(
      new Paragraph({ children: [new TextRun({ text: project.heading, bold: true })] }),
      ...project.claims.map(({ text }) => new Paragraph({ text, bullet: { level: 0 } })),
    );
  }
  for (const education of document.education) {
    sections.EDUCATION.push(
      new Paragraph({ children: [new TextRun({ text: education.heading, bold: true })] }),
      new Paragraph({ text: education.dates }),
    );
  }
  sections.ACHIEVEMENTS.push(
    ...document.achievements.map(({ text }) => new Paragraph({ text, bullet: { level: 0 } })),
  );
  for (const section of design.sectionOrder) children.push(...sections[section]);
  const docx = new Document({
    styles: { default: { document: { run: { font: design.typeface, size: 21 } } } },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.55),
              right: convertInchesToTwip(0.65),
              bottom: convertInchesToTwip(0.55),
              left: convertInchesToTwip(0.65),
            },
          },
        },
        children,
      },
    ],
  });
  const root = resolve(privateRoot);
  await preparePrivateOutputTarget(target, root);
  await writeFile(target, await Packer.toBuffer(docx), { flag: "wx" });
}
