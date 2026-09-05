import type { Metadata } from "next";
import Link from "next/link";

import { ScoreBadge } from "@web/components/score-badge";
import { StatusPill } from "@web/components/status-pill";
import { evaluatedJobs, formatDiscoveryDate, getImportedJobs } from "@web/lib/data";

export const metadata: Metadata = { title: "Jobs" };

export const dynamic = "force-dynamic";

export default function JobsPage() {
  const importedJobs = getImportedJobs();
  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="eyebrow">
          {evaluatedJobs.length} demo fixtures · {importedJobs.length} local imports
        </div>
        <h1>Jobs</h1>
        <p>
          Every result has source provenance. Demo jobs are evaluated with the labelled fictional
          profile; real imports require a valid private local profile.
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
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {evaluatedJobs.map(({ job, eligibility, fit, recommendedAction }) => (
                <tr key={job.id}>
                  <td>
                    <Link className="table-link" href={`/jobs/${job.id}`}>
                      {job.title}
                    </Link>
                    <span>
                      {job.company} · {job.location}
                    </span>
                  </td>
                  <td>
                    <span className="source-pill">{job.source}</span>
                  </td>
                  <td>{formatDiscoveryDate(job.dateDiscovered)}</td>
                  <td>{job.employmentType.replaceAll("_", " ")}</td>
                  <td>
                    <StatusPill status={eligibility.status} />
                  </td>
                  <td>
                    <ScoreBadge score={fit.score} compact />
                  </td>
                  <td>
                    <span className="action-label">{recommendedAction}</span>
                  </td>
                </tr>
              ))}
              {importedJobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link className="table-link" href={`/jobs/${job.id}`}>
                      {job.title}
                    </Link>
                    <span>
                      {job.company} · {job.location} · Imported
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
                    <span className="action-label">Review import</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
