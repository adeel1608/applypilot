import { describe, expect, it } from "vitest";

import {
  assertApplicationTransition,
  canTransitionApplication,
  canTransitionBetaApplication,
  legacyStatusToBeta,
  projectBetaApplicationEvents,
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

  it("projects an append-only timeline and rejects skipped or conflicting transitions", () => {
    const base = {
      applicationId: "application:1",
      packetId: null,
      actor: "LOCAL_USER" as const,
      metadata: {},
      occurredAt: "2026-09-07T04:00:00.000Z",
    };
    const discovered = {
      ...base,
      id: "event:1",
      fromStatus: null,
      toStatus: "DISCOVERED" as const,
      eventType: "APPLICATION_DISCOVERED",
      idempotencyKey: "application:1:discovered",
    };
    const reviewing = {
      ...base,
      id: "event:2",
      fromStatus: "DISCOVERED" as const,
      toStatus: "REVIEWING" as const,
      eventType: "APPLICATION_REVIEWING",
      idempotencyKey: "application:1:reviewing",
    };
    expect(projectBetaApplicationEvents([discovered, reviewing])).toMatchObject({
      status: "REVIEWING",
      timeline: [discovered, reviewing],
    });
    expect(() =>
      projectBetaApplicationEvents([
        discovered,
        { ...reviewing, fromStatus: "SHORTLISTED" as const },
      ]),
    ).toThrow("FROM_STATUS_MISMATCH");
    expect(() =>
      projectBetaApplicationEvents([discovered, { ...reviewing, toStatus: "SUBMITTED" as const }]),
    ).toThrow("cannot transition");
  });
});
