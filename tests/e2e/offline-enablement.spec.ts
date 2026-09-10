import { expect, test } from "@playwright/test";

test("source approval surface remains disabled without an approved private tenant", async ({
  page,
}) => {
  await page.goto("/sources");
  await expect(page.getByRole("heading", { name: "Source approvals and recovery" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "WAITING FOR APPROVED TENANT" })).toBeVisible();
  await expect(page.getByText("No approved private tenant exists.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start bounded source read" })).toHaveCount(0);
  await expect(page.getByText("Candidate data sent: 0 fields")).toBeVisible();
});

test("runner approval and recovery surface requires a private target capability", async ({
  page,
}) => {
  await page.goto("/applications");
  await expect(
    page.getByText("Target-independent runner authority", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "WAITING FOR APPROVED TARGET" })).toBeVisible();
  await expect(page.getByText("No real target capability is configured.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Persist target approval" })).toHaveCount(0);
  await expect(
    page.getByText(/CAPTCHA, MFA, authentication, bot, rate, access, form drift/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Real target interaction approval required" }),
  ).toBeVisible();
});

test("offline enablement approval surfaces remain usable at narrow width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const path of ["/sources", "/applications"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
