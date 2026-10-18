import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
import { pinnedHostedHttpTransport, type HostedHttpRequest } from "./hosted-transport";
import { hostedErrorDiagnostic } from "./hosted-diagnostics";
import { PlaywrightHostedApplicationDriver } from "./hosted-driver";
import {
  diagnosticCapability,
  diagnosticInstant,
} from "../../../tests/helpers/hosted-diagnostic-fixture";
let reply: {
  status: number;
  connected: string;
  headers: Record<string, string | string[]>;
  bytes: Buffer;
  error?: string;
  observeSocket?: boolean;
  responseError?: boolean;
};
const input = (): HostedHttpRequest => ({
  url: new URL("https://jobs.lever.co/fictional/one/apply"),
  method: "GET",
  headers: {},
  body: null,
  byteLimit: 1000,
  timeoutMs: 1000,
});
beforeEach(() => {
  vi.clearAllMocks();
  reply = {
    status: 200,
    connected: "93.184.216.34",
    headers: { "content-type": "text/html" },
    bytes: Buffer.from("fictional"),
  };
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocks.request.mockImplementation((_url, _options, callback) => {
    const outgoing = new EventEmitter() as EventEmitter & { write: () => void; end: () => void };
    outgoing.write = () => undefined;
    outgoing.end = () =>
      queueMicrotask(() => {
        if (reply.observeSocket) outgoing.emit("socket", {});
        if (reply.error) {
          outgoing.emit("error", new Error(reply.error));
          return;
        }
        const response = Object.assign(new PassThrough(), {
          statusCode: reply.status,
          headers: reply.headers,
          socket: { remoteAddress: reply.connected },
        });
        callback(response);
        if (reply.responseError) {
          response.emit("error", new Error("private-canary"));
          return;
        }
        if (!response.destroyed) response.end(reply.bytes);
      });
    return outgoing;
  });
});

