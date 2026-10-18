import { describe, expect, it, vi } from "vitest";
import {
  HostedDiagnosticError,
  HostedRejectionDiagnosticSchema,
  HostedRejectionRecorder,
  hostedDiagnostic,
} from "./hosted-diagnostics";
import { PlaywrightHostedApplicationDriver } from "./hosted-driver";
import {
  diagnosticInstant,
  diagnosticRoute,
  routeBoundary,
} from "../../../tests/helpers/hosted-diagnostic-fixture";

it("preserves the first observed route failure after a later in-flight response failure", async () => {
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const driver = new PlaywrightHostedApplicationDriver({
    now: () => diagnosticInstant,
    fictionalTransport: true,
    transport: async () => {
      entered();
      await pending;
      throw new Error("HOSTED_ACCESS_CONTROL");
    },
  });
  const { boundary, frame } = routeBoundary(driver);
  const first = diagnosticRoute(boundary.capability.subject.targetUrl, { frame });
  const inFlight = boundary.route(first.route);
  await ready;
  await boundary.route(
    diagnosticRoute(`${boundary.capability.subject.targetUrl}?fictional=denied`, { frame }).route,
  );
  release();
  await inFlight;
  expect(driver.getRejectionDiagnostic()).toMatchObject({
    site: "ROUTE_URL_SHAPE",
    safeCode: "HOSTED_DESTINATION_FORBIDDEN",
    routeAttemptCount: 1,
    secondaryRejectionCount: 1,
  });
  expect(() => boundary.assertHealthy()).toThrow("HOSTED_DESTINATION_FORBIDDEN");
  await driver.close();
  expect(() => boundary.assertHealthy()).toThrow("HOSTED_DESTINATION_FORBIDDEN");
});

describe("diagnostic-only route decisions versus the retained original authorization predicate", () => {
  const target = "https://jobs.lever.co/fictional/post/apply";
  // Independent transcription of the original boundary at c9b8146. No diagnosis drives admission.
  const original = (url: URL, method: string, body: Buffer | null) =>
    url.protocol !== "https:" ||
    !!(url.port || url.username || url.password || url.search || url.hash)
      ? "HOSTED_DESTINATION_FORBIDDEN"
      : method === "GET"
        ? url.origin !== "https://jobs.lever.co" || url.pathname !== "/fictional/post/apply" || body
          ? "HOSTED_DESTINATION_FORBIDDEN"
          : null
        : "HOSTED_METHOD_FORBIDDEN";
  const cases = [
    ["approved", target, "GET", null, null],
    ["missing path", target + "/other", "GET", null, "ROUTE_READ_DESTINATION"],
    ["scheme", target.replace("https:", "http:"), "GET", null, "ROUTE_URL_SHAPE"],
    ["port", target.replace(".co/", ".co:444/"), "GET", null, "ROUTE_URL_SHAPE"],
    [
      "credentials",
      target.replace("https://", "https://fictional:private-canary@"),
      "GET",
      null,
      "ROUTE_URL_SHAPE",
    ],
    ["query", target + "?private-canary=value", "GET", null, "ROUTE_URL_SHAPE"],
    ["fragment", target + "#private-canary", "GET", null, "ROUTE_URL_SHAPE"],
    ["GET body", target, "GET", Buffer.from("private-canary"), "ROUTE_GET_BODY"],
    ["POST scope", target, "POST", null, "ROUTE_METHOD_SCOPE"],
    ["other method", target, "DELETE", null, "ROUTE_METHOD_SCOPE"],
    [
      "precedence",
      target + "/other?private-canary=value",
      "DELETE",
      Buffer.from("private-canary"),
      "ROUTE_URL_SHAPE",
    ],
  ] as const;
  it("preserves the authorization property across URL, method and body combinations", async () => {
    const urls = [
      target,
      target + "/other",
      target + "?fixture=value",
      target + "#fixture",
      target.replace("https:", "http:"),
      target.replace(".co/", ".co:444/"),
      target.replace("https://", "https://fixture:fixture@"),
    ];
    for (const url of urls)
      for (const method of ["GET", "POST", "DELETE"])
        for (const body of [null, Buffer.alloc(0), Buffer.from("fictional")]) {
          const transport = vi.fn(async () => ({
            status: 200,
            headers: {},
            body: Buffer.from("fictional"),
          }));
          const driver = new PlaywrightHostedApplicationDriver({
            transport,
            fictionalTransport: true,
            now: () => diagnosticInstant,
          });
          const { boundary, frame } = routeBoundary(driver);
          const attempt = diagnosticRoute(url, { method, body, frame });
          await boundary.route(attempt.route);
          const denied = original(new URL(url), method, body) !== null;
          expect(attempt.aborted()).toBe(denied);
          expect(transport).toHaveBeenCalledTimes(denied ? 0 : 1);
          await driver.close();
        }
  });
  it.each(cases)(
    "keeps %s decision and records no destination values",
    async (_name, url, method, body, site) => {
      const transport = vi.fn(async () => ({
        status: 200,
        headers: {},
        body: Buffer.from("fictional"),
      }));
      const driver = new PlaywrightHostedApplicationDriver({
        now: () => diagnosticInstant,
        fictionalTransport: true,
        transport,
      });
      const { boundary, frame } = routeBoundary(driver);
      const attempt = diagnosticRoute(url, { method, body, frame });
      await boundary.route(attempt.route);
      const code = original(new URL(url), method, body);
      expect(attempt.aborted()).toBe(code !== null);
      expect(attempt.fulfilled()).toBe(code === null);
      expect(transport).toHaveBeenCalledTimes(code ? 0 : 1);
      if (code) {
        expect(driver.getRejectionDiagnostic()).toMatchObject({
          safeCode: code,
          site,
          routeAttemptCount: 0,
          transportPhase: "NOT_INVOKED",
          isMainFrame: true,
          isNavigationRequest: true,
          resource: "DOCUMENT",
        });
        expect(JSON.stringify(driver.getRejectionDiagnostic())).not.toContain("private-canary");
        expect(JSON.stringify(driver.getRejectionDiagnostic())).not.toContain("jobs.lever.co");
        if (site === "ROUTE_URL_SHAPE") {
          const parsed = new URL(url);
          expect(driver.getRejectionDiagnostic()?.urlShape).toEqual({
            nonHttps: parsed.protocol !== "https:",
            nonDefaultPort: !!parsed.port,
            credentials: !!(parsed.username || parsed.password),
            query: !!parsed.search,
            fragment: !!parsed.hash,
          });
        }
      } else expect(driver.getRejectionDiagnostic()).toBeNull();
      await driver.close();
    },
  );
  it("does not conflate a local increment or failed admission callback with native transport", async () => {
    const transport = vi.fn();
    const driver = new PlaywrightHostedApplicationDriver({
      now: () => diagnosticInstant,
      transport,
      fictionalTransport: true,
      onRequest: () => {
        throw new Error("HOSTED_AUDIT_PERSISTENCE_FAILED");
      },
    });
    const { boundary, frame } = routeBoundary(driver);
    await boundary.route(diagnosticRoute(target, { frame }).route);
    expect(driver.getRejectionDiagnostic()).toMatchObject({
      routeAttemptCount: 1,
      transportPhase: "NOT_INVOKED",
    });
    expect(transport).not.toHaveBeenCalled();
    await driver.close();
  });
  it("keeps budget limits and local overshoot semantics", async () => {
    const transport = vi.fn(async () => ({
      status: 200,
      headers: {},
      body: Buffer.from("fictional"),
    }));
    const driver = new PlaywrightHostedApplicationDriver({
      now: () => diagnosticInstant,
      transport,
      fictionalTransport: true,
    });
    const { boundary, frame } = routeBoundary(driver);
    boundary.capability.requestBudget = 1;
    await boundary.route(diagnosticRoute(target, { frame }).route);
    await boundary.route(diagnosticRoute(target, { frame }).route);
    expect(driver.getRejectionDiagnostic()).toMatchObject({
      safeCode: "HOSTED_REQUEST_BUDGET_EXHAUSTED",
      routeAttemptCount: 2,
      transportPhase: "NOT_INVOKED",
    });
    expect(transport).toHaveBeenCalledTimes(1);
    await driver.close();
  });
});

