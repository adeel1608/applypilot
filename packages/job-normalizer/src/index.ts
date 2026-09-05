import type { Job, JobSource } from "@applypilot/job-model";

export interface RawJobSourceRecord {
  source: JobSource;
  externalId: string;
  sourceUrl: string;
  discoveredAt: string;
  payload: unknown;
}

export interface JobNormalizer<TRecord extends RawJobSourceRecord = RawJobSourceRecord> {
  readonly source: JobSource;
  normalize(record: TRecord): Job;
}

export interface DeduplicationSignals {
  jobId: string;
  canonicalUrl: string;
  source: JobSource;
  externalId: string;
  normalizedCompany: string;
  normalizedTitle: string;
  normalizedLocation: string;
  datePosted: string | null;
  descriptionFingerprint?: string;
}

export interface DuplicateCandidate {
  leftJobId: string;
  rightJobId: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  matchedSignals: Array<keyof DeduplicationSignals>;
  requiresHumanReview: true;
}

export interface JobDeduplicator {
  signals(job: Job): DeduplicationSignals;
  compare(left: DeduplicationSignals, right: DeduplicationSignals): DuplicateCandidate | null;
}
