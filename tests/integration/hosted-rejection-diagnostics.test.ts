import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "node:http";
import type { Server } from "node:http";
import type { Route } from "@playwright/test";
import {
  HostedApplicationService,
  HostedDiagnosticError,
  PlaywrightHostedApplicationDriver,
  hostedOwnerAction,
  hostedDigest,
  hostedDiagnostic,
  type HostedForm,
} from "@applypilot/application-runner";
import {
  createHostedFixture,
  fictionalHostedProof,
  FICTIONAL_BUILD,
  FICTIONAL_INSTANT,
} from "../helpers/hosted-fixture";
import { diagnosticCapability, diagnosticInstant } from "../helpers/hosted-diagnostic-fixture";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function instrumented(asset = "") {
  const f = await createHostedFixture("LEVER");
  cleanup.push(f.close);
  let driver!: PlaywrightHostedApplicationDriver;
  const transport = vi.fn(async (input: Parameters<typeof f.transport>[0]) => {
    const response = await f.transport(input);
    return {
      ...response,
      body: Buffer.from(response.body.toString().replace("</body>", `${asset}</body>`)),
    };
  });
  const service = new HostedApplicationService({
    store: f.store,
    reviewedBuild: FICTIONAL_BUILD,
    now: () => FICTIONAL_INSTANT,
    driverFactory: (onRequest) =>
      (driver = new PlaywrightHostedApplicationDriver({
        onRequest,
        transport,
        fictionalTransport: true,
        now: () => FICTIONAL_INSTANT,
      })),
  });
  cleanup.push(() => service.close());
  const inspect = () =>
    service.inspect(f.passiveCap, fictionalHostedProof(hostedOwnerAction("INSPECT", f.passiveCap)));
  const session = () => f.store.listSessions()[0]!;
  const owned = () =>
    driver as unknown as {
      browser: unknown;
      context: unknown;
      denyingProxy: Server | null;
      page: import("@playwright/test").Page | null;
    };
  return { f, service, inspect, session, transport, owned, driver: () => driver };
}

