import { SOURCE_RULES_VERSION } from "./limits";
import type { DetectedJobSource, SourceDetection } from "./types";

const INDEED_HOSTS = new Set([
  "indeed.com",
  "www.indeed.com",
  "au.indeed.com",
  "ca.indeed.com",
  "uk.indeed.com",
  "nz.indeed.com",
  "de.indeed.com",
  "fr.indeed.com",
]);
const SEEK_HOSTS = new Set(["seek.com.au", "www.seek.com.au", "seek.co.nz", "www.seek.co.nz"]);
const GREENHOUSE_HOSTS = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "boards-api.greenhouse.io",
]);
const LEVER_HOSTS = new Set(["jobs.lever.co", "api.lever.co", "api.eu.lever.co"]);
const EMPLOYMENT_HERO_HOSTS = new Set([
  "employmenthero.com",
  "jobs.employmenthero.com",
  "swagapp.com",
  "jobs.swagapp.com",
]);

export function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase();
  return normalized.endsWith(".") ? normalized.slice(0, -1) : normalized;
}

export function isExactOrSubdomain(host: string, domain: string): boolean {
  const normalizedHost = normalizeHostname(host);
  const normalizedDomain = normalizeHostname(domain);
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

export function classifyJobUrl(value: string): DetectedJobSource {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "UNKNOWN";
  }
  if (url.protocol !== "https:" || url.username || url.password) return "UNKNOWN";
  const host = normalizeHostname(url.hostname);
  if (SEEK_HOSTS.has(host) && /^\/job\/\d+(?:\/|$)/.test(url.pathname)) return "SEEK";
  if (
    INDEED_HOSTS.has(host) &&
    /(?:\/viewjob|\/job\/|[?&]jk=)/i.test(`${url.pathname}${url.search}`)
  ) {
    return "INDEED";
  }
  if (GREENHOUSE_HOSTS.has(host)) return "GREENHOUSE";
  if (LEVER_HOSTS.has(host)) return "LEVER";
  if (EMPLOYMENT_HERO_HOSTS.has(host)) return "EMPLOYMENT_HERO";
  if (isExactOrSubdomain(host, "myworkdayjobs.com") && /\/job\//i.test(url.pathname)) {
    return "WORKDAY";
  }
  return "GENERIC_COMPANY_SITE";
}

function structuredString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function detectJobSource(input: {
  sourceUrl?: string | null;
  structured?: Record<string, unknown> | null;
  text?: string;
  sourceHint?: DetectedJobSource | null;
}): SourceDetection {
  const ruleIds: string[] = [SOURCE_RULES_VERSION];
  const evidence: string[] = [];
  const conflicts: string[] = [];
  const structuredUrl = input.structured
    ? structuredString(input.structured, ["url", "sourceUrl", "jobUrl"])
    : null;
  const candidateUrl = input.sourceUrl ?? structuredUrl;
  let source: DetectedJobSource = candidateUrl ? classifyJobUrl(candidateUrl) : "UNKNOWN";
  let confidence: SourceDetection["confidence"] = source === "UNKNOWN" ? "LOW" : "MEDIUM";
  if (candidateUrl && source !== "UNKNOWN" && source !== "GENERIC_COMPANY_SITE") {
    ruleIds.push("URL_HOST_PATH_MATCH");
    evidence.push("validated-url-host-and-path");
  }
  const structuredType = input.structured?.["@type"];
  const hasJobPosting =
    structuredType === "JobPosting" ||
    (Array.isArray(structuredType) && structuredType.includes("JobPosting"));
  if (hasJobPosting) {
    ruleIds.push("SCHEMA_ORG_JOB_POSTING");
    evidence.push("structured:@type=JobPosting");
    if (source === "UNKNOWN" && candidateUrl) source = "GENERIC_COMPANY_SITE";
    if (source !== "UNKNOWN") confidence = candidateUrl ? "HIGH" : "MEDIUM";
  }
  if (input.sourceHint && input.sourceHint !== source && source !== "UNKNOWN") {
    conflicts.push("SOURCE_HINT_CONFLICT");
  }
  if (source === "UNKNOWN" && input.sourceHint) {
    ruleIds.push("UNVERIFIED_SOURCE_HINT");
    evidence.push("user-source-hint");
  }
  return { source, confidence, ruleIds, evidence, conflicts };
}
