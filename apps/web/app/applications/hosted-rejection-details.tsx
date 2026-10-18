import { HostedRejectionDiagnosticSchema } from "@applypilot/application-runner";

/** Re-parse at the display boundary; never render an exception or arbitrary metadata. */
export function HostedRejectionDetails({ diagnostic }: { diagnostic: unknown }) {
  const parsed = HostedRejectionDiagnosticSchema.safeParse(diagnostic);
  if (!parsed.success) return <p>DIAGNOSTIC_NOT_RETAINED</p>;
  const d = parsed.data;
  const observed = (value: boolean | null) => (value === null ? "UNKNOWN" : value ? "YES" : "NO");
  return (
    <details>
      <summary>First observed rejection · {d.site}</summary>
      <p>
        This observation does not establish the physical root cause. Counts were captured before
        browser cleanup.
      </p>
      <dl>
        <dt>Diagnostic version</dt>
        <dd>{d.schemaVersion}</dd>
        <dt>Public code</dt>
        <dd>{d.safeCode}</dd>
        <dt>Stage / method / resource</dt>
        <dd>
          {d.stage} / {d.method} / {d.resource}
        </dd>
        <dt>Navigation / main frame</dt>
        <dd>
          {observed(d.isNavigationRequest)} / {observed(d.isMainFrame)}
        </dd>
        <dt>Exact target / read / current write</dt>
        <dd>
          {observed(d.exactTarget)} / {observed(d.exactRead)} / {observed(d.exactWrite)}
        </dd>
        <dt>Non-HTTPS / port / credentials / query / fragment</dt>
        <dd>
          {observed(d.urlShape.nonHttps)} / {observed(d.urlShape.nonDefaultPort)} /{" "}
          {observed(d.urlShape.credentials)} / {observed(d.urlShape.query)} /{" "}
          {observed(d.urlShape.fragment)}
        </dd>
        <dt>Valid method / timeout / byte limit / body limit / GET body</dt>
        <dd>
          {observed(d.transportConfig.methodValid)} / {observed(d.transportConfig.timeoutValid)} /{" "}
          {observed(d.transportConfig.byteLimitValid)} /{" "}
          {observed(d.transportConfig.bodyLimitValid)} / {observed(d.transportConfig.getBodyValid)}
        </dd>
        <dt>Observed transport phase</dt>
        <dd>{d.transportPhase}</dd>
        <dt>Observation / local route attempts / proxy denials</dt>
        <dd>
          {d.observationSequence} / {d.routeAttemptCount} / {d.proxyDenialCount}
        </dd>
        <dt>Secondary rejections / proxy denials</dt>
        <dd>
          {d.secondaryRejectionCount} / {d.secondaryProxyDenialCount}
        </dd>
      </dl>
      <p>
        Local route attempts precede durable admission and do not prove DNS, a connection or a
        response.
      </p>
    </details>
  );
}
