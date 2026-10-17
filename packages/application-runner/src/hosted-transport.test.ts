import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
import { pinnedHostedHttpTransport, type HostedHttpRequest } from "./hosted-transport";
let reply: {
  status: number;
  connected: string;
  headers: Record<string, string | string[]>;
  bytes: Buffer;
  error?: string;
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
        if (!response.destroyed) response.end(reply.bytes);
      });
    return outgoing;
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
