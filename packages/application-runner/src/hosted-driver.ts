import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import type { ApplicationPacket } from "./beta";
import {
  HOSTED_ADAPTER_VERSION,
  HostedCapabilitySchema,
  HostedFormSchema,
  HostedMappingSchema,
  hostedDigest,
  type HostedApplicationDriver,
  type HostedCapability,
  type HostedControl,
  type HostedForm,
  type HostedMapping,
  type HostedUploadProof,
  type HostedVerifiedArtifact,
} from "./hosted-contract";
import { pinnedHostedHttpTransport, type HostedHttpTransport } from "./hosted-transport";

const safeCodes = new Set([
  "HOSTED_REQUEST_BUDGET_EXHAUSTED",
  "HOSTED_DESTINATION_FORBIDDEN",
  "HOSTED_METHOD_FORBIDDEN",
  "HOSTED_REDIRECT_FORBIDDEN",
  "HOSTED_RESPONSE_TOO_LARGE",
  "HOSTED_NETWORK_ADDRESS_FORBIDDEN",
  "HOSTED_NETWORK_ADDRESS_CHANGED",
  "HOSTED_DNS_FAILED",
  "HOSTED_CONTENT_ENCODING_UNSUPPORTED",
  "HOSTED_RATE_LIMIT",
  "HOSTED_AUTHENTICATION_REQUIRED",
  "HOSTED_ACCESS_CONTROL",
  "HOSTED_BOT_PROTECTION",
  "HOSTED_HTTP_FAILURE",
  "HOSTED_UPLOAD_ACK_INVALID",
  "HOSTED_OUTGOING_CONTENT_CHANGED",
  "HOSTED_SESSION_EXPIRED",
  "HOSTED_UNSUPPORTED_CONTROL",
  "HOSTED_FORM_CHANGED",
  "HOSTED_NATIVE_VALIDATION_FAILED",
  "HOSTED_DESTINATION_CHANGED",
  "HOSTED_CONTEXT_LOST",
  "HOSTED_CONFIRMATION_UNPROVEN",
  "HOSTED_TRANSPORT_OUTCOME_UNKNOWN",
  "HOSTED_ACTION_TIMEOUT",
  "HOSTED_NAVIGATION_TIMEOUT",
  "HOSTED_ANSWER_NOT_VERIFIED",
  "HOSTED_APPLICATION_BINDING_INVALID",
  "HOSTED_APPROVED_DOCUMENT_REQUIRED",
  "HOSTED_AUDIT_PERSISTENCE_FAILED",
  "HOSTED_CAPABILITY_CORRUPT",
  "HOSTED_CAPABILITY_EXPIRED",
  "HOSTED_CAPABILITY_FAMILY_CHANGED",
  "HOSTED_CAPABILITY_IMMUTABLE",
  "HOSTED_CAPABILITY_NOT_CURRENT",
  "HOSTED_CAPABILITY_SEQUENCE_INVALID",
  "HOSTED_DISCLOSURE_REPLAYED",
  "HOSTED_FACT_QUESTION_UNSUPPORTED",
  "HOSTED_FINAL_PREVIEW_CHANGED",
  "HOSTED_FINAL_PREVIEW_REQUIRED",
  "HOSTED_INSPECTION_REPLAYED",
  "HOSTED_MAPPING_CHANGED",
  "HOSTED_MODE_MISMATCH",
  "HOSTED_OPERATION_CLAIM_MISSING",
  "HOSTED_OPERATION_COMPLETION_INVALID",
  "HOSTED_OPERATION_SEQUENCE_INVALID",
  "HOSTED_OWNER_CHOICE_INVALID",
  "HOSTED_OWNER_CONSENT_INVALID",
  "HOSTED_OWNER_NONCE_REPLAY",
  "HOSTED_PACKET_BINDING_REQUIRED",
  "HOSTED_PACKET_NOT_READY",
  "HOSTED_PRIVATE_PROFILE_CHANGED",
  "HOSTED_QUESTION_CONTRACT_REQUIRED",
  "HOSTED_QUESTION_DISCOVERY_CORRUPT",
  "HOSTED_QUESTION_SUBJECT_CHANGED",
  "HOSTED_REVIEWED_BUILD_REQUIRED",
  "HOSTED_SESSION_CORRUPT",
  "HOSTED_SESSION_NOT_FOUND",
  "HOSTED_SOURCE_BINDING_INVALID",
  "HOSTED_SOURCE_STALE",
  "HOSTED_SUBJECT_NOT_CURRENT",
  "HOSTED_SUBMIT_ACTIVATION_GUARDED",
  "HOSTED_OPERATION_IN_PROGRESS",
  "HOSTED_REQUIRED_ANSWER_UNKNOWN",
  "HOSTED_QUESTION_CONTRACT_CHANGED",
  "HOSTED_QUESTION_REVIEW_INVALID",
  "HOSTED_ANSWER_OPTION_UNSUPPORTED",
  "HOSTED_APPROVED_ARTIFACT_ADMISSION_FAILED",
  "HOSTED_OWNER_CONFIRMATION_REQUIRED",
  "HOSTED_QUESTION_REVIEW_REQUIRED",
  "HOSTED_RENDERED_BINDING_CHANGED",
  "HOSTED_OWNED_RUNTIME_BUILD_CHANGED",
  "HOSTED_REVIEWED_ROLLOUT_REQUIRED",
  "HOSTED_OPERATION_STOPPED",
]);
export function hostedSafeErrorCode(value: unknown): string | null {
  return typeof value === "string" && safeCodes.has(value) ? value : null;
}
export function safeHostedError(error: unknown): string {
  return error instanceof Error && safeCodes.has(error.message)
    ? error.message
    : "HOSTED_OPERATION_STOPPED";
}
const csrfNames = new Set(["csrf_token", "csrfmiddlewaretoken", "authenticity_token", "_token"]);
const digestBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A fresh isolated context; no user cookies, saved storage, main-world metadata script or retries. */
export class PlaywrightHostedApplicationDriver implements HostedApplicationDriver {
  readonly adapterVersion = HOSTED_ADAPTER_VERSION;
  private browser: Browser | null = null;
  private denyingProxy: Server | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private capability: HostedCapability | null = null;
  private form: HostedForm | null = null;
  private controls: Locator[][] = [];
  private stage: "READ" | "MAP" | "FILL" | "UPLOAD" | "VERIFY" | "REVIEW" | "SUBMIT" = "READ";
  private fault: string | null = null;
  private requests = 0;
  private openedAt = 0;
  private pending = new Set<Promise<void>>();
  private packet: ApplicationPacket | null = null;
  private mapping: HostedMapping = [];
  private artifacts: readonly HostedVerifiedArtifact[] = [];
  private proofs: HostedUploadProof[] = [];
  private submitAttempted = false;
  private submitResponseConfirmed = false;
  private submitResponseDigest: string | null = null;
  private csrfValues = new Map<string, string>();

