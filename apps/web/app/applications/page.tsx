import type { Metadata } from "next";
import Link from "next/link";

import { recordManualOutcomeAction } from "@web/app/applications/actions";
import { listBetaApplications } from "@web/lib/beta-workspace";
import { issueLocalMutationNonce } from "@web/lib/local-mutation-security";

export const metadata: Metadata = { title: "Applications" };
export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const applications = listBetaApplications();
  const outcomeNonces = await Promise.all(
    applications.map(() => issueLocalMutationNonce("APPLICATION_OUTCOME", "/applications")),
  );
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
        applications.map((application, applicationIndex) => (
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
            <div className="detail-grid">
              <div>
                <h3>Selected documents</h3>
                {application.selectedDocuments.length ? (
                  <ul>
                    {application.selectedDocuments.map((document) => (
                      <li key={`${document.type}-${document.format}-${document.version}`}>
                        {document.type.replaceAll("_", " ")} {document.format} v{document.version} ·{" "}
                        {document.stale
                          ? "stale"
                          : document.approved
                            ? "approved"
                            : "approval required"}
                        {document.required ? " · required" : " · optional"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No current document selected.</p>
                )}
                <p>Cover letter: {application.coverLetterState.replaceAll("_", " ")}</p>
              </div>
              <div>
                <h3>Answers and disclosure</h3>
                <p>Unknown required answers: {application.unknownAnswerCount}</p>
                <p>
                  Approved to disclose: {application.approvedDisclosureCount} of{" "}
                  {application.questionCount}
                </p>
                <p>
                  A verified fact is not disclosed unless its current answer version is separately
                  approved.
                </p>
              </div>
              <div>
                <h3>Runner and next action</h3>
                <p>Runner: {application.runnerState.replaceAll("_", " ")}</p>
                <p>Next: {application.nextAction}</p>
                {application.runnerStopReason && (
                  <p>Recovery: owner review is required; there is no automatic resume.</p>
                )}
              </div>
            </div>
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
            {application.manualOutcomes.length ? (
              <form action={recordManualOutcomeAction} className="import-form">
                <input type="hidden" name="mutationNonce" value={outcomeNonces[applicationIndex]} />
                <input type="hidden" name="applicationId" value={application.id} />
                <label>
                  Observed manual outcome
                  <select name="outcome" required defaultValue="">
                    <option value="" disabled>
                      Select an allowed transition
                    </option>
                    {application.manualOutcomes.map((outcome) => (
                      <option key={outcome} value={outcome}>
                        {outcome.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="checkbox-line">
                  <input type="checkbox" name="ownerConfirmed" value="yes" required />I am recording
                  an outcome I observed manually. This does not submit an application.
                </label>
                <button className="button button--secondary">Record owner-observed outcome</button>
              </form>
            ) : (
              <p>No valid manual outcome transition is available from this lifecycle state.</p>
            )}
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
