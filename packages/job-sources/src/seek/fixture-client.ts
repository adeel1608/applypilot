import type { DiscoveryPage, DiscoveredJobRecord } from "../index";
import { normalizeSeekPostingDate } from "./dates";
import { SeekAdapterError } from "./errors";
import { createSeekRawJobRecord, normalizeSeekJob } from "./normalizer";
import {
  canonicalizeSeekQuery,
  canonicalizeSeekUrl,
  decodeSeekCursor,
  encodeSeekCursor,
  hashPayload,
  hashSeekQuery,
} from "./query";
import type { SeekDiscoveryQuery, SeekRawJobRecord, SeekRawJobRecordInput } from "./schemas";

export interface SeekFixtureEntry {
  record: SeekRawJobRecord;
  distanceKmFrom3072: number;
}

function includesText(value: string | null, search: string): boolean {
  return value?.toLocaleLowerCase("en-AU").includes(search.toLocaleLowerCase("en-AU")) ?? false;
}

function matchesQuery(entry: SeekFixtureEntry, query: SeekDiscoveryQuery, now: Date): boolean {
  const { record } = entry;
  if (record.status !== "ACTIVE") return false;
  const searchable = [
    record.title,
    record.company,
    record.classification,
    record.subclassification,
    record.location.text,
    record.description,
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .toLocaleLowerCase("en-AU");
  if (
    query.keywords.length > 0 &&
    !query.keywords.every((keyword) => searchable.includes(keyword.toLocaleLowerCase("en-AU")))
  ) {
    return false;
  }
  if (
    query.locations.length > 0 &&
    !query.locations.some((location) => includesText(record.location.text, location))
  ) {
    return false;
  }
  if (query.location?.text && !includesText(record.location.text, query.location.text))
    return false;
  if (query.location?.suburb && !includesText(record.location.suburb, query.location.suburb)) {
    return false;
  }
  if (
    query.location?.postcode &&
    query.location.radiusKm === undefined &&
    record.location.postcode !== query.location.postcode
  ) {
    return false;
  }
  if (query.location?.state && record.location.state !== query.location.state) return false;
  if (
    query.location?.radiusKm !== undefined &&
    entry.distanceKmFrom3072 > query.location.radiusKm
  ) {
    return false;
  }
  if (query.datePostedWithinDays !== undefined) {
    const normalized = normalizeSeekPostingDate(
      record.postingDate,
      record.postingText,
      record.discoveredAt,
    );
    if (
      !normalized.datePosted ||
      now.getTime() - Date.parse(normalized.datePosted) > query.datePostedWithinDays * 86_400_000
    ) {
      return false;
    }
  }
  if (query.employmentTypes.length > 0) {
    try {
      const employmentType = normalizeSeekJob(record).employmentType;
      if (!query.employmentTypes.some((candidate) => candidate === employmentType)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function asDiscoveredJobRecord(record: SeekRawJobRecord): DiscoveredJobRecord {
  return {
    externalId: record.externalId,
    sourceUrl: record.canonicalUrl,
    raw: record,
    discoveredAt: record.discoveredAt,
  };
}

export class SeekFixtureClient {
  constructor(
    private readonly entries: readonly SeekFixtureEntry[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  async discover(input: unknown): Promise<DiscoveryPage> {
    const query = canonicalizeSeekQuery(input);
    const queryHash = hashSeekQuery(query);
    if (query.location?.radiusKm !== undefined && query.location.postcode !== "3072") {
      throw new SeekAdapterError("UNSUPPORTED_PAGE", {
        message: "Fixture distance filtering is available only from postcode 3072",
      });
    }
    const cursor = query.pageCursor
      ? decodeSeekCursor(query.pageCursor, { queryHash, mode: "FIXTURE_ONLY" })
      : null;
    const offset = cursor?.sourceCursor ? Number(cursor.sourceCursor) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new SeekAdapterError("CHECKPOINT_MISMATCH", {
        message: "Fixture cursor contains an invalid offset",
      });
    }

    const matches = this.entries.filter((entry) => matchesQuery(entry, query, this.now()));
    if (query.sortOrder === "DATE_POSTED") {
      matches.sort((left, right) => {
        const leftDate = normalizeSeekPostingDate(
          left.record.postingDate,
          left.record.postingText,
          left.record.discoveredAt,
        ).datePosted;
        const rightDate = normalizeSeekPostingDate(
          right.record.postingDate,
          right.record.postingText,
          right.record.discoveredAt,
        ).datePosted;
        return (rightDate ?? "").localeCompare(leftDate ?? "");
      });
    }
    const pageEntries = matches.slice(offset, offset + query.pageSize);
    const pageHash = hashPayload(
      pageEntries.map(({ record }) => [
        record.externalId,
        record.canonicalUrl,
        record.rawPayloadHash,
      ]),
    );
    const nextOffset = offset + pageEntries.length;
    const nextCursor =
      nextOffset < matches.length
        ? encodeSeekCursor({
            schemaVersion: 1,
            source: "SEEK",
            mode: "FIXTURE_ONLY",
            queryHash,
            pageNumber: (cursor?.pageNumber ?? 0) + 1,
            sourceCursor: String(nextOffset),
            previousPageHash: pageHash,
          })
        : undefined;
    return { records: pageEntries.map(({ record }) => asDiscoveredJobRecord(record)), nextCursor };
  }

  async fetch(externalId: string): Promise<DiscoveredJobRecord> {
    const entry = this.entries.find(({ record }) => record.externalId === externalId);
    if (!entry) throw new SeekAdapterError("NOT_FOUND");
    if (entry.record.status === "REMOVED") {
      throw new SeekAdapterError("JOB_REMOVED", { sourceUrl: entry.record.canonicalUrl });
    }
    return asDiscoveredJobRecord(entry.record);
  }
}

export interface UserSuppliedSeekContentContext {
  sourceUrl: string;
  discoveredAt: string;
  fetchedAt: string;
}

function plainText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const match = findJobPosting(child);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  const type = object["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return object;
  return findJobPosting(object["@graph"]);
}

function jsonLdFromHtml(content: string): unknown[] {
  const scripts = [
    ...content.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  const parsed: unknown[] = [];
  for (const script of scripts) {
    try {
      parsed.push(JSON.parse(script[1]));
    } catch {
      // A malformed script is ignored; a valid JobPosting is still required below.
    }
  }
  return parsed;
}

function objectProperty(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function stringProperty(value: unknown, key: string): string | null {
  const property = objectProperty(value, key);
  return typeof property === "string" && property.trim() ? property.trim() : null;
}

function salaryTextFromJsonLd(value: unknown): string | null {
  const baseSalary = objectProperty(value, "baseSalary");
  const currency = stringProperty(baseSalary, "currency") ?? "AUD";
  const salaryValue = objectProperty(baseSalary, "value");
  const minimum = objectProperty(salaryValue, "minValue");
  const maximum = objectProperty(salaryValue, "maxValue");
  const unit = stringProperty(salaryValue, "unitText")?.toLowerCase();
  if (typeof minimum !== "number" || !unit || currency !== "AUD") return null;
  return `$${minimum}${typeof maximum === "number" ? ` - $${maximum}` : ""} per ${unit}`;
}

function containsSensitiveAuthMaterial(value: unknown): boolean {
  if (typeof value === "string") {
    return /(?:^|[\r\n<])\s*(?:authorization|cookie|set-cookie)\s*[:=]|\bbearer\s+[a-z0-9._~-]{12,}|<input\b[^>]*type=["']password["']/i.test(
      value,
    );
  }
  if (Array.isArray(value)) return value.some(containsSensitiveAuthMaterial);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) =>
      /^(?:authorization|cookie|cookies|password|accessToken|refreshToken|sessionState)$/i.test(
        key,
      ) || containsSensitiveAuthMaterial(child),
  );
}

export function parseUserSuppliedSeekContent(
  content: string | Record<string, unknown>,
  context: UserSuppliedSeekContentContext,
): SeekRawJobRecord {
  if (containsSensitiveAuthMaterial(content)) {
    throw new SeekAdapterError("ACCESS_DENIED", {
      message: "User-supplied content contains authentication or session material",
      diagnosticCode: "SEEK_SENSITIVE_INPUT_REJECTED",
    });
  }
  const canonicalUrl = canonicalizeSeekUrl(context.sourceUrl);
  const sourceUrl = new URL(canonicalUrl);
  const supportedHost =
    sourceUrl.hostname === "seek.com.au" ||
    sourceUrl.hostname.endsWith(".seek.com.au") ||
    sourceUrl.hostname === "seek.example.test";
  if (!supportedHost || !/^\/job\//.test(sourceUrl.pathname)) {
    throw new SeekAdapterError("UNSUPPORTED_PAGE", {
      message: "User-supplied SEEK content requires a validated SEEK job URL pattern",
      sourceUrl: canonicalUrl,
    });
  }
  const suppliedContentHash = hashPayload(content);
  let payload: unknown = content;
  if (typeof content === "string") {
    if (/^https?:\/\//i.test(content.trim())) {
      throw new SeekAdapterError("UNSUPPORTED_PAGE", {
        message: "Provide page content, not a URL; this mode never fetches a URL",
        sourceUrl: content.trim(),
      });
    }
    try {
      payload = JSON.parse(content);
    } catch {
      payload = jsonLdFromHtml(content);
    }
  }
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    objectProperty(payload, "source") === "SEEK"
  ) {
    return createSeekRawJobRecord({
      ...(payload as SeekRawJobRecordInput),
      accessMode: "USER_SUPPLIED_CONTENT",
      canonicalUrl,
      sourcePageUrl: canonicalUrl,
      discoveredAt: context.discoveredAt,
      fetchedAt: context.fetchedAt,
      provenance: {
        retrievalMethod: "USER_SUPPLIED_CONTENT",
        contentType: "application/json",
        sourceReference: canonicalUrl,
        fieldSources: {},
      },
      rawPayload: content,
      rawPayloadHash: suppliedContentHash,
    });
  }
  const posting = findJobPosting(payload);
  if (!posting) {
    throw new SeekAdapterError("UNSUPPORTED_PAGE", {
      message: "User-supplied content did not contain a schema.org JobPosting object",
      sourceUrl: canonicalUrl,
    });
  }
  const location = objectProperty(posting, "jobLocation");
  const firstLocation = Array.isArray(location) ? location[0] : location;
  const address = objectProperty(firstLocation, "address");
  const suburb = stringProperty(address, "addressLocality");
  const state = stringProperty(address, "addressRegion");
  const postcode = stringProperty(address, "postalCode");
  const countryValue = objectProperty(address, "addressCountry");
  const country =
    typeof countryValue === "string"
      ? countryValue
      : (stringProperty(countryValue, "name") ?? stringProperty(countryValue, "@id"));
  const identifier = objectProperty(posting, "identifier");
  const identifierValue =
    typeof identifier === "string" ? identifier : stringProperty(identifier, "value");
  const employmentType = objectProperty(posting, "employmentType");
  const employmentTypeText = Array.isArray(employmentType)
    ? employmentType.filter((item): item is string => typeof item === "string").join(", ")
    : typeof employmentType === "string"
      ? employmentType
      : null;
  const description = plainText(posting.description);
  const title = stringProperty(posting, "title");
  const hiringOrganization = objectProperty(posting, "hiringOrganization");
  const company = stringProperty(hiringOrganization, "name");
  const externalId = identifierValue ?? hashPayload([canonicalUrl, title, company]).slice(0, 24);
  const raw: SeekRawJobRecordInput = {
    schemaVersion: 1,
    parserVersion: "seek-user-content-v1",
    source: "SEEK",
    accessMode: "USER_SUPPLIED_CONTENT",
    externalId,
    canonicalUrl,
    sourcePageUrl: canonicalUrl,
    title,
    company,
    advertiser: null,
    location: {
      text: [suburb, state, postcode].filter(Boolean).join(" ") || null,
      suburb,
      postcode,
      state: state as SeekRawJobRecordInput["location"]["state"],
      country,
    },
    salaryText: salaryTextFromJsonLd(posting),
    employmentTypeText,
    workType: null,
    classification: stringProperty(posting, "industry") ?? "Unclassified",
    subclassification: null,
    postingText: null,
    postingDate: stringProperty(posting, "datePosted"),
    description,
    responsibilities: [],
    requirementTexts: [],
    requiredSkills: [],
    scheduleText: null,
    hoursText: null,
    coverLetterRequired: null,
    discoveredAt: context.discoveredAt,
    fetchedAt: context.fetchedAt,
    rawPayload: content,
    rawPayloadHash: suppliedContentHash,
    provenance: {
      retrievalMethod: "USER_SUPPLIED_CONTENT",
      contentType: "application/ld+json",
      sourceReference: canonicalUrl,
      fieldSources: {
        title: "$.title",
        company: "$.hiringOrganization.name",
        description: "$.description",
        location: "$.jobLocation.address",
      },
    },
    normalizationWarnings: [],
    unknownFields: {},
    status: "ACTIVE",
  };
  return createSeekRawJobRecord(raw);
}
