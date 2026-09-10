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
