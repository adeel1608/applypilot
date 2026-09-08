import { describe, expect, it } from "vitest";

import { fixtureJob, testProfile } from "../../../tests/fixture-data";
import {
  ApplicationPacketSchema,
  ApplicationRunnerMode,
  PhaseOnePreparationRunner,
  SyntheticApplicationRunner,
  assessPacketReadiness,
  deriveDuplicatePacketState,
  deriveJobExpiryState,
  packetDigest,
  type ApplicationPacket,
} from "./index";

function readyPacket(overrides: Partial<ApplicationPacket> = {}): ApplicationPacket {
  return ApplicationPacketSchema.parse({
    id: "packet:1",
    jobId: "job:1",
    jobVersionId: "job-version:1",
    profileVersionId: "profile-version:1",
    evaluationVersionId: "evaluation:1",
    eligibilityStatus: "ELIGIBLE",
    targetUrl: "http://127.0.0.1:4123/synthetic-application",
    targetHost: "127.0.0.1",
    jobExpiryState: "ACTIVE",
    duplicateState: "CLEAR",
    versionsCurrent: true,
    documents: [
      {
        id: "document:cv",
        type: "CV",
        fileName: "safe-example.docx",
        digest: "a".repeat(64),
        approved: true,
        stale: false,
        required: true,
      },
    ],
    answers: [
      {
        questionId: "question:work-rights",
        questionText: "Can you work in Australia?",
        required: true,
        sensitive: true,
        value: true,
        truthState: "VERIFIED_ANSWER",
        disclosureState: "APPROVED",
        factReferences: ["fact:work-rights"],
      },
    ],
    ...overrides,
  });
}