it("rejects raw/extra-key evidence and caps later rejections without replacing first fields", () => {
  const first = hostedDiagnostic("HOSTED_METHOD_FORBIDDEN", {
    site: "ROUTE_METHOD_SCOPE",
    method: "OTHER",
    transportPhase: "NOT_INVOKED",
  });
  const recorder = new HostedRejectionRecorder();
  recorder.record(first);
  const untouched = JSON.parse(JSON.stringify(first));
  first.urlShape.query = true;
  const snapshot = recorder.snapshot()!;
  snapshot.urlShape.credentials = true;
  expect(recorder.snapshot()).toEqual(untouched);
  first.urlShape.query = null;
  for (let i = 0; i < 1100; i++)
    recorder.record(
      hostedDiagnostic("HOSTED_DESTINATION_FORBIDDEN", { site: "PROXY_CONNECT_DENIED" }),
      true,
    );
  expect(recorder.snapshot()).toEqual({
    ...first,
    secondaryRejectionCount: 1000,
    secondaryProxyDenialCount: 1000,
  });
  for (const invalid of [
    { ...first, url: "private-canary" },
    { ...first, site: "private-canary" },
    { ...first, urlShape: { ...first.urlShape, query: "private-canary" } },
    { ...first, routeAttemptCount: 1001 },
  ]) {
    expect(HostedRejectionDiagnosticSchema.safeParse(invalid).success).toBe(false);
    expect(new HostedDiagnosticError("private-canary", invalid).diagnostic).toBeNull();
  }
});

it("counts only directly observed proxy callbacks after a prior proxy fault", async () => {
  const driver = new PlaywrightHostedApplicationDriver({ now: () => diagnosticInstant });
  const { boundary, frame } = routeBoundary(driver);
  const proxy = driver as unknown as {
    proxyFailure(site: "PROXY_CONNECT_DENIED" | "PROXY_HTTP_DENIED", method: string): void;
  };
  proxy.proxyFailure("PROXY_CONNECT_DENIED", "CONNECT");
  await boundary.route(diagnosticRoute(boundary.capability.subject.targetUrl, { frame }).route);
  expect(driver.getRejectionDiagnostic()).toMatchObject({
    site: "PROXY_CONNECT_DENIED",
    proxyDenialCount: 1,
    secondaryRejectionCount: 1,
    secondaryProxyDenialCount: 0,
  });
  proxy.proxyFailure("PROXY_HTTP_DENIED", "GET");
  expect(driver.getRejectionDiagnostic()).toMatchObject({
    site: "PROXY_CONNECT_DENIED",
    proxyDenialCount: 1,
    secondaryRejectionCount: 2,
    secondaryProxyDenialCount: 1,
  });
  await driver.close();
});
