import type { Metadata } from "next";
import Link from "next/link";

import { ScoreBadge } from "@web/components/score-badge";
import { StatusPill } from "@web/components/status-pill";
import { evaluatedJobs } from "@web/lib/data";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="eyebrow">15 normalized fixtures</div>
        <h1>Jobs</h1>
        <p>
          Every result has source provenance, deterministic eligibility, and an explainable fit
          score.
        </p>
      </section>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Role</th>
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
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