  constructor(
    private readonly options: {
      transport?: HostedHttpTransport;
      fictionalTransport?: boolean;
      now?: () => Date;
      onRequest?: (method: "GET" | "POST", stage: string) => void;
    } = {},
  ) {}

  private assertHealthy(): void {
    if (this.fault) throw new Error(this.fault);
    if (!this.capability || !this.page || this.page.isClosed())
      throw new Error("HOSTED_CONTEXT_LOST");
    const now = this.options.now?.().getTime() ?? Date.now();
    if (
      now >= Date.parse(this.capability.expiresAt) ||
      now - this.openedAt >= this.capability.sessionTimeoutMs
    )
      throw new Error("HOSTED_SESSION_EXPIRED");
  }

  private async route(route: Route): Promise<void> {
    try {
      this.assertHealthy();
      const capability = this.capability!;
      const request = route.request();
      const url = new URL(request.url());
      if (
        url.protocol !== "https:" ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error("HOSTED_DESTINATION_FORBIDDEN");
      const matches = (destination: { origin: string; path: string }) =>
        destination.origin === url.origin && destination.path === url.pathname;
      const method = request.method();
      const write = capability.allowedWrites.find(
        (value) => matches(value) && value.operation === this.stage,
      );
      if (method === "GET") {
        if (!capability.allowedReads.some(matches) || request.postDataBuffer())
          throw new Error("HOSTED_DESTINATION_FORBIDDEN");
      } else if (method !== "POST" || !write) throw new Error("HOSTED_METHOD_FORBIDDEN");
      const body = request.postDataBuffer();
      const headers = await request.allHeaders();
      if (body && body.length > 5_000_000) throw new Error("HOSTED_OUTGOING_CONTENT_CHANGED");
      if (method === "POST")
        await this.assertOutgoingBody(body, headers["content-type"] ?? "", this.stage === "SUBMIT");
      if (++this.requests > capability.requestBudget)
        throw new Error("HOSTED_REQUEST_BUDGET_EXHAUSTED");
      this.options.onRequest?.(method as "GET" | "POST", this.stage);
      const response = await (this.options.transport ?? pinnedHostedHttpTransport)({
        url,
        method: method as "GET" | "POST",
        headers,
        body,
        byteLimit: capability.responseByteLimit,
        timeoutMs: capability.requestTimeoutMs,
      });
      if (response.status >= 300 && response.status < 400)
        throw new Error("HOSTED_REDIRECT_FORBIDDEN");
      if (response.status === 429) throw new Error("HOSTED_RATE_LIMIT");
      if (response.status === 401) throw new Error("HOSTED_AUTHENTICATION_REQUIRED");
      if (response.status === 403) throw new Error("HOSTED_ACCESS_CONTROL");
      if (response.status < 200 || response.status >= 300) throw new Error("HOSTED_HTTP_FAILURE");
      if (response.body.length > capability.responseByteLimit)
        throw new Error("HOSTED_RESPONSE_TOO_LARGE");
      if (write?.operation === "UPLOAD") {
        if (write.acknowledgement !== "SHA256_JSON_ACK")
          throw new Error("HOSTED_UPLOAD_ACK_INVALID");
        let ack: unknown;
        try {
          ack = JSON.parse(response.body.toString("utf8"));
        } catch {
          throw new Error("HOSTED_UPLOAD_ACK_INVALID");
        }
        const value = ack as {
          digest?: unknown;
          byteLength?: unknown;
          acknowledgementId?: unknown;
        };
        const artifact = this.artifacts.find(
          (item) => item.digest === value?.digest && item.bytes.byteLength === value.byteLength,
        );
        if (
          !artifact ||
          typeof value.acknowledgementId !== "string" ||
          !/^[A-Za-z0-9_-]{1,100}$/.test(value.acknowledgementId)
        )
          throw new Error("HOSTED_UPLOAD_ACK_INVALID");
        this.proofs = this.proofs.filter((proof) => proof.documentId !== artifact.documentId);
        this.proofs.push({
          documentId: artifact.documentId,
          digest: artifact.digest,
          byteLength: artifact.bytes.byteLength,
          proof: "REMOTE_BYTES_VERIFIED",
          acknowledgementId: value.acknowledgementId,
        });
      }
      if (
        write?.operation === "SUBMIT" &&
        capability.confirmation &&
        matches(capability.confirmation) &&
        request.isNavigationRequest()
      ) {
        this.submitResponseConfirmed = true;
        this.submitResponseDigest = digestBytes(response.body);
      }
      await route.fulfill({
        status: response.status,
        headers: response.headers,
        body: response.body,
      });
    } catch (error) {
      this.fault = safeHostedError(error);
      await route.abort("blockedbyclient").catch(() => undefined);
    }
  }

  private async settled(): Promise<void> {
    await Promise.all([...this.pending]);
    this.assertHealthy();
  }

  async inspect(input: HostedCapability): Promise<HostedForm> {
    const capability = HostedCapabilitySchema.parse(input);
    if (this.browser || capability.scope !== "PASSIVE_INSPECTION")
      throw new Error("HOSTED_CONTEXT_LOST");
    if (capability.mode === "REAL" && (this.options.fictionalTransport || this.options.transport))
      throw new Error("HOSTED_DESTINATION_FORBIDDEN");
    this.capability = capability;
    this.openedAt = this.options.now?.().getTime() ?? Date.now();
    this.denyingProxy = createServer((_request, response) => {
      this.fault = "HOSTED_DESTINATION_FORBIDDEN";
      response.writeHead(403);
      response.end();
    });
    this.denyingProxy.on("connect", (_request, socket) => {
      this.fault = "HOSTED_DESTINATION_FORBIDDEN";
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
    await new Promise<void>((resolve) => this.denyingProxy!.listen(0, "127.0.0.1", resolve));
    const proxyPort = (this.denyingProxy.address() as { port: number }).port;
    this.browser = await chromium.launch({
      headless: true,
      args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
    });
    this.context = await this.browser.newContext({
      serviceWorkers: "block",
      javaScriptEnabled: false,
      proxy: { server: `http://127.0.0.1:${proxyPort}` },
      acceptDownloads: false,
    });
    this.page = await this.context.newPage();
    this.context.on("page", (page) => {
      if (page !== this.page) {
        this.fault = "HOSTED_UNSUPPORTED_CONTROL";
        void page.close();
      }
    });
    this.page.on("download", (download) => {
      this.fault = "HOSTED_UNSUPPORTED_CONTROL";
      void download.cancel();
    });
    this.page.on("crash", () => {
      this.fault = "HOSTED_CONTEXT_LOST";
    });
    await this.context.route("**/*", (route) => {
      const task = this.route(route);
      this.pending.add(task);
      return task.finally(() => {
        this.pending.delete(task);
      });
    });
    await this.page
      .goto(capability.subject.targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: capability.requestTimeoutMs,
      })
      .catch(() => {
        this.assertHealthy();
        throw new Error("HOSTED_CONTEXT_LOST");
      });
    await this.settled();
    const first = await this.snapshot(true);
    const second = await this.snapshot(true);
    if (hostedDigest(first) !== hostedDigest(second)) throw new Error("HOSTED_FORM_CHANGED");
    this.form = second;
    this.stage = "REVIEW";
    return second;
  }

  private async snapshot(initial = false): Promise<HostedForm> {
    this.assertHealthy();
    const page = this.page!;
    if (page.url() !== this.capability!.subject.targetUrl || page.frames().length !== 1)
      throw new Error("HOSTED_DESTINATION_CHANGED");
    if (
      await page
        .locator(
          'iframe, [role="combobox"], [role="listbox"], [contenteditable="true"], input[type="password"], [data-sitekey], #captcha, .g-recaptcha, .h-captcha',
        )
        .count()
    )
      throw new Error("HOSTED_BOT_PROTECTION");
    if (
      await page
        .getByText(/captcha|verify you are human|access denied|sign in to apply|rate limit/i)
        .count()
    )
      throw new Error("HOSTED_BOT_PROTECTION");
    const forms = page.locator("form");
    if ((await forms.count()) !== 1) throw new Error("HOSTED_UNSUPPORTED_CONTROL");
    const form = forms.first();
    if (
      (await form.getAttribute("novalidate")) !== null ||
      ![null, "", "_self"].includes(await form.getAttribute("target"))
    )
      throw new Error("HOSTED_UNSUPPORTED_CONTROL");
    const method = ((await form.getAttribute("method")) ?? "GET").toUpperCase();
    const encoding = (
      (await form.getAttribute("enctype")) ?? "application/x-www-form-urlencoded"
    ).toLowerCase();
    const action = new URL((await form.getAttribute("action")) ?? page.url(), page.url());
    if (
      method !== "POST" ||
      action.protocol !== "https:" ||
      action.username ||
      action.password ||
      action.port ||
      action.search ||
      action.hash
    )
      throw new Error("HOSTED_DESTINATION_CHANGED");
    const elements = form.locator("input,select,textarea,button");
    if (
      (await elements.count()) > 200 ||
      (await page.locator("input,select,textarea,button").count()) !== (await elements.count()) ||
      !["application/x-www-form-urlencoded", "multipart/form-data"].includes(encoding) ||
      (await form.locator("xpath=.//input|.//select|.//textarea|.//button").count()) !==
        (await elements.count())
    )
      throw new Error("HOSTED_UNSUPPORTED_CONTROL");
    const controls: HostedControl[] = [];
    const locators: Locator[][] = [];
    for (let index = 0; index < (await elements.count()); index++) {
      const element = elements.nth(index);
      const name = (await element.getAttribute("name")) ?? "";
      const id = (await element.getAttribute("id")) ?? "";
      const tag = (await element.locator("xpath=self::select").count())
        ? "select"
        : (await element.locator("xpath=self::textarea").count())
          ? "textarea"
          : (await element.locator("xpath=self::button").count())
            ? "button"
            : "input";
      const type =
        tag === "input"
          ? ((await element.getAttribute("type")) ?? "text").toLowerCase()
          : tag === "button"
            ? ((await element.getAttribute("type")) ?? "submit").toLowerCase()
            : tag;
      if (
        ![
          "text",
          "email",
          "tel",
          "url",
          "number",
          "textarea",
          "select",
          "checkbox",
          "radio",
          "file",
          "submit",
          "hidden",
        ].includes(type) ||
        name.length > 200 ||
        id.length > 200
      )
        throw new Error("HOSTED_UNSUPPORTED_CONTROL");
      if (
        (await element.getAttribute("formaction")) !== null ||
        (await element.getAttribute("formmethod")) !== null ||
        (await element.getAttribute("formenctype")) !== null ||
        (await element.getAttribute("formtarget")) !== null ||
        (await element.getAttribute("formnovalidate")) !== null ||
        (await element.getAttribute("form")) !== null ||
        (await element.getAttribute("multiple")) !== null ||
        (await element.isDisabled()) ||
        (await element.getAttribute("readonly")) !== null
      )
        throw new Error("HOSTED_UNSUPPORTED_CONTROL");
      if (type !== "hidden" && type !== "submit" && (!name || !(await element.isVisible())))
        throw new Error("HOSTED_UNSUPPORTED_CONTROL");
      if (type === "hidden" && !csrfNames.has(name)) throw new Error("HOSTED_UNSUPPORTED_CONTROL");
      if (type === "file" && encoding !== "multipart/form-data")
        throw new Error("HOSTED_UNSUPPORTED_CONTROL");
      const constraints: Record<string, string | null> = {};
      // Values of candidate inputs and CSRF tokens are verified separately, never fingerprints.
      for (const key of [
        "pattern",
        "min",
        "max",
        "step",
        "minlength",
        "maxlength",
        "wrap",
        "dir",
        "value",
      ])
        if (key !== "value" || ["submit", "checkbox", "radio"].includes(type))
          constraints[key] = await element.getAttribute(key);
      if (Object.values(constraints).some((value) => (value?.length ?? 0) > 1000))
        throw new Error("HOSTED_UNSUPPORTED_CONTROL");
      const constraintsDigest = hostedDigest(constraints);
      let label = (await element.getAttribute("aria-label")) ?? "";
      const wrapping = element.locator("xpath=ancestor::label[1]");
      if (!label && (await wrapping.count())) label = (await wrapping.textContent()) ?? "";
      if (!label && id)
        for (const candidate of await page.locator("label").all())
          if ((await candidate.getAttribute("for")) === id) {
            label = (await candidate.textContent()) ?? "";
            break;
          }
      label = label.trim();
      if (label.length > 500) throw new Error("HOSTED_UNSUPPORTED_CONTROL");
      const options: HostedControl["options"] = [];
      if (type === "select") {
        const optionElements = element.locator("option");
        if ((await optionElements.count()) > 100) throw new Error("HOSTED_UNSUPPORTED_CONTROL");
        for (const option of await optionElements.all()) {
          if (await option.isDisabled()) throw new Error("HOSTED_UNSUPPORTED_CONTROL");
          options.push({
            value: (await option.getAttribute("value")) ?? (await option.textContent()) ?? "",
            label: (await option.textContent()) ?? "",
          });
        }
      }
      if (type === "radio" || type === "checkbox")
        options.push({
          value: (await element.getAttribute("value")) ?? "on",
          label: label || name,
        });
      const required =
        (await element.getAttribute("required")) !== null ||
        (await element.getAttribute("aria-required")) === "true";
      const radioIndex =
        type === "radio"
          ? controls.findIndex((control) => control.type === "radio" && control.name === name)
          : -1;
      if (radioIndex >= 0) {
        controls[radioIndex]!.constraintsDigest = hostedDigest([
          controls[radioIndex]!.constraintsDigest,
          constraintsDigest,
        ]);
        controls[radioIndex]!.options.push(...options);
        controls[radioIndex]!.required ||= required;
        locators[radioIndex]!.push(element);
        continue;
      }
      if (
        name &&
        type !== "hidden" &&
        type !== "submit" &&
        controls.some((control) => control.name === name)
      )
        throw new Error("HOSTED_UNSUPPORTED_CONTROL");
      if (
        initial &&
        !["hidden", "submit", "file", "radio", "checkbox"].includes(type) &&
        (await element.inputValue()) !== ""
      )
        throw new Error("HOSTED_UNSUPPORTED_CONTROL");
      if (initial && ["radio", "checkbox"].includes(type) && (await element.isChecked()))
        throw new Error("HOSTED_UNSUPPORTED_CONTROL");
      controls.push({
        index: controls.length,
        name,
        label,
        type: type as HostedControl["type"],
        required,
        options,
        accept: (await element.getAttribute("accept")) ?? "",
        constraintsDigest,
      });
      locators.push([element]);
    }
    if (controls.filter((control) => control.type === "submit").length !== 1)
      throw new Error("HOSTED_UNSUPPORTED_CONTROL");
    this.controls = locators;
    return HostedFormSchema.parse({
      targetUrl: page.url(),
      action: action.href,
      method: "POST",
      encoding,
      controls,
    });
  }

  private async assertForm(): Promise<void> {
    await this.settled();
    if (!this.form || hostedDigest(await this.snapshot()) !== hostedDigest(this.form))
      throw new Error("HOSTED_FORM_CHANGED");
  }

  async map(
    input: HostedCapability,
    packet: ApplicationPacket,
    inputMapping: HostedMapping,
  ): Promise<void> {
    await this.assertForm();
    const capability = HostedCapabilitySchema.parse(input);
    if (
      capability.scope !== "APPLICATION" ||
      hostedDigest(capability.subject) !== hostedDigest(this.capability!.subject) ||
      hostedDigest(capability.build) !== hostedDigest(this.capability!.build) ||
      capability.mode !== this.capability!.mode ||
      capability.formDigest !== hostedDigest(this.form)
    )
      throw new Error("HOSTED_FORM_CHANGED");
    if (
      !capability.allowedWrites.some(
        (value) =>
          value.operation === "SUBMIT" && `${value.origin}${value.path}` === this.form!.action,
      )
    )
      throw new Error("HOSTED_DESTINATION_CHANGED");
    const mapping = HostedMappingSchema.parse(inputMapping);
    if (new Set(mapping.map((value) => value.controlIndex)).size !== mapping.length)
      throw new Error("HOSTED_UNSUPPORTED_CONTROL");
    for (const entry of mapping) {
      const control = this.form!.controls[entry.controlIndex];
      if (!control || control.type === "hidden" || control.type === "submit")
        throw new Error("HOSTED_UNSUPPORTED_CONTROL");
      if (entry.kind === "DOCUMENT") {
        if (
          control.type !== "file" ||
          !packet.documents.some(
            (document) => document.id === entry.documentId && document.approved && !document.stale,
          ) ||
          (control.accept &&
            !control.accept
              .split(",")
              .some((value) => [".pdf", "application/pdf"].includes(value.trim().toLowerCase())))
        )
          throw new Error("HOSTED_UNSUPPORTED_CONTROL");
      } else {
        const answer = packet.answers.find((value) => value.questionId === entry.questionId);
        if (
          control.type === "file" ||
          !answer ||
          !["VERIFIED_ANSWER", "OWNER_CHOICE"].includes(answer.truthState) ||
          answer.disclosureState !== "APPROVED" ||
          answer.value === null ||
          (control.type === "checkbox" && typeof answer.value !== "boolean") ||
          (["select", "radio"].includes(control.type) &&
            !control.options.some((option) => option.value === String(answer.value)))
        )
          throw new Error("HOSTED_UNSUPPORTED_CONTROL");
      }
    }
    for (const control of this.form!.controls.filter(
      (value) => value.required && value.type !== "hidden" && value.type !== "submit",
    )) {
      if (mapping.some((entry) => entry.controlIndex === control.index)) continue;
      // Native required children cannot be rewritten to pretend an alternative satisfies them.
      throw new Error("HOSTED_UNSUPPORTED_CONTROL");
    }
    this.capability = capability;
    this.packet = packet;
    this.mapping = mapping;
    this.stage = "MAP";
  }

  async fill(packet: ApplicationPacket, mapping: HostedMapping): Promise<void> {
    await this.assertForm();
    this.stage = "FILL";
    for (const entry of mapping)
      if (entry.kind === "ANSWER") {
        const answer = packet.answers.find((value) => value.questionId === entry.questionId)!;
        const control = this.form!.controls[entry.controlIndex]!;
        const elements = this.controls[entry.controlIndex]!;
        if (control.type === "checkbox")
          await elements[0]!.setChecked(answer.value === true, {
            timeout: this.capability!.requestTimeoutMs,
          });
        else if (control.type === "radio")
          await elements[
            control.options.findIndex((option) => option.value === String(answer.value))
          ]!.check({ timeout: this.capability!.requestTimeoutMs });
        else if (control.type === "select")
          await elements[0]!.selectOption(String(answer.value), {
            timeout: this.capability!.requestTimeoutMs,
          });
        else
          await elements[0]!.fill(String(answer.value), {
            timeout: this.capability!.requestTimeoutMs,
          });
        await this.settled();
      }
    this.stage = "REVIEW";
    await this.assertForm();
  }

  async upload(
    artifacts: readonly HostedVerifiedArtifact[],
    mapping: HostedMapping,
  ): Promise<HostedUploadProof[]> {
    await this.assertForm();
    this.artifacts = artifacts;
    this.stage = "UPLOAD";
    for (const entry of mapping)
      if (entry.kind === "DOCUMENT") {
        const artifact = artifacts.find((value) => value.documentId === entry.documentId);
        if (
          !artifact ||
          digestBytes(artifact.bytes) !== artifact.digest ||
          artifact.mimeType !== "application/pdf" ||
          artifact.bytes.byteLength > 5_000_000
        )
          throw new Error("HOSTED_OUTGOING_CONTENT_CHANGED");
        this.proofs.push({
          documentId: artifact.documentId,
          digest: artifact.digest,
          byteLength: artifact.bytes.byteLength,
          proof: "LOCAL_ATTACHED",
          acknowledgementId: null,
        });
        await this.controls[entry.controlIndex]![0]!.setInputFiles(
          {
            name: artifact.fileName,
            mimeType: artifact.mimeType,
            buffer: Buffer.from(artifact.bytes),
          },
          { timeout: this.capability!.requestTimeoutMs },
        );
        await this.settled();
      }
    this.stage = "REVIEW";
    if (
      this.capability!.remoteUploadProofRequired &&
      this.proofs.some((value) => value.proof !== "REMOTE_BYTES_VERIFIED")
    )
      throw new Error("HOSTED_UPLOAD_ACK_INVALID");
    await this.assertForm();
    return this.proofs.map((value) => ({ ...value }));
  }

  async verify(
    packet: ApplicationPacket,
    mapping: HostedMapping,
    proofs: readonly HostedUploadProof[],
  ): Promise<{ valuesDigest: string; uploadsDigest: string }> {
    await this.assertForm();
    this.stage = "VERIFY";
    const values: { index: number; value: unknown }[] = [];
    for (const entry of mapping) {
      const control = this.form!.controls[entry.controlIndex]!;
      if (entry.kind === "ANSWER") {
        const answer = packet.answers.find((value) => value.questionId === entry.questionId)!;
        const elements = this.controls[entry.controlIndex]!;
        let observed: unknown;
        if (control.type === "checkbox") observed = await elements[0]!.isChecked();
        else if (control.type === "radio") {
          const checked: number[] = [];
          for (const [index, element] of elements.entries())
            if (await element.isChecked()) checked.push(index);
          if (checked.length !== 1) throw new Error("HOSTED_OUTGOING_CONTENT_CHANGED");
          observed = control.options[checked[0]!]!.value;
        } else observed = await elements[0]!.inputValue();
        if (observed !== (typeof answer.value === "boolean" ? answer.value : String(answer.value)))
          throw new Error("HOSTED_OUTGOING_CONTENT_CHANGED");
        values.push({ index: entry.controlIndex, value: observed });
      } else {
        const artifact = this.artifacts.find((value) => value.documentId === entry.documentId);
        const proof = proofs.find((value) => value.documentId === entry.documentId);
        // Attachment is local evidence only. Exact remote bytes are validated separately at approved writes.
        if (
          !artifact ||
          !proof ||
          proof.digest !== artifact.digest ||
          proof.byteLength !== artifact.bytes.byteLength ||
          digestBytes(artifact.bytes) !== artifact.digest ||
          (this.capability!.remoteUploadProofRequired && proof.proof !== "REMOTE_BYTES_VERIFIED")
        )
          throw new Error("HOSTED_UPLOAD_ACK_INVALID");
        const observed = await this.attachedFile(control.index);
        if (
          observed.digest !== artifact.digest ||
          observed.byteLength !== artifact.bytes.byteLength ||
          observed.name !== artifact.fileName ||
          observed.type !== artifact.mimeType
        )
          throw new Error("HOSTED_UPLOAD_ACK_INVALID");
      }
    }
    this.stage = "REVIEW";
    await this.assertForm();
    await this.assertNativeValidity();
    return { valuesDigest: hostedDigest(values), uploadsDigest: hostedDigest(proofs) };
  }

  /** Read native validity in an isolated world without firing invalid events or enabling page scripts. */
  private async assertNativeValidity(): Promise<void> {
    const cdp = await this.context!.newCDPSession(this.page!);
    try {
      const tree = await cdp.send("Page.getFrameTree");
      const world = await cdp.send("Page.createIsolatedWorld", {
        frameId: tree.frameTree.frame.id,
        worldName: "applypilot-native-validity",
      });
      const result = await cdp.send("Runtime.evaluate", {
        contextId: world.executionContextId,
        returnByValue: true,
        timeout: this.capability!.requestTimeoutMs,
        expression:
          "document.forms.length === 1 && Array.from(document.forms[0].elements).every(element => !element.willValidate || element.validity.valid)",
      });
      if (result.exceptionDetails || result.result.value !== true) throw new Error();
    } catch {
      throw new Error("HOSTED_NATIVE_VALIDATION_FAILED");
    } finally {
      await cdp.detach();
    }
  }

  /** Fixed read-only byte inspection in Chromium's isolated world, outside employer JS prototypes. */
  private async attachedFile(
    controlIndex: number,
  ): Promise<{ digest: string; byteLength: number; name: string; type: string }> {
    const cdp = await this.context!.newCDPSession(this.page!);
    try {
      const tree = await cdp.send("Page.getFrameTree");
      const world = await cdp.send("Page.createIsolatedWorld", {
        frameId: tree.frameTree.frame.id,
        worldName: "applypilot-file-proof",
      });
      const document = await cdp.send("DOM.getDocument");
      const nodes = await cdp.send("DOM.querySelectorAll", {
        nodeId: document.root.nodeId,
        selector: "form input[type=file]",
      });
      const fileIndex = this.form!.controls.filter((value) => value.type === "file").findIndex(
        (value) => value.index === controlIndex,
      );
      if (fileIndex < 0 || !nodes.nodeIds[fileIndex]) throw new Error();
      const object = await cdp.send("DOM.resolveNode", {
        nodeId: nodes.nodeIds[fileIndex]!,
        executionContextId: world.executionContextId,
      });
      const result = await cdp.send("Runtime.callFunctionOn", {
        objectId: object.object.objectId!,
        returnByValue: true,
        awaitPromise: true,
        functionDeclaration:
          "async function(){ const files=this.files; if(!files || files.length!==1 || files[0].size>5000000) return null; const file=files[0]; const bytes=await File.prototype.arrayBuffer.call(file); const hash=await crypto.subtle.digest('SHA-256',bytes); return {digest:Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join(''),byteLength:bytes.byteLength,name:file.name,type:file.type}; }",
      });
      const value = result.result.value as {
        digest?: unknown;
        byteLength?: unknown;
        name?: unknown;
        type?: unknown;
      } | null;
      if (
        result.exceptionDetails ||
        !value ||
        typeof value.digest !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.digest) ||
        typeof value.byteLength !== "number" ||
        typeof value.name !== "string" ||
        value.name.length > 200 ||
        typeof value.type !== "string"
      )
        throw new Error();
      return value as { digest: string; byteLength: number; name: string; type: string };
    } catch {
      throw new Error("HOSTED_UPLOAD_ACK_INVALID");
    } finally {
      await cdp.detach();
    }
  }

  private async assertOutgoingBody(
    body: Buffer | null,
    contentType: string,
    submission: boolean,
  ): Promise<void> {
    if (!body || !this.packet || !this.form) throw new Error("HOSTED_OUTGOING_CONTENT_CHANGED");
    let data: FormData;
    try {
      data = await new Response(new Uint8Array(body), {
        headers: { "content-type": contentType },
      }).formData();
    } catch {
      throw new Error("HOSTED_OUTGOING_CONTENT_CHANGED");
    }
    const seen = new Set<string>();
    for (const [name, value] of data.entries()) {
      if (seen.has(name)) throw new Error("HOSTED_OUTGOING_CONTENT_CHANGED");
      seen.add(name);
      const control = this.form.controls.find((item) => item.name === name);
      if (!control) throw new Error("HOSTED_OUTGOING_CONTENT_CHANGED");
      if (control.type === "hidden" && csrfNames.has(name)) {
        if (!submission || typeof value !== "string" || value !== this.csrfValues.get(name))
          throw new Error("HOSTED_OUTGOING_CONTENT_CHANGED");
        continue;
      }
      if (control.type === "submit" && typeof value === "string" && value.length <= 200) continue;
      const entry = this.mapping.find((item) => item.controlIndex === control.index);
      if (!entry) {
        if (typeof value === "string" && value === "" && !control.required) continue;
        if (value instanceof File && value.size === 0 && !control.required) continue;
        throw new Error("HOSTED_OUTGOING_CONTENT_CHANGED");
      }
      if (entry.kind === "DOCUMENT") {
        const artifact = this.artifacts.find((item) => item.documentId === entry.documentId);
        if (
          !(value instanceof File) ||
          !artifact ||
          value.type !== "application/pdf" ||
          value.name !== artifact.fileName ||
          value.size !== artifact.bytes.byteLength ||
          digestBytes(new Uint8Array(await value.arrayBuffer())) !== artifact.digest
        )
          throw new Error("HOSTED_OUTGOING_CONTENT_CHANGED");
      } else {
        if (!submission || typeof value !== "string")
          throw new Error("HOSTED_OUTGOING_CONTENT_CHANGED");
        const answer = this.packet.answers.find((item) => item.questionId === entry.questionId)!;
        const expected =
          control.type === "checkbox"
            ? answer.value
              ? control.options[0]!.value
              : null
            : String(answer.value);
        if (value !== expected) throw new Error("HOSTED_OUTGOING_CONTENT_CHANGED");
      }
    }
    const expectedEntries = this.mapping.filter((entry) => submission || entry.kind === "DOCUMENT");
    for (const entry of expectedEntries) {
      const control = this.form.controls[entry.controlIndex]!;
      const unchecked =
        entry.kind === "ANSWER" &&
        control.type === "checkbox" &&
        this.packet.answers.find((item) => item.questionId === entry.questionId)?.value === false;
      if (!unchecked && !seen.has(control.name)) throw new Error("HOSTED_OUTGOING_CONTENT_CHANGED");
    }
  }

  async submit(): Promise<{
    state: "CONFIRMED_SUBMITTED" | "OUTCOME_UNKNOWN";
    confirmationDigest: string | null;
    safeStopCode: string | null;
  }> {
    if (this.submitAttempted) throw new Error("HOSTED_CONTEXT_LOST");
    await this.assertForm();
    await this.assertNativeValidity();
    this.csrfValues.clear();
    for (const control of this.form!.controls.filter((value) => value.type === "hidden"))
      this.csrfValues.set(control.name, await this.controls[control.index]![0]!.inputValue());
    this.submitAttempted = true;
    this.stage = "SUBMIT";
    try {
      const submit = this.form!.controls.find((value) => value.type === "submit")!;
      await this.controls[submit.index]![0]!.click({
        timeout: this.capability!.requestTimeoutMs,
        noWaitAfter: false,
      });
      await this.page!.waitForLoadState("domcontentloaded", {
        timeout: this.capability!.requestTimeoutMs,
      });
      await this.settled();
      const confirmation = this.capability!.confirmation!;
      const observed = new URL(this.page!.url());
      if (
        !this.submitResponseConfirmed ||
        observed.origin !== confirmation.origin ||
        observed.pathname !== confirmation.path ||
        observed.search ||
        observed.hash ||
        (await this.page!.locator(confirmation.selector).count()) !== 1 ||
        (await this.page!.locator(confirmation.selector).textContent())?.trim() !==
          confirmation.expectedText ||
        (await this.page!.locator("form").count())
      )
        return {
          state: "OUTCOME_UNKNOWN",
          confirmationDigest: null,
          safeStopCode: "HOSTED_CONFIRMATION_UNPROVEN",
        };
      return {
        state: "CONFIRMED_SUBMITTED",
        confirmationDigest: hostedDigest({
          responseDigest: this.submitResponseDigest,
          destination: this.page!.url(),
          contract: confirmation,
        }),
        safeStopCode: null,
      };
    } catch (error) {
      return {
        state: "OUTCOME_UNKNOWN",
        confirmationDigest: null,
        safeStopCode:
          this.fault ??
          (error instanceof Error && error.name === "TimeoutError"
            ? error.message.includes("waiting for scheduled navigations")
              ? "HOSTED_NAVIGATION_TIMEOUT"
              : "HOSTED_ACTION_TIMEOUT"
            : safeHostedError(error)),
      };
    } finally {
      this.stage = "REVIEW";
    }
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = null;
    this.context = null;
    this.browser = null;
    if (this.denyingProxy) {
      this.denyingProxy.closeAllConnections();
      await new Promise<void>((resolve) => this.denyingProxy!.close(() => resolve()));
      this.denyingProxy = null;
    }
  }
}
