import type { Job, JobSource } from "@applypilot/job-model";

export const AdapterCapability = {
  DISCOVERY: "DISCOVERY",
  JOB_DETAILS: "JOB_DETAILS",
  ASSISTED_APPLICATION: "ASSISTED_APPLICATION",
  FORM_FILLING: "FORM_FILLING",
  APPLICATION_STATUS: "APPLICATION_STATUS",
  MANUAL_ONLY: "MANUAL_ONLY",
} as const;

export type AdapterCapability = (typeof AdapterCapability)[keyof typeof AdapterCapability];

export interface DiscoveryQuery {
  keywords: string[];
  locations: string[];
  location?: {
    text?: string;
    suburb?: string;
    postcode?: string;
    state?: "ACT" | "NSW" | "NT" | "QLD" | "SA" | "TAS" | "VIC" | "WA";
    radiusKm?: number;
  };
  employmentTypes?: Array<"CASUAL" | "PART_TIME" | "FULL_TIME" | "CONTRACT" | "INTERNSHIP">;
  datePostedWithinDays?: number;
  sortOrder?: "RELEVANCE" | "DATE_POSTED";
  pageCursor?: string;
  pageSize?: number;
}

export interface DiscoveredJobRecord {
  externalId: string;
  sourceUrl: string;
  raw: unknown;
  discoveredAt: string;
}

export interface DiscoveryPage {
  records: DiscoveredJobRecord[];
  nextCursor?: string;
}

export interface JobSourceAdapter {
  readonly sourceName: JobSource;
  capabilities(): readonly AdapterCapability[];
  discoverJobs(query: DiscoveryQuery): Promise<DiscoveryPage>;
  fetchJob(externalId: string): Promise<DiscoveredJobRecord>;
  normalizeJob(record: DiscoveredJobRecord): Promise<Job>;
}

export class AdapterNotImplementedError extends Error {
  constructor(sourceName: JobSource, operation: string) {
    super(`${sourceName} adapter does not implement ${operation} in Phase 0/1`);
    this.name = "AdapterNotImplementedError";
  }
}

class PlaceholderAdapter implements JobSourceAdapter {
  constructor(
    readonly sourceName: JobSource,
    private readonly declaredCapabilities: readonly AdapterCapability[],
  ) {}

  capabilities(): readonly AdapterCapability[] {
    return this.declaredCapabilities;
  }

  async discoverJobs(_query: DiscoveryQuery): Promise<DiscoveryPage> {
    void _query;
    throw new AdapterNotImplementedError(this.sourceName, "live discovery");
  }

  async fetchJob(_externalId: string): Promise<DiscoveredJobRecord> {
    void _externalId;
    throw new AdapterNotImplementedError(this.sourceName, "live job details");
  }

  async normalizeJob(_record: DiscoveredJobRecord): Promise<Job> {
    void _record;
    throw new AdapterNotImplementedError(this.sourceName, "source normalization");
  }
}

export * from "./seek/index";
export * from "./public-postings";
export * from "./private-allowlist";
export * from "./greenhouse/reader";
export * from "./lever/reader";

import { SeekAdapter } from "./seek/adapter";

export const jobSourceAdapters = {
  seek: new SeekAdapter(),
  indeed: new PlaceholderAdapter("INDEED", [
    AdapterCapability.DISCOVERY,
    AdapterCapability.JOB_DETAILS,
  ]),
  linkedin: new PlaceholderAdapter("LINKEDIN", [
    AdapterCapability.MANUAL_ONLY,
    AdapterCapability.ASSISTED_APPLICATION,
  ]),
  employmentHero: new PlaceholderAdapter("EMPLOYMENT_HERO", [
    AdapterCapability.DISCOVERY,
    AdapterCapability.JOB_DETAILS,
  ]),
  workday: new PlaceholderAdapter("WORKDAY", [
    AdapterCapability.JOB_DETAILS,
    AdapterCapability.ASSISTED_APPLICATION,
  ]),
  greenhouse: new PlaceholderAdapter("GREENHOUSE", [
    AdapterCapability.DISCOVERY,
    AdapterCapability.JOB_DETAILS,
  ]),
  lever: new PlaceholderAdapter("LEVER", [
    AdapterCapability.DISCOVERY,
    AdapterCapability.JOB_DETAILS,
  ]),
  genericCompanySite: new PlaceholderAdapter("GENERIC_COMPANY_SITE", [
    AdapterCapability.MANUAL_ONLY,
  ]),
} as const;
