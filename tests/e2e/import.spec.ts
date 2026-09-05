import { expect, test } from "@playwright/test";

test("checks URL policy without fetching a SEEK job", async ({ page }) => {
  let externalRequest = false;
  await page.route("https://**", async (route) => {
    externalRequest = true;
    await route.abort();
  });
  await page.goto("/import");
  await page.getByLabel("Import method").selectOption("URL");
  await page.getByRole("textbox", { name: "Job URL" }).fill("https://www.seek.com.au/job/12345678");
  await page.getByRole("button", { name: "Check URL policy" }).click();
  await expect(page.getByText("USER CONTENT REQUIRED")).toBeVisible();
  await expect(page.getByText(/copy the visible job content/i)).toBeVisible();
  expect(externalRequest).toBe(false);
});

test("previews, confirms, and displays a local real-world import", async ({ page }) => {
  const title = "Fictional E2E Service Assistant";
  await page.goto("/import");
  await page.getByLabel("Job content").fill(`Title: ${title}
Company: Example E2E Harbour Co
Location: Sydney NSW 2000
Employment type: Part time
Description: Help fictional visitors and maintain accurate local service records.`);
  await page.getByRole("button", { name: "Preview detected jobs" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("USER SUPPLIED CONTENT", { exact: true })).toBeVisible();
  await page.getByLabel("Import this job").check();
  await page.getByLabel(/reviewed the inferred boundary/i).check();
  await page.getByRole("button", { name: "Import selected" }).click();
  await expect(page.getByRole("heading", { name: "Import complete" })).toBeVisible();

  await page.goto("/jobs");
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Not evaluated", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Private candidate profile required/i)).toBeVisible();
});

test("supports multi-job, inert HTML, and file-upload previews", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("Import method").selectOption("PASTED_MULTI");
  await page.getByLabel("Job content").fill(`Title: Fictional Multi One
Company: Example One Co
Location: Sydney NSW
Description: Support a fictional local operations team carefully.
--- JOB ---
Title: Fictional Multi Two
Company: Example Two Co
Location: Melbourne VIC
Description: Maintain fictional local service records accurately.`);
  await page.getByRole("button", { name: "Preview detected jobs" }).click();
  await expect(page.getByRole("heading", { name: "2 detected jobs" })).toBeVisible();

  await page.reload();
  await page.getByLabel("Import method").selectOption("PASTED_HTML");
  await page.getByLabel("Job content").fill(
    `<script>alert('never')</script><script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: "Fictional HTML Assistant",
      hiringOrganization: { name: "Example HTML Co" },
      jobLocation: { address: { addressLocality: "Perth", addressRegion: "WA" } },
      description: "Support a fictional inert HTML workflow locally.",
      url: "https://careers.example.test/jobs/html-assistant",
    })}</script>`,
  );
  await page.getByRole("button", { name: "Preview detected jobs" }).click();
  await expect(page.getByRole("heading", { name: "Fictional HTML Assistant" })).toBeVisible();
  await expect(page.getByText("alert('never')")).toHaveCount(0);

  await page.reload();
  await page.getByLabel("Import method").selectOption("FILE_UPLOAD");
  await page.locator('input[name="file"]').setInputFiles({
    name: "fictional-job.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(`Title: Fictional Uploaded Assistant
Company: Example Upload Co
Location: Adelaide SA
Description: Maintain fictional uploaded service records locally.`),
  });
  await page.getByRole("button", { name: "Preview detected jobs" }).click();
  await expect(page.getByRole("heading", { name: "Fictional Uploaded Assistant" })).toBeVisible();
  await expect(page.getByText("FILE UPLOAD", { exact: true })).toBeVisible();
});

test("shows only the safe private-profile runtime state", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Private profile missing" })).toBeVisible();
  const source = await page.content();
  expect(source).not.toContain('"referees":');
  expect(source).not.toContain('"contact":');
});
