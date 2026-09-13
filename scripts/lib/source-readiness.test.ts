import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceEnabledBetaReleaseReadiness } from "./source-readiness";

function decision() {
  return {
    schemaVersion: 1,
    decisionId: "fictional-release",
    recordedAt: "2026-09-13T03:04:21.901Z",
    decision: "SOURCE_ENABLED_PERSONAL_BETA_READY",
    reviewedRunId: "00000000-0000-4000-8000-000000000001",
    reviewedCapabilityId: "fictional_capability",
    reviewedParserMainSha: "a".repeat(40),
    basis: {
      realSourceGetCount: 1,
      retryCount: 0,
      redirectCount: 0,
      providerRecordCount: 25,
      acceptedRecordCount: 25,
      unusableRecordCount: 0,
      persistedObservationCount: 25,
      jobVersionCount: 25,
      r2EvaluationCount: 25,
      queueDecisionCount: 25,
      acceptedToPersistenceInvariantHeld: true,
      candidateDataOutbound: false,
      employerInteractionCount: 0,
      formInteractionCount: 0,
      uploadCount: 0,
      submissionCount: 0,
      capabilityRevokedAfterRun: true,
      activeSourceCapabilityCountAfterRun: 0,
    },
    scope: "RELEASE_CLASSIFICATION_ONLY",
    authorizedActions: [],
    sourceEnabledPersonalBetaReady: true,
    runnerFrameworkStatus: "READY_FOR_CONTROLLED_VALIDATION_TARGET_APPROVAL_REQUIRED",
    personalLiveV1Status: "NOT_READY",
  };
}

describe("source-enabled beta release readiness", () => {
  it("distinguishes a validated release decision from current source authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "applypilot-source-release-"));
    const reports = join(root, "data", "private", "reports");
    await mkdir(reports, { recursive: true });
    await expect(sourceEnabledBetaReleaseReadiness(root)).resolves.toMatchObject({
      state: "NOT_RECORDED",
    });
    await writeFile(
      join(reports, "source-enabled-personal-beta-release-2026-09-13.json"),
      JSON.stringify(decision()),
    );
    await expect(sourceEnabledBetaReleaseReadiness(root)).resolves.toEqual({
      state: "READY",
      reviewedRunId: "00000000-0000-4000-8000-000000000001",
      reviewedCapabilityId: "fictional_capability",
    });
  });

  it("rejects a decision that claims candidate disclosure or live authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "applypilot-source-release-invalid-"));
    const reports = join(root, "data", "private", "reports");
    await mkdir(reports, { recursive: true });
    await writeFile(
      join(reports, "source-enabled-personal-beta-release-2026-09-13.json"),
      JSON.stringify({
        ...decision(),
        authorizedActions: ["SOURCE_GET"],
        basis: { ...decision().basis, candidateDataOutbound: true },
      }),
    );
    await expect(sourceEnabledBetaReleaseReadiness(root)).rejects.toThrow();
  });
});
