import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  formatPrivateProfileValidation,
  privateProfileValidationExitCode,
  validatePrivateProfileAtPath,
} from "../../scripts/validate-private-profile";

const repositoryRoot = process.cwd();
const fictionalProfile = readFileSync(
  resolve(repositoryRoot, "data", "profile.example.json"),
  "utf8",
);
const temporaryDirectories: string[] = [];

function temporaryWorkspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "applypilot-validator-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function privateProfilePath(workspace: string): string {
  return join(workspace, "data", "profile.private.json");
}

function writePrivateProfile(workspace: string, body: string): void {
  const dataDirectory = join(workspace, "data");
  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(privateProfilePath(workspace), body, "utf8");
}

async function runValidator(workspace: string) {
  const result = await validatePrivateProfileAtPath(privateProfilePath(workspace));
  return {
    status: privateProfileValidationExitCode(result),
    stdout: formatPrivateProfileValidation(result).join("\n"),
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("private profile validation CLI", () => {
  it("reports a missing fixed-path profile without exposing its path", async () => {
    const workspace = temporaryWorkspace();
    const result = await runValidator(workspace);

    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe("Private candidate profile: MISSING");
    expect(result.stdout).not.toContain(workspace);
  });

  it("reports malformed JSON without echoing content or exceptions", async () => {
    const workspace = temporaryWorkspace();
    const secretSentinel = "fictional-private-value-that-must-not-leak";
    writePrivateProfile(workspace, `{${secretSentinel}`);
    const result = await runValidator(workspace);

    expect(result.status).toBe(3);
    expect(result.stdout).toContain("Private candidate profile: INVALID");
    expect(result.stdout).toContain("Private profile issue: $ [invalid_json]");
    expect(result.stdout).not.toContain(secretSentinel);
    expect(result.stdout).not.toContain(workspace);
    expect(result.stdout).not.toContain("SyntaxError");
  });

  it("reports bounded schema paths and codes without field values", async () => {
    const workspace = temporaryWorkspace();
    const privateEmailSentinel = "private-candidate@example.test";
    writePrivateProfile(
      workspace,
      JSON.stringify({
        schemaVersion: 1,
        profileId: "fictional-test",
        contact: { email: privateEmailSentinel },
      }),
    );
    const result = await runValidator(workspace);
    const outputLines = result.stdout.trim().split(/\r?\n/);

    expect(result.status).toBe(3);
    expect(outputLines[0]).toBe("Private candidate profile: INVALID");
    expect(outputLines.length).toBeLessThanOrEqual(21);
    expect(
      outputLines.slice(1).every((line) => /^Private profile issue: .+ \[[a-z_]+\]$/.test(line)),
    ).toBe(true);
    expect(result.stdout).not.toContain(privateEmailSentinel);
    expect(result.stdout).not.toContain(workspace);
  });

  it("accepts a schema-valid fictional profile", async () => {
    const workspace = temporaryWorkspace();
    writePrivateProfile(workspace, fictionalProfile);
    const result = await runValidator(workspace);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("Private candidate profile: VALID");
  });

  it("rejects an oversized file without reading or echoing it", async () => {
    const workspace = temporaryWorkspace();
    writePrivateProfile(workspace, "x".repeat(1024 * 1024 + 1));
    const result = await runValidator(workspace);

    expect(result.status).toBe(3);
    expect(result.stdout.trim()).toBe(
      "Private candidate profile: INVALID\nPrivate profile issue: $ [invalid_file_size]",
    );
  });
});
