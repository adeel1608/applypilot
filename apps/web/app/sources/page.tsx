import { dirname } from "node:path";

import type { Metadata } from "next";

import { loadPrivateSourceAllowlist, publicSourceReadiness } from "@applypilot/job-sources";
import { getSourceCapabilitySummary } from "@web/lib/beta-workspace";
import { resolveLocalDataDirectory } from "@web/lib/local-data-directory";

export const metadata: Metadata = { title: "Sources" };
export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  let privateState: Awaited<ReturnType<typeof loadPrivateSourceAllowlist>> | null = null;
  let safeError = false;
  try {
    privateState = await loadPrivateSourceAllowlist(dirname(resolveLocalDataDirectory()));
  } catch {
    safeError = true;
  }
  const persisted = getSourceCapabilitySummary();
  return (
    <div className="page-stack">
      <section className="page-heading">
        <div className="eyebrow">Owner-started · GET only · no scheduler</div>
        <h1>Source capabilities</h1>
        <p>
          Greenhouse and Lever readers are implemented but default-disabled. Candidate data is never
          supplied to discovery or source requests.
        </p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Effective private configuration</span>
            <h2>
              {safeError
                ? "Configuration rejected"
                : (privateState?.status.replaceAll("_", " ") ?? "Unavailable")}
            </h2>
          </div>
          <span className="source-pill">Real calls this session: 0</span>
        </div>
        {safeError && <p>The private allowlist failed validation and no source is enabled.</p>}
        {privateState?.status === "SOURCE_READY_AWAITING_TENANT" && (
          <p>
            No approved private tenant is configured. ApplyPilot will not guess, enumerate, or
            substitute a public tenant.
          </p>
        )}
        {privateState?.status === "SOURCE_ALLOWLIST_READY" && (
          <div className="job-list">
            {privateState.capabilities.map((capability) => {
              const readiness = publicSourceReadiness(capability);
              return (
                <article className="job-row" key={`${capability.source}:${capability.alias}`}>
                  <div className="job-row__main">
                    <h3>
                      {capability.source} · {capability.alias}
                    </h3>
                    <p>
                      {readiness.status.replaceAll("_", " ")} · expires{" "}
                      {new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(
                        new Date(capability.policyExpiresAt),
                      )}
                    </p>
                  </div>
                  <span className="source-pill">{capability.allowedOperations.join(" + ")}</span>
                  <button className="button button--secondary" disabled>
                    Owner-started read not requested
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <section className="panel">
        <span className="section-kicker">Durable run metadata</span>
        <h2>{persisted.status.replaceAll("_", " ")}</h2>
        <p>
          Bounded run records retain only source, safe counts, cursor metadata and safe error codes;
          they never store credentials, cookies, candidate facts or browser state.
        </p>
      </section>
      <section className="safety-banner">
        <div>
          <span className="section-kicker">Write boundary</span>
          <h2>No application endpoints</h2>
        </div>
        <p>
          Every non-GET source operation is rejected. Real application automation remains disabled.
        </p>
      </section>
    </div>
  );
}
