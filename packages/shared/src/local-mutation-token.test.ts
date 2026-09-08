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
