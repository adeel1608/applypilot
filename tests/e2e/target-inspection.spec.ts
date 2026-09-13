import { expect, test } from "@playwright/test";
import type { Page } from "playwright";

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
    ["changed-destination", "STOPPED", "DESTINATION_CHANGED"],
    ["popup", "STOPPED", "DESTINATION_CHANGED"],
    ["hidden-step", "STOPPED", "UNSUPPORTED_CONTROL"],
    ["hidden-submit", "COMPLETED", null],
    ["file-chooser", "COMPLETED", null],
    ["labels-absent", "COMPLETED", null],
    ["unusual-native", "STOPPED", "UNSUPPORTED_CONTROL"],
    ["large-attributes", "COMPLETED", null],
    ["unicode", "COMPLETED", null],
    ["no-form", "STOPPED", "FORM_CHANGED"],
    ["multiple-forms", "COMPLETED", null],
    ["over-200", "STOPPED", "UNSUPPORTED_CONTROL"],
    ["dynamic-insert", "COMPLETED", null],
    ["shadow-dom", "STOPPED", "UNSUPPORTED_CONTROL"],
    ["no-submit", "STOPPED", "FORM_CHANGED"],
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

test("bounds fictional attributes and handles labels absent and Unicode safely", async ({
  page,
}) => {
  for (const caseName of ["labels-absent", "large-attributes", "unicode"] as const) {
    const { binding } = inspection(caseName);
    const snapshot = await new PlaywrightReadOnlyInspectionBrowser(page).inspect(binding);
    expect(snapshot.controls.length, caseName).toBeGreaterThan(0);
    for (const field of snapshot.controls) {
      expect(field.name.length, caseName).toBeLessThanOrEqual(200);
      expect(field.id.length, caseName).toBeLessThanOrEqual(200);
      expect(field.label.length, caseName).toBeLessThanOrEqual(200);
      expect(field.autocomplete.length, caseName).toBeLessThanOrEqual(100);
      expect(field.type.length, caseName).toBeLessThanOrEqual(40);
      expect(/[\uD800-\uDBFF]$/u.test(`${field.name}${field.id}${field.label}`), caseName).toBe(
        false,
      );
    }
    if (caseName === "labels-absent") expect(snapshot.controls[0]?.label).toBe("");
  }
});

test("defensive extraction isolates fictional per-control failures and DOM mutation", async ({
  browser,
}) => {
  for (const caseName of [
    "style",
    "labels-collection",
    "label-text",
    "detach",
    "mutate",
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    let nonReadRequestCount = 0;
    page.on("request", (request) => {
      if (!new Set(["GET", "HEAD"]).has(request.method())) nonReadRequestCount += 1;
    });
    await page.addInitScript((fixture) => {
      if (fixture === "style") {
        const original = window.getComputedStyle.bind(window);
        window.getComputedStyle = ((element: Element, pseudo?: string | null) => {
          if (element instanceof HTMLInputElement && element.name === "firstName") {
            throw new Error("fictional style accessor failure");
          }
          return original(element, pseudo);
        }) as typeof window.getComputedStyle;
      }
      if (fixture === "labels-collection") {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "labels");
        if (descriptor?.get) {
          Object.defineProperty(HTMLInputElement.prototype, "labels", {
            configurable: true,
            get() {
              if (this.name === "firstName") {
                throw new Error("fictional labels collection failure");
              }
              return descriptor.get!.call(this);
            },
          });
        }
      }
      if (fixture === "label-text") {
        const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
        if (descriptor?.get) {
          Object.defineProperty(HTMLLabelElement.prototype, "textContent", {
            configurable: true,
            get() {
              if (this.querySelector('input[name="firstName"]')) {
                throw new Error("fictional label accessor failure");
              }
              return descriptor.get!.call(this);
            },
          });
        }
      }
      if (fixture === "detach" || fixture === "mutate") {
        const original = Element.prototype.getAttribute;
        let changed = false;
        Element.prototype.getAttribute = function (name: string) {
          const firstName = original.call(this, "name") === "firstName";
          if (!changed && firstName && name === "type") {
            changed = true;
            if (fixture === "detach") this.remove();
            else {
              const inserted = document.createElement("input");
              inserted.name = "dynamicallyInsertedDuringInspection";
              document.querySelector("form")?.append(inserted);
            }
          }
          return original.call(this, name);
        };
      }
    }, caseName);
    const { capability, binding } = inspection("normal");
    const result = await new TargetInspectionRunner(
      capability,
      binding,
      new LeverRealTargetInspectionAdapter(new PlaywrightReadOnlyInspectionBrowser(page)),
      () => binding,
      () => undefined,
      () => now,
    ).openAndInspect();
    expect(result, caseName).toMatchObject({
      state: "STOPPED",
      stopReason: "UNSUPPORTED_CONTROL",
    });
    expect(nonReadRequestCount, caseName).toBe(0);
    expect(
      await page
        .locator("input, textarea, select")
        .evaluateAll((controls) =>
          controls.every((control) => !(control as HTMLInputElement).value),
        ),
      caseName,
    ).toBe(true);
    await context.close();
  }
});

test("classifies synthetic navigation, reload, and close races without a retry", async ({
  browser,
}) => {
  for (const caseName of ["client-navigation", "reload", "close"] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const { capability, binding } = inspection("normal");
    const originalEvaluate = page.evaluate.bind(page);
    let injected = false;
    const unstablePage = new Proxy(page, {
      get(target, property) {
        if (property === "evaluate") {
          return async (...args: Parameters<Page["evaluate"]>) => {
            if (!injected) {
              injected = true;
              if (caseName === "client-navigation") {
                await page.goto(`${binding.targetUrl}&fictional-navigation=1`, {
                  waitUntil: "commit",
                });
              } else if (caseName === "reload") {
                await page.reload({ waitUntil: "commit" });
              } else {
                await page.close();
              }
            }
            return originalEvaluate(...args);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Page;
    const result = await new TargetInspectionRunner(
      capability,
      binding,
      new LeverRealTargetInspectionAdapter(new PlaywrightReadOnlyInspectionBrowser(unstablePage)),
      () => binding,
      () => undefined,
      () => now,
    ).openAndInspect();
    expect(result, caseName).toMatchObject({
      state: "STOPPED",
      stopReason: "PAGE_CHANGED",
      diagnosticCategory: "NAVIGATION_EXCEPTION",
    });
    expect(injected, caseName).toBe(true);
    await context.close();
  }
});
