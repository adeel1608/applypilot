import { URL_POLICY_VERSION } from "./limits";
import { classifyJobUrl, normalizeHostname } from "./source-detector";
import type { DetectedJobSource, UrlPolicyResult } from "./types";

const productionDecisions: Record<DetectedJobSource, UrlPolicyResult["decision"]> = {
  SEEK: "USER_CONTENT_REQUIRED",
  INDEED: "REVIEW_REQUIRED",
  EMPLOYMENT_HERO: "REVIEW_REQUIRED",
  GREENHOUSE: "REVIEW_REQUIRED",
  LEVER: "REVIEW_REQUIRED",
  WORKDAY: "REVIEW_REQUIRED",
  GENERIC_COMPANY_SITE: "REVIEW_REQUIRED",
  UNKNOWN: "REVIEW_REQUIRED",
};

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

function isLocalHost(host: string): boolean {
  const normalized = normalizeHostname(host);
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".lan") ||
    !normalized.includes(".") ||
    normalized === "0.0.0.0"
  );
}

export function evaluateJobUrlPolicy(value: string): UrlPolicyResult {
  if (value.length > 2048) {
    return invalid("URL_TOO_LONG");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid("INVALID_URL");
  }
  const host = normalizeHostname(url.hostname);
  if (url.protocol !== "https:") return invalid("HTTPS_REQUIRED");
  if (url.username || url.password) return invalid("URL_CREDENTIALS_UNSUPPORTED");
  if (isIpLiteral(host) || isLocalHost(host)) return invalid("LOCAL_OR_IP_HOST_UNSUPPORTED");
  const detectedSource = classifyJobUrl(url.toString());
  const decision = productionDecisions[detectedSource];
  return {
    decision,
    detectedSource,
    reasonCode:
      decision === "USER_CONTENT_REQUIRED" ? "PASTE_VISIBLE_CONTENT" : "NO_APPROVED_FETCH_PROVIDER",
    policyVersion: URL_POLICY_VERSION,
    normalizedUrl: url.toString(),
  };
}

function invalid(reasonCode: string): UrlPolicyResult {
  return {
    decision: "UNSUPPORTED",
    detectedSource: "UNKNOWN",
    reasonCode,
    policyVersion: URL_POLICY_VERSION,
    normalizedUrl: null,
  };
}

export function productionFetchAllowedCount(): number {
  return Object.values(productionDecisions).filter((decision) => decision === "FETCH_ALLOWED")
    .length;
}
