import { describe, expect, it } from "vitest";

import {
  assertApplicationTransition,
  canTransitionApplication,
  canTransitionBetaApplication,
  legacyStatusToBeta,
} from "./index";

describe("application tracking transitions", () => {
  it("allows a reviewed job to be shortlisted", () => {
    expect(canTransitionApplication("REVIEWED", "SHORTLISTED")).toBe(true);
  });

  it("rejects impossible terminal-state transitions", () => {
    expect(() => assertApplicationTransition("REJECTED", "INTERVIEW")).toThrow("cannot transition");
  });

  it("enforces the Beta preparation and final-review lifecycle", () => {
    expect(canTransitionBetaApplication("SHORTLISTED", "PREPARING")).toBe(true);
    expect(canTransitionBetaApplication("PREPARING", "READY_TO_APPLY")).toBe(true);
    expect(canTransitionBetaApplication("READY_FOR_FINAL_REVIEW", "SUBMITTED")).toBe(true);
    expect(canTransitionBetaApplication("READY_TO_APPLY", "SUBMITTED")).toBe(false);
    expect(canTransitionBetaApplication("SUBMITTED", "DISCOVERED")).toBe(false);
    expect(legacyStatusToBeta("APPLIED")).toBe("SUBMITTED");
  });
});
