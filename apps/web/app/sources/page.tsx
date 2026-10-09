import type { Metadata } from "next";
import { displaySourceSchemaDiagnostic } from "@applypilot/job-sources";

import {
  approveAndStartSourceRunAction,
  cancelSourceRunAction,
  revokeSourceAction,
  startSourceRunAction,
} from "./actions";
import { issueLocalMutationNonce } from "@web/lib/local-mutation-security";
import { getSourceEnablementView } from "@web/lib/source-workspace";

export const metadata: Metadata = { title: "Source approvals and recovery" };
export const dynamic = "force-dynamic";

const display = (value: string) => value.replaceAll("_", " ");

export default async function SourcesPage() {
  const view = await getSourceEnablementView();
  const nonces = await Promise.all(
    view.capabilities.map(async (capability) => {
      const combinedOwnerAction =
        capability.readiness === "SOURCE_ENABLED" &&
        capability.ownerApprovalState === "APPROVAL_REQUIRED";
      const legacyRunRecovery =
        capability.readiness === "SOURCE_ENABLED" &&
        capability.ownerApprovalState === "CURRENT" &&
        capability.canOwnerStart;
      const [approval, start, revoke] = await Promise.all([
        combinedOwnerAction
          ? issueLocalMutationNonce("SOURCE_CAPABILITY_APPROVE", "/sources")
          : Promise.resolve(null),
        combinedOwnerAction || legacyRunRecovery
          ? issueLocalMutationNonce("SOURCE_RUN_START", "/sources")
          : Promise.resolve(null),
        issueLocalMutationNonce("SOURCE_REVOKE", "/sources"),
      ]);
      return { approval, start, revoke };
    }),
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
            Local schema 12 is required before durable owner approval or source runs. Existing runs
            remain readable and their owner-action provenance is shown separately.
          </p>
        )}

        {view.capabilities.map((capability, index) => {
          const supported = capability.source === "LEVER" || capability.source === "GREENHOUSE";
          const enabled = supported && capability.readiness === "SOURCE_ENABLED";
          const combinedOwnerAction =
            enabled && capability.ownerApprovalState === "APPROVAL_REQUIRED";
          const legacyRunRecovery =
            enabled && capability.ownerApprovalState === "CURRENT" && capability.canOwnerStart;
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
                <p>Capability digest {capability.configurationDigest.slice(0, 12)}</p>
                <p>
                  Durable owner approval: {display(capability.ownerApprovalState)}
                  {capability.ownerApprovalReceiptId
                    ? ` · receipt ${capability.ownerApprovalReceiptId}`
                    : ""}
                </p>
                <p>
                  Exact boundary: https://{capability.host}
                  {capability.pathPrefix} · operations {capability.operations.join(" + ")}
                </p>
                {capability.exactExternalId ? (
                  <p>
                    Exact post {capability.exactExternalId} · application questions{" "}
                    {capability.includeQuestions ? "included" : "not requested"} · reader{" "}
                    {capability.readerVersion}
                  </p>
                ) : null}
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
                {combinedOwnerAction ? (
                  <form
                    action={approveAndStartSourceRunAction}
                    className="import-form"
                    aria-describedby={`source-combined-help-${index}`}
                  >
                    <input
                      type="hidden"
                      name="approvalMutationNonce"
                      value={nonces[index]?.approval ?? ""}
                    />
                    <input
                      type="hidden"
                      name="startMutationNonce"
                      value={nonces[index]?.start ?? ""}
                    />
                    <input type="hidden" name="capabilityId" value={capability.capabilityId} />
                    <input type="hidden" name="capabilityVersion" value={capability.version} />
                    <input
                      type="hidden"
                      name="capabilityDigest"
                      value={capability.configurationDigest}
                    />
                    <h4>Approve and start this exact bounded source read</h4>
                    <p id={`source-combined-help-${index}`}>
                      This single owner confirmation records approval for this exact capability and
                      immediately starts one bounded source read. It cannot be replayed. Type{" "}
                      <code>APPROVE AND RUN {capability.capabilityId}</code>.
                    </p>
                    <label>
                      Exact owner confirmation
                      <input name="confirmationText" autoComplete="off" required />
                    </label>
                    <label className="checkbox-line">
                      <input type="checkbox" name="ownerConfirmed" value="yes" required />I approve
                      this exact capability and one bounded source read.
                    </label>
                    <button className="button button--primary">
                      Approve &amp; start bounded source read
                    </button>
                  </form>
                ) : legacyRunRecovery ? (
                  <form
                    action={startSourceRunAction}
                    className="import-form"
                    aria-describedby={`source-run-help-${index}`}
                  >
                    <input type="hidden" name="mutationNonce" value={nonces[index]?.start ?? ""} />
                    <input type="hidden" name="capabilityId" value={capability.capabilityId} />
                    <input type="hidden" name="capabilityVersion" value={capability.version} />
                    <input
                      type="hidden"
                      name="capabilityDigest"
                      value={capability.configurationDigest}
                    />
                    <p id={`source-run-help-${index}`}>
                      A legacy owner approval is current for this exact capability. Type{" "}
                      <code>RUN {capability.capabilityId}</code> to start its bounded source read.
                    </p>
                    <label>
                      Exact source-run confirmation
                      <input name="confirmationText" autoComplete="off" required />
                    </label>
                    <label className="checkbox-line">
                      <input type="checkbox" name="ownerConfirmed" value="yes" required />I approve
                      this bounded source read.
                    </label>
                    <button className="button button--primary">Start bounded source read</button>
                  </form>
                ) : null}
                <form
                  action={revokeSourceAction}
                  className="import-form"
                  aria-describedby={`source-revoke-help-${index}`}
                >
                  <input type="hidden" name="mutationNonce" value={nonces[index]?.revoke} />
                  <input type="hidden" name="capabilityId" value={capability.capabilityId} />
                  <input type="hidden" name="capabilityVersion" value={capability.version} />
                  <input
                    type="hidden"
                    name="capabilityDigest"
                    value={capability.configurationDigest}
                  />
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
                — {run.requestCount} requests, {run.pageCount} pages, {run.providerRecordCount}
                provider records, {run.acceptedRecordCount} accepted, {run.unusableRecordCount}
                unusable, {run.providerDriftWarningCount} drift warnings, and{" "}
                {run.persistedObservationCount} persisted observations.
                {run.safeErrorCode ? ` Safe stop: ${display(run.safeErrorCode)}.` : ""}
                {run.transportStage
                  ? ` Deepest recorded transport stage: ${display(run.transportStage)}.`
                  : ""}
                {run.schemaDiagnostic
                  ? ` Contract diagnostic: ${displaySourceSchemaDiagnostic(run.schemaDiagnostic)}.`
                  : ""}
                {run.schemaDiagnosticState === "INVALID"
                  ? " Contract diagnostic unavailable: invalid stored diagnostic rejected."
                  : ""}
                {run.ownerProvenance === "LEGACY_OWNER_PROVENANCE_UNVERIFIED"
                  ? " LEGACY OWNER ACTION PROVENANCE UNVERIFIED."
                  : run.ownerProvenance === "OWNER_RECEIPT_BINDING_INVALID"
                    ? " OWNER RECEIPT BINDING INVALID; do not treat this run as owner-proven."
                    : " Owner approval and start receipts are bound to this run."}
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
