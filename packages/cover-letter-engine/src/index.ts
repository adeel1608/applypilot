import { type CandidateProfile, verifiedCandidateName } from "@applypilot/candidate-profile";
import type { Job } from "@applypilot/job-model";
import { VerificationStatus } from "@applypilot/shared";

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

  return {
    candidateName,
    employer: job.company,
    roleTitle: job.title,
    salutation: "Dear Hiring Manager,",
    paragraphs: [
      `I am applying for the ${job.title} position with ${job.company}.`,
      requirementText
        ? `I understand that the role calls for ${requirementText.toLocaleLowerCase("en-AU")}.`
        : "I have reviewed the responsibilities described for the role.",
      evidenceParagraph,
      "Thank you for considering my application. I would welcome an opportunity to discuss the role.",
    ],
    claims,
    requiresHumanReview: true,
  };
}

export function coverLetterFileName(profile: CandidateProfile, company: string): string {
  const firstName = profile.identity.firstName.value.toLocaleUpperCase("en-AU");
  const safeCompany = company.replace(/[<>:"/\\|?*]/g, "").trim();
  return `${firstName} COVER LETTER (${safeCompany}).pdf`;
}
