import { describe, expect, it } from "vitest";

import { containsPrivateCanary } from "../../scripts/lib/privacy-canary";

describe("private artifact canaries", () => {
  it("distinguishes short random binary collisions from readable private text", () => {
    expect(containsPrivateCanary(Buffer.from([0, 75, 104, 97, 110, 0]), "Khan")).toBe(false);
    expect(containsPrivateCanary(Buffer.from("candidate last name Khan was cached"), "Khan")).toBe(
      true,
    );
  });

  it("detects longer private canaries even inside opaque artifacts", () => {
    expect(
      containsPrivateCanary(
        Buffer.concat([
          Buffer.from([0, 1]),
          Buffer.from("fictional@example.test"),
          Buffer.from([0]),
        ]),
        "fictional@example.test",
      ),
    ).toBe(true);
  });
});
