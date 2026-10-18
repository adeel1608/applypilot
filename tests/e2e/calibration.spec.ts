import { randomUUID } from "node:crypto";
import { resolve, basename } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { expect, test } from "@playwright/test";
import { SourceCapabilityV2Schema } from "@applypilot/job-sources";
import { SourceEnablementRepository, runLeverSourceToQueue } from "@applypilot/database";

/** Existing shared fictional runner database only; these markers are checked before any fixture write. */
function fictionalDatabase() {
  const path = resolve("data/applypilot.e2e.sqlite");
  if (basename(path) !== "applypilot.e2e.sqlite")
    throw new Error("FICTIONAL_CALIBRATION_PATH_REQUIRED");
  const sqlite = new BetterSqlite3(path, { fileMustExist: true });
  sqlite.pragma("foreign_keys=ON");
  const profile = sqlite
    .prepare("SELECT id,active_version_id FROM candidate_profiles")
    .all() as Array<{ id: string; active_version_id: string }>;
  if (
    sqlite.pragma("user_version", { simple: true }) !== 15 ||
    profile.length !== 1 ||
    profile[0]!.id !== "profile:e2e" ||
    profile[0]!.active_version_id !== "profile-version:e2e"
  ) {
    sqlite.close();
    throw new Error("FICTIONAL_CALIBRATION_DATABASE_REQUIRED");
  }
  return sqlite;
}

async function seedRetainedFictionalJobs(sqlite: BetterSqlite3.Database): Promise<string[]> {
  const existing = sqlite
    .prepare(
      "SELECT DISTINCT job_id FROM source_observations WHERE source='LEVER' AND tenant='fictional-calibration-browser' ORDER BY job_id",
    )
    .pluck()
    .all() as string[];
  if (existing.length === 2) return existing;
  if (existing.length !== 0) throw new Error("FICTIONAL_CALIBRATION_SOURCE_INCOMPLETE");
  const at = new Date().toISOString(),
    expires = new Date(Date.now() + 86400000).toISOString();
  const cap = SourceCapabilityV2Schema.parse({
    schemaVersion: 2,
    capabilityId: "source-fictional-calibration-browser",
    version: 1,
    predecessorVersion: null,
    source: "LEVER",
    alias: "Fictional Calibration Browser",
    tenant: "fictional-calibration-browser",
    region: "GLOBAL",
    allowedHost: "api.lever.co",
    allowedPathPrefix: "/v0/postings/fictional-calibration-browser",
    allowedOperations: ["LIST_JOBS"],
    approvalState: "APPROVED",
    approvalReference: "fictional-browser-owner",
    approvedAt: at,
    policyVersion: "fictional-browser-1",
    policyReviewedAt: at,
    policyExpiresAt: expires,
    capabilityExpiresAt: expires,
    requestBudget: 1,
    recordCap: 10,
    pageSizeCap: 10,
    responseByteLimit: 100000,
    requestTimeoutMs: 1000,
    runTimeoutMs: 10000,
    maxRedirects: 0,
    maxRetries: 0,
    maxConcurrency: 1,
    parserVersion: "lever-v2-browser-fixture",
    createdAt: at,
    updatedAt: at,
    revokedAt: null,
    revocationReason: null,
  });
  const repository = new SourceEnablementRepository(sqlite);
  repository.persistCapabilityVersion(cap);
  const gate = (action: "SOURCE_CAPABILITY_APPROVE" | "SOURCE_RUN_START") => ({
    action,
    consumedAt: at,
    loopbackValidated: true as const,
    localSessionValidated: true as const,
    nonceConsumed: true as const,
  });
  repository.recordOwnerApprovalReceipt({
    capability: cap,
    gateProof: gate("SOURCE_CAPABILITY_APPROVE"),
    ownerConfirmed: true,
  });
  const receipts = repository.createOwnerStartReceipt({
    capability: cap,
    operation: "LIST_JOBS",
    gateProof: gate("SOURCE_RUN_START"),
    ownerConfirmed: true,
  });
  const payload = ["alpha", "beta"].map((id) => ({
    id: `fictional-${id}`,
    text: `Fictional Calibration ${id}`,
    hostedUrl: `https://jobs.lever.co/fictional-calibration-browser/fictional-${id}`,
    applyUrl: `https://jobs.lever.co/fictional-calibration-browser/fictional-${id}/apply`,
    descriptionPlain:
      "Fictional retained customer support duties. Source text <img src='https://foreign.invalid/canary'> stays inert.",
    categories: {
      location: "Melbourne VIC",
      allLocations: ["Melbourne VIC"],
      commitment: "Part-time",
    },
    lists: [{ text: "Requirements", content: "<p>Customer service skills are required.</p>" }],
    createdAt: Date.now(),
  }));
  const result = await runLeverSourceToQueue({
    capability: cap,
    repository,
    ownerReceiptChain: receipts,
    evaluateJob: async () => null,
    queueJob: () => {},
    dependencies: {
      resolveHost: async () => ["8.8.8.8"],
      request: async ({ pinnedAddress }) => ({
        status: 200,
        headers: { "content-type": "application/json", "content-encoding": "identity" },
        body: Buffer.from(JSON.stringify(payload)),
        connectedAddress: pinnedAddress,
      }),
    },
  });
  if (result.status !== "COMPLETE") throw new Error("FICTIONAL_CALIBRATION_SOURCE_FAILED");
  return sqlite
    .prepare(
      "SELECT DISTINCT job_id FROM source_observations WHERE source='LEVER' AND tenant='fictional-calibration-browser' ORDER BY job_id",
    )
    .pluck()
    .all() as string[];
}

