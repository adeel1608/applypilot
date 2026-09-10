export interface JobQueueFilterItem {
  eligibilityStatus: string | null;
  fitScore: number | null;
  coverage: { percent: number; missingDimensions: string[] } | null;
  coveragePercent?: number | null;
  category: string;
  employmentType: string;
  source: string;
  location: string;
  state: string | null;
  expiresAt: string | null;
  unknownRequirementCount: number;
  queueState: string | null;
  queueReason: string | null;
}

export interface JobQueueFilters {
  eligibility?: string;
  fit?: string;
  coverage?: string;
  category?: string;
  employmentType?: string;
  source?: string;
  location?: string;
  state?: string;
  expiry?: string;
  unknownRequirements?: string;
  queue?: string;
}

export function ownerQueueLabel(item: Pick<JobQueueFilterItem, "queueState" | "queueReason">) {
  if (item.queueReason === "OWNER_ARCHIVED") return "ARCHIVE";
  if (item.queueReason === "OWNER_REVIEW_LATER") return "REVIEW LATER";
  if (item.queueState === "SHORTLISTED") return "SHORTLIST";
  if (item.queueState === "SKIPPED") return "SKIP";
  return (item.queueState ?? "REVIEW LATER").replaceAll("_", " ");
}

function band(value: number | null, high: number, medium: number): string {
  if (value === null) return "UNAVAILABLE";
  if (value >= high) return "HIGH";
  if (value >= medium) return "MEDIUM";
  return "LOW";
}

export function filterJobQueue<T extends JobQueueFilterItem>(
  jobs: T[],
  filters: JobQueueFilters,
  now: Date = new Date(),
): T[] {
  return jobs.filter((job) => {
    if (
      filters.eligibility &&
      (filters.eligibility === "NOT_EVALUATED"
        ? job.eligibilityStatus !== null
        : job.eligibilityStatus !== filters.eligibility)
    ) {
      return false;
    }
    if (filters.fit && band(job.fitScore, 70, 40) !== filters.fit) return false;
    if (
      filters.coverage &&
      band(job.coveragePercent ?? job.coverage?.percent ?? null, 80, 50) !== filters.coverage
    ) {
      return false;
    }
    if (filters.category && job.category !== filters.category) return false;
    if (filters.employmentType && job.employmentType !== filters.employmentType) return false;
    if (filters.source && job.source !== filters.source) return false;
    if (
      filters.location &&
      !job.location.toLocaleLowerCase("en-AU").includes(filters.location.toLocaleLowerCase("en-AU"))
    ) {
      return false;
    }
    if (filters.state && job.state !== filters.state) return false;
    if (filters.expiry) {
      const expiry = job.expiresAt ? new Date(job.expiresAt).getTime() : null;
      const state = expiry === null ? "UNKNOWN" : expiry < now.getTime() ? "EXPIRED" : "ACTIVE";
      if (state !== filters.expiry) return false;
    }
    if (filters.unknownRequirements) {
      const hasUnknown =
        job.unknownRequirementCount > 0 || Boolean(job.coverage?.missingDimensions.length);
      if ((filters.unknownRequirements === "YES") !== hasUnknown) return false;
    }
    if (filters.queue && ownerQueueLabel(job).replaceAll(" ", "_") !== filters.queue) return false;
    return true;
  });
}
