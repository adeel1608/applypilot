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
  consumeLocalMutationNonce,
  issueLocalMutationNonce,
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

describe("hosted nonce bindings use the real unchanged token store", () => {
  const capability = "fictional-capability",
    digest = "a".repeat(64),
    preview = "b".repeat(64);
  const actions = [
    `HOSTED_INSPECT:${capability}:1:${digest}::`,
    `HOSTED_DISCLOSE:${capability}:1:${digest}:fictional-session:`,
    `HOSTED_SUBMIT:${capability}:1:${digest}:fictional-session:${preview}`,
    `HOSTED_QUESTION_REVIEW:${digest}:${preview}`,
    "HOSTED_STOP:fictional-session",
  ];
  const data = (nonce: string) => {
    const form = new FormData();
    form.set("mutationNonce", nonce);
    return form;
  };
  it.each(actions)("issues and consumes the full %s binding exactly once", async (action) => {
    const nonce = await issueLocalMutationNonce(action, "/applications");
    const proof = await consumeLocalMutationNonce(action, data(nonce));
    expect(proof).toMatchObject({
      action,
      nonceConsumed: true,
      localSessionValidated: true,
      loopbackValidated: true,
    });
    await expect(consumeLocalMutationNonce(action, data(nonce))).rejects.toThrow(
      "MUTATION_NONCE_REPLAYED",
    );
  });
  it.each([
    actions[2]!.replace(capability, "different-capability"),
    actions[2]!.replace(":1:", ":2:"),
    actions[2]!.replace(digest, "c".repeat(64)),
    actions[2]!.replace("fictional-session", "different-session"),
    actions[2]!.replace(preview, "d".repeat(64)),
    actions[1]!,
  ])("a changed binding cannot consume the original nonce: %s", async (changed) => {
    const nonce = await issueLocalMutationNonce(actions[2]!, "/applications");
    await expect(consumeLocalMutationNonce(changed, data(nonce))).rejects.toThrow(
      "MUTATION_NONCE_ACTION_MISMATCH",
    );
    await expect(consumeLocalMutationNonce(actions[2]!, data(nonce))).resolves.toMatchObject({
      action: actions[2],
    });
  });
  it("keeps hosted nonces session-bound without consuming on mismatch", async () => {
    const original = requestState.session,
      nonce = await issueLocalMutationNonce(actions[0]!, "/applications");
    requestState.session = localMutationTokens.createSession().token;
    await expect(consumeLocalMutationNonce(actions[0]!, data(nonce))).rejects.toThrow(
      "MUTATION_NONCE_SESSION_MISMATCH",
    );
    requestState.session = original;
    await expect(consumeLocalMutationNonce(actions[0]!, data(nonce))).resolves.toMatchObject({
      action: actions[0],
    });
  });
  it.each([
    "HOSTED_BOUND_" + "A".repeat(64),
    "HOSTED_STOP:",
    "HOSTED_STOP:id\n",
    "HOSTED_STOP:id\r\nX:value",
    "HOSTED_OTHER:id",
    "lowercase",
    "IMPORT_PREPARE\n",
    "HOSTED_STOP:" + "x".repeat(500),
    actions[0]!.replace(":1:", ":01:"),
    actions[0]!.replace(":1:", ":1e0:"),
    actions[0]!.replace(":1:", ":9007199254740992:"),
    actions[0]!.replace(digest, "A".repeat(64)),
    actions[2]!.replace(preview, ""),
    actions[3]!.replace(digest, `${digest}\n`),
    actions[3]!.replace(digest, `${digest}\r`),
    actions[0]!.replace(capability, `${capability}\n`),
    actions[0]!.replace(capability, `${capability}\u2028`),
    actions[1]!.replace("fictional-session", "fictional-session\n"),
    actions[1]!.replace("fictional-session", "fictional\0session"),
    actions[1]!.replace("fictional-session", "fictional\u007fsession"),
    actions[1]!.replace("fictional-session", "fictional-session\u2029"),
  ])("rejects invalid or reserved input %j", async (action) => {
    await expect(issueLocalMutationNonce(action, "/applications")).rejects.toThrow(
      "INVALID_MUTATION_ACTION",
    );
  });
  it.each(["binding mismatch", "malformed action", "internal control"])(
    "mixed batch %s leaves every nonce unused",
    async (kind) => {
      const legacy = await issueLocalMutationNonce("SOURCE_RUN_START", "/sources"),
        hosted = await issueLocalMutationNonce(actions[4]!, "/applications");
      const specs = [
        { action: "SOURCE_RUN_START", fieldName: "legacy" },
        { action: actions[4]!, fieldName: "hosted" },
      ];
      const form = new FormData();
      form.set("legacy", legacy);
      form.set("hosted", hosted);
      await expect(
        consumeLocalMutationNonceBatch(
          [
            specs[0]!,
            {
              ...specs[1]!,
              action:
                kind === "binding mismatch"
                  ? "HOSTED_STOP:another-session"
                  : kind === "internal control"
                    ? actions[1]!.replace("fictional-session", "fictional-session\n")
                    : "HOSTED_STOP:",
            },
          ],
          form,
        ),
      ).rejects.toThrow(
        kind === "binding mismatch" ? "MUTATION_NONCE_ACTION_MISMATCH" : "INVALID_MUTATION_ACTION",
      );
      const proofs = await consumeLocalMutationNonceBatch(specs, form);
      expect(proofs.map((proof) => proof.action)).toEqual(["SOURCE_RUN_START", actions[4]]);
    },
  );
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
