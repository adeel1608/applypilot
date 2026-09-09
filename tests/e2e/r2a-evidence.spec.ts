import { expect, test } from "@playwright/test";

test("shows the fictional R2A evidence contract separately from evaluation", async ({ page }) => {
  await page.goto("/jobs/job-e2e-document");

  const layer = page.getByTestId("r2a-evidence-layer");
  await expect(layer).toBeVisible();
  await expect(layer.getByText("Parser 3.0.0")).toBeVisible();
  await expect(layer.getByText(/Evidence 3\.0\.0.*normalization 3\.0\.0/)).toBeVisible();
  await expect(layer.getByText(/GEOGRAPHY: COMPLETE/)).toBeVisible();
  await expect(layer.getByText(/WORK RIGHTS: COMPLETE/)).toBeVisible();
  await expect(layer.getByText(/does not make R2B rule outcomes/)).toBeVisible();
  await expect(layer.getByText(/Valid Australian work rights required/)).toBeVisible();
});
