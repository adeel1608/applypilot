import type { Metadata } from "next";
import Link from "next/link";

import { listBetaApplications } from "@web/lib/beta-workspace";

export const metadata: Metadata = { title: "Applications" };
export const dynamic = "force-dynamic";

export default function ApplicationsPage() {
  const applications = listBetaApplications();
  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="eyebrow">Private local tracking</div>
        <h1>Applications</h1>
        <p>
          Durable packet and lifecycle events are shown from the local database. Real form access
          and submission remain disabled.
        </p>
      </section>
      {applications.length === 0 ? (
        <section className="panel empty-state">
          <span className="empty-mark" aria-hidden="true">
            0
          </span>
          <h2>No private packets prepared</h2>
          <p>Shortlist a local job, approve its current CV, then prepare a packet.</p>
          <Link className="button button--primary" href="/jobs">
            Review jobs
          </Link>
        </section>
      ) : (
        applications.map((application) => (
          <article className="panel" key={application.id}>
            <div className="panel-heading">
              <div>
                <span className="section-kicker">{application.status.replaceAll("_", " ")}</span>
                <h2>
                  <Link href={`/jobs/${application.jobId}`}>{application.title}</Link>
                </h2>
                <p>{application.company}</p>
              </div>
              <span className="source-pill">
                Packet {application.packetVersion ?? "—"} · {application.packetStatus ?? "missing"}
              </span>
            </div>
            {application.blockers.length ? (
              <div>
                <h3>Missing inputs or safety blockers</h3>
                <ul>
                  {application.blockers.map((blocker) => (
                    <li key={blocker}>{blocker.replaceAll("_", " ")}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <h3>Append-only timeline</h3>
            <ol>
              {application.timeline.map((event, index) => (
                <li key={`${event.eventType}-${event.occurredAt}-${index}`}>
                  <strong>{event.toStatus.replaceAll("_", " ")}</strong> ·{" "}
                  {event.eventType.replaceAll("_", " ")} ·{" "}
                  {new Intl.DateTimeFormat("en-AU", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Australia/Sydney",
                  }).format(new Date(event.occurredAt))}
                </li>
              ))}
            </ol>
          </article>
        ))
      )}
      <section className="safety-banner">
        <div>
          <span className="section-kicker">Runner boundary</span>
          <h2>Real target approval required</h2>
        </div>
        <p>Only the synthetic loopback runner is executable. No employer page is opened here.</p>
      </section>
    </div>
  );
}
