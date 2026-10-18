import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { hostedDiagnostic } from "@applypilot/application-runner";
import { HostedRejectionDetails } from "./hosted-rejection-details";

describe("read-only strict diagnostic display", () => {
  it("shows only closed observations and bounded counters", () => {
    const diagnostic = hostedDiagnostic("HOSTED_DESTINATION_FORBIDDEN", {
      site: "PROXY_CONNECT_DENIED",
      method: "CONNECT",
      transportPhase: "NOT_INVOKED",
      proxyDenialCount: 1,
    });
    const html = renderToStaticMarkup(<HostedRejectionDetails diagnostic={diagnostic} />);
    expect(html).toContain("PROXY_CONNECT_DENIED");
    expect(html).toContain("UNKNOWN");
    expect(html).toContain("NOT_INVOKED");
    expect(html).not.toContain("<form");
  });
  it.each([
    null,
    undefined,
    { raw: "private-canary" },
    { ...hostedDiagnostic("HOSTED_DESTINATION_FORBIDDEN"), url: "private-canary" },
    { ...hostedDiagnostic("HOSTED_DESTINATION_FORBIDDEN"), site: "private-canary" },
  ])("keeps legacy and malformed evidence unretained without publishing raw keys", (diagnostic) => {
    const html = renderToStaticMarkup(<HostedRejectionDetails diagnostic={diagnostic} />);
    expect(html).toBe("<p>DIAGNOSTIC_NOT_RETAINED</p>");
    expect(html).not.toContain("private-canary");
  });
});
