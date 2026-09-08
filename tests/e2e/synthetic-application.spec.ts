import { expect, test } from "@playwright/test";

import {
  ApplicationPacketSchema,
  SyntheticApplicationRunner,
  packetDigest,
} from "@applypilot/application-runner";

test("exposes every synthetic stop fixture only on loopback", async ({ page }) => {
  let externalRequest = false;
  await page.route("https://**", async (route) => {
    externalRequest = true;
    await route.abort();
  });
  for (const [fixture, reason] of [
    ["captcha", "CAPTCHA"],
    ["mfa", "MFA"],
    ["auth-required", "AUTHENTICATION_REQUIRED"],
    ["access-denied", "ACCESS_CONTROL"],
    ["rate-limit", "RATE_LIMIT"],
  ] as const) {
    await page.goto(`/synthetic-application?case=${fixture}`);
    await expect(page.locator(`[data-stop-reason="${reason}"]`)).toBeVisible();
  }
  expect(externalRequest).toBe(false);
});

test("exposes changed and unsupported controls and bounded response outcomes", async ({ page }) => {
  await page.goto("/synthetic-application?case=changed-field");
  await expect(page.locator('[data-form-change="FIELD_ADDED"]')).toBeVisible();
  await page.goto("/synthetic-application?case=unsupported-control");
  await expect(page.locator("[data-unsupported-control]")).toBeVisible();

  for (const [fixture, status, reason] of [
    ["http-401", 401, "AUTHENTICATION_REQUIRED"],
    ["http-403", 403, "ACCESS_CONTROL"],
    ["http-429", 429, "RATE_LIMIT"],
  ] as const) {
    const response = await page.request.post(`/synthetic-application/submit?case=${fixture}`, {
      headers: { origin: "http://127.0.0.1:3100" },
      multipart: { formVersion: "synthetic-form-v1" },
    });
    expect(response.status()).toBe(status);
    expect(await response.json()).toEqual({ status: "PAUSED", reason });
  }

  const started = Date.now();
  const slow = await page.request.post("/synthetic-application/submit?case=slow-response", {
    headers: { origin: "http://127.0.0.1:3100" },
    multipart: { formVersion: "synthetic-form-v1" },
  });
  expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  expect(slow.ok()).toBe(true);

  const receipt = await page.request.post("/synthetic-application/submit?case=success-receipt", {
    headers: { origin: "http://127.0.0.1:3100" },
    multipart: { formVersion: "synthetic-form-v1" },
  });
  expect(await receipt.json()).toMatchObject({
    status: "SYNTHETIC_SUBMITTED",
    receipt: "fixture-receipt-001",
  });
});

test("submits exactly the fictional local simple form", async ({ page }) => {
  await page.goto("/synthetic-application?case=simple");
  await page.getByLabel("Fictional applicant name").fill("Casey Example");
  await page.getByLabel("Fictional contact email").fill("casey@example.test");
  await page.getByRole("button", { name: "Submit fictional fixture" }).click();
  await expect(page.getByText(/SYNTHETIC_SUBMITTED/)).toBeVisible();
});

test("represents unknown, changed-action, document, redirect, and lost-response cases", async ({
  page,
}) => {
  await page.goto("/synthetic-application?case=required-unknown");
  await expect(page.locator('[data-answer-state="UNKNOWN"]')).toBeVisible();
  await page.goto("/synthetic-application?case=different-action");
  await expect(page.locator("form")).toHaveAttribute(
    "data-expected-action",
    "/synthetic-application/unexpected",
  );
  await page.goto("/synthetic-application?case=document-upload");
  await expect(page.getByLabel("Approved synthetic document")).toBeVisible();
  await expect(page.locator('[data-final-review="fictional-frozen-packet"]')).toContainText(
    "Exact approved fixture mapping",
  );
  await page.goto("/synthetic-application?case=changed-page");
  await expect(page.locator('[data-synthetic-fixture="changed-page"]')).toHaveAttribute(
    "data-form-version",
    "synthetic-form-v2",
  );
  const response = await page.request.post("/synthetic-application/submit?case=lost-response", {
    headers: { origin: "http://127.0.0.1:3100" },
    multipart: {
      formVersion: "synthetic-form-v1",
      applicantName: "Example",
      contactEmail: "example@example.test",
    },
  });
  expect(response.status()).toBe(504);
  expect(await response.json()).toEqual({ status: "OUTCOME_UNKNOWN" });
});

test("executes one consent-bound synthetic browser submission without retry", async ({ page }) => {
  const documentBytes = Buffer.from("fictional approved document");
  const digest = (await import("node:crypto"))
    .createHash("sha256")
    .update(documentBytes)
    .digest("hex");
  const packet = ApplicationPacketSchema.parse({
    id: "packet:e2e",
    jobId: "job:e2e",
    jobVersionId: "job-version:e2e",
    profileVersionId: "profile-version:e2e",
    evaluationVersionId: "evaluation:e2e",
    eligibilityStatus: "ELIGIBLE",
    targetUrl: "http://127.0.0.1:3100/synthetic-application?case=document-upload",
    targetHost: "127.0.0.1",
    jobExpiryState: "ACTIVE",
    duplicateState: "CLEAR",
    versionsCurrent: true,
    documents: [
      {
        id: "document:e2e",
        type: "CV",
        fileName: "fictional-approved.txt",
        digest,
        approved: true,
        stale: false,
        required: true,
      },
    ],
    answers: [
      {
        questionId: "applicantName",
        questionText: "Fictional applicant name",
        required: true,
        sensitive: false,
        value: "Casey Example",
        truthState: "VERIFIED_ANSWER",
        disclosureState: "APPROVED",
        factReferences: ["fictional:name"],
      },
      {
        questionId: "contactEmail",
        questionText: "Fictional contact email",
        required: true,
        sensitive: false,
        value: "casey@example.test",
        truthState: "VERIFIED_ANSWER",
        disclosureState: "APPROVED",
        factReferences: ["fictional:email"],
      },
    ],
  });
  const runner = new SyntheticApplicationRunner(packet, "synthetic-form-v1");
  let submitRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/synthetic-application/submit")) {
      submitRequests += 1;
    }
  });
  await page.goto(packet.targetUrl!);
  runner.open();
  expect(await page.locator("[data-form-version]").getAttribute("data-form-version")).toBe(
    "synthetic-form-v1",
  );
  runner.map();
  await page.getByLabel("Fictional applicant name").fill("Casey Example");
  await page.getByLabel("Fictional contact email").fill("casey@example.test");
  await page.getByLabel("Approved synthetic document").setInputFiles({
    name: "fictional-approved.txt",
    mimeType: "text/plain",
    buffer: documentBytes,
  });
  runner.fill({ host: "127.0.0.1", formVersion: "synthetic-form-v1", documentDigests: [digest] });
  runner.readyForFinalReview();
  const consent = runner.createConsent();
  await page.getByRole("button", { name: "Submit fictional fixture" }).click();
  const submitted = runner.submitSynthetic({
    token: consent.token,
    packetDigest: packetDigest(packet),
    targetHost: "127.0.0.1",
    formVersion: "synthetic-form-v1",
  });
  expect(submitted.state).toBe("SYNTHETIC_SUBMITTED");
  expect(runner.snapshot().irreversibleClicks).toBe(1);
  expect(submitRequests).toBe(1);
  expect(() =>
    runner.submitSynthetic({
      token: consent.token,
      packetDigest: packetDigest(packet),
      targetHost: "127.0.0.1",
      formVersion: "synthetic-form-v1",
    }),
  ).toThrow("RUN_TERMINAL");
  expect(submitRequests).toBe(1);
});
