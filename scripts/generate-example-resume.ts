import profileJson from "../data/profile.example.json";
import { fixtureJobs } from "../fixtures/jobs";

import { parseCandidateProfile } from "@applypilot/candidate-profile";
import { generateResumeDocument, renderResumePdf, resumeFileName } from "@applypilot/resume-engine";

async function main() {
  const profile = parseCandidateProfile(profileJson);
  const job = fixtureJobs.find(({ id }) => id === "job-retail-sales-assistant");
  if (!job) throw new Error("Retail fixture not found");

  const document = generateResumeDocument(profile, job);
  const outputPath = `output/pdf/${resumeFileName(profile, job.company)}`;
  await renderResumePdf(document, outputPath);
  process.stdout.write(`${outputPath}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