describe("actual Chromium route/fulfill/denying-proxy and durable fictional lifecycle", () => {
  it("succeeds on the exactly approved native page and creates one bound consent/session/claim", async () => {
    const x = await instrumented();
    const session = await x.inspect();
    expect(session.state).toBe("INSPECTED");
    expect(session.requestCount).toBe(1);
    expect(session.rejectionDiagnostic).toBeNull();
    for (const table of [
      "hosted_owner_consents",
      "hosted_browser_sessions",
      "hosted_operation_claims",
    ])
      expect(x.f.sqlite.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(1);
    expect(x.transport).toHaveBeenCalledTimes(1);
    await x.service.stop(session.id);
    expect(x.owned()).toMatchObject({
      browser: null,
      context: null,
      denyingProxy: null,
      page: null,
    });
  }, 30000);
  it.each([
    [
      "same-origin stylesheet",
      '<link rel="stylesheet" href="/fictional/denied.css">',
      "STYLESHEET",
    ],
    [
      "cross-origin stylesheet",
      '<link rel="stylesheet" href="https://fictional-assets.test/denied.css">',
      "STYLESHEET",
    ],
    ["same-origin image", '<img alt="Fictional" src="/fictional/denied.png">', "IMAGE"],
    [
      "cross-origin image",
      '<img alt="Fictional" src="https://fictional-assets.test/denied.png">',
      "IMAGE",
    ],
    [
      "same-origin font",
      "<style>@font-face{font-family:Fixture;src:url(/fictional/denied.woff2)}body{font-family:Fixture}</style>",
      "FONT",
    ],
    [
      "cross-origin font",
      "<style>@font-face{font-family:Fixture;src:url(https://fictional-assets.test/denied.woff2)}body{font-family:Fixture}</style>",
      "FONT",
    ],
  ])(
    "stops an approved document with an unapproved %s and never fetches the asset",
    async (_name, html, resource) => {
      const x = await instrumented(html);
      await expect(x.inspect()).rejects.toThrow("HOSTED_DESTINATION_FORBIDDEN");
      const session = x.session();
      expect(session).toMatchObject({
        state: "STOPPED",
        requestCount: 1,
        safeStopCode: "HOSTED_DESTINATION_FORBIDDEN",
        form: null,
        discovery: null,
        rejectionDiagnostic: {
          site: "ROUTE_READ_DESTINATION",
          resource,
          isNavigationRequest: false,
          isMainFrame: true,
          exactTarget: false,
          exactRead: false,
          transportPhase: "NOT_INVOKED",
          routeAttemptCount: 1,
        },
      });
      expect(x.transport).toHaveBeenCalledTimes(1);
      expect(x.owned()).toMatchObject({
        browser: null,
        context: null,
        denyingProxy: null,
        page: null,
      });
      const audit = x.f.sqlite
        .prepare(
          "SELECT redacted_metadata_json AS json FROM audit_events WHERE entity_id=? AND event_type='HOSTED_SESSION_STOPPED'",
        )
        .get(session.id) as { json: string };
      expect(JSON.parse(audit.json).rejectionDiagnostic).toEqual(session.rejectionDiagnostic);
      for (const table of [
        "hosted_owner_consents",
        "hosted_browser_sessions",
        "hosted_operation_claims",
      ])
        expect(x.f.sqlite.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(1);
      expect(
        x.f.sqlite
          .prepare("SELECT count(*) FROM hosted_operation_claims WHERE state='CLAIMED'")
          .pluck()
          .get(),
      ).toBe(0);
      expect(
        x.f.sqlite
          .prepare("SELECT count(*) FROM hosted_capability_versions WHERE revoked_at IS NULL")
          .pluck()
          .get(),
      ).toBe(0);
      await expect(x.inspect()).rejects.toThrow("HOSTED_CAPABILITY_NOT_CURRENT");
      const published = JSON.stringify(
        x.f.sqlite
          .prepare(
            "SELECT redacted_metadata_json FROM audit_events WHERE event_type='HOSTED_SESSION_STOPPED'",
          )
          .all(),
      );
      expect(published).not.toContain("fictional-assets.test");
      expect(published).not.toContain("denied.");
    },
    30000,
  );
  it("distinguishes an actual child-frame document rejection from a main-frame request", async () => {
    // A deterministic fixture barrier lets the real child route finish before the independent
    // existing frame-count snapshot fence. Neither production admission nor the route is mocked.
    type ObservedDriver = {
      route(route: Route): Promise<void>;
      snapshot(initial?: boolean): Promise<HostedForm>;
      page: import("@playwright/test").Page;
    };
    const prototype = PlaywrightHostedApplicationDriver.prototype as unknown as ObservedDriver;
    const route = prototype.route,
      snapshot = prototype.snapshot;
    let childDone!: () => void;
    const child = new Promise<void>((resolve) => {
      childDone = resolve;
    });
    vi.spyOn(prototype, "route").mockImplementation(async function (this: ObservedDriver, request) {
      const isChild = request.request().frame() !== this.page.mainFrame();
      await route.call(this, request);
      if (isChild) childDone();
    });
    vi.spyOn(prototype, "snapshot").mockImplementation(async function (
      this: ObservedDriver,
      initial,
    ) {
      await child;
      return snapshot.call(this, initial);
    });
    const x = await instrumented('<iframe src="https://fictional-frame.test/denied"></iframe>');
    await expect(x.inspect()).rejects.toThrow("HOSTED_DESTINATION_FORBIDDEN");
    expect(x.session().rejectionDiagnostic).toMatchObject({
      site: "ROUTE_READ_DESTINATION",
      resource: "DOCUMENT",
      isNavigationRequest: true,
      isMainFrame: false,
    });
    expect(x.transport).toHaveBeenCalledTimes(1);
  }, 30000);
  it("preserves original failure, stops/revokes and closes when diagnostic audit persistence fails", async () => {
    const x = await instrumented('<img src="/fictional/private-canary.png">');
    x.f.sqlite.exec(
      "CREATE TRIGGER fictional_deny_stop_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='HOSTED_SESSION_STOPPED' BEGIN SELECT RAISE(FAIL,'private-canary'); END;",
    );
    const error = await x.inspect().catch((error) => error);
    expect(error).toBeInstanceOf(HostedDiagnosticError);
    expect(error).toMatchObject({
      message: "HOSTED_DESTINATION_FORBIDDEN",
      auditPersistenceFailed: true,
      diagnostic: { site: "ROUTE_READ_DESTINATION" },
    });
    expect(x.session()).toMatchObject({
      state: "STOPPED",
      safeStopCode: "HOSTED_AUDIT_PERSISTENCE_FAILED",
      rejectionDiagnostic: null,
    });
    expect(x.owned()).toMatchObject({
      browser: null,
      context: null,
      denyingProxy: null,
      page: null,
    });
    expect(
      x.f.sqlite
        .prepare("SELECT count(*) FROM hosted_operation_claims WHERE state='CLAIMED'")
        .pluck()
        .get(),
    ).toBe(0);
    await expect(x.inspect()).rejects.toThrow("HOSTED_CAPABILITY_NOT_CURRENT");
    expect(x.transport).toHaveBeenCalledTimes(1);
  }, 30000);
  it("loads code-only legacy stops and never substitutes a later diagnostic audit", async () => {
    const x = await instrumented();
    const session = await x.inspect();
    await x.service.stop(session.id);
    expect(x.session().rejectionDiagnostic).toBeNull();
    x.f.sqlite
      .prepare(
        "INSERT INTO audit_events(id,event_type,actor,entity_type,entity_id,redacted_metadata_json,occurred_at) SELECT 'fictional-later-audit',event_type,actor,entity_type,entity_id,?,occurred_at FROM audit_events WHERE entity_id=? AND event_type='HOSTED_SESSION_STOPPED'",
      )
      .run(
        JSON.stringify({
          state: "STOPPED",
          rejectionDiagnostic: hostedDiagnostic("HOSTED_DESTINATION_FORBIDDEN", {
            site: "ROUTE_READ_DESTINATION",
          }),
        }),
        session.id,
      );
    expect(x.session().rejectionDiagnostic).toBeNull();
    x.f.sqlite
      .prepare(
        "UPDATE audit_events SET redacted_metadata_json=? WHERE entity_id=? AND event_type='HOSTED_SESSION_STOPPED'",
      )
      .run('{"rejectionDiagnostic":"private-canary"', session.id);
    expect(x.session().rejectionDiagnostic).toBeNull();
  }, 30000);
  it.each([false, true])(
    "carries returned submit rejection through completion with audit failure=%s, OUTCOME_UNKNOWN and no replay",
    async (auditFailure) => {
      const x = await instrumented();
      const inspected = await x.inspect();
      const { applicationCap } = await x.f.preparePacket(inspected.id);
      const review = await x.service.prepare(
        inspected.id,
        applicationCap,
        fictionalHostedProof(hostedOwnerAction("DISCLOSE", applicationCap, inspected.id)),
      );
      // Actual Chromium click triggers route method denial; no fictional POST reaches upstream.
      const privateDriver = x.driver() as unknown as { capability: typeof applicationCap };
      privateDriver.capability = { ...applicationCap, allowedWrites: [] };
      if (auditFailure)
        x.f.sqlite.exec(
          "CREATE TRIGGER fictional_deny_unknown_completion BEFORE INSERT ON audit_events WHEN NEW.event_type='HOSTED_OPERATION_COMPLETE' AND json_extract(NEW.redacted_metadata_json,'$.state')='OUTCOME_UNKNOWN' BEGIN SELECT RAISE(FAIL,'private-canary'); END;",
        );
      const result = await x.service.submit(
        review.id,
        fictionalHostedProof(
          hostedOwnerAction("SUBMIT", applicationCap, review.id, hostedDigest(review.preview)),
        ),
      );
      expect(result).toMatchObject({
        state: "OUTCOME_UNKNOWN",
        safeStopCode: auditFailure ? "HOSTED_TRANSPORT_OUTCOME_UNKNOWN" : "HOSTED_METHOD_FORBIDDEN",
        rejectionDiagnostic: { site: "ROUTE_METHOD_SCOPE", method: "POST", stage: "SUBMIT" },
      });
      expect(x.f.stats().confirmedPosts).toBe(0);
      const audit = x.f.sqlite
        .prepare(
          "SELECT redacted_metadata_json AS json FROM audit_events WHERE entity_id=? AND event_type IN ('HOSTED_SESSION_STOPPED','HOSTED_OPERATION_COMPLETE') ORDER BY rowid DESC LIMIT 1",
        )
        .get(result.id) as { json: string };
      expect(JSON.parse(audit.json).rejectionDiagnostic).toEqual(result.rejectionDiagnostic);
      await expect(
        x.service.submit(review.id, fictionalHostedProof("fictional-replay")),
      ).rejects.toThrow("HOSTED_CONTEXT_LOST");
      expect(x.owned()).toMatchObject({
        browser: null,
        context: null,
        denyingProxy: null,
        page: null,
      });
    },
    60000,
  );
});

describe("actual local denying proxy callbacks without destination access", () => {
  it.each(["GET", "CONNECT"])(
    "denies %s with UNKNOWN resource/frame and retains first evidence across later faults",
    async (method) => {
      const driver = new PlaywrightHostedApplicationDriver({
        now: () => diagnosticInstant,
        fictionalTransport: true,
        transport: async () => ({
          status: 200,
          headers: { "content-type": "text/html" },
          body: Buffer.from(
            '<form method="post"><label>Name<input name="name"></label><button>Apply</button></form>',
          ),
        }),
      });
      cleanup.push(() => driver.close());
      await driver.inspect(diagnosticCapability());
      const owned = driver as unknown as { denyingProxy: Server };
      const port = (owned.denyingProxy.address() as { port: number }).port;
      const deny = async (verb: string) =>
        await new Promise<number>((resolve, reject) => {
          const req = request(
            {
              host: "127.0.0.1",
              port,
              method: verb,
              path:
                verb === "CONNECT"
                  ? "private-canary.test:443"
                  : "http://private-canary.test/path?secret=private-canary",
              headers: { cookie: "private-canary" },
            },
            (response) => {
              response.resume();
              response.on("end", () => resolve(response.statusCode!));
            },
          );
          req.on("connect", (response, socket) => {
            socket.destroy();
            resolve(response.statusCode!);
          });
          req.on("error", reject);
          req.end();
        });
      expect(await deny(method)).toBe(403);
      const first = driver.getRejectionDiagnostic();
      expect(first).toMatchObject({
        site: method === "CONNECT" ? "PROXY_CONNECT_DENIED" : "PROXY_HTTP_DENIED",
        method,
        resource: "UNKNOWN",
        isMainFrame: null,
        isNavigationRequest: null,
        transportPhase: "NOT_INVOKED",
        proxyDenialCount: 1,
      });
      expect(await deny(method === "CONNECT" ? "GET" : "CONNECT")).toBe(403);
      await driver.close();
      expect(driver.getRejectionDiagnostic()).toEqual({
        ...first,
        secondaryRejectionCount: 1,
        secondaryProxyDenialCount: 1,
      });
      expect(JSON.stringify(driver.getRejectionDiagnostic())).not.toContain("private-canary");
    },
    30000,
  );
});
