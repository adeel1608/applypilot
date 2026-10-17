import "server-only";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  HOSTED_DISCLOSURE,
  HostedReviewedBuildRecordSchema,
  assertHostedBuildEvidence,
  HostedCapabilitySchema,
  HostedApplicationService,
  PlaywrightHostedApplicationDriver,
  hostedCapabilityDigest,
  hostedDigest,
  hostedOwnerAction,
  hostedVerifiedFacts,
  hostedMapping,
  reviewedHostedQuestions,
  type HostedCapability,
  type HostedOwnerProof,
  type HostedBuild,
  type HostedSession,
} from "@applypilot/application-runner";
import { CandidateProfileSchema, candidateProfileContentHash } from "@applypilot/candidate-profile";
import { HostedWorkflowRepository, loadPersistedApplicationPacket } from "@applypilot/database";
import { getLocalDatabase } from "./local-database";
import { resolveLocalDataDirectory } from "./local-data-directory";
import { preparePrivatePacket } from "./beta-workspace";

export function currentHostedReviewedBuild(): HostedBuild | null {
  try {
    const root = dirname(resolveLocalDataDirectory());
    const review = HostedReviewedBuildRecordSchema.parse(
      JSON.parse(
        readFileSync(
          /* turbopackIgnore: true */ join(
            root,
            "data",
            "private",
            "runtime",
            "hosted-reviewed-build.json",
          ),
          "utf8",
        ),
      ),
    );
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 3000,
      }).trim();
    if (
      git("rev-parse", "HEAD") !== review.build.head ||
      git("rev-parse", "HEAD^{tree}") !== review.build.tree ||
      git(
        "status",
        "--porcelain",
        "--untracked-files=no",
        "--",
        "apps",
        "packages",
        "scripts",
        "package.json",
        "package-lock.json",
      ).length
    )
      return null;
    assertHostedBuildEvidence(
      review,
      join(root, "apps", "web", ".next"),
      readFileSync(
        /* turbopackIgnore: true */ join(
          root,
          "data",
          "private",
          "runtime",
          "hosted-quality-evidence.json",
        ),
      ),
    );
    return review.build;
  } catch {
    return null;
  }
}
function repository(): HostedWorkflowRepository | null {
  const sqlite = getLocalDatabase()?.sqlite;
  if (
    !sqlite
      ?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hosted_browser_sessions'")
      .get()
  )
    return null;
  const data = resolveLocalDataDirectory();
  return new HostedWorkflowRepository(sqlite, {
    mode: "REAL",
    approvedArtifactRoot: join(data, "private"),
    reviewedBuild: currentHostedReviewedBuild(),
    currentReviewedBuild: currentHostedReviewedBuild,
    currentPrivateProfileHash: () => {
      const profile = CandidateProfileSchema.parse(
        JSON.parse(
          readFileSync(/* turbopackIgnore: true */ join(data, "profile.private.json"), "utf8"),
        ),
      );
      return candidateProfileContentHash(profile);
    },
  });
}
const runtime = globalThis as typeof globalThis & {
  __applypilotHostedService?: { buildDigest: string; service: HostedApplicationService };
};
function service(): HostedApplicationService {
  const store = repository();
  const build = currentHostedReviewedBuild();
  if (!store || !build) throw new Error("HOSTED_REVIEWED_ROLLOUT_REQUIRED");
  const digest = hostedDigest(build);
  if (runtime.__applypilotHostedService && runtime.__applypilotHostedService.buildDigest !== digest)
    throw new Error("HOSTED_OWNED_RUNTIME_BUILD_CHANGED");
  if (!runtime.__applypilotHostedService) {
    const service = new HostedApplicationService({
      store,
      reviewedBuild: build,
      driverFactory: (onRequest) => new PlaywrightHostedApplicationDriver({ onRequest }),
    });
    service.recover();
    runtime.__applypilotHostedService = { buildDigest: digest, service };
  }
  return runtime.__applypilotHostedService.service;
}
export interface HostedWorkspaceView {
  state: "MIGRATION_REQUIRED" | "REVIEWED_ROLLOUT_REQUIRED" | "AVAILABLE";
  capabilities: HostedCapability[];
  sessions: HostedSession[];
  disclosure: string;
  executableDigests: string[];
}
export function getHostedWorkspaceView(): HostedWorkspaceView {
  const store = repository();
  if (!store)
    return {
      state: "MIGRATION_REQUIRED",
      capabilities: [],
      sessions: [],
      disclosure: HOSTED_DISCLOSURE,
      executableDigests: [],
    };
  const build = currentHostedReviewedBuild();
  if (build) service();
  const capabilities = store.listCapabilities();
  const executableDigests = capabilities.flatMap((cap) => {
    try {
      if (!build) return [];
      store.assertCapability(cap, build);
      if (cap.scope === "APPLICATION") store.resolvePacket(cap);
      return [hostedCapabilityDigest(cap)];
    } catch {
      return [];
    }
  });
  return {
    state: build ? "AVAILABLE" : "REVIEWED_ROLLOUT_REQUIRED",
    capabilities,
    sessions: store.listSessions(),
    disclosure: HOSTED_DISCLOSURE,
    executableDigests,
  };
}
export function exactHostedCapability(
  id: string,
  version: number,
  digest: string,
): HostedCapability {
  const cap = repository()
    ?.listCapabilities()
    .find((value) => value.capabilityId === id && value.version === version);
  if (!cap || hostedCapabilityDigest(cap) !== digest)
    throw new Error("HOSTED_RENDERED_BINDING_CHANGED");
  return HostedCapabilitySchema.parse(cap);
}
export async function runHostedOwnerAction(
  kind: "INSPECT" | "DISCLOSE" | "SUBMIT",
  cap: HostedCapability,
  sessionId: string,
  proof: HostedOwnerProof,
): Promise<HostedSession> {
  if (kind === "INSPECT") return service().inspect(cap, proof);
  if (kind === "DISCLOSE") return service().prepare(sessionId, cap, proof);
  const session = repository()!.getSession(sessionId);
  if (
    hostedCapabilityDigest(session.capability) !== hostedCapabilityDigest(cap) ||
    proof.action !== hostedOwnerAction("SUBMIT", cap, sessionId, hostedDigest(session.preview))
  )
    throw new Error("HOSTED_RENDERED_BINDING_CHANGED");
  return service().submit(sessionId, proof);
}
export async function stopHostedSession(id: string): Promise<void> {
  await service().stop(id);
}
export function hostedPrivatePreview(session: HostedSession, capability = session.capability) {
  if (!capability.packetId || !capability.packetDigest) return null;
  try {
    const { packet } = loadPersistedApplicationPacket({
      sqlite: getLocalDatabase()!.sqlite,
      packetId: capability.packetId,
      expectedDigest: capability.packetDigest,
    });
    const mapping = session.mapping.length
      ? session.mapping
      : session.form && session.discovery
        ? hostedMapping(packet, session.form, session.discovery)
        : [];
    const selectedQuestions = new Set(
      mapping.flatMap((entry) => (entry.kind === "ANSWER" ? [entry.questionId] : [])),
    );
    const selectedDocuments = new Set(
      mapping.flatMap((entry) => (entry.kind === "DOCUMENT" ? [entry.documentId] : [])),
    );
    return {
      answers: packet.answers.filter((answer) => selectedQuestions.has(answer.questionId)),
      documents: packet.documents.filter((document) => selectedDocuments.has(document.id)),
      unanswered: packet.answers
        .filter((answer) => !selectedQuestions.has(answer.questionId))
        .map((answer) => answer.questionText),
    };
  } catch {
    return null;
  }
}
export function hostedQuestionReviewView(sessionId: string) {
  const store = repository();
  const session = store?.getSession(sessionId);
  if (!store || !session?.discovery || session.state !== "INSPECTED") return null;
  store.assertSubject(session.capability.subject);
  const row = getLocalDatabase()!
    .sqlite.prepare("SELECT snapshot_json AS json FROM candidate_profile_versions WHERE id=?")
    .get(session.capability.subject.profileVersionId) as { json: string };
  return { session, facts: hostedVerifiedFacts(JSON.parse(row.json)) };
}
export async function reviewHostedPacket(
  sessionId: string,
  formData: FormData,
  proof: HostedOwnerProof,
): Promise<{ packetId: string; status: string }> {
  const view = hostedQuestionReviewView(sessionId);
  const store = repository();
  if (
    !view ||
    !store ||
    !view.session.discovery?.complete ||
    formData.get("ownerConfirmed") !== "yes"
  )
    throw new Error("HOSTED_QUESTION_REVIEW_REQUIRED");
  const discovery = view.session.discovery;
  const subject = view.session.capability.subject;
  const selections = discovery.groups.map((group, index) => {
    const value = formData.get(`alternative:${index}`);
    return {
      groupId: group.id,
      alternative: value === "" || value === null ? null : Number(value),
    };
  });
  const choices = discovery.questions.flatMap((question, index) => {
    const value = formData.get(`choice:${index}`);
    if (value === "") return [];
    if (value === null) return [];
    if (value !== "true" && value !== "false") throw new Error("HOSTED_OWNER_CHOICE_INVALID");
    return [{ questionId: question.id, value: value === "true" }];
  });
  const receipts = store.recordQuestionChoices(subject, discovery, choices, proof);
  const review = reviewedHostedQuestions({
    discovery,
    facts: view.facts,
    selections,
    answers: discovery.questions.map((question, index) => {
      const factPath = String(formData.get(`fact:${index}`) ?? "") || null;
      const receipt = receipts.get(question.id);
      const choice = choices.find((value) => value.questionId === question.id);
      return {
        questionId: question.id,
        factPath,
        ...(receipt && choice ? { ownerChoice: { ...receipt, value: choice.value } } : {}),
      };
    }),
  });
  return preparePrivatePacket(subject.jobId, { subject, discovery, ...review });
}
