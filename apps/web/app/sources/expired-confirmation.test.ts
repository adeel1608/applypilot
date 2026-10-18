import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => {
  const state = {
    now: Date.UTC(2026, 9, 18),
    host: "127.0.0.1:3000",
    origin: "http://127.0.0.1:3000",
    session: "",
  };
  // The real store captures Date.now during module initialization. Only its clock is fictional.
  const clock = vi.spyOn(Date, "now").mockImplementation(() => state.now);
  return { state, clock };
});
const mocks = vi.hoisted(() => ({
  approveAndRunOwnerSource: vi.fn(),
  runOwnerApprovedSource: vi.fn(),
  cancelSourceRun: vi.fn(),
  revokeSourceCapability: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: request.state.host, origin: request.state.origin }),
  cookies: async () => ({
    get: () => (request.state.session ? { value: request.state.session } : undefined),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@web/lib/source-workspace", () => ({
  approveAndRunOwnerSource: mocks.approveAndRunOwnerSource,
  runOwnerApprovedSource: mocks.runOwnerApprovedSource,
  cancelSourceRun: mocks.cancelSourceRun,
  revokeSourceCapability: mocks.revokeSourceCapability,
}));

import { issueLocalMutationNonce, localMutationTokens } from "@web/lib/local-mutation-security";
import { approveAndStartSourceRunAction, startSourceRunAction } from "./actions";

const nonceLifetime = 15 * 60 * 1000;
const capabilityId = "fictional-source-capability";
const binding = { capabilityId, version: 3, capabilityDigest: "a".repeat(64) };
const expiryRedirect = "REDIRECT:/sources?notice=confirmation-expired";

async function form(combined = true) {
  const value = new FormData();
  value.set("capabilityId", binding.capabilityId);
  value.set("capabilityVersion", String(binding.version));
  value.set("capabilityDigest", binding.capabilityDigest);
  value.set("ownerConfirmed", "yes");
  value.set("confirmationText", `${combined ? "APPROVE AND RUN" : "RUN"} ${capabilityId}`);
  if (combined) {
    value.set(
      "approvalMutationNonce",
      await issueLocalMutationNonce("SOURCE_CAPABILITY_APPROVE", "/sources"),
    );
    value.set("startMutationNonce", await issueLocalMutationNonce("SOURCE_RUN_START", "/sources"));
  } else {
    value.set("mutationNonce", await issueLocalMutationNonce("SOURCE_RUN_START", "/sources"));
  }
  return value;
}

function expectNoWorkspaceAction() {
  expect(mocks.approveAndRunOwnerSource).not.toHaveBeenCalled();
  expect(mocks.runOwnerApprovedSource).not.toHaveBeenCalled();
  expect(mocks.cancelSourceRun).not.toHaveBeenCalled();
  expect(mocks.revokeSourceCapability).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  request.state.now = Date.UTC(2026, 9, 18);
  request.state.host = "127.0.0.1:3000";
  request.state.origin = "http://127.0.0.1:3000";
  request.state.session = localMutationTokens.createSession().token;
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
});
afterAll(() => request.clock.mockRestore());

