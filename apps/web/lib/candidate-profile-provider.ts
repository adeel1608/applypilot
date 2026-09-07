import "server-only";

import { open } from "node:fs/promises";
import { join } from "node:path";

import { resolveLocalDataDirectory } from "./local-data-directory";

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

function privateProfileFilename(): string {
  const filename = process.env.APPLYPILOT_PROFILE_FILENAME ?? "profile.private.json";
  if (!/^profile(?:\.[A-Za-z0-9-]+)?\.private\.json$/.test(filename)) {
    throw new Error("INVALID_PRIVATE_PROFILE_FILENAME");
  }
  return filename;
}

export class LocalCandidateProfileProvider implements CandidateProfileProvider {
  constructor(private readonly privateProfilePath?: string) {}

  async resolve(context: JobEvaluationContext): Promise<CandidateProfileResolution> {
    if (context === "DEMO_FIXTURE_JOB") return { state: "DEMO_PROFILE", profile: demoProfile };
    let handle;
    try {
      const path =
        this.privateProfilePath ??
        join(/* turbopackIgnore: true */ resolveLocalDataDirectory(), privateProfileFilename());
      // The owner's runtime file is never a deployable build dependency.
      handle = await open(/* turbopackIgnore: true */ path, "r");
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
