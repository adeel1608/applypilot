import type { Metadata } from "next";
import Link from "next/link";

import { ScoreBadge } from "@web/components/score-badge";
import { StatusPill } from "@web/components/status-pill";
import {
  getSourceCapabilitySummary,
  listBetaApplications,
  listBetaJobs,
} from "@web/lib/beta-workspace";
import { getImportSummary } from "@web/lib/data";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const jobs = listBetaJobs();
  const applications = listBetaApplications();
  const importSummary = getImportSummary();
  const sources = getSourceCapabilitySummary();
  const priority = jobs
    .filter(({ queueState }) => queueState !== "SKIPPED")
    .sort(
      (left, right) =>
        Number(right.recommended) - Number(left.recommended) ||
        (right.fitScore ?? -1) - (left.fitScore ?? -1),
    )
    .slice(0, 5);
  const metrics = [
    ["Private jobs", jobs.length],
    ["Reviewing", jobs.filter(({ queueState }) => queueState === "REVIEWING").length],
    ["Shortlisted", jobs.filter(({ queueState }) => queueState === "SHORTLISTED").length],
    ["Preparing", jobs.filter(({ queueState }) => queueState === "PREPARING").length],
    [
      "Evidence review",
      jobs.filter(
        ({ unknownRequirementCount, unresolvedConditionCount, unresolvedConflictCount }) =>
          unknownRequirementCount + unresolvedConditionCount + unresolvedConflictCount > 0,
      ).length,
    ],
    ["Stale queue", jobs.filter(({ queueFreshness }) => queueFreshness === "STALE").length],
    [
      "Duplicate review",
      jobs.filter(({ duplicateState }) => duplicateState === "SUGGESTED").length,
    ],
    ["Packets", applications.length],
    ["Submitted", applications.filter(({ status }) => status === "SUBMITTED").length],
  ] as const;
  return (
    <div className="page-stack">
      <section className="page-heading split-heading">
        <div>
          <div className="eyebrow">Private local Beta workspace</div>
          <h1>Decision dashboard</h1>
          <p>Explainable matches, current-version documents, and explicit human control.</p>
        </div>
        <Link className="button button--primary" href="/import">
          Import jobs
        </Link>
      </section>
      <section className="metric-grid" aria-label="Private local metrics">
        {metrics.map(([label, value]) => (
          <article className="metric-card metric-card--neutral" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Real local queue</span>
            <h2>Current priorities</h2>
          </div>
          <span className="source-pill">{jobs.length} stored</span>
        </div>
        {priority.length ? (
          <div className="job-list">
            {priority.map((job) => (
              <Link className="job-row" href={`/jobs/${job.id}`} key={job.id}>
                <div className="job-row__main">
                  <h3>{job.title}</h3>
                  <p>
                    {job.company} · {job.location}
                  </p>
                </div>
                {job.eligibilityStatus ? (
                  <StatusPill status={job.eligibilityStatus} />
                ) : (
                  <span>Not evaluated</span>
                )}
                {job.fitScore === null ? (
                  <span>Fit unavailable</span>
                ) : (
                  <ScoreBadge score={job.fitScore} compact />
                )}
                <span className="action-label">
                  {(job.queueState ?? "REVIEW").replaceAll("_", " ")}
                </span>
                <span className="action-label">
                  {job.coveragePercent === null
                    ? "Coverage unavailable"
                    : `${job.coveragePercent}% evidence`}
                  {job.queueFreshness ? ` · ${job.queueFreshness}` : ""}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h3>No private queue items</h3>
            <p>Import a job or review a migrated local job.</p>
          </div>
        )}
      </section>
      <section className="panel" aria-labelledby="matching-readiness-heading">
        <span className="section-kicker">R2 matching quality</span>
        <h2 id="matching-readiness-heading">Truthful ordering, never hiring probability</h2>
        <p>
          Scoring is{" "}
          {jobs.some(({ calibrationState }) => calibrationState === "CALIBRATED")
            ? "CALIBRATED"
            : "UNCALIBRATED"}
          . Recommendations require current eligible evidence, complete safety gates, and the score
          threshold. Unknown, conditional, conflicting, or stale inputs remain visible review
          blockers.
        </p>
      </section>
      <section className="detail-grid">
        <article className="panel">
          <span className="section-kicker">Latest import totals</span>
          <h2>Owner-supplied intake</h2>
          <div className="source-summary-grid">
            {Object.entries(importSummary).map(([label, value]) => (
              <div key={label}>
                <span>{label.replaceAll("_", " ")}</span>
                <strong>{value ?? "None"}</strong>
              </div>
            ))}
          </div>
        </article>
        <article className="panel">
          <span className="section-kicker">Governed discovery</span>
          <h2>{sources.status.replaceAll("_", " ")}</h2>
          <p>
            Greenhouse and Lever are GET-only, bounded, owner-started, and disabled without an
            approved private tenant.
          </p>
          <Link className="button button--secondary" href="/sources">
            Review source status
          </Link>
        </article>
      </section>
      <section className="safety-banner">
        <div>
          <span className="section-kicker">Safety invariant</span>
          <h2>Unknown never means yes.</h2>
        </div>
        <p>
          Real target execution is disabled. Final submission always requires separate, fresh human
          approval.
        </p>
      </section>
    </div>
  );
}
