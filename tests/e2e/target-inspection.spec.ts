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
  deterministicRunnerTargetCapabilityId,
  freezeInspectionBinding,
  legacyMainWorldBrowserV2ForLocalRegression,
  packetDigest,
} from "@applypilot/application-runner";

const now = new Date("2026-09-13T04:00:00.000Z");

function inspection(caseName: string, route = "synthetic-inspection") {
  const targetPath = `/${route}`;
  const targetUrl = `http://127.0.0.1:3100${targetPath}?case=${caseName}`;
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
  const identity = {
    targetKind: "SYNTHETIC_LOCAL" as const,
    allowedOrigin: "http://127.0.0.1:3100",
    allowedPathPrefix: targetPath,
    operation: "OPEN_AND_INSPECT_ONLY" as const,
    formVersion: LEVER_APPLICATION_INSPECTION_FORM_VERSION,
    adapterVersion: LEVER_REAL_INSPECTION_ADAPTER_VERSION,
    packetDigest: packetDigest(packet),
  };
  const capability = RunnerTargetCapabilitySchema.parse({
    schemaVersion: 2,
    capabilityId: deterministicRunnerTargetCapabilityId(identity),
    version: 1,
    predecessorVersion: null,
    targetKind: "SYNTHETIC_LOCAL",
    alias: "Fictional Lever inspection target",
    allowedOrigin: "http://127.0.0.1:3100",
    allowedPathPrefix: targetPath,
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
  expect(result.state, JSON.stringify(result)).toBe("COMPLETED");
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

test("v4 classifies the complete fictional Lever-like semantic contract", async ({ page }) => {
  const { capability, binding } = inspection("full-contract");
  const result = await new TargetInspectionRunner(
    capability,
    binding,
    new LeverRealTargetInspectionAdapter(new PlaywrightReadOnlyInspectionBrowser(page)),
    () => binding,
    () => undefined,
    () => now,
  ).openAndInspect();
  expect(result.state, JSON.stringify(result)).toBe("COMPLETED");
  if (result.state !== "COMPLETED") return;
  expect(result.observation.fields.map(({ semanticType }) => semanticType)).toEqual(
    expect.arrayContaining([
      "FIRST_NAME",
      "LAST_NAME",
      "EMAIL",
      "PHONE",
      "RESUME_UPLOAD",
      "COVER_LETTER_UPLOAD",
      "WORK_AUTHORIZATION",
      "SPONSORSHIP_REQUIRED",
      "CITIZENSHIP",
      "SECURITY_CLEARANCE",
      "EXPORT_CONTROL",
      "RELOCATION",
      "LOCATION",
      "EDUCATION",
      "YEARS_EXPERIENCE",
      "FREE_TEXT",
      "CONSENT",
      "FINAL_SUBMIT",
    ]),
  );
  expect(result.observation.fields.filter(({ required }) => required).length).toBeGreaterThan(0);
  expect(
    result.observation.fields.filter(
      ({ inspectionStatus }) => inspectionStatus === "REVIEW_REQUIRED",
    ).length,
  ).toBeGreaterThanOrEqual(7);
});

test("fictional inspection matrix stops safely or inventories without clicks", async ({ page }) => {
  test.setTimeout(180_000);
  for (const [caseName, expectedState, expectedReason] of [
    ["normal", "COMPLETED", null],
    ["full-contract", "COMPLETED", null],
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
    if (result.state === "STOPPED" && caseName === "changed-destination") {
      expect(result.destinationDiagnostic).toBe("FINAL_PATH_CHANGED");
    }
    if (result.state === "STOPPED" && caseName === "popup") {
      expect(result.destinationDiagnostic).toBe("POPUP_ATTEMPT");
    }
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

test("v4 passive reads resist hostile employer main-world primitives", async ({ browser }) => {
  test.slow();
  const hostileCases = [
    "document-query-all",
    "document-query-one",
    "element-get-attribute",
    "element-has-attribute",
    "html-id-getter",
    "computed-style",
    "node-list-iterator",
    "array-from",
    "array-methods",
    "string-methods",
    "labels-getter",
    "label-text",
    "forms-getter",
    "shadow-getter",
    "unusual-dom-return",
    "prototype-mutation",
    "hostile-custom-element",
  ] as const;
  for (const caseName of hostileCases) {
    const context = await browser.newContext();
    const page = await context.newPage();
    let nonReadRequestCount = 0;
    page.on("request", (request) => {
      if (!new Set(["GET", "HEAD"]).has(request.method())) nonReadRequestCount += 1;
    });
    const hostilePage = new Proxy(page, {
      get(target, property) {
        if (property === "goto") {
          return async (...args: Parameters<Page["goto"]>) => {
            const response = await page.goto(...args);
            await page.evaluate((fixture) => {
              const fail = () => {
                throw new Error("fictional hostile page-world primitive");
              };
              if (fixture === "document-query-all") document.querySelectorAll = fail as never;
              if (fixture === "document-query-one") document.querySelector = fail as never;
              if (fixture === "element-get-attribute") Element.prototype.getAttribute = fail;
              if (fixture === "element-has-attribute") Element.prototype.hasAttribute = fail;
              if (fixture === "html-id-getter") {
                Object.defineProperty(HTMLElement.prototype, "id", {
                  configurable: true,
                  get: fail,
                });
              }
              if (fixture === "computed-style") window.getComputedStyle = fail as never;
              if (fixture === "node-list-iterator") {
                Object.defineProperty(NodeList.prototype, Symbol.iterator, {
                  configurable: true,
                  value: fail,
                });
              }
              if (fixture === "array-from") Array.from = fail as never;
              if (fixture === "array-methods") {
                Array.prototype.slice = fail as never;
                Array.prototype.map = fail as never;
                Array.prototype.every = fail as never;
              }
              if (fixture === "string-methods") {
                String.prototype.slice = fail as never;
                String.prototype.replace = fail as never;
                String.prototype.trim = fail as never;
                String.prototype.toLowerCase = fail as never;
              }
              if (fixture === "labels-getter") {
                Object.defineProperty(HTMLInputElement.prototype, "labels", {
                  configurable: true,
                  get: fail,
                });
              }
              if (fixture === "label-text") {
                Object.defineProperty(HTMLLabelElement.prototype, "textContent", {
                  configurable: true,
                  get: fail,
                });
              }
              if (fixture === "forms-getter") {
                Object.defineProperty(Document.prototype, "forms", {
                  configurable: true,
                  get: fail,
                });
              }
              if (fixture === "shadow-getter") {
                Object.defineProperty(Element.prototype, "shadowRoot", {
                  configurable: true,
                  get: fail,
                });
              }
              if (fixture === "unusual-dom-return") {
                document.querySelectorAll = (() => ({ fictional: true })) as never;
                document.querySelector = (() => ({ fictional: true })) as never;
              }
              if (fixture === "prototype-mutation") {
                queueMicrotask(() => {
                  Element.prototype.getAttribute = fail;
                  Array.from = fail as never;
                });
              }
              if (fixture === "hostile-custom-element") {
                class HostileControl extends HTMLElement {
                  get id() {
                    return fail();
                  }
                }
                customElements.define("fictional-hostile-control", HostileControl);
                const host = document.createElement("fictional-hostile-control");
                const input = document.createElement("input");
                input.name = "phone";
                input.type = "tel";
                input.setAttribute("aria-label", "Fictional phone");
                host.append(input);
                document.querySelector("form")?.append(host);
              }
            }, caseName);
            return response;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Page;
    const { capability, binding } = inspection("normal", "synthetic-inspection-raw");
    const result = await new TargetInspectionRunner(
      capability,
      binding,
      new LeverRealTargetInspectionAdapter(new PlaywrightReadOnlyInspectionBrowser(hostilePage)),
      () => binding,
      () => undefined,
      () => now,
    ).openAndInspect();
    expect(result, caseName).toMatchObject({ state: "COMPLETED" });
    expect(nonReadRequestCount, caseName).toBe(0);
    const valueLocators = await page.locator("input, textarea, select").all();
    expect(
      (await Promise.all(valueLocators.map(async (locator) => locator.inputValue()))).filter(
        Boolean,
      ),
    ).toEqual([]);
    await context.close();
  }
});

test("cross-origin passive resources stay blocked without destabilizing the fictional form", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  let crossOriginRequests = 0;
  let nonReadRequestCount = 0;
  page.on("request", (request) => {
    if (request.url().startsWith("http://127.0.0.1:3200/")) crossOriginRequests += 1;
    if (!new Set(["GET", "HEAD"]).has(request.method())) nonReadRequestCount += 1;
  });
  const resourcePage = new Proxy(page, {
    get(target, property) {
      if (property === "goto") {
        return async (...args: Parameters<Page["goto"]>) => {
          const response = await page.goto(...args);
          await page.evaluate(async () => {
            await fetch("http://127.0.0.1:3200/fictional-passive-resource").catch(() => undefined);
          });
          return response;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Page;
  const { capability, binding } = inspection("normal", "synthetic-inspection-raw");
  const result = await new TargetInspectionRunner(
    capability,
    binding,
    new LeverRealTargetInspectionAdapter(new PlaywrightReadOnlyInspectionBrowser(resourcePage)),
    () => binding,
    () => undefined,
    () => now,
  ).openAndInspect();
  expect(result).toMatchObject({ state: "COMPLETED" });
  expect(crossOriginRequests).toBe(1);
  expect(nonReadRequestCount).toBe(0);
  await context.close();
});

test("v4 remains bounded for a large inert DOM and a server-rendered form with JavaScript disabled", async ({
  browser,
}) => {
  for (const [caseName, javaScriptEnabled] of [
    ["large-dom", true],
    ["javascript-disabled", false],
  ] as const) {
    const context = await browser.newContext({ javaScriptEnabled, serviceWorkers: "block" });
    const page = await context.newPage();
    const { capability, binding } = inspection(caseName, "synthetic-inspection-raw");
    const result = await new TargetInspectionRunner(
      capability,
      binding,
      new LeverRealTargetInspectionAdapter(new PlaywrightReadOnlyInspectionBrowser(page)),
      () => binding,
      () => undefined,
      () => now,
    ).openAndInspect();
    expect(result, caseName).toMatchObject({ state: "COMPLETED" });
    if (result.state === "COMPLETED") {
      expect(result.observation.fields.length, caseName).toBe(4);
      expect(result.observation.metrics, caseName).toEqual({
        browserWriteEvents: 0,
        formValueChanges: 0,
        uploads: 0,
        submissions: 0,
        candidateDataOutboundFields: 0,
      });
    }
    await context.close();
  }
});

test("classifies synthetic navigation, reload, close, and context loss without a retry", async ({
  browser,
}) => {
  for (const caseName of [
    "client-navigation",
    "reload",
    "close",
    "execution-context-destroyed",
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const { capability, binding } = inspection("normal", "synthetic-inspection-raw");
    let injected = false;
    let productionGotoCount = 0;
    let controlCollectionCount = 0;
    const unstablePage = new Proxy(page, {
      get(target, property) {
        if (property === "goto") {
          return async (...args: Parameters<Page["goto"]>) => {
            productionGotoCount += 1;
            return page.goto(...args);
          };
        }
        if (property === "locator") {
          return (...args: Parameters<Page["locator"]>) => {
            const locator = page.locator(...args);
            if (!args[0].startsWith("xpath=//input")) return locator;
            return new Proxy(locator, {
              get(locatorTarget, locatorProperty) {
                if (locatorProperty === "elementHandles") {
                  return async () => {
                    const handles = await locator.elementHandles();
                    controlCollectionCount += 1;
                    if (!injected && controlCollectionCount === 2) {
                      injected = true;
                      if (
                        caseName === "client-navigation" ||
                        caseName === "execution-context-destroyed"
                      ) {
                        await page.goto(`${binding.targetUrl}&fictional-navigation=1`, {
                          waitUntil: "commit",
                        });
                      } else if (caseName === "reload") {
                        await page.reload({ waitUntil: "commit" });
                      } else {
                        await page.close();
                      }
                    }
                    return handles;
                  };
                }
                const value = Reflect.get(locatorTarget, locatorProperty, locatorTarget) as unknown;
                return typeof value === "function" ? value.bind(locatorTarget) : value;
              },
            });
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
    const changedDestination =
      caseName === "client-navigation" || caseName === "execution-context-destroyed";
    expect(result, caseName).toMatchObject({
      state: "STOPPED",
      stopReason: changedDestination ? "DESTINATION_CHANGED" : "PAGE_CHANGED",
      diagnosticCategory: changedDestination ? null : "NAVIGATION_EXCEPTION",
      destinationDiagnostic: changedDestination ? "FINAL_QUERY_OR_FRAGMENT_CHANGED" : null,
    });
    expect(injected, caseName).toBe(true);
    expect(productionGotoCount, caseName).toBe(1);
    await context.close();
  }
});

test("fails closed when the passive control or form structure mutates between bounded passes", async ({
  browser,
}) => {
  for (const caseName of ["append", "detach", "replace-control", "replace-form"] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    let productionGotoCount = 0;
    let controlCollectionCount = 0;
    const mutatingPage = new Proxy(page, {
      get(target, property) {
        if (property === "goto") {
          return async (...args: Parameters<Page["goto"]>) => {
            productionGotoCount += 1;
            return page.goto(...args);
          };
        }
        if (property === "locator") {
          return (...args: Parameters<Page["locator"]>) => {
            const locator = page.locator(...args);
            if (!args[0].startsWith("xpath=//input")) return locator;
            return new Proxy(locator, {
              get(locatorTarget, locatorProperty) {
                if (locatorProperty === "elementHandles") {
                  return async () => {
                    const handles = await locator.elementHandles();
                    controlCollectionCount += 1;
                    if (controlCollectionCount === 2) {
                      await page.evaluate((fixture) => {
                        const form = document.querySelector("form");
                        const first = form?.querySelector("input");
                        if (fixture === "append") {
                          const inserted = document.createElement("input");
                          inserted.name = "location";
                          form?.append(inserted);
                        } else if (fixture === "detach") {
                          first?.remove();
                        } else if (fixture === "replace-control" && first) {
                          first.replaceWith(first.cloneNode(true));
                        } else if (fixture === "replace-form" && form) {
                          form.replaceWith(form.cloneNode(true));
                        }
                      }, caseName);
                    }
                    return handles;
                  };
                }
                const value = Reflect.get(locatorTarget, locatorProperty, locatorTarget) as unknown;
                return typeof value === "function" ? value.bind(locatorTarget) : value;
              },
            });
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Page;
    const { capability, binding } = inspection("normal", "synthetic-inspection-raw");
    const result = await new TargetInspectionRunner(
      capability,
      binding,
      new LeverRealTargetInspectionAdapter(new PlaywrightReadOnlyInspectionBrowser(mutatingPage)),
      () => binding,
      () => undefined,
      () => now,
    ).openAndInspect();
    expect(result, caseName).toMatchObject({
      state: "STOPPED",
      stopReason: "PAGE_CHANGED",
      diagnosticCategory: "DOM_INSPECTION_EXCEPTION",
      diagnosticStage: "DOM_ENUMERATION",
    });
    expect(productionGotoCount, caseName).toBe(1);
    await context.close();
  }
});

test("persists only fixed value-free v4 DOM diagnostic stages", async ({ browser }) => {
  for (const stage of ["DOM_QUERY", "DOM_CONTROL_READ", "DOM_PAGE_METADATA"] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const stagedPage = new Proxy(page, {
      get(target, property) {
        if (property === "locator") {
          return (...args: Parameters<Page["locator"]>) => {
            if (stage === "DOM_QUERY" && args[0].startsWith("xpath=//input")) {
              throw new Error("fictional query boundary failure");
            }
            const locator = page.locator(...args);
            if (stage === "DOM_PAGE_METADATA" && args[0] === "xpath=//form") {
              return new Proxy(locator, {
                get(locatorTarget, locatorProperty) {
                  if (locatorProperty === "count") {
                    return async () => {
                      throw new Error("fictional metadata boundary failure");
                    };
                  }
                  const value = Reflect.get(
                    locatorTarget,
                    locatorProperty,
                    locatorTarget,
                  ) as unknown;
                  return typeof value === "function" ? value.bind(locatorTarget) : value;
                },
              });
            }
            if (stage === "DOM_CONTROL_READ" && args[0].startsWith("xpath=//input")) {
              return new Proxy(locator, {
                get(locatorTarget, locatorProperty) {
                  if (locatorProperty === "elementHandles") {
                    return async () => {
                      const handles = await locator.elementHandles();
                      const first = handles[0];
                      if (!first) return handles;
                      handles[0] = new Proxy(first, {
                        get(handleTarget, handleProperty) {
                          if (handleProperty === "$") {
                            return async () => {
                              throw new Error("fictional control boundary failure");
                            };
                          }
                          const value = Reflect.get(
                            handleTarget,
                            handleProperty,
                            handleTarget,
                          ) as unknown;
                          return typeof value === "function" ? value.bind(handleTarget) : value;
                        },
                      });
                      return handles;
                    };
                  }
                  const value = Reflect.get(
                    locatorTarget,
                    locatorProperty,
                    locatorTarget,
                  ) as unknown;
                  return typeof value === "function" ? value.bind(locatorTarget) : value;
                },
              });
            }
            return locator;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Page;
    const { capability, binding } = inspection("normal", "synthetic-inspection-raw");
    const result = await new TargetInspectionRunner(
      capability,
      binding,
      new LeverRealTargetInspectionAdapter(new PlaywrightReadOnlyInspectionBrowser(stagedPage)),
      () => binding,
      () => undefined,
      () => now,
    ).openAndInspect();
    expect(result, stage).toMatchObject({
      state: "STOPPED",
      stopReason: "PAGE_CHANGED",
      diagnosticCategory: "DOM_INSPECTION_EXCEPTION",
      diagnosticStage: stage,
    });
    expect(JSON.stringify(result), stage).not.toMatch(/fictional|selector|stack|message/i);
    await context.close();
  }

  for (const [stage, serializer] of [
    [
      "DOM_RESULT_SERIALIZATION",
      () => {
        throw new Error("fictional serialization detail");
      },
    ],
    [
      "DOM_ENUMERATION",
      (() => {
        let call = 0;
        return () => (++call === 1 ? "first" : "second");
      })(),
    ],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const { capability, binding } = inspection("normal", "synthetic-inspection-raw");
    const result = await new TargetInspectionRunner(
      capability,
      binding,
      new LeverRealTargetInspectionAdapter(
        new PlaywrightReadOnlyInspectionBrowser(page, serializer),
      ),
      () => binding,
      () => undefined,
      () => now,
    ).openAndInspect();
    expect(result, stage).toMatchObject({
      state: "STOPPED",
      stopReason: "PAGE_CHANGED",
      diagnosticCategory: "DOM_INSPECTION_EXCEPTION",
      diagnosticStage: stage,
    });
    await context.close();
  }
});

test("baseline v2 reproduces a stable-URL DOM inspection exception under hostile page-world query primitives", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    document.querySelectorAll = (() => {
      throw new Error("fictional hostile query primitive");
    }) as typeof document.querySelectorAll;
  });
  const { binding } = inspection("normal", "synthetic-inspection-raw");
  await expect(
    legacyMainWorldBrowserV2ForLocalRegression(page).inspect(binding),
  ).rejects.toMatchObject({
    category: "DOM_INSPECTION_EXCEPTION",
    message: "INSPECTION_DIAGNOSTIC",
  });
  expect(page.url()).toBe(binding.targetUrl);
  await context.close();
});
