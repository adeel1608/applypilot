import { beforeEach, describe, expect, it, vi } from "vitest";

const requestState = vi.hoisted(() => ({
  host: "127.0.0.1:3000",
  origin: "http://127.0.0.1:3000",
  session: "",
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: requestState.host, origin: requestState.origin }),
  cookies: async () => ({
    get: () => (requestState.session ? { value: requestState.session } : undefined),
  }),
}));

import {
  consumeLocalMutationNonceBatch,
  localMutationTokens,
  type LocalMutationNonceFieldSpec,
} from "./local-mutation-security";

const nonceFields = [
  { action: "SOURCE_CAPABILITY_APPROVE", fieldName: "approvalMutationNonce" },
  { action: "SOURCE_RUN_START", fieldName: "startMutationNonce" },
] as const satisfies readonly LocalMutationNonceFieldSpec[];

function formData(approvalNonce: string, startNonce: string): FormData {
  const form = new FormData();
  form.set("approvalMutationNonce", approvalNonce);
  form.set("startMutationNonce", startNonce);
  return form;
}

beforeEach(() => {
  requestState.host = "127.0.0.1:3000";
  requestState.origin = "http://127.0.0.1:3000";
  requestState.session = localMutationTokens.createSession().token;
});

describe("consumeLocalMutationNonceBatch", () => {
  it("returns distinct action-bound proofs and consumes both nonces exactly once", async () => {
    const approval = localMutationTokens.issue(requestState.session, "SOURCE_CAPABILITY_APPROVE");
    const start = localMutationTokens.issue(requestState.session, "SOURCE_RUN_START");
    const form = formData(approval.nonce, start.nonce);

    const proofs = await consumeLocalMutationNonceBatch(nonceFields, form);

    expect(proofs.map(({ action }) => action)).toEqual([
      "SOURCE_CAPABILITY_APPROVE",
      "SOURCE_RUN_START",
    ]);
    expect(JSON.stringify(proofs)).not.toContain(approval.nonce);
    expect(JSON.stringify(proofs)).not.toContain(start.nonce);
    await expect(consumeLocalMutationNonceBatch(nonceFields, form)).rejects.toThrow(
      "MUTATION_NONCE_REPLAYED",
    );
  });

  it("does not consume the first proof when the second nonce has the wrong action", async () => {
    const approval = localMutationTokens.issue(requestState.session, "SOURCE_CAPABILITY_APPROVE");
    const wrongStart = localMutationTokens.issue(requestState.session, "SOURCE_REVOKE");
    await expect(
      consumeLocalMutationNonceBatch(nonceFields, formData(approval.nonce, wrongStart.nonce)),
    ).rejects.toThrow("MUTATION_NONCE_ACTION_MISMATCH");

    const correctStart = localMutationTokens.issue(requestState.session, "SOURCE_RUN_START");
    await expect(
      consumeLocalMutationNonceBatch(nonceFields, formData(approval.nonce, correctStart.nonce)),
    ).resolves.toHaveLength(2);
  });

  it("rejects missing and duplicate named fields before consuming either nonce", async () => {
    const approval = localMutationTokens.issue(requestState.session, "SOURCE_CAPABILITY_APPROVE");
    const start = localMutationTokens.issue(requestState.session, "SOURCE_RUN_START");
    const missing = new FormData();
    missing.set("approvalMutationNonce", approval.nonce);
    await expect(consumeLocalMutationNonceBatch(nonceFields, missing)).rejects.toThrow(
      "MUTATION_NONCE_REQUIRED",
    );

    const duplicate = formData(approval.nonce, start.nonce);
    duplicate.append("approvalMutationNonce", approval.nonce);
    await expect(consumeLocalMutationNonceBatch(nonceFields, duplicate)).rejects.toThrow(
      "MUTATION_NONCE_FIELD_AMBIGUOUS",
    );
    await expect(
      consumeLocalMutationNonceBatch(nonceFields, formData(approval.nonce, start.nonce)),
    ).resolves.toHaveLength(2);
  });
});
