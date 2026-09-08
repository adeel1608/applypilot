import { expect, test } from "@playwright/test";

test("dashboard separates private local state from governed source state", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Decision dashboard" })).toBeVisible();
  await expect(page.getByText("Private jobs", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "SOURCE READY AWAITING TENANT" })).toBeVisible();
  await expect(page.getByText(/disabled without an approved private tenant/)).toBeVisible();
  await expect(page.getByText("Final submission always requires human confirmation")).toBeVisible();
});

test("jobs list links to an explained job decision", async ({ page }) => {
  await page.goto("/jobs");
  await page.getByText(/Show isolated fictional demo jobs/).click();
  const jobLink = page.getByRole("link", { name: "Retail Sales Assistant" });
  await expect(jobLink).toHaveAttribute("href", "/jobs/job-retail-sales-assistant");
  await page.goto("/jobs/job-retail-sales-assistant");
  await expect(page.getByRole("heading", { name: "Retail Sales Assistant" })).toBeVisible();
  await expect(page.getByText("NO HARD BLOCKERS")).toBeVisible();
  await expect(page.getByText("retail-customer-service")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare application" })).toBeDisabled();
});

test("core local routes remain usable at a narrow viewport and expose labelled controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const path of ["/dashboard", "/jobs", "/sources", "/applications", "/import"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
  await expect(page.getByLabel("Import method")).toBeVisible();
  await expect(page.getByLabel("Job content")).toBeVisible();
});

test("real queue filters remain keyboard-usable at 200 percent zoom", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/jobs?eligibility=INELIGIBLE&unknownRequirements=YES&queue=ARCHIVE");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "200%";
  });

  await expect(page.getByRole("form", { name: "Real job queue filters" })).toBeVisible();
  await expect(page.getByLabel("Eligibility")).toHaveValue("INELIGIBLE");
  await expect(page.getByLabel("Unknown requirements")).toHaveValue("YES");
  await expect(page.getByLabel("Queue state")).toHaveValue("ARCHIVE");
  await expect(page.getByRole("heading", { name: "No jobs match these filters" })).toBeVisible();

  await page.getByLabel("Eligibility").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Fit band")).toBeFocused();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("profile exposes explicit forbidden claims without private data", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Candidate truth store" })).toBeVisible();
  await expect(page.getByText("Australian driver's licence")).toBeVisible();
  await expect(page.getByText("Real data stays out of Git.")).toBeVisible();
});

test("SEEK fixture detail exposes safe provenance without enabling submission", async ({
  page,
}) => {
  await page.goto("/jobs/seek-seek-fixture-retail-001");
  await expect(page.getByRole("heading", { name: "Casual Retail Assistant" })).toBeVisible();
  await expect(page.getByText("SEEK · FIXTURE ONLY")).toBeVisible();
  await expect(page.getByText("Source URL")).toBeVisible();
  await expect(page.getByText("Last refreshed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare application" })).toBeDisabled();
  await expect(page.getByText("Support customers and maintain")).toBeVisible();
  await expect(page.getByText("rawPayload", { exact: true })).toHaveCount(0);
});
