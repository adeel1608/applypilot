import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import {
  HostedCapabilitySchema,
  hostedCapabilityDigest,
  hostedOwnerAction,
  hostedDigest,
} from "@applypilot/application-runner";
const mocks = vi.hoisted(() => ({
  view: vi.fn(),
  preview: vi.fn(),
  question: vi.fn(),
  cookie: "",
  ownerAction: vi.fn(),
  packetReview: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@web/lib/hosted-workspace", () => ({
  getHostedWorkspaceView: mocks.view,
  hostedPrivatePreview: mocks.preview,
  hostedQuestionReviewView: mocks.question,
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }),
  cookies: async () => ({ get: () => ({ value: mocks.cookie }) }),
}));
vi.mock("./hosted-actions", () => ({
  hostedOwnerActionForm: mocks.ownerAction,
  hostedPacketReviewAction: mocks.packetReview,
  hostedStopAction: mocks.stop,
}));
import { HostedApplicationPanel } from "./hosted-panel";
import * as security from "@web/lib/local-mutation-security";
const nonceSpy = vi.spyOn(security, "issueLocalMutationNonce");
function actions(node: ReactNode): unknown[] {
  if (Array.isArray(node)) return node.flatMap(actions);
  if (!isValidElement<{ children?: ReactNode; action?: unknown }>(node)) return [];
  return [...(node.type === "form" ? [node.props.action] : []), ...actions(node.props.children)];
}
function fictionalCapability() {
  return HostedCapabilitySchema.parse({
    schemaVersion: 1,
    capabilityId: "fictional-expired-capability",
    version: 2,
    predecessorVersion: 1,
    mode: "FICTIONAL",
    scriptPolicy: "NATIVE_SCRIPT_DISABLED",
    scope: "APPLICATION",
    subject: {
      provider: "LEVER",
      region: "GLOBAL",
      tenant: "fictional-tenant",
      externalId: "fictional-post",
      jobId: "job:fictional",
      jobVersionId: "jv:fictional",
      profileVersionId: "pv:fictional",
      verificationId: "verify:fictional",
      sourceRunId: "run:fictional",
      sourceContentHash: "a".repeat(64),
      targetUrl: "https://jobs.lever.co/fictional-tenant/fictional-post/apply",
    },
    packetId: "packet:fictional",
    packetDigest: "b".repeat(64),
    formDigest: "c".repeat(64),
    discoveryDigest: "d".repeat(64),
    build: {
      head: "a".repeat(40),
      tree: "b".repeat(40),
      buildDigest: "e".repeat(64),
      adapterVersion: "hosted-native-v1",
    },
    policyReference: "fictional-policy",
    policyReviewedAt: "2025-12-31T23:00:00.000Z",
    createdAt: "2025-12-31T23:00:00.000Z",
    requestBudget: 2,
    responseByteLimit: 10000,
    requestTimeoutMs: 1000,
    sessionTimeoutMs: 60000,
    remoteUploadProofRequired: false,
    expiresAt: "2026-01-01T00:00:00.000Z",
    allowedReads: [
      { origin: "https://jobs.lever.co", path: "/fictional-tenant/fictional-post/apply" },
    ],
    allowedWrites: [
      {
        origin: "https://jobs.lever.co",
        path: "/fictional-tenant/fictional-post/apply",
        operation: "SUBMIT",
        method: "POST",
        acknowledgement: "PROVIDER_CONFIRMATION",
      },
    ],
    confirmation: {
      origin: "https://jobs.lever.co",
      path: "/fictional-tenant/fictional-post/apply",
      selector: "#fictional-confirmed",
      expectedText: "Fictional application received",
    },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview.mockReturnValue(null);
  mocks.question.mockReturnValue(null);
  mocks.cookie = security.localMutationTokens.createSession().token;
});
describe("hosted owner stop availability", () => {
  it.each(["INSPECTED", "MAPPED", "FILLED", "UPLOADED", "VERIFIED", "REVIEW_READY"])(
    "keeps STOP available for an expired %s session while executable authority is absent",
    async (state) => {
      const cap = fictionalCapability();
      mocks.view.mockReturnValue({
        state: "AVAILABLE",
        capabilities: [cap],
        sessions: [
          {
            id: "fictional-session",
            capability: cap,
            state,
            requestCount: 1,
            proofs: [],
            preview: null,
          },
        ],
        executableDigests: [],
        disclosure: "fictional disclosure",
      });
      const forms = actions(await HostedApplicationPanel());
      expect(forms).toContain(mocks.stop);
      expect(forms).not.toContain(mocks.ownerAction);
      expect(nonceSpy).toHaveBeenCalledExactlyOnceWith(
        "HOSTED_STOP:fictional-session",
        "/applications",
      );
      const nonce = await nonceSpy.mock.results[0]!.value;
      const form = new FormData();
      form.set("mutationNonce", nonce);
      await expect(
        security.consumeLocalMutationNonce(`HOSTED_STOP:fictional-session`, form),
      ).resolves.toMatchObject({ action: "HOSTED_STOP:fictional-session" });
    },
  );
  it.each(["INSPECT", "DISCLOSE", "SUBMIT"] as const)(
    "renders %s with actual token issuance and exact consumption",
    async (kind) => {
      const base = fictionalCapability();
      const cap =
        kind === "INSPECT"
          ? HostedCapabilitySchema.parse({
              ...base,
              scope: "PASSIVE_INSPECTION",
              packetId: null,
              packetDigest: null,
              formDigest: null,
              discoveryDigest: null,
              allowedWrites: [],
              confirmation: null,
            })
          : base;
      const preview = kind === "SUBMIT" ? { fictional: "preview" } : null;
      const session = {
        id: "fictional-session",
        capability: cap,
        state: kind === "SUBMIT" ? "REVIEW_READY" : "INSPECTED",
        requestCount: 1,
        proofs: [],
        preview,
      };
      mocks.view.mockReturnValue({
        state: "AVAILABLE",
        capabilities: [cap],
        sessions: kind === "INSPECT" ? [] : [session],
        executableDigests: [hostedCapabilityDigest(cap)],
        disclosure: "fictional disclosure",
      });
      const forms = actions(await HostedApplicationPanel());
      expect(forms).toContain(mocks.ownerAction);
      const expected = hostedOwnerAction(
        kind,
        cap,
        kind === "INSPECT" ? "" : session.id,
        kind === "SUBMIT" ? hostedDigest(preview) : "",
      );
      const callIndex = nonceSpy.mock.calls.findIndex(([action]) => action === expected);
      expect(callIndex).toBeGreaterThanOrEqual(0);
      const nonce = await nonceSpy.mock.results[callIndex]!.value;
      const form = new FormData();
      form.set("mutationNonce", nonce);
      await expect(security.consumeLocalMutationNonce(expected, form)).resolves.toMatchObject({
        action: expected,
      });
      await expect(security.consumeLocalMutationNonce(expected, form)).rejects.toThrow(
        "MUTATION_NONCE_REPLAYED",
      );
    },
  );
  it("renders question review with real subject/discovery-bound issuance", async () => {
    const cap = fictionalCapability();
    const discovery = { groups: [], questions: [], safeBlockers: [], complete: true };
    const session = {
      id: "fictional-session",
      capability: cap,
      state: "INSPECTED",
      requestCount: 1,
      proofs: [],
      preview: null,
      discovery,
    };
    mocks.view.mockReturnValue({
      state: "AVAILABLE",
      capabilities: [cap],
      sessions: [session],
      executableDigests: [],
      disclosure: "fictional disclosure",
    });
    mocks.question.mockReturnValue({ session, facts: [] });
    expect(actions(await HostedApplicationPanel())).toContain(mocks.packetReview);
    const action = `HOSTED_QUESTION_REVIEW:${hostedDigest(cap.subject)}:${hostedDigest(discovery)}`;
    const index = nonceSpy.mock.calls.findIndex(([value]) => value === action);
    expect(index).toBeGreaterThanOrEqual(0);
    const nonce = await nonceSpy.mock.results[index]!.value;
    const form = new FormData();
    form.set("mutationNonce", nonce);
    await expect(
      security.consumeLocalMutationNonce(
        `HOSTED_QUESTION_REVIEW:${hostedDigest(cap.subject)}:${"e".repeat(64)}`,
        form,
      ),
    ).rejects.toThrow("MUTATION_NONCE_ACTION_MISMATCH");
    await expect(security.consumeLocalMutationNonce(action, form)).resolves.toMatchObject({
      action,
    });
  });
});
