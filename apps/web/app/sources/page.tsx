import type { Metadata } from "next";

import { cancelSourceRunAction, revokeSourceAction, startSourceRunAction } from "./actions";
import { issueLocalMutationNonce } from "@web/lib/local-mutation-security";
import { getSourceEnablementView } from "@web/lib/source-workspace";

export const metadata: Metadata = { title: "Source approvals and recovery" };
export const dynamic = "force-dynamic";

const display = (value: string) => value.replaceAll("_", " ");

export default async function SourcesPage() {
  const view = await getSourceEnablementView();
  const nonces = await Promise.all(
    view.capabilities.map(async () => ({
      start: await issueLocalMutationNonce("SOURCE_RUN_START", "/sources"),
      revoke: await issueLocalMutationNonce("SOURCE_REVOKE", "/sources"),
    })),
  );
  const runNonces = await Promise.all(
    view.recentRuns.map(() => issueLocalMutationNonce("SOURCE_RUN_CANCEL", "/sources")),
  );
  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="eyebrow">Owner-started · GET only · no scheduler</div>
        <h1>Source approvals and recovery</h1>
        <p>
          No tenant is guessed or enumerated. Discovery can begin only from one strict, ignored
          private capability version and an exact owner confirmation entered below.
        </p>
      </section>

      <section className="panel" aria-labelledby="source-state-heading">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Effective private configuration</span>
            <h2 id="source-state-heading">{display(view.status)}</h2>
          </div>
          <span className="source-pill">Candidate data sent: 0 fields</span>
        </div>
        {view.status === "WAITING_FOR_APPROVED_TENANT" && (
          <p>No approved private tenant exists. Source-enabled Personal Beta remains waiting.</p>
        )}
        {view.status === "CONFIGURATION_REJECTED" && (
          <p role="alert">
            The private capability file failed strict validation. No request is possible.
          </p>
        )}
        {view.status === "DATABASE_MIGRATION_REQUIRED" && (
          <p role="alert">
            Local schema 0007 is required before capability approval or source recovery.
          </p>
        )}

        {view.capabilities.map((capability, index) => {
          const canRun = capability.source === "LEVER" && capability.readiness === "SOURCE_ENABLED";
          return (
            <article className="job-row" key={`${capability.capabilityId}:${capability.version}`}>
              <div className="job-row__main">
                <h3>
                  {capability.source} · {capability.alias}
                </h3>
                <p>
                  Tenant {capability.tenant} · v{capability.version} ·{" "}
                  {display(capability.readiness)}
                </p>
                <p>
                  Exact boundary: https://{capability.host}
                  {capability.pathPrefix} · operations {capability.operations.join(" + ")}
                </p>
                <p>
                  Per run: {capability.requestBudget} requests, {capability.recordCap} records,
                  pages of {capability.pageSizeCap}, {capability.responseByteLimit} bytes per
                  response.
                </p>
                <p>
                  Policy expires {new Date(capability.policyExpiresAt).toLocaleString("en-AU")} ·
                  capability expires{" "}
                  {new Date(capability.capabilityExpiresAt).toLocaleString("en-AU")}
                </p>
              </div>
              <div className="page-stack">
                <form
                  action={startSourceRunAction}
                  className="import-form"
                  aria-describedby={`source-run-help-${index}`}
                >
                  <input type="hidden" name="mutationNonce" value={nonces[index]?.start} />
                  <input type="hidden" name="capabilityId" value={capability.capabilityId} />
                  <p id={`source-run-help-${index}`}>
                    This makes the first bounded real GET. Type{" "}
                    <code>RUN {capability.capabilityId}</code> only after separate owner approval.
                  </p>
                  <label>
                    Exact source-run confirmation
                    <input name="confirmationText" autoComplete="off" required />
                  </label>
                  <label className="checkbox-line">
                    <input type="checkbox" name="ownerConfirmed" value="yes" required />I approve
                    this exact tenant capability and bounded GET run.
                  </label>
                  <button className="button button--primary" disabled={!canRun}>
                    Start bounded source read
                  </button>
                </form>
                <form
                  action={revokeSourceAction}
                  className="import-form"
                  aria-describedby={`source-revoke-help-${index}`}
                >
                  <input type="hidden" name="mutationNonce" value={nonces[index]?.revoke} />
                  <input type="hidden" name="capabilityId" value={capability.capabilityId} />
                  <p id={`source-revoke-help-${index}`}>
                    Revocation is an immutable new version and prevents later runs. Type{" "}
                    <code>REVOKE {capability.capabilityId}</code>.
                  </p>
                  <label>
                    Exact revocation confirmation
                    <input name="confirmationText" autoComplete="off" required />
                  </label>
                  <label className="checkbox-line">
                    <input type="checkbox" name="ownerConfirmed" value="yes" required />I approve
                    revocation of this capability.
                  </label>
                  <button className="button button--secondary">Revoke capability</button>
                </form>
              </div>
            </article>
          );
        })}
      </section>

      <section className="panel" aria-labelledby="source-recovery-heading">
        <span className="section-kicker">Durable recovery</span>
        <h2 id="source-recovery-heading">Recent bounded runs</h2>
        {view.recentRuns.length ? (
          <ol>
            {view.recentRuns.map((run, index) => (
              <li key={run.id}>
                <strong>
                  {run.source} · {run.alias} · {display(run.status)}
                </strong>{" "}
                — {run.requestCount} requests, {run.pageCount} pages, {run.recordCount} records.
                {run.safeErrorCode ? ` Safe stop: ${display(run.safeErrorCode)}.` : ""}
                {run.retryAfter ? ` Earliest owner-reviewed retry: ${run.retryAfter}.` : ""}
                {run.status === "RUNNING" ? (
                  <form action={cancelSourceRunAction} className="import-form">
                    <input type="hidden" name="mutationNonce" value={runNonces[index]} />
                    <input type="hidden" name="runId" value={run.id} />
                    <label>
                      Exact cancellation confirmation
                      <input
                        name="confirmationText"
                        autoComplete="off"
                        required
                        aria-describedby={`cancel-run-${index}`}
                      />
                    </label>
                    <p id={`cancel-run-${index}`}>
                      Type <code>CANCEL {run.id}</code>. Cancellation never resumes or retries the
                      request.
                    </p>
                    <label className="checkbox-line">
                      <input type="checkbox" name="ownerConfirmed" value="yes" required />I approve
                      stopping this run.
                    </label>
                    <button className="button button--secondary">Cancel active run</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p>No source runs recorded. There is no automatic start, resume, or retry.</p>
        )}
      </section>

      <section className="safety-banner">
        <div>
          <span className="section-kicker">Write boundary</span>
          <h2>Application URLs stay inert</h2>
        </div>
        <p>
          Discovery never visits an application URL. Authentication, access, bot, rate, schema and
          destination changes stop safely for owner review.
        </p>
      </section>
    </div>
  );
}
