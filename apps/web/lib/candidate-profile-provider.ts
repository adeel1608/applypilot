import "server-only";

import { open } from "node:fs/promises";
import { resolve } from "node:path";

import profileJson from "../../../data/profile.example.json";
import {
  CandidateProfileSchema,
  enforceEvaluationProfile,
  parseCandidateProfile,
  toCandidateProfileStatusDto,
  type CandidateProfileProvider,
  type CandidateProfileResolution,
  type CandidateProfileStatusDto,
  type JobEvaluationContext,
} from "@applypilot/candidate-profile";

const maximumPrivateProfileBytes = 1024 * 1024;
const demoProfile = parseCandidateProfile(profileJson);

export class LocalCandidateProfileProvider implements CandidateProfileProvider {
  constructor(
    private readonly privateProfilePath = resolve(process.cwd(), "data", "profile.private.json"),
  ) {}

  async resolve(context: JobEvaluationContext): Promise<CandidateProfileResolution> {
    if (context === "DEMO_FIXTURE_JOB") return { state: "DEMO_PROFILE", profile: demoProfile };
    let handle;
    try {
      handle = await open(this.privateProfilePath, "r");
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size <= 0 || stats.size > maximumPrivateProfileBytes) {
        return { state: "INVALID_PRIVATE_PROFILE", reasonCode: "PRIVATE_PROFILE_INVALID" };
      }
      const body = await handle.readFile({ encoding: "utf8" });
      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch {
        return { state: "INVALID_PRIVATE_PROFILE", reasonCode: "PRIVATE_PROFILE_INVALID" };
      }
      const parsed = CandidateProfileSchema.safeParse(value);
      return parsed.success
        ? { state: "PRIVATE_LOCAL_PROFILE", profile: parsed.data }
        : { state: "INVALID_PRIVATE_PROFILE", reasonCode: "PRIVATE_PROFILE_INVALID" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { state: "NO_ACTIVE_PROFILE", reasonCode: "PRIVATE_PROFILE_MISSING" };
      }
      return { state: "INVALID_PRIVATE_PROFILE", reasonCode: "PRIVATE_PROFILE_INVALID" };
    } finally {
      await handle?.close();
    }
  }
}

export const candidateProfileProvider = new LocalCandidateProfileProvider();

export async function getCandidateProfileStatus(): Promise<CandidateProfileStatusDto> {
  const resolution = enforceEvaluationProfile(
    "REAL_IMPORTED_JOB",
    await candidateProfileProvider.resolve("REAL_IMPORTED_JOB"),
  );
  return toCandidateProfileStatusDto(resolution);
}
