import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { HostedCapabilitySchema } from "@applypilot/application-runner";
const mocks = vi.hoisted(() => ({
  view: vi.fn(),
  preview: vi.fn(),
  question: vi.fn(),
  nonce: vi.fn(),
  session: vi.fn(),
  ownerAction: vi.fn(),
  packetReview: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@web/lib/hosted-workspace", () => ({
  getHostedWorkspaceView: mocks.view,
  hostedPrivatePreview: mocks.preview,
  hostedQuestionReviewView: mocks.question,
}));
vi.mock("@web/lib/local-mutation-security", () => ({
  issueLocalMutationNonce: mocks.nonce,
  requireLocalSession: mocks.session,
}));
vi.mock("./hosted-actions", () => ({
  hostedOwnerActionForm: mocks.ownerAction,
  hostedPacketReviewAction: mocks.packetReview,
  hostedStopAction: mocks.stop,
}));
import { HostedApplicationPanel } from "./hosted-panel";
function actions(node: ReactNode): unknown[] {
  if (Array.isArray(node)) return node.flatMap(actions);
  if (!isValidElement<{ children?: ReactNode; action?: unknown }>(node)) return [];
  return [...(node.type === "form" ? [node.props.action] : []), ...actions(node.props.children)];
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview.mockReturnValue(null);
  mocks.question.mockReturnValue(null);
  mocks.nonce.mockResolvedValue("fictional-stop-nonce");
});
describe("hosted owner stop availability", () => {
  it.each(["INSPECTED", "MAPPED", "FILLED", "UPLOADED", "VERIFIED", "REVIEW_READY"])(
    "keeps STOP available for an expired %s session while executable authority is absent",
    async (state) => {
      const cap = HostedCapabilitySchema.parse({
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
      expect(mocks.nonce).toHaveBeenCalledExactlyOnceWith(
        "HOSTED_STOP:fictional-session",
        "/applications",
      );
    },
  );
});
