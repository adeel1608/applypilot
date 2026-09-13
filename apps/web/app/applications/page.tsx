import type { Metadata } from "next";
import Link from "next/link";

import {
  approveRunnerTargetAction,
  recordManualOutcomeAction,
  revokeRunnerTargetAction,
} from "@web/app/applications/actions";
import { listBetaApplications } from "@web/lib/beta-workspace";
import { issueLocalMutationNonce } from "@web/lib/local-mutation-security";
import { getRunnerEnablementView } from "@web/lib/runner-workspace";

export const metadata: Metadata = { title: "Applications" };
export const dynamic = "force-dynamic";

export default async function ApplicationsPage() {
  const applications = listBetaApplications();
  const runnerView = await getRunnerEnablementView();
  const outcomeNonces = await Promise.all(
    applications.map(() => issueLocalMutationNonce("APPLICATION_OUTCOME", "/applications")),
  );
  const runnerNonces = await Promise.all(
    runnerView.capabilities.map(async () => ({
      approve: await issueLocalMutationNonce("RUNNER_TARGET_APPROVE", "/applications"),
      revoke: await issueLocalMutationNonce("RUNNER_TARGET_REVOKE", "/applications"),
    })),
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
      <section className="panel" aria-labelledby="runner-approval-heading">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Target-independent runner authority</span>
            <h2 id="runner-approval-heading">{runnerView.status.replaceAll("_", " ")}</h2>
          </div>
          <span className="source-pill">No automatic resume or retry</span>
        </div>
        {runnerView.status === "WAITING_FOR_APPROVED_TARGET" && (
          <p>No real target capability is configured. Real target interaction remains blocked.</p>
        )}
        {runnerView.status === "CONFIGURATION_REJECTED" && (
          <p role="alert">
            The ignored private target allowlist failed strict validation. No target can open.
          </p>
        )}
        {runnerView.status === "DATABASE_MIGRATION_REQUIRED" && (
          <p role="alert">Local schema 0008 is required before a runner target can be approved.</p>
        )}
        {runnerView.capabilities.map((capability, index) => (
          <article className="job-row" key={`${capability.capabilityId}:${capability.version}`}>
            <div className="job-row__main">
              <h3>
                {capability.alias} · {capability.targetKind.replaceAll("_", " ")}
              </h3>
              <p>
                {capability.allowedOrigin}
                {capability.allowedPathPrefix} · form {capability.formVersion} · adapter{" "}
                {capability.adapterVersion}
              </p>
              <p>Operations: {capability.operations.join(", ").replaceAll("_", " ")}</p>
              <p>
                {capability.readiness.replaceAll("_", " ")} · capability expires{" "}
                {new Date(capability.capabilityExpiresAt).toLocaleString("en-AU")}
              </p>
              <p>
                Approval persists authority only. It does not open a form, upload a document, or
                submit.
              </p>
            </div>
            <div className="page-stack">
              <form action={approveRunnerTargetAction} className="import-form">
                <input type="hidden" name="mutationNonce" value={runnerNonces[index]?.approve} />
                <input type="hidden" name="capabilityId" value={capability.capabilityId} />
                <label>
                  Exact approval confirmation
                  <input
                    name="confirmationText"
                    autoComplete="off"
                    required
                    aria-describedby={`runner-approve-${index}`}
                  />
                </label>
                <p id={`runner-approve-${index}`}>
                  Type <code>APPROVE {capability.capabilityId}</code>. A separate exact approval is
                  still required before first interaction.
                </p>
                <label className="checkbox-line">
                  <input type="checkbox" name="ownerConfirmed" value="yes" required />I approve this
                  exact versioned target boundary.
                </label>
                <button className="button button--secondary">Persist target approval</button>
              </form>
              <form action={revokeRunnerTargetAction} className="import-form">
                <input type="hidden" name="mutationNonce" value={runnerNonces[index]?.revoke} />
                <input type="hidden" name="capabilityId" value={capability.capabilityId} />
                <label>
                  Exact revocation confirmation
                  <input
                    name="confirmationText"
                    autoComplete="off"
                    required
                    aria-describedby={`runner-revoke-${index}`}
                  />
                </label>
                <p id={`runner-revoke-${index}`}>
                  Type <code>REVOKE {capability.capabilityId}</code>.
                </p>
                <label className="checkbox-line">
                  <input type="checkbox" name="ownerConfirmed" value="yes" required />I approve
                  immutable revocation.
                </label>
                <button className="button button--secondary">Revoke target</button>
              </form>
            </div>
          </article>
        ))}
        <h3>Recovery decisions</h3>
        {runnerView.recoveries.length ? (
          <ol>
            {runnerView.recoveries.map((recovery) => (
              <li key={recovery.id}>
                <strong>{recovery.decision.replaceAll("_", " ")}</strong> ·{" "}
                {recovery.reasonCode.replaceAll("_", " ")} · {recovery.state.replaceAll("_", " ")}
              </li>
            ))}
          </ol>
        ) : (
          <p>
            No runner recovery event exists. CAPTCHA, MFA, authentication, bot, rate, access, form
            drift and ambiguous outcomes all require owner review.
          </p>
        )}
        <h3>Read-only target inspections</h3>
        {runnerView.inspections.length ? (
          <ol>
            {runnerView.inspections.map((inspection) => (
              <li key={inspection.id}>
                <strong>{inspection.state.replaceAll("_", " ")}</strong> /{" "}
                {inspection.operation.replaceAll("_", " ")} / {inspection.fieldCount} semantic
                fields / {inspection.unresolvedCount} packet blockers
                {inspection.stopReason
                  ? ` / stopped ${inspection.stopReason.replaceAll("_", " ")}`
                  : ""}
              </li>
            ))}
          </ol>
        ) : (
          <p>
            No real target inspection has occurred. A scoped approval and a separate owner-started
            control are required before read-only navigation.
          </p>
        )}
      </section>
      <section className="safety-banner">
        <div>
          <span className="section-kicker">Runner boundary</span>
          <h2>Real target interaction approval required</h2>
        </div>
        <p>
          A versioned target approval alone cannot open or submit. The frozen packet, current
          versions, disclosures, exact one-use final consent and a separate owner-started
          interaction are all required.
        </p>
      </section>
    </div>
  );
}
