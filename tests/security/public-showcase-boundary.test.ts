import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { demoJobs, demoMetrics } from "../../apps/showcase/lib/demo-data";

const root = process.cwd();
const showcaseRoot = join(root, "apps", "showcase");

function sourceFiles(directory: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if ([".next", "node_modules", "out", "public"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx|js|mjs|json)$/i.test(path)) result.push(path);
  }
  return result;
}

describe("public showcase boundary", () => {
  it("remains a static export without runtime or private application imports", () => {
    const content = sourceFiles(showcaseRoot)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(content).toContain('output: "export"');
    expect(content).not.toMatch(/@web\/|(?:from\s+|import\s*\()["']@applypilot\//);
    expect(content).not.toMatch(/process\.env|better-sqlite3|drizzle-orm/);
    expect(content).not.toMatch(/["']use server["']|server-only/);
    expect(content).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/);
    expect(content).not.toMatch(/profile\.private|data[\\/]private/i);
  });

  it("uses an internally consistent fictional demonstration dataset", () => {
    expect(demoJobs).toHaveLength(8);
    expect(new Set(demoJobs.map((job) => job.id)).size).toBe(demoJobs.length);
    expect(demoJobs.every((job) => job.fictional)).toBe(true);
    expect(demoJobs.some((job) => job.recommendation === "RECOMMENDED")).toBe(true);
    expect(demoJobs.some((job) => job.eligibility === "REVIEW_REQUIRED")).toBe(true);
    expect(demoMetrics.map((metric) => metric.value)).toEqual([24, 7, 5, 3]);
  });
});
