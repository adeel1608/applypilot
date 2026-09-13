import { expect, test } from "@playwright/test";

import {
  ApplicationPacketSchema,
  LEVER_APPLICATION_INSPECTION_FORM_VERSION,
  LEVER_REAL_INSPECTION_ADAPTER_VERSION,
  LeverRealTargetInspectionAdapter,
  PlaywrightReadOnlyInspectionBrowser,
  RunnerTargetCapabilitySchema,
  TargetInspectionRunner,
  freezeInspectionBinding,
} from "@applypilot/application-runner";

const now = new Date("2026-09-13T04:00:00.000Z");

function inspection(caseName: string) {
  const targetUrl = `http://127.0.0.1:3100/synthetic-inspection?case=${caseName}`;
  const packet = ApplicationPacketSchema.parse({
    id: `packet:e2e-inspection:${caseName}`,
    jobId: "job:e2e-inspection",
    jobVersionId: "job-version:e2e-inspection",
    profileVersionId: "profile-version:e2e-inspection",
    evaluationVersionId: "evaluation:e2e-inspection",
    eligibilityStatus: "REVIEW_REQUIRED",
    targetUrl,
    targetHost: "127.0.0.1",
    jobExpiryState: "UNKNOWN",
    duplicateState: "CLEAR",
    versionsCurrent: true,
    documents: [],
    answers: [],
  });
  const capability = RunnerTargetCapabilitySchema.parse({
    schemaVersion: 2,
    capabilityId: `runner_e2e_inspection_${caseName}`,
    version: 1,
    predecessorVersion: null,
    targetKind: "SYNTHETIC_LOCAL",
    alias: "Fictional Lever inspection target",
    allowedOrigin: "http://127.0.0.1:3100",
    allowedPathPrefix: "/synthetic-inspection",
    formVersion: LEVER_APPLICATION_INSPECTION_FORM_VERSION,
    adapterVersion: LEVER_REAL_INSPECTION_ADAPTER_VERSION,
    allowedOperations: ["OPEN_AND_INSPECT_ONLY"],
    approvalState: "APPROVED",
    approvalReference: "E2E_FIXTURE_ONLY",
    approvedAt: "2026-09-13T03:59:00.000Z",
    policyVersion: "offline-e2e-v1",
    policyExpiresAt: "2026-09-14T04:00:00.000Z",
    capabilityExpiresAt: "2026-09-13T04:30:00.000Z",
    revokedAt: null,
  });
  const binding = freezeInspectionBinding(packet, capability);
  return { packet, capability, binding };
}

test("read-only Lever adapter inventories the fictional local form with zero browser mutation", async ({
  page,
}) => {
  const { capability, binding } = inspection("eligibility");
  let nonReadRequestCount = 0;
  page.on("request", (request) => {
    if (!new Set(["GET", "HEAD"]).has(request.method())) nonReadRequestCount += 1;
  });
  const runner = new TargetInspectionRunner(
    capability,
    binding,
    new LeverRealTargetInspectionAdapter(new PlaywrightReadOnlyInspectionBrowser(page)),
    () => binding,
    () => undefined,
    () => now,
  );
  const result = await runner.openAndInspect();
  expect(result.state).toBe("COMPLETED");
  if (result.state !== "COMPLETED") return;
  expect(result.observation.fields.map(({ semanticType }) => semanticType)).toEqual(
    expect.arrayContaining([
      "FIRST_NAME",
      "LAST_NAME",
      "EMAIL",
      "WORK_AUTHORIZATION",
      "SPONSORSHIP_REQUIRED",
      "EXPORT_CONTROL",
      "SECURITY_CLEARANCE",
      "FINAL_SUBMIT",
    ]),
  );
  expect(result.observation.metrics).toEqual({
    browserWriteEvents: 0,
    formValueChanges: 0,
    uploads: 0,
    submissions: 0,
    candidateDataOutboundFields: 0,
  });
  expect(nonReadRequestCount).toBe(0);
  expect(
    await page
      .locator("input, textarea, select")
      .evaluateAll((controls) => controls.every((control) => !(control as HTMLInputElement).value)),
  ).toBe(true);
});

test("fictional inspection matrix stops safely or inventories without clicks", async ({ page }) => {
  for (const [caseName, expectedState, expectedReason] of [
    ["normal", "COMPLETED", null],
    ["unknown-required", "COMPLETED", null],
    ["documents", "COMPLETED", null],
    ["captcha", "STOPPED", "CAPTCHA"],
    ["mfa", "STOPPED", "MFA"],
    ["auth", "STOPPED", "AUTHENTICATION_REQUIRED"],
    ["bot", "STOPPED", "BOT_DETECTION"],
    ["rate", "STOPPED", "RATE_LIMIT"],
    ["access", "STOPPED", "ACCESS_CONTROL"],
    ["restriction", "STOPPED", "WEBSITE_RESTRICTION"],
    ["unsupported", "STOPPED", "UNSUPPORTED_CONTROL"],
    ["changed-form", "STOPPED", "FORM_CHANGED"],
    ["popup", "STOPPED", "DESTINATION_CHANGED"],
    ["hidden-step", "STOPPED", "UNSUPPORTED_CONTROL"],
    ["hidden-submit", "COMPLETED", null],
    ["file-chooser", "COMPLETED", null],
  ] as const) {
    const { capability, binding } = inspection(caseName);
    const result = await new TargetInspectionRunner(
      capability,
      binding,
      new LeverRealTargetInspectionAdapter(new PlaywrightReadOnlyInspectionBrowser(page)),
      () => binding,
      () => undefined,
      () => now,
    ).openAndInspect();
    expect(result.state, caseName).toBe(expectedState);
    if (result.state === "STOPPED") expect(result.stopReason, caseName).toBe(expectedReason);
    if (result.state === "COMPLETED") {
      expect(result.observation.metrics, caseName).toMatchObject({
        browserWriteEvents: 0,
        formValueChanges: 0,
        uploads: 0,
        submissions: 0,
        candidateDataOutboundFields: 0,
      });
    }
  }
});
