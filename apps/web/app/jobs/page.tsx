import type { Metadata } from "next";
import Link from "next/link";

import { ScoreBadge } from "@web/components/score-badge";
import { StatusPill } from "@web/components/status-pill";
import { listBetaJobs } from "@web/lib/beta-workspace";
import { evaluatedJobs, formatDiscoveryDate, getImportedJobs } from "@web/lib/data";

export const metadata: Metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

export default function JobsPage() {
  const betaJobs = listBetaJobs();
  const importedJobs = getImportedJobs();
  const betaIds = new Set(betaJobs.map(({ id }) => id));
  const legacyOnlyImports = importedJobs.filter(({ id }) => !betaIds.has(id));
  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="eyebrow">
          {betaJobs.length || importedJobs.length} private local jobs · {evaluatedJobs.length} demo
          fixtures
        </div>
        <h1>Jobs</h1>
        <p>
          Private local jobs are the default queue. Fictional demos remain isolated below and never
          use the private profile.
        </p>
      </section>
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
                    <span className="action-label">
                      {(job.queueState ?? "REVIEW").replaceAll("_", " ")}
                    </span>
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
          <h2>No private local jobs</h2>
          <p>Import owner-supplied job content to begin the real local workflow.</p>
          <Link className="button button--primary" href="/import">
            Import jobs
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
