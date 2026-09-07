import { describe, expect, it } from "vitest";

import { fixtureJob, testProfile } from "../../../tests/fixture-data";
import {
  ApplicationPacketSchema,
  ApplicationRunnerMode,
  PhaseOnePreparationRunner,
  SyntheticApplicationRunner,
  assessPacketReadiness,
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
    jobExpired: false,
    duplicateDanger: false,
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
});
