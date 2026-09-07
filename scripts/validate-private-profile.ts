import { open } from "node:fs/promises";
import { resolve } from "node:path";

import { CandidateProfileSchema } from "@applypilot/candidate-profile";

const maximumPrivateProfileBytes = 1024 * 1024;
const maximumReportedIssues = 20;
const maximumPathCharacters = 120;
const privateProfilePath = resolve(process.cwd(), "data", "profile.private.json");

export type ProfileValidationResult =
  | { state: "VALID" }
  | { state: "MISSING" }
  | { state: "INVALID"; issues: Array<{ path: string; code: string }> };

function boundedIssuePath(path: PropertyKey[]): string {
  const normalized = path
    .slice(0, 12)
    .map((segment) => (typeof segment === "string" || typeof segment === "number" ? segment : "?"))
    .join(".");
  return (normalized || "$").slice(0, maximumPathCharacters);
}

export async function validatePrivateProfileAtPath(
  profilePath: string,
): Promise<ProfileValidationResult> {
  let handle;
  try {
    handle = await open(profilePath, "r");
    const stats = await handle.stat();
    if (!stats.isFile()) return { state: "INVALID", issues: [{ path: "$", code: "invalid_file" }] };
    if (stats.size <= 0 || stats.size > maximumPrivateProfileBytes) {
      return { state: "INVALID", issues: [{ path: "$", code: "invalid_file_size" }] };
    }

    const body = await handle.readFile({ encoding: "utf8" });
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return { state: "INVALID", issues: [{ path: "$", code: "invalid_json" }] };
    }

    const parsed = CandidateProfileSchema.safeParse(value);
    if (parsed.success) return { state: "VALID" };

    const seen = new Set<string>();
    const issues: Array<{ path: string; code: string }> = [];
    for (const issue of parsed.error.issues) {
      const safeIssue = { path: boundedIssuePath(issue.path), code: issue.code };
      const key = `${safeIssue.path}:${safeIssue.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(safeIssue);
      if (issues.length === maximumReportedIssues) break;
    }
    return { state: "INVALID", issues };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "MISSING" };
    return { state: "INVALID", issues: [{ path: "$", code: "read_error" }] };
  } finally {
    await handle?.close();
  }
}

export function formatPrivateProfileValidation(result: ProfileValidationResult): string[] {
  const lines = [`Private candidate profile: ${result.state}`];
  if (result.state === "INVALID") {
    for (const issue of result.issues) {
      lines.push(`Private profile issue: ${issue.path} [${issue.code}]`);
    }
  }
  return lines;
}

export function privateProfileValidationExitCode(result: ProfileValidationResult): number {
  return result.state === "VALID" ? 0 : result.state === "MISSING" ? 2 : 3;
}

async function main(): Promise<void> {
  const result = await validatePrivateProfileAtPath(privateProfilePath);
  for (const line of formatPrivateProfileValidation(result)) console.log(line);
  process.exitCode = privateProfileValidationExitCode(result);
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/validate-private-profile.ts")) {
  void main().catch(() => {
    console.log("Private candidate profile: INVALID");
    console.log("Private profile issue: $ [read_error]");
    process.exitCode = 3;
  });
}
