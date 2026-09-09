import { expect, test } from "@playwright/test";

test("shows the fictional R2A evidence contract separately from evaluation", async ({ page }) => {
  await page.goto("/jobs/job-e2e-document");

  const layer = page.getByTestId("r2a-evidence-layer");
  await expect(layer).toBeVisible();
  await expect(layer.getByText("Parser 3.1.0")).toBeVisible();
  await expect(layer.getByText(/Evidence 3\.1\.0.*normalization 3\.1\.0/)).toBeVisible();
  await expect(layer.getByText(/GEOGRAPHY: PARTIAL/)).toBeVisible();
  await expect(layer.getByText(/WORK RIGHTS: PARTIAL/)).toBeVisible();
  await expect(layer.getByText(/R2B consumes only the current version/)).toBeVisible();
  await expect(layer.getByText(/Valid Australian work rights required/)).toBeVisible();
});

test("shows a safe explicit warning for corrupt current R2A evidence", async ({ page }) => {
  await page.goto("/jobs/job-e2e-r2a-invalid");

  await expect(page.getByRole("alert")).toContainText("R2A_EVIDENCE_INVALID_REVIEW_REQUIRED");
  await expect(page.getByTestId("r2a-evidence-layer")).toBeVisible();
  await expect(page.getByText(/Fictional Corrupt Evidence Role/)).toBeVisible();
});
