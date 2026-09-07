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
const historicalObjects = git("rev-list", "--objects", "--all")
  .split(/\r?\n/)
  .map((line) => {
    const separator = line.indexOf(" ");
    return separator < 0
      ? { objectId: line, path: "" }
      : { objectId: line.slice(0, separator), path: line.slice(separator + 1) };
  })
  .filter(({ objectId, path }) => /^[a-f0-9]{40}$/.test(objectId) && Boolean(path));

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
const normalizeSyntheticSentinels = (content: string) =>
  content.replaceAll("abcdefghijklmnopqrstuvwxyz", "x");
for (const path of tracked) {
  const absolute = `${root}/${path}`;
  try {
    if (statSync(absolute).size > 5_000_000) continue;
    const content = normalizeSyntheticSentinels(readFileSync(absolute, "utf8"));
    if (sensitivePatterns.some((pattern) => pattern.test(content))) findings.add(path);
  } catch {
    findings.add(path);
  }
}

const uniqueObjects = new Map<string, string>();
for (const { objectId, path } of historicalObjects) {
  if (!uniqueObjects.has(objectId)) uniqueObjects.set(objectId, path);
}
const checkedBlobs = new Set<string>();
try {
  const objectIds = [...uniqueObjects.keys()];
  const batch = execFileSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input: `${objectIds.join("\n")}\n`,
    maxBuffer: 200_000_000,
  });
  let offset = 0;
  for (const expectedId of objectIds) {
    const headerEnd = batch.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error("GIT_BATCH_HEADER_MISSING");
    const [objectId, type, rawSize] = batch
      .subarray(offset, headerEnd)
      .toString("ascii")
      .split(" ");
    const size = Number(rawSize);
    const bodyStart = headerEnd + 1;
    const bodyEnd = bodyStart + size;
    if (objectId !== expectedId || !Number.isFinite(size) || bodyEnd >= batch.length) {
      throw new Error("GIT_BATCH_RESPONSE_INVALID");
    }
    if (type === "blob") {
      checkedBlobs.add(objectId);
      if (size <= 5_000_000) {
        const content = normalizeSyntheticSentinels(
          batch.subarray(bodyStart, bodyEnd).toString("utf8"),
        );
        if (sensitivePatterns.some((pattern) => pattern.test(content))) {
          findings.add(`history:${objectId}:${uniqueObjects.get(objectId) ?? "unknown"}`);
        }
      }
    }
    offset = bodyEnd + 1;
  }
} catch {
  findings.add("history:GIT_BATCH_AUDIT_FAILED");
}

if (findings.size) {
  console.error("PRIVACY_AUDIT_FAIL");
  for (const path of [...findings].sort()) console.error(`- ${path}`);
  process.exitCode = 1;
} else {
  console.log(
    `PRIVACY_AUDIT_PASS tracked_files=${tracked.length} history_paths_checked=${historical.length} history_blobs_checked=${checkedBlobs.size}`,
  );
}