test("owner calibration precommits blank policy and records only explicit fictional label and pair actions", async ({
  page,
}) => {
  const sqlite = fictionalDatabase();
  try {
    const jobIds = await seedRetainedFictionalJobs(sqlite),
      posts: string[] = [],
      remote: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST") posts.push(r.url());
      if (new URL(r.url()).hostname === "foreign.invalid") remote.push(r.url());
    });
    await page.goto("/local-session?returnTo=/calibration");
    await expect(
      page.getByRole("heading", { name: "Matching calibration", exact: true }),
    ).toBeVisible();
    for (const jobId of jobIds) {
      const choice = page.locator(`input[name="job"][value="${jobId}"]`);
      await expect(choice).toBeEnabled();
      await expect(choice).not.toBeChecked();
      await choice.check();
    }
    await page.getByRole("button", { name: "Preview selected corpus", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Precommit comparison thresholds" }),
    ).toBeVisible();
    for (const name of [
      "thresholdVersion",
      "minimumLabelAgreementBasisPoints",
      "minimumPairComparisons",
      "minimumPairAgreementBasisPoints",
    ])
      await expect(page.locator(`input[name="${name}"]`)).toHaveValue("");
    await expect(
      page.getByText("Final-version comparison outcomes (retained corpus only)"),
    ).toHaveCount(0);
    await page
      .locator('input[name="thresholdVersion"]')
      .fill(`fictional-browser-${randomUUID().slice(0, 8)}`);
    await page.locator('input[name="minimumLabelAgreementBasisPoints"]').fill("8000");
    await page.locator('input[name="minimumPairComparisons"]').fill("1");
    await page.locator('input[name="minimumPairAgreementBasisPoints"]').fill("8000");
    await page.getByRole("button", { name: "Precommit thresholds and this corpus" }).click();
    await expect(page).toHaveURL(/\/calibration\?campaign=/);
    const campaignId = new URL(page.url()).searchParams.get("campaign")!;
    const members = sqlite
      .prepare(
        "SELECT id,job_id FROM r2_calibration_comparisons WHERE campaign_id=? ORDER BY job_id",
      )
      .all(campaignId) as Array<{ id: string; job_id: string }>;
    expect(members).toHaveLength(2);
    const form = page
      .locator("form")
      .filter({ has: page.locator(`input[name="comparisonId"][value="${members[0]!.id}"]`) });
    await expect(form.locator('select[name="label"]')).toHaveValue("");
    await expect(form.locator('select[name="occupationalFamily"]')).toHaveValue("");
    await form.locator('select[name="label"]').selectOption("AMBIGUOUS");
    await form.locator('select[name="occupationalFamily"]').selectOption("RETAIL_CUSTOMER_SERVICE");
    await form.getByRole("button", { name: "Record my label", exact: true }).click();
    await expect(page.getByText(/Recorded revision 1: AMBIGUOUS/)).toBeVisible();
    await page.locator('select[name="left"]').selectOption(members[0]!.id);
    await page.locator('select[name="right"]').selectOption(members[1]!.id);
    await page.getByRole("button", { name: "View pair context" }).click();
    for (const radio of await page.locator('input[name="preferredComparisonId"]').all())
      await expect(radio).not.toBeChecked();
    await page.locator(`input[name="preferredComparisonId"][value="${members[0]!.id}"]`).check();
    await page.getByRole("button", { name: "Record my preference", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Qualification assessment" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Approve this matching qualification" }),
    ).toHaveCount(0);
    expect(
      sqlite
        .prepare("SELECT count(*) FROM r2_calibration_label_events WHERE campaign_id=?")
        .pluck()
        .get(campaignId),
    ).toBe(1);
    expect(
      sqlite
        .prepare("SELECT count(*) FROM r2_calibration_pair_events WHERE campaign_id=?")
        .pluck()
        .get(campaignId),
    ).toBe(1);
    expect(
      sqlite
        .prepare("SELECT count(*) FROM r2_calibration_intake_qualifications WHERE campaign_id=?")
        .pluck()
        .get(campaignId),
    ).toBe(0);
    expect(posts).toHaveLength(3);
    expect(remote).toEqual([]);
  } finally {
    sqlite.close();
  }
});
