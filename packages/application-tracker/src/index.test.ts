import { describe, expect, it } from "vitest";

import { assertApplicationTransition, canTransitionApplication } from "./index";

describe("application tracking transitions", () => {
  it("allows a reviewed job to be shortlisted", () => {
    expect(canTransitionApplication("REVIEWED", "SHORTLISTED")).toBe(true);
  });

  it("rejects impossible terminal-state transitions", () => {
    expect(() => assertApplicationTransition("REJECTED", "INTERVIEW")).toThrow("cannot transition");
  });
});
