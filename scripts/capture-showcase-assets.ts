import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { chromium } from "playwright";

import { repositoryRoot } from "./lib/runtime-safety";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3200";
const outputDirectory = join(repositoryRoot(), "docs", "assets");
const routes = [
  ["landing.png", "/"],
  ["dashboard.png", "/demo/"],
  ["evidence.png", "/demo/evidence/"],
  ["application-packet.png", "/demo/application-packet/"],
] as const;

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    colorScheme: "dark",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
  });

  try {
    for (const [filename, route] of routes) {
      const page = await context.newPage();
      await page.goto(new URL(route, baseUrl).toString(), { waitUntil: "networkidle" });
      await page.screenshot({
        animations: "disabled",
        fullPage: true,
        path: join(outputDirectory, filename),
      });
      await page.close();
    }
    console.log(`SHOWCASE_SCREENSHOTS_WRITTEN count=${routes.length}`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "SHOWCASE_SCREENSHOT_CAPTURE_FAILED");
  process.exitCode = 1;
});
