import type { Metadata } from "next";
import Link from "next/link";

import { ScoreBadge } from "@web/components/score-badge";
import { StatusPill } from "@web/components/status-pill";
import {
  dashboardMetrics,
  evaluatedJobs,
  formatDiscoveryDate,
  seekDiscoverySummary,
} from "@web/lib/data";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  const strongMatches = evaluatedJobs
    .filter(({ eligibility }) => eligibility.status !== "INELIGIBLE")
    .sort((left, right) => right.fit.score - left.fit.score)
    .slice(0, 4);
  return (
    <div className="page-stack">
      <section className="page-heading split-heading">
        <div>
          <div className="eyebrow">Local fixture workspace</div>
          <h1>Decision dashboard</h1>
          <p>Explainable matches, explicit blockers, and a review gate before every application.</p>
        </div>
        <Link className="button button--primary" href="/jobs">
          Review all jobs
        </Link>
      </section>

      <section className="metric-grid" aria-label="Application metrics">
        {dashboardMetrics.map((metric) => (
          <article className={`metric-card metric-card--${metric.tone}`} key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Priority queue</span>
            <h2>Best current matches</h2>
          </div>
          <span className="quiet">Deterministic score · fixture data</span>
        </div>
        <div className="job-list">
          {strongMatches.map(({ job, eligibility, fit, recommendedAction }) => (
            <Link className="job-row" href={`/jobs/${job.id}`} key={job.id}>
              <div className="job-row__main">
                <h3>{job.title}</h3>
                <p>
                  {job.company} · {job.location} · {job.employmentType.replaceAll("_", " ")}
                </p>
              </div>
              <StatusPill status={eligibility.status} />
              <ScoreBadge score={fit.score} compact />
              <span className="action-label">{recommendedAction}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="panel" aria-labelledby="discovery-source-heading">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Discovery source</span>
            <h2 id="discovery-source-heading">SEEK adapter status</h2>
          </div>
          <span className="source-pill">{seekDiscoverySummary.status}</span>
        </div>
        <div className="source-summary-grid">
          <div>
            <span>Source</span>
            <strong>{seekDiscoverySummary.source}</strong>
          </div>
          <div>
            <span>Mode</span>
            <strong>{seekDiscoverySummary.mode}</strong>
          </div>
          {Object.entries(seekDiscoverySummary.counts).map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
          <div>
            <span>Last successful fetch</span>
            <strong>{formatDiscoveryDate(seekDiscoverySummary.lastSuccessfulFetchAt)}</strong>
          </div>
          <div>
            <span>Partial run</span>
            <strong>{seekDiscoverySummary.partial ? "Yes" : "No"}</strong>
          </div>
        </div>
        {!seekDiscoverySummary.liveModesEnabled && (
          <p className="source-note">
            Live SEEK discovery and job-page retrieval are disabled. This view uses synthetic local
            fixtures only; user-supplied content can be parsed locally in the adapter.
          </p>
        )}
      </section>

      <section className="safety-banner">
        <div>
          <span className="section-kicker">Safety invariant</span>
          <h2>Unknown never means yes.</h2>
        </div>
        <p>
          Ambiguous requirements are routed to review. Candidate claims require verified profile
          provenance.
        </p>
      </section>
    </div>
  );
}
