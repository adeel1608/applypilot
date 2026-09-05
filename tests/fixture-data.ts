import profileJson from "../data/profile.example.json";
import { fixtureJobs } from "../fixtures/jobs";

import { parseCandidateProfile } from "@applypilot/candidate-profile";

export const testProfile = parseCandidateProfile(profileJson);

export function fixtureJob(id: string) {
  const job = fixtureJobs.find((candidate) => candidate.id === id);
  if (!job) throw new Error(`Fixture job not found: ${id}`);
  return job;
}