describe("Phase 0/1 application runner", () => {
  it("prepares required documents but cannot submit", async () => {
    const result = await new PhaseOnePreparationRunner().prepare(
      fixtureJob("job-junior-receptionist"),
      testProfile,
    );
    expect(result.mode).toBe(ApplicationRunnerMode.HUMAN_REVIEW_REQUIRED);
    expect(result.missingDocuments).toEqual(["RESUME", "COVER_LETTER"]);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.finalSubmissionEnabled).toBe(false);
  });

  it("keeps truth verification and disclosure approval as independent readiness gates", () => {
    const packet = readyPacket({
      answers: [
        {
          questionId: "question:visa",
          questionText: "Provide visa details",
          required: true,
          sensitive: true,
          value: null,
          truthState: "UNKNOWN",
          disclosureState: "NOT_APPROVED",
          factReferences: [],
        },
      ],
    });
    expect(assessPacketReadiness(packet)).toMatchObject({
      status: "REVIEW_REQUIRED",
      blockers: expect.arrayContaining([
        "REQUIRED_ANSWER_UNKNOWN:question:visa",
        "REQUIRED_DISCLOSURE_NOT_APPROVED:question:visa",
      ]),
    });
  });

  it.each([
    [{ jobExpiryState: "EXPIRED" as const }, "JOB_EXPIRED"],
    [{ jobExpiryState: "UNKNOWN" as const }, "JOB_EXPIRY_UNKNOWN"],
    [{ duplicateState: "UNRESOLVED" as const }, "DUPLICATE_DANGER_UNRESOLVED"],
    [{ duplicateState: "UNKNOWN" as const }, "DUPLICATE_STATE_UNKNOWN"],
  ])("blocks unsafe conservative packet state %o", (overrides, blocker) => {
    expect(assessPacketReadiness(readyPacket(overrides))).toMatchObject({
      status: "REVIEW_REQUIRED",
      blockers: expect.arrayContaining([blocker]),
    });
  });

  it("derives expiry and duplicate states without treating unknown data as verified safe", () => {
    const now = new Date("2026-09-08T00:00:00.000Z");
    expect(deriveJobExpiryState(null, now)).toBe("UNKNOWN");
    expect(deriveJobExpiryState("not-a-date", now)).toBe("UNKNOWN");
    expect(deriveJobExpiryState("2026-09-07T00:00:00.000Z", now)).toBe("EXPIRED");
    expect(deriveJobExpiryState("2026-09-09T00:00:00.000Z", now)).toBe("ACTIVE");
    expect(deriveDuplicatePacketState([])).toBe("CLEAR");
    expect(deriveDuplicatePacketState(["REJECTED"])).toBe("CLEAR");
    expect(deriveDuplicatePacketState(["SUGGESTED"])).toBe("UNRESOLVED");
    expect(deriveDuplicatePacketState(["AMBIGUOUS_FUTURE_STATE"])).toBe("UNKNOWN");
  });

  it("requires ordered checkpoints and a fresh, bound, single-use consent", () => {
    const now = new Date("2026-09-07T04:00:00.000Z");
    const packet = readyPacket();
    const runner = new SyntheticApplicationRunner(packet, "synthetic-form-v1", () => now);

    expect(() => runner.map()).toThrow("RUN_STATE_REQUIRED:OPENED");
    runner.open();
    runner.map();
    runner.fill({
      host: "127.0.0.1",
      formVersion: "synthetic-form-v1",
      documentDigests: ["a".repeat(64)],
    });
    runner.readyForFinalReview();
    const consent = runner.createConsent();
    const submitted = runner.submitSynthetic({
      token: consent.token,
      packetDigest: packetDigest(packet),
      targetHost: "127.0.0.1",
      formVersion: "synthetic-form-v1",
    });
    expect(submitted.state).toBe("SYNTHETIC_SUBMITTED");
    expect(runner.snapshot().irreversibleClicks).toBe(1);
    expect(() =>
      runner.submitSynthetic({
        token: consent.token,
        packetDigest: packetDigest(packet),
        targetHost: "127.0.0.1",
        formVersion: "synthetic-form-v1",
      }),
    ).toThrow("RUN_TERMINAL");
    expect(runner.snapshot().irreversibleClicks).toBe(1);
  });

  it("cannot advance a real target beyond TARGET_APPROVAL_REQUIRED", () => {
    const packet = readyPacket({
      targetUrl: "https://careers.example.test/jobs/1",
      targetHost: "careers.example.test",
    });
    const runner = new SyntheticApplicationRunner(packet, "real-form-v1");
    expect(runner.snapshot().checkpoints.at(-1)?.stopReason).toBe("TARGET_APPROVAL_REQUIRED");
    expect(runner.open().stopReason).toBe("TARGET_APPROVAL_REQUIRED");
    expect(runner.snapshot().state).toBe("PAUSED");
    expect(() => runner.createConsent()).toThrow("FINAL_REVIEW_REQUIRED");
  });

  it("rejects destinations containing credentials or a mismatched host", () => {
    expect(() =>
      readyPacket({
        targetUrl: "https://user:password@careers.example.test/jobs/1",
        targetHost: "careers.example.test",
      }),
    ).toThrow("Target URL credentials are forbidden");
    expect(() =>
      readyPacket({
        targetUrl: "https://careers.example.test/jobs/1",
        targetHost: "attacker.example.test",
      }),
    ).toThrow("Target URL host does not match targetHost");
  });

  it.each([
    "CAPTCHA",
    "MFA",
    "AUTHENTICATION_REQUIRED",
    "ACCESS_CONTROL",
    "RATE_LIMIT",
    "UNSUPPORTED_CONTROL",
  ] as const)("pauses on %s with zero irreversible clicks", (reason) => {
    const runner = new SyntheticApplicationRunner(readyPacket(), "synthetic-form-v1");
    expect(runner.stop(reason)).toMatchObject({ state: "PAUSED", stopReason: reason });
    expect(runner.snapshot().irreversibleClicks).toBe(0);
  });

  it("allows zero clicks for an unknown mandatory answer", () => {
    const runner = new SyntheticApplicationRunner(
      readyPacket({
        answers: [
          {
            questionId: "unknown",
            questionText: "Unknown mandatory answer",
            required: true,
            sensitive: false,
            value: null,
            truthState: "UNKNOWN",
            disclosureState: "UNKNOWN",
            factReferences: [],
          },
        ],
      }),
      "synthetic-form-v1",
    );
    runner.open();
    expect(runner.map()).toMatchObject({
      state: "PAUSED",
      stopReason: "UNKNOWN_REQUIRED_ANSWER",
    });
    expect(runner.snapshot().irreversibleClicks).toBe(0);
  });

  it.each(["packet", "document", "domain", "form"] as const)(
    "allows zero clicks when the consent-bound %s changes",
    (changed) => {
      const packet = readyPacket();
      const runner = readyRunner(packet);
      const consent = runner.createConsent();
      const originalDigest = packetDigest(packet);
      if (changed === "document") packet.documents[0]!.digest = "b".repeat(64);
      if (changed === "packet") packet.profileVersionId = "profile-version:changed";
      const result = runner.submitSynthetic({
        token: consent.token,
        packetDigest: originalDigest,
        targetHost: changed === "domain" ? "localhost" : "127.0.0.1",
        formVersion: changed === "form" ? "synthetic-form-v2" : "synthetic-form-v1",
      });
      expect(result).toMatchObject({ state: "PAUSED", stopReason: "PAGE_CHANGED" });
      expect(runner.snapshot().irreversibleClicks).toBe(0);
    },
  );

  it("allows zero clicks for expired consent", () => {
    let now = new Date("2026-09-08T00:00:00.000Z");
    const packet = readyPacket();
    const runner = readyRunner(packet, () => now);
    const consent = runner.createConsent(1);
    now = new Date("2026-09-08T00:00:01.000Z");
    expect(
      runner.submitSynthetic({
        token: consent.token,
        packetDigest: packetDigest(packet),
        targetHost: "127.0.0.1",
        formVersion: "synthetic-form-v1",
      }),
    ).toMatchObject({ state: "PAUSED", stopReason: "CONSENT_EXPIRED" });
    expect(runner.snapshot().irreversibleClicks).toBe(0);
  });

  it("records an unknown outcome after one click and never retries", () => {
    const packet = readyPacket();
    const runner = readyRunner(packet);
    const consent = runner.createConsent();
    expect(
      runner.submitSynthetic({
        token: consent.token,
        packetDigest: packetDigest(packet),
        targetHost: "127.0.0.1",
        formVersion: "synthetic-form-v1",
        responseLost: true,
      }),
    ).toMatchObject({ state: "OUTCOME_UNKNOWN" });
    expect(runner.snapshot().irreversibleClicks).toBe(1);
    expect(() =>
      runner.submitSynthetic({
        token: consent.token,
        packetDigest: packetDigest(packet),
        targetHost: "127.0.0.1",
        formVersion: "synthetic-form-v1",
      }),
    ).toThrow("RUN_TERMINAL");
    expect(runner.snapshot().irreversibleClicks).toBe(1);
  });
});

function readyRunner(packet: ApplicationPacket, now?: () => Date): SyntheticApplicationRunner {
  const runner = new SyntheticApplicationRunner(packet, "synthetic-form-v1", now);
  runner.open();
  runner.map();
  runner.fill({
    host: "127.0.0.1",
    formVersion: "synthetic-form-v1",
    documentDigests: packet.documents.map(({ digest }) => digest),
  });
  runner.readyForFinalReview();
  return runner;
}
