import { describe, expect, it } from "vitest";

import {
  ApplicationPacketSchema,
  LEVER_APPLICATION_INSPECTION_FORM_VERSION,
  LEVER_REAL_INSPECTION_ADAPTER_VERSION,
  LeverRealTargetInspectionAdapter,
  ReadOnlyBrowserSnapshotSchema,
  RunnerTargetCapabilitySchema,
  TargetInspectionRunner,
  freezeInspectionBinding,
  freezeRunnerBinding,
  type ApplicationPacket,
  type ReadOnlyBrowserSnapshot,
  type RunnerTargetCapability,
} from "./index";

const now = new Date("2026-09-13T04:00:00.000Z");

function packet(overrides: Partial<ApplicationPacket> = {}) {
  return ApplicationPacketSchema.parse({
    id: "packet:inspection-fixture",
    jobId: "job:inspection-fixture",
    jobVersionId: "job-version:inspection-fixture",
    profileVersionId: "profile-version:inspection-fixture",
    evaluationVersionId: "evaluation:inspection-fixture",
    eligibilityStatus: "REVIEW_REQUIRED",
    targetUrl: "https://jobs.lever.co/fictional/00000000-0000-4000-8000-000000000001/apply",
    targetHost: "jobs.lever.co",
    jobExpiryState: "UNKNOWN",
    duplicateState: "CLEAR",
    versionsCurrent: true,
    documents: [],
    answers: [],
    ...overrides,
  });
}

function capability(overrides: Partial<RunnerTargetCapability> = {}) {
  return RunnerTargetCapabilitySchema.parse({
    schemaVersion: 2,
    capabilityId: "runner_inspection_fixture",
    version: 1,
    predecessorVersion: null,
    targetKind: "REAL_TARGET",
    alias: "Fictional Lever inspection",
    allowedOrigin: "https://jobs.lever.co",
    allowedPathPrefix: "/fictional/00000000-0000-4000-8000-000000000001/apply",
    formVersion: LEVER_APPLICATION_INSPECTION_FORM_VERSION,
    adapterVersion: LEVER_REAL_INSPECTION_ADAPTER_VERSION,
    allowedOperations: ["OPEN_AND_INSPECT_ONLY"],
    approvalState: "APPROVED",
    approvalReference: "FICTIONAL_OWNER_APPROVAL",
    approvedAt: "2026-09-13T03:59:00.000Z",
    policyVersion: "real-target-inspection-v1",
    policyExpiresAt: "2026-09-14T04:00:00.000Z",
    capabilityExpiresAt: "2026-09-13T04:30:00.000Z",
    revokedAt: null,
    ...overrides,
  });
}

