import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  exact: vi.fn(),
  question: vi.fn(),
  view: vi.fn(),
  review: vi.fn(),
  run: vi.fn(),
  stop: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@web/lib/local-mutation-security", () => ({ consumeLocalMutationNonce: mocks.consume }));
vi.mock("@web/lib/hosted-workspace", () => ({
  exactHostedCapability: mocks.exact,
  hostedQuestionReviewView: mocks.question,
  getHostedWorkspaceView: mocks.view,
  reviewHostedPacket: mocks.review,
  runHostedOwnerAction: mocks.run,
  stopHostedSession: mocks.stop,
}));
import {
  HostedCapabilitySchema,
  hostedCapabilityDigest,
  hostedDigest,
  hostedOwnerAction,
} from "@applypilot/application-runner";
import {
  hostedOwnerActionForm,
  hostedPacketReviewAction,
  hostedStopAction,
} from "./hosted-actions";
const cap = HostedCapabilitySchema.parse({
  schemaVersion: 1,
  capabilityId: "hosted-fictional-test",
  version: 1,
  predecessorVersion: null,
  mode: "REAL",
  scriptPolicy: "NATIVE_SCRIPT_DISABLED",
  subject: {
    provider: "LEVER",
    region: "GLOBAL",
    tenant: "fictional",
    externalId: "one",
    jobId: "job:fictional",
    jobVersionId: "jv:fictional",
    profileVersionId: "pv:fictional",
    verificationId: "verify:fictional",
    sourceRunId: "run:fictional",
    sourceContentHash: "a".repeat(64),
    targetUrl: "https://jobs.lever.co/fictional/one/apply",
  },
  scope: "PASSIVE_INSPECTION",
  packetId: null,
  packetDigest: null,
  formDigest: null,
  discoveryDigest: null,
  build: {
    head: "a".repeat(40),
    tree: "b".repeat(40),
    buildDigest: "c".repeat(64),
    adapterVersion: "hosted-native-v1",
  },
  policyReference: "fictional-policy",
  policyReviewedAt: "2026-10-09T05:00:00.000Z",
  createdAt: "2026-10-09T05:00:00.000Z",
  expiresAt: "2026-10-09T06:00:00.000Z",
  allowedReads: [{ origin: "https://jobs.lever.co", path: "/fictional/one/apply" }],
  allowedWrites: [],
  confirmation: null,
  requestBudget: 2,
  responseByteLimit: 1000,
  requestTimeoutMs: 1000,
  sessionTimeoutMs: 60000,
  remoteUploadProofRequired: false,
});
const sessionId = "fictional-session";
const preview = { fictional: "server-derived-preview" };
function form(kind = "INSPECT") {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    kind,
    capabilityId: cap.capabilityId,
    version: "1",
    digest: hostedCapabilityDigest(cap),
    sessionId,
    ownerConfirmed: "yes",
    confirmationText:
      kind === "INSPECT"
        ? `INSPECT ${cap.capabilityId}`
        : kind === "DISCLOSE"
          ? `DISCLOSE AND PREPARE ${cap.capabilityId}`
          : `SUBMIT ${sessionId}`,
    mutationNonce: "fictional-one-use-nonce",
  }))
    data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.exact.mockReturnValue(cap);
  mocks.view.mockReturnValue({ sessions: [{ id: sessionId, preview }] });
  mocks.question.mockReturnValue({
    session: { capability: cap, discovery: { fictional: "questions" } },
  });
  mocks.consume.mockImplementation(async (action) => ({
    action,
    consumedAt: "2026-10-09T05:00:00.000Z",
    loopbackValidated: true,
    localSessionValidated: true,
    nonceConsumed: true,
  }));
  mocks.redirect.mockImplementation((path) => {
    throw new Error(`REDIRECT:${path}`);
  });
});
describe("production hosted owner forms", () => {
  it.each(["INSPECT", "DISCLOSE", "SUBMIT"] as const)(
    "binds the exact %s operation and server preview to a fresh local nonce",
    async (kind) => {
      const data = form(kind);
      await expect(hostedOwnerActionForm(data)).rejects.toThrow("REDIRECT:/applications");
      const action = hostedOwnerAction(
        kind,
        cap,
        kind === "INSPECT" ? "" : sessionId,
        kind === "SUBMIT" ? hostedDigest(preview) : "",
      );
      expect(mocks.consume).toHaveBeenCalledExactlyOnceWith(action, data);
      expect(mocks.run).toHaveBeenCalledExactlyOnceWith(
        kind,
        cap,
        kind === "INSPECT" ? "" : sessionId,
        expect.objectContaining({
          action,
          ownerConfirmed: true,
          nonceDigest: createHash("sha256").update("fictional-one-use-nonce").digest("hex"),
        }),
      );
    },
  );
  it.each([
    "kind",
    "capabilityId",
    "version",
    "digest",
    "ownerConfirmed",
    "confirmationText",
    "mutationNonce",
  ])("rejects duplicate %s before operation dispatch", async (key) => {
    const data = form();
    data.append(key, String(data.get(key)));
    await expect(hostedOwnerActionForm(data)).rejects.toThrow("HOSTED_RENDERED_BINDING_CHANGED");
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it.each(["03", "1.0", "", "NaN"])("rejects malformed version %s", async (value) => {
    const data = form();
    data.set("version", value);
    await expect(hostedOwnerActionForm(data)).rejects.toThrow("HOSTED_RENDERED_BINDING_CHANGED");
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each(["phrase", "unchecked"])("rejects %s without consuming or dispatching", async (kind) => {
    const data = form();
    data.set(
      kind === "phrase" ? "confirmationText" : "ownerConfirmed",
      kind === "phrase" ? `INSPECT ${cap.capabilityId} ` : "no",
    );
    await expect(hostedOwnerActionForm(data)).rejects.toThrow("HOSTED_OWNER_CONFIRMATION_REQUIRED");
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it("rejects nonce replay or a cross-operation nonce before workspace mutation", async () => {
    mocks.consume.mockRejectedValue(new Error("PRIVATE_CANARY_MUTATION_NONCE_INVALID"));
    await expect(hostedOwnerActionForm(form("SUBMIT"))).rejects.toThrow("HOSTED_OPERATION_STOPPED");
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("requires an existing server preview for submit", async () => {
    mocks.view.mockReturnValue({ sessions: [] });
    await expect(hostedOwnerActionForm(form("SUBMIT"))).rejects.toThrow(
      "HOSTED_FINAL_PREVIEW_REQUIRED",
    );
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it("does not reflect raw private exception text", async () => {
    mocks.run.mockRejectedValue(new Error("private-canary cookie profile sql arguments"));
    await expect(hostedOwnerActionForm(form())).rejects.toThrow(
      "REDIRECT:/applications?hostedError=HOSTED_OPERATION_STOPPED",
    );
    expect(mocks.redirect).not.toHaveBeenCalledWith(expect.stringContaining("private-canary"));
  });
  it.each(["choice:0", "fact:0", "alternative:0"])(
    "rejects ambiguous %s question review fields",
    async (key) => {
      const data = form();
      data.append(key, "0");
      data.append(key, "0");
      await expect(hostedPacketReviewAction(data)).rejects.toThrow(
        "HOSTED_RENDERED_BINDING_CHANGED",
      );
      expect(mocks.review).not.toHaveBeenCalled();
      expect(mocks.consume).not.toHaveBeenCalled();
    },
  );
  it("sanitizes a stop failure through the same safe page error path", async () => {
    mocks.stop.mockRejectedValue(new Error("private-stop-canary"));
    await expect(hostedStopAction(form())).rejects.toThrow(
      "REDIRECT:/applications?hostedError=HOSTED_OPERATION_STOPPED",
    );
    expect(mocks.stop).toHaveBeenCalledWith(sessionId);
  });
});
