import { createHash } from "node:crypto";

import type { Download, Frame, Page, Route } from "playwright";
import { z } from "zod";

import {
  FrozenInspectionBindingSchema,
  InspectionDiagnosticError,
  InspectionControlTypeSchema,
  InspectionFieldSchema,
  InspectionFieldSemanticSchema,
  TargetInspectionObservationSchema,
  TargetInspectionRunner,
  type InspectionAuditSink,
  type InspectionRunResult,
  type FrozenInspectionBinding,
  type InspectionField,
  type TargetInspectionAdapter,
  type TargetInspectionObservation,
} from "./inspection-runner";
import {
  RunnerProtectionSignalSchema,
  RunnerTargetCapabilitySchema,
  type RunnerTargetCapability,
} from "./target-runner";

export const LEVER_REAL_INSPECTION_ADAPTER_VERSION = "lever-real-inspection-v2";
export const LEVER_APPLICATION_INSPECTION_FORM_VERSION = "lever-application-inspection-v1";

const RawControlSchema = z
  .object({
    index: z.number().int().nonnegative().max(199),
    tag: z.enum(["input", "select", "textarea", "button"]),
    type: z.string().max(40),
    name: z.string().max(200),
    id: z.string().max(200),
    autocomplete: z.string().max(100),
    required: z.boolean(),
    hidden: z.boolean(),
    label: z.string().max(200),
    unsupportedWidget: z.boolean(),
  })
  .strict();

