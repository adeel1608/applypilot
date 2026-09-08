import { describe, expect, it } from "vitest";

import { assertLoopbackMutationRequest } from "./loopback-security";

describe("loopback mutation boundary", () => {
  it.each([
    ["localhost:3000", "http://localhost:3000"],
    ["127.0.0.1:3000", "http://127.0.0.1:3000"],
    ["[::1]:3000", "http://[::1]:3000"],
  ])("accepts exact same-origin loopback %s", (host, origin) => {
    expect(() => assertLoopbackMutationRequest({ host, origin })).not.toThrow();
    expect(() =>
      assertLoopbackMutationRequest({ host, origin, forwardedHost: host }),
    ).not.toThrow();
  });

  it.each([
    [
      { host: "applypilot.attacker.test", origin: "http://applypilot.attacker.test" },
      "LOCAL_REQUEST_REQUIRED",
    ],
    [{ host: "localhost:3000", origin: "https://attacker.test" }, "FOREIGN_MUTATION_ORIGIN"],
    [{ host: "localhost:3000", origin: "http://localhost:4000" }, "MUTATION_ORIGIN_MISMATCH"],
    [{ host: "localhost:3000", origin: null }, "MUTATION_ORIGIN_REQUIRED"],
    [
      { host: "localhost:3000", origin: "http://localhost:3000", forwardedHost: "attacker.test" },
      "FORWARDED_HOST_UNTRUSTED",
    ],
  ] as const)("rejects an untrusted mutation boundary", (input, code) => {
    expect(() => assertLoopbackMutationRequest(input)).toThrow(code);
  });
});
