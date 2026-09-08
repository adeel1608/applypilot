import type { Metadata } from "next";
import Link from "next/link";

import { ScoreBadge } from "@web/components/score-badge";
import { StatusPill } from "@web/components/status-pill";
import { listBetaJobs } from "@web/lib/beta-workspace";
import { evaluatedJobs, formatDiscoveryDate, getImportedJobs } from "@web/lib/data";
import { filterJobQueue, ownerQueueLabel, type JobQueueFilters } from "@web/lib/job-filters";

export const metadata: Metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

function parameter(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length <= 200 ? value : undefined;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const filters: JobQueueFilters = {
    eligibility: parameter(query.eligibility),
    fit: parameter(query.fit),
    coverage: parameter(query.coverage),
    category: parameter(query.category),
    employmentType: parameter(query.employmentType),
    source: parameter(query.source),
    location: parameter(query.location),
    state: parameter(query.state),
    expiry: parameter(query.expiry),
    unknownRequirements: parameter(query.unknownRequirements),
    queue: parameter(query.queue),
  };
  const allBetaJobs = listBetaJobs();
  const betaJobs = filterJobQueue(allBetaJobs, filters);
  const hasFilters = Object.values(filters).some(Boolean);
  const importedJobs = getImportedJobs();
  const betaIds = new Set(allBetaJobs.map(({ id }) => id));
  const legacyOnlyImports = hasFilters ? [] : importedJobs.filter(({ id }) => !betaIds.has(id));
  const categories = [...new Set(allBetaJobs.map(({ category }) => category))].sort();
  const sources = [...new Set(allBetaJobs.map(({ source }) => source))].sort();
  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="eyebrow">
          {allBetaJobs.length || importedJobs.length} private local jobs · {evaluatedJobs.length}{" "}
          demo fixtures
        </div>
        <h1>Jobs</h1>
        <p>
          Private local jobs are the default queue. Fictional demos remain isolated below and never
          use the private profile.
        </p>
      </section>
      <details className="panel" open={hasFilters}>
        <summary>Filter private local queue</summary>
        <form method="get" className="filter-grid" aria-label="Real job queue filters">
          <label>
            Eligibility
            <select name="eligibility" defaultValue={filters.eligibility ?? ""}>
              <option value="">Any</option>
              <option value="ELIGIBLE">Eligible</option>
              <option value="REVIEW_REQUIRED">Review required</option>
              <option value="INELIGIBLE">Ineligible</option>
              <option value="NOT_EVALUATED">Not evaluated</option>
            </select>
          </label>
          <label>
            Fit band
            <select name="fit" defaultValue={filters.fit ?? ""}>
              <option value="">Any</option>
              <option value="HIGH">High (70+)</option>
              <option value="MEDIUM">Medium (40–69)</option>
              <option value="LOW">Low (&lt;40)</option>
              <option value="UNAVAILABLE">Unavailable</option>
            </select>
          </label>
          <label>
            Coverage band
            <select name="coverage" defaultValue={filters.coverage ?? ""}>
              <option value="">Any</option>
              <option value="HIGH">High (80%+)</option>
              <option value="MEDIUM">Medium (50–79%)</option>
              <option value="LOW">Low (&lt;50%)</option>
              <option value="UNAVAILABLE">Unavailable</option>
            </select>
          </label>
          <label>
            Category
            <select name="category" defaultValue={filters.category ?? ""}>
              <option value="">Any</option>
              {categories.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
          <label>
            Employment type
            <select name="employmentType" defaultValue={filters.employmentType ?? ""}>
              <option value="">Any</option>
              {["CASUAL", "PART_TIME", "FULL_TIME", "CONTRACT", "INTERNSHIP", "UNKNOWN"].map(
                (type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Source
            <select name="source" defaultValue={filters.source ?? ""}>
              <option value="">Any</option>
              {sources.map((source) => (
                <option key={source}>{source}</option>
              ))}
            </select>
          </label>
          <label>
            Location contains
            <input name="location" defaultValue={filters.location ?? ""} maxLength={200} />
          </label>
          <label>
            State
            <select name="state" defaultValue={filters.state ?? ""}>
              <option value="">Any</option>
              {["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].map((state) => (
                <option key={state}>{state}</option>
              ))}
            </select>
          </label>
          <label>
            Expiry evidence
            <select name="expiry" defaultValue={filters.expiry ?? ""}>
              <option value="">Any</option>
              <option value="ACTIVE">Active</option>
              <option value="EXPIRED">Expired</option>
              <option value="UNKNOWN">Unknown</option>
            </select>
          </label>
          <label>
            Unknown requirements
            <select name="unknownRequirements" defaultValue={filters.unknownRequirements ?? ""}>
              <option value="">Any</option>
              <option value="YES">Present</option>
              <option value="NO">None detected</option>
            </select>
          </label>
          <label>
            Queue state
            <select name="queue" defaultValue={filters.queue ?? ""}>
              <option value="">Any</option>
              <option value="SHORTLIST">Shortlist</option>
              <option value="REVIEW_LATER">Review later</option>
              <option value="SKIP">Skip</option>
              <option value="ARCHIVE">Archive</option>
              <option value="PREPARING">Preparing</option>
            </select>
          </label>
          <div className="filter-actions">
            <button className="button button--secondary">Apply filters</button>
            <Link className="button button--quiet" href="/jobs">
              Clear filters
            </Link>
          </div>
        </form>
        <p aria-live="polite">
          Showing {betaJobs.length} of {allBetaJobs.length} private local jobs.
        </p>
      </details>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Source</th>
                <th>Discovered</th>
                <th>Type</th>
                <th>Eligibility</th>
                <th>Fit</th>
                <th>Queue</th>
              </tr>
            </thead>
            <tbody>
              {betaJobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link className="table-link" href={`/jobs/${job.id}`}>
                      {job.title}
                    </Link>
                    <span>
                      {job.company} · {job.location} · Private local
                    </span>
                  </td>
                  <td>
                    <span className="source-pill">{job.source}</span>
                  </td>
                  <td>{formatDiscoveryDate(job.dateDiscovered)}</td>
                  <td>{job.employmentType.replaceAll("_", " ")}</td>
                  <td>
                    {job.eligibilityStatus ? (
                      <StatusPill status={job.eligibilityStatus} />
                    ) : (
                      <span className="source-pill">Not evaluated</span>
                    )}
                  </td>
                  <td>
                    {job.fitScore === null ? (
                      "Unavailable"
                    ) : (
                      <ScoreBadge score={job.fitScore} compact />
                    )}
                  </td>
                  <td>
                    <span className="action-label">{ownerQueueLabel(job)}</span>
                  </td>
                </tr>
              ))}
              {legacyOnlyImports.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link className="table-link" href={`/jobs/${job.id}`}>
                      {job.title}
                    </Link>
                    <span>
                      {job.company} · {job.location} · Migration required
                    </span>
                  </td>
                  <td>
                    <span className="source-pill">{job.source}</span>
                  </td>
                  <td>{formatDiscoveryDate(job.dateDiscovered)}</td>
                  <td>{job.employmentType.replaceAll("_", " ")}</td>
                  <td>
                    {job.eligibilityStatus ? (
                      <StatusPill status={job.eligibilityStatus} />
                    ) : (
                      "Unavailable"
                    )}
                  </td>
                  <td>
                    {job.fitScore === null ? (
                      "Unavailable"
                    ) : (
                      <ScoreBadge score={job.fitScore} compact />
                    )}
                  </td>
                  <td>
                    <span className="action-label">Migrate to Beta</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {betaJobs.length === 0 && legacyOnlyImports.length === 0 && (
        <section className="panel empty-state">
          <h2>{hasFilters ? "No jobs match these filters" : "No private local jobs"}</h2>
          <p>
            {hasFilters
              ? "Clear or adjust the queue filters; no job data was changed."
              : "Import owner-supplied job content to begin the real local workflow."}
          </p>
          <Link className="button button--primary" href={hasFilters ? "/jobs" : "/import"}>
            {hasFilters ? "Clear filters" : "Import jobs"}
          </Link>
        </section>
      )}
      <details className="panel">
        <summary>Show isolated fictional demo jobs ({evaluatedJobs.length})</summary>
        <div className="job-list">
          {evaluatedJobs.map(({ job, eligibility, fit, recommendedAction }) => (
            <Link className="job-row" href={`/jobs/${job.id}`} key={job.id}>
              <div className="job-row__main">
                <h3>{job.title}</h3>
                <p>{job.company} · fictional fixture</p>
              </div>
              <StatusPill status={eligibility.status} />
              <ScoreBadge score={fit.score} compact />
              <span className="action-label">{recommendedAction}</span>
            </Link>
          ))}
        </div>
      </details>
    </div>
  );
}