export const ReadOnlyBrowserSnapshotSchema = z
  .object({
    targetUrl: z.url(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    declaredFormVersion: z.string().min(1).max(100).nullable(),
    formCount: z.number().int().nonnegative().max(20),
    controls: z.array(RawControlSchema).max(200),
    protectionSignals: z.array(RunnerProtectionSignalSchema).max(1),
    popupAttempted: z.boolean(),
    downloadAttempted: z.boolean(),
    blockedWriteRequest: z.boolean(),
    blockedDestination: z.boolean(),
    hiddenInteractiveStep: z.boolean(),
  })
  .strict();

export type ReadOnlyBrowserSnapshot = z.infer<typeof ReadOnlyBrowserSnapshotSchema>;

function parseReadOnlyBrowserSnapshot(input: unknown): ReadOnlyBrowserSnapshot {
  const parsed = ReadOnlyBrowserSnapshotSchema.safeParse(input);
  if (!parsed.success) throw new InspectionDiagnosticError("SNAPSHOT_INVALID");
  return parsed.data;
}

export interface ReadOnlyInspectionBrowser {
  inspect(binding: FrozenInspectionBinding): Promise<ReadOnlyBrowserSnapshot>;
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function semanticFor(control: z.infer<typeof RawControlSchema>) {
  const text = normalize(`${control.name} ${control.id} ${control.autocomplete} ${control.label}`);
  if (control.type === "submit" || (control.tag === "button" && control.type !== "button")) {
    return "FINAL_SUBMIT" as const;
  }
  if (control.type === "file") {
    return /cover/.test(text) ? ("COVER_LETTER_UPLOAD" as const) : ("RESUME_UPLOAD" as const);
  }
  if (/first name|given name|given-name|firstname/.test(text)) return "FIRST_NAME" as const;
  if (/last name|family name|surname|family-name|lastname/.test(text)) return "LAST_NAME" as const;
  if (control.type === "email" || /e mail|email/.test(text)) return "EMAIL" as const;
  if (control.type === "tel" || /phone|mobile|telephone/.test(text)) return "PHONE" as const;
  if (/sponsor/.test(text)) return "SPONSORSHIP_REQUIRED" as const;
  if (
    /work authori[sz]ation|work rights|right to work|authorized to work|legally authorized/.test(
      text,
    )
  ) {
    return "WORK_AUTHORIZATION" as const;
  }
  if (/citizen/.test(text)) return "CITIZENSHIP" as const;
  if (/security clearance|clearance/.test(text)) return "SECURITY_CLEARANCE" as const;
  if (/export control|\bitar\b|\bear\b/.test(text)) return "EXPORT_CONTROL" as const;
  if (/relocat/.test(text)) return "RELOCATION" as const;
  if (/location|address|city|state|postcode|zip/.test(text)) return "LOCATION" as const;
  if (/education|degree|qualification|school|university/.test(text)) return "EDUCATION" as const;
  if (/years?.*experience|experience.*years?/.test(text)) return "YEARS_EXPERIENCE" as const;
  if (control.tag === "textarea") return "FREE_TEXT" as const;
  if (control.type === "checkbox" && /consent|agree|privacy|terms/.test(text)) {
    return "CONSENT" as const;
  }
  return "UNKNOWN_FIELD" as const;
}

function controlTypeFor(control: z.infer<typeof RawControlSchema>) {
  if (control.unsupportedWidget) return "CUSTOM" as const;
  if (control.tag === "textarea") return "TEXTAREA" as const;
  if (control.tag === "select") return "SELECT" as const;
  if (control.tag === "button")
    return control.type === "submit" ? ("SUBMIT" as const) : ("CUSTOM" as const);
  if (control.hidden || control.type === "hidden") return "HIDDEN" as const;
  if (control.type === "email") return "EMAIL" as const;
  if (control.type === "tel") return "TEL" as const;
  if (control.type === "file") return "FILE" as const;
  if (control.type === "checkbox") return "CHECKBOX" as const;
  if (control.type === "radio") return "RADIO" as const;
  if (control.type === "submit") return "SUBMIT" as const;
  if (["", "text", "number", "url", "date"].includes(control.type)) return "TEXT" as const;
  return "CUSTOM" as const;
}

function classificationFor(
  semantic: z.infer<typeof InspectionFieldSemanticSchema>,
  controlType: z.infer<typeof InspectionControlTypeSchema>,
) {
  if (controlType === "CUSTOM") return "UNSUPPORTED" as const;
  if (semantic === "RESUME_UPLOAD" || semantic === "COVER_LETTER_UPLOAD") {
    return "DOCUMENT_REQUIRED" as const;
  }
  if (
    [
      "WORK_AUTHORIZATION",
      "SPONSORSHIP_REQUIRED",
      "CITIZENSHIP",
      "EXPORT_CONTROL",
      "SECURITY_CLEARANCE",
      "RELOCATION",
      "YEARS_EXPERIENCE",
    ].includes(semantic)
  ) {
    return "REVIEW_REQUIRED" as const;
  }
  if (semantic === "FINAL_SUBMIT" || controlType === "HIDDEN") return "NOT_APPLICABLE" as const;
  if (semantic === "UNKNOWN_FIELD") return "UNSUPPORTED" as const;
  return "SUPPORTED" as const;
}

const eligibilitySemantics = new Set([
  "WORK_AUTHORIZATION",
  "SPONSORSHIP_REQUIRED",
  "CITIZENSHIP",
  "EXPORT_CONTROL",
  "SECURITY_CLEARANCE",
]);

function safeField(control: z.infer<typeof RawControlSchema>): InspectionField {
  const semanticType = semanticFor(control);
  const controlType = controlTypeFor(control);
  const locatorId = `lever-field-${createHash("sha256")
    .update(`${control.index}|${control.tag}|${control.type}|${control.name}|${control.id}`)
    .digest("hex")
    .slice(0, 16)}`;
  return InspectionFieldSchema.parse({
    semanticType,
    controlType,
    required: control.required,
    locatorId,
    inspectionStatus: classificationFor(semanticType, controlType),
    minimumEligibilityLabel:
      eligibilitySemantics.has(semanticType) && control.label ? control.label : null,
  });
}

function firstSignal(snapshot: ReadOnlyBrowserSnapshot) {
  if (snapshot.protectionSignals[0]) return snapshot.protectionSignals[0];
  if (snapshot.httpStatus === 401) return "AUTHENTICATION_REQUIRED" as const;
  if (snapshot.httpStatus === 403) return "ACCESS_CONTROL" as const;
  if (snapshot.httpStatus === 429) return "RATE_LIMIT" as const;
  if (snapshot.blockedDestination || snapshot.popupAttempted) return "DESTINATION_CHANGED" as const;
  if (
    snapshot.blockedWriteRequest ||
    snapshot.downloadAttempted ||
    snapshot.hiddenInteractiveStep
  ) {
    return "UNSUPPORTED_CONTROL" as const;
  }
  if (snapshot.httpStatus !== null && snapshot.httpStatus >= 400) return "PAGE_CHANGED" as const;
  return null;
}

export class LeverRealTargetInspectionAdapter implements TargetInspectionAdapter {
  readonly adapterVersion = LEVER_REAL_INSPECTION_ADAPTER_VERSION;
  readonly formVersion = LEVER_APPLICATION_INSPECTION_FORM_VERSION;

  constructor(private readonly browser: ReadOnlyInspectionBrowser) {}

  async inspect(bindingInput: FrozenInspectionBinding): Promise<TargetInspectionObservation> {
    const binding = FrozenInspectionBindingSchema.parse(bindingInput);
    const target = new URL(binding.targetUrl);
    if (binding.operation !== "OPEN_AND_INSPECT_ONLY") {
      throw new Error("INSPECTION_OPERATION_SCOPE_REQUIRED");
    }
    if (
      target.hostname !== "jobs.lever.co" &&
      !["127.0.0.1", "localhost"].includes(target.hostname)
    ) {
      throw new Error("LEVER_INSPECTION_HOST_UNSUPPORTED");
    }
    const snapshot = parseReadOnlyBrowserSnapshot(await this.browser.inspect(binding));
    const signal = firstSignal(snapshot);
    if (signal === "PAGE_CHANGED" && snapshot.httpStatus !== null && snapshot.httpStatus >= 400) {
      throw new InspectionDiagnosticError("HTTP_ERROR");
    }
    const fields = snapshot.controls.map(safeField);
    const structurallySupported =
      snapshot.formCount > 0 && fields.some(({ semanticType }) => semanticType === "FINAL_SUBMIT");
    const unsupportedControl = fields.some(({ controlType }) => controlType === "CUSTOM");
    const protectionSignals = signal
      ? [signal]
      : snapshot.declaredFormVersion && snapshot.declaredFormVersion !== this.formVersion
        ? (["FORM_CHANGED"] as const)
        : !structurallySupported
          ? (["FORM_CHANGED"] as const)
          : unsupportedControl
            ? (["UNSUPPORTED_CONTROL"] as const)
            : [];
    const observation = TargetInspectionObservationSchema.safeParse({
      targetUrl: snapshot.targetUrl,
      formVersion: this.formVersion,
      adapterVersion: this.adapterVersion,
      fields,
      protectionSignals,
      metrics: {
        browserWriteEvents: 0,
        formValueChanges: 0,
        uploads: 0,
        submissions: 0,
        candidateDataOutboundFields: 0,
      },
    });
    if (!observation.success) throw new InspectionDiagnosticError("ADAPTER_OUTPUT_INVALID");
    return observation.data;
  }
}

function urlInScope(url: string, binding: FrozenInspectionBinding): boolean {
  try {
    const parsed = new URL(url);
    const prefix = new URL(binding.targetOrigin).origin;
    const pathPrefix = binding.allowedPathPrefix;
    return (
      parsed.origin === prefix &&
      (parsed.pathname === pathPrefix || parsed.pathname.startsWith(`${pathPrefix}/`))
    );
  } catch {
    return false;
  }
}

export class PlaywrightReadOnlyInspectionBrowser implements ReadOnlyInspectionBrowser {
  constructor(private readonly page: Page) {}

  async inspect(bindingInput: FrozenInspectionBinding): Promise<ReadOnlyBrowserSnapshot> {
    const binding = FrozenInspectionBindingSchema.parse(bindingInput);
    let popupAttempted = false;
    let downloadAttempted = false;
    let blockedWriteRequest = false;
    let blockedDestination = false;
    let mainFrameNavigationCount = 0;
    let pageClosed = false;
    let pageCrashed = false;
    const inspectedMainFrame = this.page.mainFrame();
    const routeHandler = async (route: Route) => {
      const request = route.request();
      const method = request.method();
      if (method !== "GET" && method !== "HEAD") {
        blockedWriteRequest = true;
        await route.abort("blockedbyclient");
        return;
      }
      const mainNavigation =
        request.isNavigationRequest() && request.frame() === inspectedMainFrame;
      if (mainNavigation && !urlInScope(request.url(), binding)) {
        blockedDestination = true;
        await route.abort("blockedbyclient");
        return;
      }
      if (new URL(request.url()).origin !== binding.targetOrigin) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    };
    const popupHandler = (popup: Page) => {
      popupAttempted = true;
      void popup.close();
    };
    const downloadHandler = (download: Download) => {
      downloadAttempted = true;
      void download.cancel();
    };
    const frameNavigationHandler = (frame: Frame) => {
      if (frame === inspectedMainFrame) mainFrameNavigationCount += 1;
    };
    const frameDetachedHandler = (frame: Frame) => {
      if (frame === inspectedMainFrame) pageClosed = true;
    };
    const closeHandler = () => {
      pageClosed = true;
    };
    const crashHandler = () => {
      pageCrashed = true;
    };
    await this.page.route("**/*", routeHandler);
    this.page.on("popup", popupHandler);
    this.page.on("download", downloadHandler);
    this.page.on("framenavigated", frameNavigationHandler);
    this.page.on("framedetached", frameDetachedHandler);
    this.page.on("close", closeHandler);
    this.page.on("crash", crashHandler);
    try {
      let response = null;
      try {
        response = await this.page.goto(binding.targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
      } catch {
        if (!blockedDestination) throw new InspectionDiagnosticError("NAVIGATION_EXCEPTION");
        return parseReadOnlyBrowserSnapshot({
          targetUrl: binding.targetUrl,
          httpStatus: null,
          declaredFormVersion: null,
          formCount: 0,
          controls: [],
          protectionSignals: ["DESTINATION_CHANGED"],
          popupAttempted,
          downloadAttempted,
          blockedWriteRequest,
          blockedDestination,
          hiddenInteractiveStep: false,
        });
      }
      if (blockedDestination || this.page.url() !== binding.targetUrl) {
        return ReadOnlyBrowserSnapshotSchema.parse({
          targetUrl: binding.targetUrl,
          httpStatus: response?.status() ?? null,
          declaredFormVersion: null,
          formCount: 0,
          controls: [],
          protectionSignals: ["DESTINATION_CHANGED"],
          popupAttempted,
          downloadAttempted,
          blockedWriteRequest,
          blockedDestination,
          hiddenInteractiveStep: false,
        });
      }
      const navigationCountBeforeEvaluation = mainFrameNavigationCount;
      const navigationBecameUnstable = () => {
        let urlChanged = true;
        let closed = pageClosed;
        try {
          urlChanged = this.page.url() !== binding.targetUrl;
          if (typeof this.page.isClosed === "function") closed ||= this.page.isClosed();
        } catch {
          closed = true;
        }
        return (
          closed ||
          pageCrashed ||
          urlChanged ||
          mainFrameNavigationCount !== navigationCountBeforeEvaluation
        );
      };
      let dom;
      try {
        dom = await this.page.evaluate(() => {
          const bounded = (value: string, max: number) => {
            const normalized = value
              .slice(0, max * 4)
              .replace(/\s+/g, " ")
              .trim();
            let result = normalized.slice(0, max);
            const finalCodeUnit = result.charCodeAt(result.length - 1);
            if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) result = result.slice(0, -1);
            return result;
          };
          const readString = (
            reader: () => string | null | undefined,
            max: number,
          ): { value: string; failed: boolean } => {
            try {
              const value = reader();
              return typeof value === "string"
                ? { value: bounded(value, max), failed: false }
                : value === null || value === undefined
                  ? { value: "", failed: false }
                  : { value: "", failed: true };
            } catch {
              return { value: "", failed: true };
            }
          };
          const readBoolean = (
            reader: () => boolean,
            fallback: boolean,
          ): { value: boolean; failed: boolean } => {
            try {
              const value = reader();
              return typeof value === "boolean"
                ? { value, failed: false }
                : { value: fallback, failed: true };
            } catch {
              return { value: fallback, failed: true };
            }
          };
          const controlSelector = "input, select, textarea, button";
          const initialControls = Array.from(document.querySelectorAll(controlSelector));
          const controls = initialControls.slice(0, 200).map((element, index) => {
            let unsupportedWidget = false;
            const tagRead = readString(() => element.tagName, 20);
            const normalizedTag = tagRead.value.toLowerCase();
            const tag = ["input", "select", "textarea", "button"].includes(normalizedTag)
              ? (normalizedTag as "input" | "select" | "textarea" | "button")
              : "input";
            unsupportedWidget ||= tagRead.failed || normalizedTag !== tag;
            const attribute = (name: string, max: number) => {
              const result = readString(() => element.getAttribute(name), max);
              unsupportedWidget ||= result.failed;
              return result.value;
            };
            const connected = readBoolean(() => element.isConnected, false);
            unsupportedWidget ||= connected.failed || !connected.value;
            const labels = (() => {
              try {
                const collection = (element as HTMLInputElement).labels;
                if (!collection) return { value: "", failed: false };
                const labelElements = Array.from(collection);
                let failed = labelElements.length > 20;
                const parts = labelElements.slice(0, 20).map((item) => {
                  const text = readString(() => item.textContent, 200);
                  failed ||= text.failed;
                  return text.value;
                });
                return { value: bounded(parts.join(" "), 200), failed };
              } catch {
                return { value: "", failed: true };
              }
            })();
            unsupportedWidget ||= labels.failed;
            const ariaLabel = attribute("aria-label", 200);
            const inspectionLabel = attribute("data-inspection-label", 200);
            const label = labels.value || ariaLabel || inspectionLabel;
            const rawType = attribute("type", 40);
            const type = (rawType || (tag === "button" ? "submit" : "text")).toLowerCase();
            const name = attribute("name", 200);
            const idRead = readString(() => (element as HTMLElement).id, 200);
            unsupportedWidget ||= idRead.failed;
            const autocomplete = attribute("autocomplete", 100);
            const required = readBoolean(() => element.hasAttribute("required"), false);
            const hiddenAttribute = readBoolean(() => element.hasAttribute("hidden"), true);
            unsupportedWidget ||= required.failed || hiddenAttribute.failed;
            let display = "";
            let visibility = "";
            try {
              const style = window.getComputedStyle(element);
              const displayRead = readString(() => style.display, 40);
              const visibilityRead = readString(() => style.visibility, 40);
              display = displayRead.value;
              visibility = visibilityRead.value;
              unsupportedWidget ||= displayRead.failed || visibilityRead.failed;
            } catch {
              unsupportedWidget = true;
            }
            const unsupportedAttribute = readBoolean(
              () => element.hasAttribute("data-unsupported-control"),
              true,
            );
            unsupportedWidget ||= unsupportedAttribute.failed || unsupportedAttribute.value;
            const role = attribute("role", 100);
            unsupportedWidget ||= role === "combobox-custom";
            return {
              index,
              tag,
              type,
              name,
              id: idRead.value,
              autocomplete,
              required: required.value,
              hidden:
                type === "hidden" ||
                hiddenAttribute.value ||
                display === "none" ||
                visibility === "hidden",
              label,
              unsupportedWidget,
            };
          });
          let controlsStable = initialControls.length <= 200;
          try {
            const finalControls = Array.from(document.querySelectorAll(controlSelector));
            controlsStable =
              controlsStable &&
              finalControls.length === initialControls.length &&
              initialControls.every((element, index) =>
                Boolean(element.isConnected && finalControls[index] === element),
              );
          } catch {
            controlsStable = false;
          }
          let shadowInteractionPresent = false;
          try {
            const allElements = Array.from(document.querySelectorAll("*"));
            shadowInteractionPresent = allElements.length > 1000;
            for (const element of allElements.slice(0, 1000)) {
              try {
                if (element.shadowRoot?.querySelector(controlSelector)) {
                  shadowInteractionPresent = true;
                  break;
                }
              } catch {
                shadowInteractionPresent = true;
                break;
              }
            }
          } catch {
            shadowInteractionPresent = true;
          }
          let pageReadFailed = false;
          const signalElement = (() => {
            try {
              return document.querySelector("[data-stop-reason]");
            } catch {
              pageReadFailed = true;
              return null;
            }
          })();
          const explicitSignalRead = signalElement
            ? readString(() => signalElement.getAttribute("data-stop-reason"), 100)
            : { value: "", failed: false };
          pageReadFailed ||= explicitSignalRead.failed;
          const explicitSignal = explicitSignalRead.value || null;
          const supportedSignals = [
            "CAPTCHA",
            "MFA",
            "AUTHENTICATION_REQUIRED",
            "BOT_DETECTION",
            "RATE_LIMIT",
            "ACCESS_CONTROL",
            "WEBSITE_RESTRICTION",
            "PAGE_CHANGED",
            "FORM_CHANGED",
            "DESTINATION_CHANGED",
            "UNSUPPORTED_CONTROL",
          ];
          const protectionSignals =
            explicitSignal && supportedSignals.includes(explicitSignal) ? [explicitSignal] : [];
          const declaredVersionElement = (() => {
            try {
              return document.querySelector("[data-form-version]");
            } catch {
              pageReadFailed = true;
              return null;
            }
          })();
          const declaredFormVersionRead = declaredVersionElement
            ? readString(() => declaredVersionElement.getAttribute("data-form-version"), 100)
            : { value: "", failed: false };
          pageReadFailed ||= declaredFormVersionRead.failed;
          const declaredFormVersion = declaredFormVersionRead.value || null;
          let formCount = 0;
          let formsReliable = true;
          try {
            const totalFormCount = document.forms.length;
            formCount = Math.min(totalFormCount, 20);
            formsReliable = totalFormCount <= 20;
          } catch {
            formsReliable = false;
          }
          let popupDeclared = false;
          try {
            popupDeclared = Boolean(
              document.querySelector('a[target="_blank"], form[target="_blank"]'),
            );
          } catch {
            popupDeclared = true;
          }
          let hiddenInteractiveStep = false;
          try {
            hiddenInteractiveStep = Boolean(
              document.querySelector("[data-hidden-application-step]"),
            );
          } catch {
            hiddenInteractiveStep = true;
          }
          return {
            declaredFormVersion,
            formCount,
            controls,
            protectionSignals,
            popupDeclared,
            hiddenInteractiveStep:
              hiddenInteractiveStep ||
              !controlsStable ||
              !formsReliable ||
              shadowInteractionPresent ||
              pageReadFailed,
          };
        });
      } catch {
        if (navigationBecameUnstable()) {
          throw new InspectionDiagnosticError("NAVIGATION_EXCEPTION");
        }
        throw new InspectionDiagnosticError("DOM_INSPECTION_EXCEPTION");
      }
      if (navigationBecameUnstable()) {
        throw new InspectionDiagnosticError("NAVIGATION_EXCEPTION");
      }
      try {
        const { popupDeclared, ...safeDom } = dom;
        return parseReadOnlyBrowserSnapshot({
          targetUrl: this.page.url(),
          httpStatus: response?.status() ?? null,
          ...safeDom,
          popupAttempted: popupAttempted || popupDeclared,
          downloadAttempted,
          blockedWriteRequest,
          blockedDestination,
        });
      } catch (error) {
        if (error instanceof InspectionDiagnosticError) throw error;
        throw new InspectionDiagnosticError("SNAPSHOT_INVALID");
      }
    } finally {
      try {
        this.page.off("popup", popupHandler);
        this.page.off("download", downloadHandler);
        this.page.off("framenavigated", frameNavigationHandler);
        this.page.off("framedetached", frameDetachedHandler);
        this.page.off("close", closeHandler);
        this.page.off("crash", crashHandler);
      } catch {
        // Page lifecycle failure is already represented by the safe terminal classification.
      }
      try {
        await this.page.unroute("**/*", routeHandler);
      } catch {
        // A closed/crashed page cannot retain a live route handler.
      }
    }
  }
}

export async function runLeverInspectionInFreshBrowser(input: {
  capability: RunnerTargetCapability;
  binding: FrozenInspectionBinding;
  currentBinding: () => FrozenInspectionBinding;
  audit: InspectionAuditSink;
  now?: () => Date;
}): Promise<InspectionRunResult> {
  const capability = RunnerTargetCapabilitySchema.parse(input.capability);
  const binding = FrozenInspectionBindingSchema.parse(input.binding);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
    });
    try {
      const page = await context.newPage();
      return await new TargetInspectionRunner(
        capability,
        binding,
        new LeverRealTargetInspectionAdapter(new PlaywrightReadOnlyInspectionBrowser(page)),
        input.currentBinding,
        input.audit,
        input.now,
      ).openAndInspect();
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