describe("prospective native transport diagnoses with DNS/HTTPS mocked below the REAL admission boundary", () => {
  const originalReject = (request: HostedHttpRequest) =>
    request.url.protocol !== "https:" ||
    !!(
      request.url.username ||
      request.url.password ||
      request.url.port ||
      request.url.search ||
      request.url.hash
    ) ||
    !["GET", "POST"].includes(request.method) ||
    !Number.isInteger(request.timeoutMs) ||
    request.timeoutMs < 100 ||
    request.timeoutMs > 30000 ||
    !Number.isInteger(request.byteLimit) ||
    request.byteLimit < 1000 ||
    request.byteLimit > 5_000_000 ||
    (request.body?.length ?? 0) > 5_000_000 ||
    !!(request.method === "GET" && request.body);
  const invalids: { name: string; patch: Partial<HostedHttpRequest>; site: string }[] = [
    ...[
      "http://fictional.test/path",
      "https://fictional.test:444/path",
      "https://user:private-canary@fictional.test/path",
      "https://fictional.test/path?private-canary=value",
      "https://fictional.test/path#private-canary",
    ].map((url) => ({
      name: "URL shape",
      patch: { url: new URL(url) },
      site: "TRANSPORT_URL_SHAPE",
    })),
    { name: "method", patch: { method: "DELETE" as "GET" }, site: "TRANSPORT_METHOD" },
    ...[99, 30001, NaN, 1.5].map((timeoutMs) => ({
      name: "timeout",
      patch: { timeoutMs },
      site: "TRANSPORT_TIMEOUT_RANGE",
    })),
    ...[999, 5_000_001, NaN, 1000.5].map((byteLimit) => ({
      name: "byte limit",
      patch: { byteLimit },
      site: "TRANSPORT_BYTE_LIMIT_RANGE",
    })),
    {
      name: "large body",
      patch: { method: "POST", body: Buffer.alloc(5_000_001) },
      site: "TRANSPORT_BODY_LIMIT",
    },
    { name: "GET empty body", patch: { body: Buffer.alloc(0) }, site: "TRANSPORT_GET_BODY" },
  ];
  it("preserves native admission over boundary/configuration combinations", async () => {
    for (const method of ["GET", "POST", "DELETE"] as const)
      for (const body of [null, Buffer.alloc(0), Buffer.from("fictional")])
        for (const timeoutMs of [99, 100, 30000, 30001])
          for (const byteLimit of [999, 1000, 5_000_000, 5_000_001]) {
            mocks.lookup.mockClear();
            mocks.request.mockClear();
            const request = {
              ...input(),
              method: method as "GET" | "POST",
              body,
              timeoutMs,
              byteLimit,
            };
            const rejected = originalReject(request);
            const result = await pinnedHostedHttpTransport(request).then(
              () => true,
              () => false,
            );
            expect(result).toBe(!rejected);
            expect(mocks.lookup).toHaveBeenCalledTimes(rejected ? 0 : 1);
            expect(mocks.request).toHaveBeenCalledTimes(rejected ? 0 : 1);
          }
  });
  it.each(invalids)("retains original denial before DNS: $name", async ({ patch, site }) => {
    const request = { ...input(), ...patch, headers: { cookie: "private-canary" } };
    expect(originalReject(request)).toBe(true);
    const error = await pinnedHostedHttpTransport(request).catch((error) => error);
    expect(error.message).toBe("HOSTED_DESTINATION_FORBIDDEN");
    expect(hostedErrorDiagnostic(error)).toMatchObject({ site, transportPhase: "VALIDATING" });
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(JSON.stringify(hostedErrorDiagnostic(error))).not.toContain("private-canary");
  });
  it.each(["DNS", "request without socket", "socket", "headers", "body"] as const)(
    "records only observed phase for failure at %s",
    async (kind) => {
      if (kind === "DNS") mocks.lookup.mockRejectedValue(new Error("private-canary"));
      if (kind === "request without socket" || kind === "socket") reply.error = "private-canary";
      if (kind === "socket") reply.observeSocket = true;
      if (kind === "headers") reply.headers["content-encoding"] = "gzip";
      if (kind === "body") reply.responseError = true;
      const error = await pinnedHostedHttpTransport(input()).catch((error) => error);
      expect(hostedErrorDiagnostic(error)?.transportPhase).toBe(
        kind === "DNS" || kind === "request without socket"
          ? "DNS_STARTED"
          : kind === "socket"
            ? "SOCKET_OBSERVED"
            : "RESPONSE_HEADERS_OBSERVED",
      );
      expect(JSON.stringify(error)).not.toContain("private-canary");
    },
  );
  it("freezes failure phase before later socket, headers and body events", async () => {
    mocks.request.mockImplementation((_url, _options, callback) => {
      const outgoing = Object.assign(new EventEmitter(), {
        write: () => undefined,
        end: () =>
          queueMicrotask(() => {
            outgoing.emit("error", new Error("private-canary"));
            outgoing.emit("socket", {});
            const response = Object.assign(new PassThrough(), {
              statusCode: 200,
              headers: {},
              socket: { remoteAddress: "93.184.216.34" },
            });
            callback(response);
            response.end("fictional");
          }),
      });
      return outgoing;
    });
    const error = await pinnedHostedHttpTransport(input()).catch((error) => error);
    expect(hostedErrorDiagnostic(error)).toMatchObject({
      safeCode: "HOSTED_TRANSPORT_OUTCOME_UNKNOWN",
      transportPhase: "DNS_STARTED",
    });
    expect(JSON.stringify(error)).not.toContain("private-canary");
  });
  it.each([200, 403])(
    "uses REAL native transport and actual Chromium/proxy/route/fulfill with status %s",
    async (status) => {
      reply.status = status;
      reply.observeSocket = true;
      reply.bytes = Buffer.from(
        '<form method="post" action="/fictional/post/apply"><label>Fictional name<input name="name"></label><button type="submit">Apply</button></form>',
      );
      const driver = new PlaywrightHostedApplicationDriver({ now: () => diagnosticInstant });
      try {
        const result = driver.inspect({ ...diagnosticCapability(), mode: "REAL" });
        if (status === 200) {
          expect((await result).controls).toHaveLength(2);
          expect(driver.getRejectionDiagnostic()).toBeNull();
        } else {
          await expect(result).rejects.toThrow("HOSTED_ACCESS_CONTROL");
          expect(driver.getRejectionDiagnostic()).toMatchObject({
            transportPhase: "BODY_COMPLETED",
            resource: "DOCUMENT",
            isMainFrame: true,
            routeAttemptCount: 1,
          });
        }
        expect(mocks.lookup).toHaveBeenCalledTimes(1);
        expect(mocks.request).toHaveBeenCalledTimes(1);
      } finally {
        await driver.close();
      }
    },
    30000,
  );
  it("still refuses injected transports in REAL before Chromium or DNS", async () => {
    const transport = vi.fn();
    const driver = new PlaywrightHostedApplicationDriver({ transport });
    await expect(driver.inspect({ ...diagnosticCapability(), mode: "REAL" })).rejects.toThrow(
      "HOSTED_DESTINATION_FORBIDDEN",
    );
    expect(driver.getRejectionDiagnostic()).toMatchObject({
      site: "DRIVER_REAL_MODE_INJECTION",
      resource: "UNKNOWN",
      transportPhase: "NOT_INVOKED",
    });
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    await driver.close();
  });
});
afterEach(() => vi.useRealTimers());
describe("pinned hosted HTTPS transport without live network", () => {
  it("pins the approved address, strips unneeded headers and preserves anonymous cookie/CSRF headers", async () => {
    const req = input();
    req.headers = {
      cookie: "fictional-private-cookie",
      "x-csrf-token": "fictional-csrf",
      authorization: "fictional-secret",
      "x-arbitrary": "fictional-canary",
    };
    expect((await pinnedHostedHttpTransport(req)).body.toString()).toBe("fictional");
    const options = mocks.request.mock.calls[0]![1];
    expect(options.headers).toEqual({
      cookie: "fictional-private-cookie",
      "x-csrf-token": "fictional-csrf",
      "accept-encoding": "identity",
    });
    const resolved = vi.fn();
    options.lookup("ignored", { all: true }, resolved);
    expect(resolved).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("preserves separate Set-Cookie values using Playwright's newline contract", async () => {
    reply.headers["set-cookie"] = [
      "fictional_a=one; Secure; Expires=Wed, 21 Oct 2099 07:28:00 GMT",
      "fictional_b=two; Secure",
    ];
    expect((await pinnedHostedHttpTransport(input())).headers["set-cookie"]).toBe(
      reply.headers["set-cookie"].join("\n"),
    );
  });
  it.each([
    "http://jobs.lever.co/fictional",
    "https://user:secret@jobs.lever.co/fictional",
    "https://jobs.lever.co:444/fictional",
    "https://jobs.lever.co/fictional?canary=secret",
    "https://jobs.lever.co/fictional#secret",
  ])("rejects invalid destination before DNS %s", async (url) => {
    await expect(pinnedHostedHttpTransport({ ...input(), url: new URL(url) })).rejects.toThrow(
      "HOSTED_DESTINATION_FORBIDDEN",
    );
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it.each(["127.0.0.1", "::1", "192.168.1.1", "169.254.169.254", "::ffff:127.0.0.1"])(
    "rejects any private DNS answer %s without request",
    async (address) => {
      mocks.lookup.mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
        { address, family: address.includes(":") ? 6 : 4 },
      ]);
      await expect(pinnedHostedHttpTransport(input())).rejects.toThrow(
        "HOSTED_NETWORK_ADDRESS_FORBIDDEN",
      );
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it.each(["redirect", "address", "encoding", "bytes"] as const)(
    "contains %s response without redirect or retry",
    async (kind) => {
      const codes = {
        redirect: "HOSTED_REDIRECT_FORBIDDEN",
        address: "HOSTED_NETWORK_ADDRESS_CHANGED",
        encoding: "HOSTED_CONTENT_ENCODING_UNSUPPORTED",
        bytes: "HOSTED_RESPONSE_TOO_LARGE",
      };
      if (kind === "redirect") {
        reply.status = 302;
        reply.headers.location = "https://unapproved.test/private-canary";
      }
      if (kind === "address") reply.connected = "127.0.0.1";
      if (kind === "encoding") reply.headers["content-encoding"] = "gzip";
      if (kind === "bytes") reply.bytes = Buffer.alloc(1001);
      await expect(pinnedHostedHttpTransport(input())).rejects.toThrow(codes[kind]);
      expect(mocks.request).toHaveBeenCalledTimes(1);
    },
  );
  it("reports a transport ambiguity without printing raw error arguments or retrying", async () => {
    reply.error = "private-canary cookie sql token";
    await expect(pinnedHostedHttpTransport(input())).rejects.toThrow(
      "HOSTED_TRANSPORT_OUTCOME_UNKNOWN",
    );
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("bounds DNS wait and never dispatches after its timeout", async () => {
    vi.useFakeTimers();
    mocks.lookup.mockReturnValue(new Promise(() => undefined));
    const rejection = expect(
      pinnedHostedHttpTransport({ ...input(), timeoutMs: 100 }),
    ).rejects.toThrow("HOSTED_DNS_FAILED");
    await vi.advanceTimersByTimeAsync(101);
    await rejection;
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
