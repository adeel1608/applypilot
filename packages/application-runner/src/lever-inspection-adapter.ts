import { createHash } from "node:crypto";

import type { Download, Page, Route } from "playwright";
import { z } from "zod";

import {
  FrozenInspectionBindingSchema,
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

export const LEVER_REAL_INSPECTION_ADAPTER_VERSION = "lever-real-inspection-v1";
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
    const snapshot = ReadOnlyBrowserSnapshotSchema.parse(await this.browser.inspect(binding));
    const signal = firstSignal(snapshot);
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
    return TargetInspectionObservationSchema.parse({
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
    const routeHandler = async (route: Route) => {
      const request = route.request();
      const method = request.method();
      if (method !== "GET" && method !== "HEAD") {
        blockedWriteRequest = true;
        await route.abort("blockedbyclient");
        return;
      }
      const mainNavigation =
        request.isNavigationRequest() && request.frame() === this.page.mainFrame();
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
    await this.page.route("**/*", routeHandler);
    this.page.on("popup", popupHandler);
    this.page.on("download", downloadHandler);
    try {
      const response = await this.page.goto(binding.targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      const dom = await this.page.evaluate(() => {
        const clean = (value: string | null | undefined, max: number) =>
          (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
        const controls = [...document.querySelectorAll("input, select, textarea, button")]
          .slice(0, 200)
          .map((element, index) => {
            const input = element as HTMLInputElement;
            const labels = "labels" in input && input.labels ? [...input.labels] : [];
            const label = clean(
              labels.map((item) => item.textContent).join(" ") ||
                element.getAttribute("aria-label") ||
                element.getAttribute("data-inspection-label"),
              200,
            );
            const tag = element.tagName.toLowerCase() as "input" | "select" | "textarea" | "button";
            const type = clean(
              element.getAttribute("type") || (tag === "button" ? "submit" : "text"),
              40,
            ).toLowerCase();
            const style = window.getComputedStyle(element);
            return {
              index,
              tag,
              type,
              name: clean(element.getAttribute("name"), 200),
              id: clean(element.id, 200),
              autocomplete: clean(element.getAttribute("autocomplete"), 100),
              required: element.hasAttribute("required"),
              hidden:
                type === "hidden" ||
                element.hasAttribute("hidden") ||
                style.display === "none" ||
                style.visibility === "hidden",
              label,
              unsupportedWidget:
                element.hasAttribute("data-unsupported-control") ||
                element.getAttribute("role") === "combobox-custom",
            };
          });
        const explicitSignal = document
          .querySelector("[data-stop-reason]")
          ?.getAttribute("data-stop-reason");
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
        return {
          declaredFormVersion:
            document.querySelector("[data-form-version]")?.getAttribute("data-form-version") ??
            null,
          formCount: document.forms.length,
          controls,
          protectionSignals,
          popupDeclared: Boolean(
            document.querySelector('a[target="_blank"], form[target="_blank"]'),
          ),
          hiddenInteractiveStep: Boolean(document.querySelector("[data-hidden-application-step]")),
        };
      });
      const { popupDeclared, ...safeDom } = dom;
      return ReadOnlyBrowserSnapshotSchema.parse({
        targetUrl: this.page.url(),
        httpStatus: response?.status() ?? null,
        ...safeDom,
        popupAttempted: popupAttempted || popupDeclared,
        downloadAttempted,
        blockedWriteRequest,
        blockedDestination,
      });
    } finally {
      this.page.off("popup", popupHandler);
      this.page.off("download", downloadHandler);
      await this.page.unroute("**/*", routeHandler);
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
