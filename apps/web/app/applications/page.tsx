import type { Metadata } from "next";
import Link from "next/link";

import { StatusPill } from "@web/components/status-pill";
import { evaluatedJobs } from "@web/lib/data";

export const metadata: Metadata = { title: "Applications" };

export default function ApplicationsPage() {
  const tracked = evaluatedJobs.filter(({ job }) => job.applicationStatus !== "NEW");
  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="eyebrow">Local tracking model</div>
        <h1>Applications</h1>
        <p>Fixture status transitions are designed for auditable future analytics.</p>
      </section>
      <section className="panel empty-state">
        {tracked.length === 0 ? (
          <>
            <span className="empty-mark" aria-hidden="true">
              0
            </span>
            <h2>No applications prepared yet</h2>
            <p>This foundation deliberately starts with review-only job fixtures.</p>
            <Link className="button button--primary" href="/jobs">
              Review jobs
            </Link>
          </>
        ) : (
          tracked.map(({ job }) => (
            <div key={job.id}>
              <span>{job.title}</span>
              <StatusPill status={job.applicationStatus} />
            </div>
          ))
        )}
      </section>
    </div>
  );
}
