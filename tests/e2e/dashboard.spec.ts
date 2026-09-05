import { expect, test } from "@playwright/test";

test("dashboard shows deterministic fixture metrics and safety state", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Decision dashboard" })).toBeVisible();
  await expect(page.getByText("Jobs discovered").locator("..").getByText("15")).toBeVisible();
  await expect(page.getByText("Final submission always requires human confirmation")).toBeVisible();
});

test("jobs list links to an explained job decision", async ({ page }) => {
  await page.goto("/jobs");
  await page.getByRole("link", { name: "Retail Sales Assistant" }).click();
  await expect(page.getByRole("heading", { name: "Retail Sales Assistant" })).toBeVisible();
  await expect(page.getByText("NO HARD BLOCKERS")).toBeVisible();
  await expect(page.getByText("retail-customer-service")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare application" })).toBeDisabled();
});

test("profile exposes explicit forbidden claims without private data", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Candidate truth store" })).toBeVisible();
  await expect(page.getByText("Australian driver's licence")).toBeVisible();
  await expect(page.getByText("Real data stays out of Git.")).toBeVisible();
});
