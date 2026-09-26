import { createHash } from "node:crypto";

import type { Browser, Page } from "playwright";

import {
  TargetObservationSchema,
  type FrozenRunnerBinding,
  type NonSubmitTargetAdapter,
  type TargetObservation,
} from "./target-runner";
import type { ApplicationPacket } from "./beta";

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertLoopback(binding: FrozenRunnerBinding): void {
  const target = new URL(binding.targetUrl);
  const origin = new URL(binding.targetOrigin);
  if (
    !["127.0.0.1", "localhost"].includes(target.hostname) ||
    target.origin !== origin.origin ||
    target.pathname !== binding.targetPath ||
    target.username ||
    target.password
  ) {
    throw new Error("LOOPBACK_TARGET_REQUIRED");
  }
}

export interface LoopbackNonSubmitAdapterOptions {
  documentBytes: Readonly<Record<string, Uint8Array>>;
  uploadPath?: string;
  operationKey?: string;
  browser?: Browser;
}

/**
 * Browser-backed adapter used only with an explicitly loopback target. It
 * performs real DOM reads/writes and a bounded fixture upload, while refusing
 * all non-loopback destinations and never exposing a submit method.
 */
export class LoopbackNonSubmitAdapter implements NonSubmitTargetAdapter {
  readonly targetKind = "SYNTHETIC_LOCAL" as const;
  private page: Page | null = null;
  private ownedBrowser: Browser | null = null;
  private readonly uploadPath: string;
  private readonly operationKey: string;

  constructor(private readonly options: LoopbackNonSubmitAdapterOptions) {
    this.uploadPath = options.uploadPath ?? "/__fixture_upload";
    this.operationKey = options.operationKey ?? "fixture-operation";
    if (!this.uploadPath.startsWith("/")) throw new Error("LOOPBACK_UPLOAD_PATH_INVALID");
  }

  async close(): Promise<void> {
    await this.page?.context().close();
    this.page = null;
    if (this.ownedBrowser) await this.ownedBrowser.close();
    this.ownedBrowser = null;
  }

  async map(packet: ApplicationPacket, binding: FrozenRunnerBinding): Promise<TargetObservation> {
    const page = await this.ensurePage(binding);
    const controls = await page.locator("[data-question-id]").count();
    if (controls !== packet.answers.length) throw new Error("UNSUPPORTED_CONTROL");
    return this.observation(binding, page, []);
  }

  async fill(packet: ApplicationPacket, binding: FrozenRunnerBinding): Promise<TargetObservation> {
    const page = await this.ensurePage(binding);
    for (const answer of packet.answers) {
      if (answer.required && answer.truthState === "UNKNOWN")
        throw new Error("UNKNOWN_REQUIRED_ANSWER");
      const control = page.locator(`[data-question-id=${JSON.stringify(answer.questionId)}]`);
      if ((await control.count()) !== 1) throw new Error("UNSUPPORTED_CONTROL");
      if (answer.value === null) throw new Error("UNKNOWN_REQUIRED_ANSWER");
      await control.fill(String(answer.value));
    }
    return this.observation(binding, page, await this.readBack(page));
  }

  async upload(
    packet: ApplicationPacket,
    binding: FrozenRunnerBinding,
  ): Promise<TargetObservation> {
    const page = await this.ensurePage(binding);
    const document = packet.documents.find(
      ({ required, approved, stale }) => required && approved && !stale,
    );
    if (!document) throw new Error("APPROVED_CURRENT_CV_REQUIRED");
    const bytes = this.options.documentBytes[document.digest];
    if (!bytes) throw new Error("DOCUMENT_BYTES_UNAVAILABLE");
    const input = page.locator(`[data-document-id=${JSON.stringify(document.id)}]`);
    if ((await input.count()) !== 1) throw new Error("UNSUPPORTED_CONTROL");
    await input.setInputFiles({
      name: document.fileName,
      mimeType: "application/pdf",
      buffer: Buffer.from(bytes),
    });
    const uploadButton = page.locator("[data-action=upload]");
    if ((await uploadButton.count()) !== 1) throw new Error("UNSUPPORTED_CONTROL");
    await uploadButton.click();
    await page.waitForFunction(
      () =>
        Boolean(
          globalThis.document.querySelector("[data-upload-ack]")?.getAttribute("data-upload-ack"),
        ),
      undefined,
      { timeout: 5_000 },
    );
    return this.observation(binding, page, [], {
      documentId: document.id,
      digest: document.digest,
    });
  }

