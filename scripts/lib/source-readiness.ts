import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { z } from "zod";

import {
  loadPrivateSourceAllowlistV2,
  sourceCapabilityReadiness,
  type SourceCapabilityReadiness,
} from "@applypilot/job-sources";

const SourceEnabledBetaReleaseDecisionSchema = z
  .object({
    schemaVersion: z.literal(1),
    decisionId: z.string().min(1).max(100),
    recordedAt: z.iso.datetime(),
    decision: z.literal("SOURCE_ENABLED_PERSONAL_BETA_READY"),
    reviewedRunId: z.string().uuid(),
    reviewedCapabilityId: z.string().min(1).max(100),
    reviewedParserMainSha: z.string().regex(/^[a-f0-9]{40}$/),
    basis: z
      .object({
        realSourceGetCount: z.literal(1),
        retryCount: z.literal(0),
        redirectCount: z.literal(0),
        providerRecordCount: z.literal(25),
        acceptedRecordCount: z.literal(25),
        unusableRecordCount: z.literal(0),
        persistedObservationCount: z.literal(25),
        jobVersionCount: z.literal(25),
        r2EvaluationCount: z.literal(25),
        queueDecisionCount: z.literal(25),
        acceptedToPersistenceInvariantHeld: z.literal(true),
        candidateDataOutbound: z.literal(false),
        employerInteractionCount: z.literal(0),
        formInteractionCount: z.literal(0),
        uploadCount: z.literal(0),
        submissionCount: z.literal(0),
        capabilityRevokedAfterRun: z.literal(true),
        activeSourceCapabilityCountAfterRun: z.literal(0),
      })
      .strict(),
    scope: z.literal("RELEASE_CLASSIFICATION_ONLY"),
    authorizedActions: z.tuple([]),
    sourceEnabledPersonalBetaReady: z.literal(true),
    runnerFrameworkStatus: z.literal("READY_FOR_CONTROLLED_VALIDATION_TARGET_APPROVAL_REQUIRED"),
    personalLiveV1Status: z.literal("NOT_READY"),
  })
  .passthrough();

export interface SourceEnabledBetaReleaseReadiness {
  state: "READY" | "NOT_RECORDED";
  reviewedRunId: string | null;
  reviewedCapabilityId: string | null;
}

export async function sourceEnabledBetaReleaseReadiness(
  repositoryRoot: string,
  filename = process.env.APPLYPILOT_SOURCE_BETA_RELEASE_FILENAME ??
    "source-enabled-personal-beta-release-2026-09-13.json",
): Promise<SourceEnabledBetaReleaseReadiness> {
  if (!/^[A-Za-z0-9._-]+\.json$/.test(filename)) {
    throw new Error("SOURCE_BETA_RELEASE_FILENAME_INVALID");
  }
  const root = resolve(repositoryRoot);
  const reportRoot = join(root, "data", "private", "reports");
  const path = join(reportRoot, filename);
  let file;
  try {
    file = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: "NOT_RECORDED", reviewedRunId: null, reviewedCapabilityId: null };
    }
    throw error;
  }
  if (!file.isFile() || file.isSymbolicLink()) throw new Error("SOURCE_BETA_RELEASE_UNSAFE_FILE");
  if ((await stat(path)).size > 32_000) throw new Error("SOURCE_BETA_RELEASE_TOO_LARGE");
  const [resolvedRoot, resolvedPath] = await Promise.all([realpath(reportRoot), realpath(path)]);
  const fromRoot = relative(resolvedRoot, resolvedPath);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("SOURCE_BETA_RELEASE_PATH_ESCAPE");
  }
  const decision = SourceEnabledBetaReleaseDecisionSchema.parse(
    JSON.parse(await readFile(resolvedPath, "utf8")) as unknown,
  );
  return {
    state: "READY",
    reviewedRunId: decision.reviewedRunId,
    reviewedCapabilityId: decision.reviewedCapabilityId,
  };
}

export interface OperationalSourceReadiness {
  state: "WAITING_FOR_APPROVED_TENANT" | "SOURCE_ALLOWLIST_V2_READY";
  configuredCapabilityCount: number;
  activeCapabilityCount: number;
  inactiveReasons: SourceCapabilityReadiness[];
}

export async function operationalSourceReadiness(
  repositoryRoot: string,
  now = new Date(),
  filename = process.env.APPLYPILOT_SOURCE_ALLOWLIST_FILENAME ?? "source-allowlist.json",
): Promise<OperationalSourceReadiness> {
  const source = await loadPrivateSourceAllowlistV2(repositoryRoot, filename);
  const readiness = source.capabilities.map((capability) =>
    sourceCapabilityReadiness(capability, now),
  );
  return {
    state: source.status,
    configuredCapabilityCount: source.capabilities.length,
    activeCapabilityCount: readiness.filter(({ status }) => status === "SOURCE_ENABLED").length,
    inactiveReasons: readiness.filter(({ status }) => status !== "SOURCE_ENABLED"),
  };
}
