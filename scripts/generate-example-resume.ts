import profileJson from "../data/profile.example.json";
import { fixtureJobs } from "../fixtures/jobs";
import { join } from "node:path";

import { parseCandidateProfile } from "@applypilot/candidate-profile";
import { generateResumeDocument, renderResumePdf, resumeFileName } from "@applypilot/resume-engine";

async function main() {
  const profile = parseCandidateProfile(profileJson);
  const job = fixtureJobs.find(({ id }) => id === "job-retail-sales-assistant");
  if (!job) throw new Error("Retail fixture not found");

  const document = generateResumeDocument(profile, job);
  const privateRoot = join(process.cwd(), "data", "private");
  const outputPath = join("generated", "examples", resumeFileName(profile, job.company));
  await renderResumePdf(document, outputPath, privateRoot);
  process.stdout.write(`${outputPath}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