  async verify(
    packet: ApplicationPacket,
    binding: FrozenRunnerBinding,
  ): Promise<TargetObservation> {
    const page = await this.ensurePage(binding);
    const fieldReadBack = await this.readBack(page);
    const expected = packet.answers.map(({ questionId, value }) => ({ questionId, value }));
    if (JSON.stringify(fieldReadBack) !== JSON.stringify(expected)) throw new Error("FORM_CHANGED");
    const document = packet.documents.find(
      ({ required, approved, stale }) => required && approved && !stale,
    );
    if (!document) throw new Error("APPROVED_CURRENT_CV_REQUIRED");
    return this.observation(binding, page, fieldReadBack, {
      documentId: document.id,
      digest: document.digest,
    });
  }

  async fillPreview(
    packet: ApplicationPacket,
    binding: FrozenRunnerBinding,
  ): Promise<TargetObservation> {
    const page = await this.ensurePage(binding);
    const fieldReadBack = await this.readBack(page);
    const acknowledgementId = await page
      .locator("[data-upload-ack]")
      .getAttribute("data-upload-ack");
    if (!acknowledgementId) throw new Error("UPLOAD_OUTCOME_UNKNOWN");
    const previewDigest = sha256(
      JSON.stringify({
        targetUrl: binding.targetUrl,
        formVersion: binding.formVersion,
        fields: fieldReadBack,
        acknowledgementId,
      }),
    );
    return TargetObservationSchema.parse({
      ...(await this.observation(binding, page, fieldReadBack)),
      previewDigest,
    });
  }

  private async ensurePage(binding: FrozenRunnerBinding): Promise<Page> {
    assertLoopback(binding);
    if (this.page) return this.page;
    const browser =
      this.options.browser ??
      (await (await import("playwright")).chromium.launch({ headless: true }));
    if (!this.options.browser) this.ownedBrowser = browser;
    const context = await browser.newContext();
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const targetPath = new URL(binding.targetUrl).pathname;
      const allowed =
        url.origin === new URL(binding.targetOrigin).origin &&
        ((url.pathname === targetPath && route.request().method() === "GET") ||
          (url.pathname === this.uploadPath && route.request().method() === "POST"));
      if (!allowed) return route.abort("blockedbyclient");
      return route.continue();
    });
    this.page = await context.newPage();
    await this.page.goto(binding.targetUrl, { waitUntil: "domcontentloaded" });
    const metadata = await this.page
      .locator("[data-form-version]")
      .getAttribute("data-form-version");
    if (metadata !== binding.formVersion) throw new Error("FORM_CHANGED");
    return this.page;
  }

  private async readBack(page: Page) {
    return page.locator("[data-question-id]").evaluateAll((elements) =>
      elements.map((element) => ({
        questionId: element.getAttribute("data-question-id") ?? "",
        value: (element as HTMLInputElement).value,
      })),
    );
  }

  private async observation(
    binding: FrozenRunnerBinding,
    page: Page,
    fieldReadBack: ReadonlyArray<{ questionId: string; value: string | number | boolean | null }>,
    document?: { documentId: string; digest: string },
  ): Promise<TargetObservation> {
    const upload = document
      ? await page.locator("[data-upload-ack]").evaluate(
          (element, expected) => ({
            documentId: expected.documentId,
            expectedDigest: expected.digest,
            receivedDigest: element.getAttribute("data-received-digest") ?? "",
            acknowledgementId: element.getAttribute("data-upload-ack") ?? "",
          }),
          document,
        )
      : null;
    return TargetObservationSchema.parse({
      targetUrl: binding.targetUrl,
      formVersion: binding.formVersion,
      adapterVersion: binding.adapterVersion,
      documentDigests: upload?.receivedDigest ? [upload.receivedDigest] : [],
      protectionSignals: [],
      fieldReadBack,
      uploadEvidence: upload,
      previewDigest: null,
    });
  }
}
