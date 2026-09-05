import { createHash } from "node:crypto";

import type { DetectedJobSource, JobIdentity, ParsedJobFields } from "./types";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalizeJobUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.port === "443") url.port = "";
  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !key.toLowerCase().startsWith("utm_"))
    .sort(([aKey, aValue], [bKey, bValue]) =>
      aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
    );
  url.search = "";
  for (const [key, item] of kept) url.searchParams.append(key, item);
  return url.toString();
}

function stable(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-AU");
}

export function localJobFingerprint(
  source: DetectedJobSource,
  fields: ParsedJobFields,
): string | null {
  if (!fields.title || !fields.company || !fields.location || !fields.description) return null;
  const descriptionHash = sha256(stable(fields.description));
  return sha256(
    [
      "job-import-fingerprint-v1",
      source,
      stable(fields.title),
      stable(fields.company),
      stable(fields.location),
      descriptionHash,
    ].join("\n"),
  );
}

export function deriveJobIdentity(
  source: DetectedJobSource,
  fields: ParsedJobFields,
  contentHash: string,
): JobIdentity {
  if (fields.externalId) return { kind: "EXTERNAL_ID", value: fields.externalId };
  if (fields.sourceUrl) {
    const canonicalUrl = canonicalizeJobUrl(fields.sourceUrl);
    if (canonicalUrl) return { kind: "CANONICAL_URL", value: canonicalUrl };
  }
  const fingerprint = localJobFingerprint(source, fields);
  if (fingerprint) return { kind: "LOCAL_FINGERPRINT", value: fingerprint };
  return { kind: "CONTENT_HASH", value: contentHash };
}