function control(
  index: number,
  label: string,
  overrides: Partial<ReadOnlyBrowserSnapshot["controls"][number]> = {},
) {
  return {
    index,
    tag: "input" as const,
    type: "text",
    name: `field-${index}`,
    id: `field-${index}`,
    autocomplete: "",
    required: true,
    hidden: false,
    label,
    unsupportedWidget: false,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ReadOnlyBrowserSnapshot> = {}): ReadOnlyBrowserSnapshot {
  return ReadOnlyBrowserSnapshotSchema.parse({
    targetUrl: packet().targetUrl!,
    httpStatus: 200,
    declaredFormVersion: LEVER_APPLICATION_INSPECTION_FORM_VERSION,
    formCount: 1,
    controls: [
      control(0, "First name", { name: "firstName", autocomplete: "given-name" }),
      control(1, "Submit application", { tag: "button", type: "submit" }),
    ],
    protectionSignals: [],
    popupAttempted: false,
    downloadAttempted: false,
    blockedWriteRequest: false,
    blockedDestination: false,
    hiddenInteractiveStep: false,
    ...overrides,
  });
}

class FixtureBrowser {
  calls = 0;
  constructor(public value: ReadOnlyBrowserSnapshot = snapshot()) {}
  async inspect() {
    this.calls += 1;
    return this.value;
  }
}

function runnerFor(value = packet(), target = capability(), browser = new FixtureBrowser()) {
  const binding = freezeInspectionBinding(value, target);
  const audits: string[] = [];
  const runner = new TargetInspectionRunner(
    target,
    binding,
    new LeverRealTargetInspectionAdapter(browser),
    () => binding,
    (record) => audits.push(record.type),
    () => now,
  );
  return { runner, binding, browser, audits };
}

describe("read-only real target inspection", () => {
  it.each([
    packet(),
    packet({
      eligibilityStatus: "ELIGIBLE",
      jobExpiryState: "ACTIVE",
      documents: [
        {
          id: "document:fictional",
          type: "CV",
          fileName: "fictional.pdf",
          digest: "a".repeat(64),
          approved: true,
          stale: false,
          required: true,
        },
      ],
    }),
  ])("inspects both packet readiness states without mutation: %#", async (value) => {
    const { runner, binding, audits } = runnerFor(value);
    const result = await runner.openAndInspect();
    expect(result.state).toBe("COMPLETED");
    expect(binding.unresolvedCount).toBe(value.documents.length ? 0 : 2);
    expect(result.state === "COMPLETED" && result.observation.metrics).toEqual({
      browserWriteEvents: 0,
      formValueChanges: 0,
      uploads: 0,
      submissions: 0,
      candidateDataOutboundFields: 0,
    });
    expect(audits).toEqual(["runner.inspection.opened", "runner.inspection.completed"]);
  });

  it("classifies the complete safe semantic inventory without candidate answers", async () => {
    const browser = new FixtureBrowser(
      snapshot({
        controls: [
          control(0, "First name", { autocomplete: "given-name" }),
          control(1, "Last name", { autocomplete: "family-name" }),
          control(2, "Email", { type: "email" }),
          control(3, "Phone", { type: "tel" }),
          control(4, "Resume", { type: "file", name: "resume" }),
          control(5, "Cover letter", { type: "file", name: "coverLetter" }),
          control(6, "Are you authorized to work here?"),
          control(7, "Will you require sponsorship?"),
          control(8, "Citizenship"),
          control(9, "Export control status"),
          control(10, "Security clearance"),
          control(11, "Current location"),
          control(12, "Willing to relocate"),
          control(13, "Education"),
          control(14, "Years of experience"),
          control(15, "Additional information", { tag: "textarea" }),
          control(16, "Consent to privacy policy", { type: "checkbox" }),
          control(17, "Unknown required field"),
          control(18, "Submit application", { tag: "button", type: "submit" }),
        ],
      }),
    );
    const result = await runnerFor(packet(), capability(), browser).runner.openAndInspect();
    expect(result.state).toBe("COMPLETED");
    if (result.state !== "COMPLETED") return;
    expect(result.observation.fields.map(({ semanticType }) => semanticType)).toEqual([
      "FIRST_NAME",
      "LAST_NAME",
      "EMAIL",
      "PHONE",
      "RESUME_UPLOAD",
      "COVER_LETTER_UPLOAD",
      "WORK_AUTHORIZATION",
      "SPONSORSHIP_REQUIRED",
      "CITIZENSHIP",
      "EXPORT_CONTROL",
      "SECURITY_CLEARANCE",
      "LOCATION",
      "RELOCATION",
      "EDUCATION",
      "YEARS_EXPERIENCE",
      "FREE_TEXT",
      "CONSENT",
      "UNKNOWN_FIELD",
      "FINAL_SUBMIT",
    ]);
    expect(
      result.observation.fields.find(({ semanticType }) => semanticType === "CITIZENSHIP"),
    ).toMatchObject({
      inspectionStatus: "REVIEW_REQUIRED",
      minimumEligibilityLabel: "Citizenship",
    });
    expect(
      result.observation.fields.find(({ semanticType }) => semanticType === "RESUME_UPLOAD"),
    ).toMatchObject({ inspectionStatus: "DOCUMENT_REQUIRED", minimumEligibilityLabel: null });
  });

  it.each([
    ["CAPTCHA", { protectionSignals: ["CAPTCHA"] }],
    ["MFA", { protectionSignals: ["MFA"] }],
    ["AUTHENTICATION_REQUIRED", { httpStatus: 401 }],
    ["BOT_DETECTION", { protectionSignals: ["BOT_DETECTION"] }],
    ["RATE_LIMIT", { httpStatus: 429 }],
    ["ACCESS_CONTROL", { httpStatus: 403 }],
    ["WEBSITE_RESTRICTION", { protectionSignals: ["WEBSITE_RESTRICTION"] }],
    ["PAGE_CHANGED", { httpStatus: 500 }],
    ["FORM_CHANGED", { declaredFormVersion: "lever-application-inspection-v2" }],
    ["DESTINATION_CHANGED", { blockedDestination: true }],
    ["DESTINATION_CHANGED", { popupAttempted: true }],
    ["UNSUPPORTED_CONTROL", { hiddenInteractiveStep: true }],
    ["UNSUPPORTED_CONTROL", { downloadAttempted: true }],
    ["UNSUPPORTED_CONTROL", { blockedWriteRequest: true }],
  ] as const)("stops on %s without any mutation", async (reason, overrides) => {
    const browser = new FixtureBrowser(snapshot(overrides as Partial<ReadOnlyBrowserSnapshot>));
    const result = await runnerFor(packet(), capability(), browser).runner.openAndInspect();
    expect(result).toMatchObject({ state: "STOPPED", stopReason: reason, observation: null });
  });

  it("stops on unsupported custom widgets and malformed form structure", async () => {
    const custom = new FixtureBrowser(
      snapshot({
        controls: [
          control(0, "Custom", { unsupportedWidget: true }),
          control(1, "Submit", { tag: "button", type: "submit" }),
        ],
      }),
    );
    expect(await runnerFor(packet(), capability(), custom).runner.openAndInspect()).toMatchObject({
      state: "STOPPED",
      stopReason: "UNSUPPORTED_CONTROL",
    });
    const noForm = new FixtureBrowser(snapshot({ formCount: 0 }));
    expect(await runnerFor(packet(), capability(), noForm).runner.openAndInspect()).toMatchObject({
      state: "STOPPED",
      stopReason: "FORM_CHANGED",
    });
  });

  it("rejects a stale packet before any browser can open", () => {
    const browser = new FixtureBrowser();
    expect(() => runnerFor(packet({ versionsCurrent: false }), capability(), browser)).toThrow(
      "STALE_PACKET_VERSION",
    );
    expect(browser.calls).toBe(0);
  });

  it("denies stale bindings before browser navigation", async () => {
    const value = packet();
    const target = capability();
    const binding = freezeInspectionBinding(value, target);
    const browser = new FixtureBrowser();
    const runner = new TargetInspectionRunner(
      target,
      binding,
      new LeverRealTargetInspectionAdapter(browser),
      () => ({ ...binding, profileVersionId: "profile-version:changed" }),
      () => undefined,
      () => now,
    );
    expect(await runner.openAndInspect()).toMatchObject({
      state: "STOPPED",
      stopReason: "TARGET_APPROVAL_REQUIRED",
    });
    expect(browser.calls).toBe(0);
  });

  it("cannot expose or reuse inspection authority for application operations", () => {
    const value = packet();
    const target = capability();
    const { runner } = runnerFor(value, target);
    for (const method of [
      "map",
      "mapForFill",
      "fill",
      "upload",
      "readyForFinalReview",
      "createConsent",
      "authenticate",
      "submit",
    ]) {
      expect(method in runner).toBe(false);
    }
    expect(() => freezeRunnerBinding(value, target)).toThrow("TARGET_OPERATION_SCOPE_INVALID");
    expect(() =>
      RunnerTargetCapabilitySchema.parse({
        ...target,
        allowedOperations: ["OPEN_AND_INSPECT_ONLY", "FILL"],
      }),
    ).toThrow();
  });

  it("rejects changed target URL and path scope without application authority", async () => {
    const changed = new FixtureBrowser(
      snapshot({
        targetUrl:
          "https://jobs.lever.co/fictional/00000000-0000-4000-8000-000000000001/apply/changed",
      }),
    );
    expect(await runnerFor(packet(), capability(), changed).runner.openAndInspect()).toMatchObject({
      state: "STOPPED",
      stopReason: "DESTINATION_CHANGED",
    });
    expect(() =>
      freezeInspectionBinding(
        packet({
          targetUrl: "https://jobs.lever.co/fictional/other/apply",
          targetHost: "jobs.lever.co",
        }),
        capability(),
      ),
    ).toThrow("TARGET_CAPABILITY_MISMATCH");
  });
});
