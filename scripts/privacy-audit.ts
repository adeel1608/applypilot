import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

import { repositoryRoot } from "./lib/runtime-safety";

const root = repositoryRoot();
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 20_000_000 });
const tracked = git("ls-files", "-z").split("\0").filter(Boolean);
const historical = git("log", "--all", "--pretty=format:", "--name-only")
  .split(/\r?\n/)
  .map((value) => value.trim())
  .filter(Boolean);

const forbiddenPath = (path: string) => {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  if (normalized === ".env.example") return false;
  return (
    /^\.env(?:\.|$)/.test(normalized) ||
    normalized === "data/profile.private.json" ||
    normalized.startsWith("data/private/") ||
    /(?:^|\/)(?:\.auth|auth-state|browser-data|browser-profile|browser-sessions|downloads)(?:\/|$)/.test(
      normalized,
    ) ||
    /\.(?:sqlite|sqlite3|db)(?:-|\.|$)/.test(normalized) ||
    /(?:^|\/)(?:credentials|secrets?)(?:[./_-]|$)/.test(normalized) ||
    /(?:generated|applications\/output).*(?:\.pdf|\.docx)$/i.test(normalized) ||
    /(?:vacancy|job-ad)\.private\./.test(normalized)
  );
};

const findings = new Set<string>();
for (const path of [...tracked, ...historical]) if (forbiddenPath(path)) findings.add(path);

const sensitivePatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~-]{20,}/i,
  /\b(?:Cookie|Set-Cookie)\s*:\s*[A-Za-z0-9_-]{2,50}=[A-Za-z0-9%._~+/=-]{12,}/i,
  /\b(?:api[_-]?key|access[_-]?token|oauth[_-]?secret|client[_-]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{16,}/i,
  /\b(?:TFN|passport number|visa grant number|bank account|card number)\s*[:=]\s*\S+/i,
];
for (const path of tracked) {
  const absolute = `${root}/${path}`;
  try {
    if (statSync(absolute).size > 5_000_000) continue;
    const content = readFileSync(absolute, "utf8").replaceAll(
      "abcdefghijklmnopqrstuvwxyz",
      "x",
    );
    if (sensitivePatterns.some((pattern) => pattern.test(content))) findings.add(path);
  } catch {
    findings.add(path);
  }
}

if (findings.size) {
  console.error("PRIVACY_AUDIT_FAIL");
  for (const path of [...findings].sort()) console.error(`- ${path}`);
  process.exitCode = 1;
} else {
  console.log(
    `PRIVACY_AUDIT_PASS tracked_files=${tracked.length} history_paths_checked=${historical.length}`,
  );
}
