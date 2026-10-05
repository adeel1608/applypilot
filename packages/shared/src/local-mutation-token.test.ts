import { describe, expect, it } from "vitest";

import { LocalMutationTokenStore } from "./local-mutation-token";

describe("LocalMutationTokenStore", () => {
  it("binds a single-use nonce to its live session and action", () => {
    let now = 1_000;
    let counter = 0;
    const store = new LocalMutationTokenStore({
      now: () => now,
      randomToken: () => `token_${String(++counter).padStart(32, "x")}`,
      sessionLifetimeMs: 1_000,
      nonceLifetimeMs: 100,
    });
    const first = store.createSession();
    const second = store.createSession();
    const issued = store.issue(first.token, "SAVE_QUEUE");

    expect(() => store.consume(second.token, "SAVE_QUEUE", issued.nonce)).toThrow(
      "MUTATION_NONCE_SESSION_MISMATCH",
    );
    expect(() => store.consume(first.token, "OTHER_ACTION", issued.nonce)).toThrow(
      "MUTATION_NONCE_ACTION_MISMATCH",
    );
    expect(() => store.consume(first.token, "SAVE_QUEUE", issued.nonce)).not.toThrow();
    expect(() => store.consume(first.token, "SAVE_QUEUE", issued.nonce)).toThrow(
      "MUTATION_NONCE_REPLAYED",
    );

    const stale = store.issue(first.token, "SAVE_QUEUE");
    now += 101;
    expect(() => store.consume(first.token, "SAVE_QUEUE", stale.nonce)).toThrow(
      "MUTATION_NONCE_EXPIRED",
    );
  });

  it("consumes independently issued action nonces as one batch", () => {
    let counter = 0;
    const store = new LocalMutationTokenStore({
      randomToken: () => `token_${String(++counter).padStart(32, "x")}`,
    });
    const session = store.createSession();
    const approval = store.issue(session.token, "SOURCE_CAPABILITY_APPROVE");
    const start = store.issue(session.token, "SOURCE_RUN_START");

    expect(() =>
      store.consumeBatch(session.token, [
        { action: "SOURCE_CAPABILITY_APPROVE", nonce: approval.nonce },
        { action: "SOURCE_RUN_START", nonce: start.nonce },
      ]),
    ).not.toThrow();
    expect(() => store.consume(session.token, "SOURCE_CAPABILITY_APPROVE", approval.nonce)).toThrow(
      "MUTATION_NONCE_REPLAYED",
    );
    expect(() => store.consume(session.token, "SOURCE_RUN_START", start.nonce)).toThrow(
      "MUTATION_NONCE_REPLAYED",
    );
  });

  it("does not partially consume valid nonces when another named action is invalid", () => {
    let counter = 0;
    const store = new LocalMutationTokenStore({
      randomToken: () => `token_${String(++counter).padStart(32, "x")}`,
    });
    const session = store.createSession();
    const approval = store.issue(session.token, "SOURCE_CAPABILITY_APPROVE");
    const start = store.issue(session.token, "SOURCE_RUN_START");

    expect(() =>
      store.consumeBatch(session.token, [
        { action: "SOURCE_CAPABILITY_APPROVE", nonce: approval.nonce },
        { action: "WRONG_ACTION", nonce: start.nonce },
      ]),
    ).toThrow("MUTATION_NONCE_ACTION_MISMATCH");
    expect(() =>
      store.consume(session.token, "SOURCE_CAPABILITY_APPROVE", approval.nonce),
    ).not.toThrow();
    expect(() => store.consume(session.token, "SOURCE_RUN_START", start.nonce)).not.toThrow();
  });

  it("rejects duplicate nonce values in a batch without consuming them", () => {
    let counter = 0;
    const store = new LocalMutationTokenStore({
      randomToken: () => `token_${String(++counter).padStart(32, "x")}`,
    });
    const session = store.createSession();
    const approval = store.issue(session.token, "SOURCE_CAPABILITY_APPROVE");

    expect(() =>
      store.consumeBatch(session.token, [
        { action: "SOURCE_CAPABILITY_APPROVE", nonce: approval.nonce },
        { action: "SOURCE_CAPABILITY_APPROVE", nonce: approval.nonce },
      ]),
    ).toThrow("MUTATION_NONCE_DUPLICATE");
    expect(() =>
      store.consume(session.token, "SOURCE_CAPABILITY_APPROVE", approval.nonce),
    ).not.toThrow();
  });

  it("rejects absent and expired sessions", () => {
    let now = 1_000;
    const store = new LocalMutationTokenStore({
      now: () => now,
      randomToken: () => "token_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      sessionLifetimeMs: 10,
    });
    const session = store.createSession();
    expect(() => store.consume(null, "SAVE_QUEUE", "x")).toThrow("LOCAL_SESSION_REQUIRED");
    now += 11;
    expect(() => store.issue(session.token, "SAVE_QUEUE")).toThrow("LOCAL_SESSION_REQUIRED");
  });
});