describe("source confirmation recovery through the real nonce adapter and store", () => {
  it.each(["approval", "start"])(
    "recovers when only the combined %s nonce expired and requires fresh owner confirmation",
    async (expired) => {
      const stale = await form();
      request.state.now += nonceLifetime;
      const freshField = expired === "approval" ? "startMutationNonce" : "approvalMutationNonce";
      stale.set(
        freshField,
        await issueLocalMutationNonce(
          expired === "approval" ? "SOURCE_RUN_START" : "SOURCE_CAPABILITY_APPROVE",
          "/sources",
        ),
      );
      await expect(approveAndStartSourceRunAction(stale)).rejects.toThrow(expiryRedirect);
      expectNoWorkspaceAction();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
      expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(
        "/sources?notice=confirmation-expired",
      );

      // The rejected form cannot become a valid confirmation by replaying it.
      await expect(approveAndStartSourceRunAction(stale)).rejects.toThrow(
        "MUTATION_NONCE_REPLAYED",
      );
      expectNoWorkspaceAction();
      // Batch expiry leaves its valid counterpart unused, preserving the store's atomic contract.
      expect(() =>
        localMutationTokens.consume(
          request.state.session,
          expired === "approval" ? "SOURCE_RUN_START" : "SOURCE_CAPABILITY_APPROVE",
          stale.get(freshField),
        ),
      ).not.toThrow();

      const unchecked = await form();
      unchecked.delete("ownerConfirmed");
      await expect(approveAndStartSourceRunAction(unchecked)).rejects.toThrow(
        "EXACT_OWNER_CONFIRMATION_REQUIRED",
      );
      expectNoWorkspaceAction();

      const confirmed = await form();
      await expect(approveAndStartSourceRunAction(confirmed)).rejects.toThrow("REDIRECT:/sources");
      expect(mocks.approveAndRunOwnerSource).toHaveBeenCalledExactlyOnceWith(
        binding,
        {
          approval: expect.objectContaining({
            action: "SOURCE_CAPABILITY_APPROVE",
            nonceConsumed: true,
          }),
          start: expect.objectContaining({ action: "SOURCE_RUN_START", nonceConsumed: true }),
        },
        `APPROVE AND RUN ${capabilityId}`,
      );
      await expect(approveAndStartSourceRunAction(confirmed)).rejects.toThrow(
        "MUTATION_NONCE_REPLAYED",
      );
      expect(mocks.approveAndRunOwnerSource).toHaveBeenCalledTimes(1);
      expect(mocks.runOwnerApprovedSource).not.toHaveBeenCalled();
    },
  );

  it("recovers an expired legacy RUN form without creating a new approval", async () => {
    const stale = await form(false);
    request.state.now += nonceLifetime;
    await expect(startSourceRunAction(stale)).rejects.toThrow(expiryRedirect);
    expectNoWorkspaceAction();
    await expect(startSourceRunAction(stale)).rejects.toThrow("MUTATION_NONCE_REPLAYED");
    const fresh = await form(false);
    await expect(startSourceRunAction(fresh)).rejects.toThrow("REDIRECT:/sources");
    expect(mocks.runOwnerApprovedSource).toHaveBeenCalledExactlyOnceWith(
      binding,
      expect.objectContaining({ action: "SOURCE_RUN_START", nonceConsumed: true }),
    );
    expect(mocks.approveAndRunOwnerSource).not.toHaveBeenCalled();
  });

  it.each([true, false])("does not recover an unknown nonce (combined=%s)", async (combined) => {
    const value = await form(combined);
    value.set(combined ? "approvalMutationNonce" : "mutationNonce", "x".repeat(43));
    const action = combined ? approveAndStartSourceRunAction : startSourceRunAction;
    await expect(action(value)).rejects.toThrow("MUTATION_NONCE_INVALID");
    expectNoWorkspaceAction();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([true, false])("preserves unexpired action binding (combined=%s)", async (combined) => {
    const value = await form(combined);
    value.set(
      combined ? "approvalMutationNonce" : "mutationNonce",
      await issueLocalMutationNonce("SOURCE_REVOKE", "/sources"),
    );
    const action = combined ? approveAndStartSourceRunAction : startSourceRunAction;
    await expect(action(value)).rejects.toThrow("MUTATION_NONCE_ACTION_MISMATCH");
    expectNoWorkspaceAction();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "preserves loopback and session guards (combined=%s)",
    async (combined) => {
      const value = await form(combined);
      const action = combined ? approveAndStartSourceRunAction : startSourceRunAction;
      request.state.origin = "http://127.0.0.1:4000";
      await expect(action(value)).rejects.toThrow("MUTATION_ORIGIN_MISMATCH");
      request.state.origin = "http://127.0.0.1:3000";
      const original = request.state.session;
      request.state.session = localMutationTokens.createSession().token;
      await expect(action(value)).rejects.toThrow("MUTATION_NONCE_SESSION_MISMATCH");
      request.state.session = "";
      await expect(action(value)).rejects.toThrow("LOCAL_SESSION_REQUIRED");
      request.state.session = original;
      expectNoWorkspaceAction();
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "does not turn a downstream expiry-shaped failure into retry permission (combined=%s)",
    async (combined) => {
      const workspace = combined ? mocks.approveAndRunOwnerSource : mocks.runOwnerApprovedSource;
      const failure = new Error("MUTATION_NONCE_EXPIRED");
      workspace.mockRejectedValueOnce(failure);
      const action = combined ? approveAndStartSourceRunAction : startSourceRunAction;
      await expect(action(await form(combined))).rejects.toBe(failure);
      expect(workspace).toHaveBeenCalledTimes(1);
      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );
});
