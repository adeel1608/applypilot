import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { containsPrivateCanary } from "./lib/privacy-canary";
import { repositoryRoot } from "./lib/runtime-safety";

const root = repositoryRoot();
const sourceRoot = join(root, "apps", "showcase");
const exportRoot = join(sourceRoot, "out");
const sourceOnly = process.argv.includes("--source-only");
const findings = new Set<string>();

function filesBelow(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if ([".next", "node_modules", "out"].includes(entry.name)) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  return files;
}

const sourcePatterns: Array<[string, RegExp]> = [
  ["server-only module", /(?:^|["'])server-only(?:["']|$)/m],
  ["server action", /["']use server["']/],
  ["private application import", /@web\//],
  ["runtime package import", /(?:from\s+|import\s*\()["']@applypilot\//],
  ["environment access", /process\.env/],
  ["filesystem access", /node:(?:fs|path|child_process)/],
  ["database access", /better-sqlite3|drizzle-orm/],
  ["Next request state", /next\/(?:headers|server)/],
  ["private profile path", /profile\.private|data[\\/]private/i],
  ["network request", /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|new\s+EventSource/],
];

for (const path of filesBelow(sourceRoot)) {
  if (!/\.(?:ts|tsx|js|mjs|json|css|txt)$/i.test(path)) continue;
  const content = readFileSync(path, "utf8");
  for (const [label, pattern] of sourcePatterns) {
    if (pattern.test(content)) findings.add(`source:${relative(root, path)}:${label}`);
  }
  if (/(?:^|[\\/])(?:route|middleware)\.(?:ts|tsx|js|mjs)$/i.test(path)) {
    findings.add(`source:${relative(root, path)}:runtime entry point`);
  }
}

const packageManifest = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8")) as {
  private?: boolean;
  dependencies?: Record<string, string>;
};
if (packageManifest.private !== true) findings.add("source:showcase package must remain private");
const dependencyNames = Object.keys(packageManifest.dependencies ?? {});
for (const dependency of dependencyNames) {
  if (!["next", "react", "react-dom"].includes(dependency)) {
    findings.add(`source:unexpected dependency:${dependency}`);
  }
}

const nextConfig = readFileSync(join(sourceRoot, "next.config.ts"), "utf8");
if (!/output:\s*["']export["']/.test(nextConfig)) {
  findings.add("source:static export is not configured");
}

if (!sourceOnly) {
  if (!existsSync(exportRoot)) {
    findings.add("export:apps/showcase/out is missing");
  } else {
    for (const expected of [
      "index.html",
      "demo/index.html",
      "demo/evidence/index.html",
      "demo/application-packet/index.html",
    ]) {
      if (!existsSync(join(exportRoot, expected))) findings.add(`export:missing:${expected}`);
    }

    for (const forbidden of [
      "api",
      "dashboard",
      "sources",
      "applications",
      "documents",
      "local-session",
    ]) {
      if (existsSync(join(exportRoot, forbidden))) findings.add(`export:unexpected:${forbidden}`);
    }

    const privateNeedles = new Set<string>();
    const privateProfilePath = join(root, "data", "profile.private.json");
    if (existsSync(privateProfilePath)) {
      try {
        const profile = JSON.parse(readFileSync(privateProfilePath, "utf8")) as Record<
          string,
          unknown
        >;
        const addFact = (value: unknown) => {
          if (!value || typeof value !== "object") return;
          const factValue = (value as Record<string, unknown>).value;
          if (typeof factValue === "string" && factValue.trim().length >= 4) {
            privateNeedles.add(factValue.trim());
          }
        };
        const identity = profile.identity as Record<string, unknown> | undefined;
        const contact = profile.contact as Record<string, unknown> | undefined;
        for (const fact of [
          identity?.firstName,
          identity?.lastName,
          identity?.preferredName,
          contact?.email,
          contact?.phone,
          contact?.linkedInUrl,
          contact?.portfolioUrl,
        ]) {
          addFact(fact);
        }
      } catch {
        findings.add("export:private-canary-profile-read-failed");
      }
    }

    for (const path of filesBelow(exportRoot)) {
      if (statSync(path).size > 10_000_000) continue;
      const bytes = readFileSync(path);
      for (const needle of privateNeedles) {
        if (containsPrivateCanary(bytes, needle)) {
          findings.add(`export:private-canary:${relative(exportRoot, path)}`);
          break;
        }
      }
      const content = bytes.toString("utf8");
      if (
        /profile\.private|data[\\/]private|source-allowlist\.json|runner-target-allowlist\.json|\.sqlite(?:3)?(?:\b|[.-])|localhost:3100|api\.lever\.co/i.test(
          content,
        )
      ) {
        findings.add(`export:private-or-runtime-reference:${relative(exportRoot, path)}`);
      }
    }
  }
}

if (findings.size > 0) {
  console.error("PUBLIC_SHOWCASE_AUDIT_FAIL");
  for (const finding of [...findings].sort()) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(
    `PUBLIC_SHOWCASE_AUDIT_PASS source_files=${filesBelow(sourceRoot).length} export_checked=${String(!sourceOnly)}`,
  );
}
