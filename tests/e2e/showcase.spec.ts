import { expect, test } from "@playwright/test";

const showcase = "http://127.0.0.1:3200";

test.describe("public showcase", () => {
  test("renders the landing experience and follows every internal route", async ({ page }) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.goto(`${showcase}/`);
    await expect(page.getByRole("heading", { name: /Find better jobs/i })).toBeVisible();
    await expect(page.getByText("Public demo — fictional data").first()).toBeVisible();
    await expect(page.locator("blockquote")).toContainText("Unknown never means yes.");

    await page.getByRole("link", { name: "Explore demo", exact: true }).first().click();
    await expect(page).toHaveURL(`${showcase}/demo/`);
    await expect(page.getByRole("heading", { name: "Fictional roles" })).toBeVisible();

    await page.getByRole("link", { name: "Inspect evidence model" }).click();
    await expect(page).toHaveURL(`${showcase}/demo/evidence/`);
    await expect(page.getByText("Australian citizenship required")).toBeVisible();

    await page.getByRole("link", { name: /Continue to packet/ }).click();
    await expect(page).toHaveURL(`${showcase}/demo/application-packet/`);
    await expect(page.getByText("HUMAN CONSENT REQUIRED")).toBeVisible();
    expect(browserErrors).toEqual([]);
  });

  test("supports filtering, sorting, selection and pipeline inspection", async ({ page }) => {
    await page.goto(`${showcase}/demo/`);

    await page.getByLabel("Filter").selectOption("REVIEW_REQUIRED");
    await expect(page.locator(".demo-job")).toHaveCount(3);
    await expect(page.getByText("Robotics Engineer", { exact: true })).toHaveCount(0);

    await page.getByLabel("Filter").selectOption("ALL");
    await page.getByLabel("Sort").selectOption("FIT_ASC");
    await expect(page.locator(".demo-job").first()).toContainText("Autonomy Software Engineer");

    await page.getByRole("button", { name: /Computer Vision Engineer/ }).click();
    await expect(page.getByRole("heading", { name: "Computer Vision Engineer" })).toBeVisible();
    await page.getByRole("button", { name: "Prepare" }).click();
    await expect(page.getByText(/Prepare: Documents and answers/)).toBeVisible();
  });

  test("keeps keyboard focus visible and avoids mobile overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${showcase}/demo/`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.keyboard.press("Tab");
    const focusStyle = await page.evaluate(() => {
      const active = document.activeElement;
      return active ? getComputedStyle(active).outlineStyle : "none";
    });
    expect(focusStyle).not.toBe("none");
  });

  test("retains core information without client-side JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${showcase}/`);
    await expect(page.getByRole("heading", { name: /Find better jobs/i })).toBeVisible();
    await page.goto(`${showcase}/demo/evidence/`);
    await expect(
      page
        .getByRole("region", { name: "Two fictional evidence decisions" })
        .getByText("UNKNOWN", { exact: true }),
    ).toBeVisible();
    await page.goto(`${showcase}/demo/application-packet/`);
    await expect(
      page.getByText("No external destination is contacted in this demo."),
    ).toBeVisible();
    await context.close();
  });
});
