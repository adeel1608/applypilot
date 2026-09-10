import { expect, test } from "@playwright/test";

test("shows R2 evidence health, explanations, calibration, duplicate, and queue state", async ({
  page,
}) => {
  await page.goto("/jobs/job-e2e-document");

  await expect(page.getByText("REVIEW REQUIRED", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Current extraction coverage 71%/)).toBeVisible();
  await expect(page.getByText(/Material unresolved: 1 unknown/)).toBeVisible();
  await expect(page.getByText("Scoring: UNCALIBRATED")).toBeVisible();
  await expect(page.getByText(/Queue freshness: (CURRENT|STALE)/)).toBeVisible();
  await expect(page.getByText("SUGGESTED", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Similar text never auto-links/)).toBeVisible();
  const duplicateForm = page.getByRole("form", { name: "Decide duplicate duplicate:r2:e2e" });
  await expect(duplicateForm.getByRole("button", { name: "Link", exact: true })).toBeVisible();
  await expect(duplicateForm.getByRole("button", { name: "Keep distinct" })).toBeVisible();
  await expect(
    page.getByText(/A fictional verified skill matches current usable evidence/),
  ).toBeVisible();
  await expect(page.getByText("No owner correction has been recorded.")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Â·");
});

test("R2 review remains keyboard usable without clipping at narrow zoom", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/jobs/job-e2e-document");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "200%";
  });

  const duplicateForm = page.getByRole("form", { name: "Decide duplicate duplicate:r2:e2e" });
  await expect(duplicateForm).toBeVisible();
  await duplicateForm.getByRole("button", { name: "Link", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(duplicateForm.getByRole("button", { name: "Keep distinct" })).toBeFocused();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("owner explicitly enters PREPARING before local packet preparation succeeds", async ({
  page,
}) => {
  await page.goto("/jobs/job-e2e-preparing");

  const enterPreparing = page.getByRole("button", { name: "Enter PREPARING" });
  const preparePacket = page.getByRole("button", { name: "Prepare local packet" });
  await expect(page.getByRole("heading", { name: "Not prepared" })).toBeVisible();
  await expect(page.getByText("ELIGIBLE", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/recommendation available/)).toBeVisible();
  await expect(page.getByText("Stale evaluation", { exact: true })).toHaveCount(0);
  await expect(page.getByText("SUGGESTED", { exact: true })).toHaveCount(0);
  await expect(enterPreparing).toBeEnabled();
  await expect(preparePacket).toBeDisabled();

  await enterPreparing.click();
  await expect(page.getByText("Queue: PREPARING", { exact: true })).toBeVisible();
  await expect(page.getByText("Queue freshness: CURRENT", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Current PREPARING decision recorded" }),
  ).toBeDisabled();
  await expect(preparePacket).toBeEnabled();

  await preparePacket.click();
  await expect(page.getByRole("heading", { name: "REVIEW_REQUIRED · version 1" })).toBeVisible();
  await expect(page.getByText("Queue: PREPARING", { exact: true })).toBeVisible();
});

test("packet preparation fails closed for absent, stale, nonrecommended, and duplicate-blocked decisions", async ({
  page,
}) => {
  await page.goto("/jobs/job-e2e-preparing-absent");
  await expect(page.getByRole("button", { name: "Prepare local packet" })).toBeDisabled();

  await page.goto("/jobs/job-e2e-preparing-stale");
  await expect(page.getByText("Queue freshness: STALE", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter PREPARING" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Prepare local packet" })).toBeDisabled();

  await page.goto("/jobs/job-e2e-preparing-nonrecommended");
  await expect(page.getByText(/recommendation blocked/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter PREPARING" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Prepare local packet" })).toBeDisabled();

  await page.goto("/jobs/job-e2e-preparing-duplicate");
  await expect(page.getByText("SUGGESTED", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter PREPARING" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Prepare local packet" })).toBeDisabled();
});
