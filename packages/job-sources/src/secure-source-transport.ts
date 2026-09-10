import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import {
  SourceCapabilityV2Schema,
  SourceRunBudget,
  type SourceCapabilityV2,
  type SourceOperation,
} from "./source-capability";
import { isBlockedNetworkAddress } from "./public-postings";

export class SecureSourceError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfter: string | null = null,
  ) {
    super(code);
  }
}

export interface SecureSourceResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
  connectedAddress: string;
}

export interface SecureSourceTransportDependencies {
  resolveHost(hostname: string): Promise<string[]>;
  request(input: {
    url: URL;
    pinnedAddress: string;
    signal: AbortSignal;
    byteLimit: number;
  }): Promise<SecureSourceResponse>;
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(",") : (value ?? "");
}

const defaultDependencies: SecureSourceTransportDependencies = {
  resolveHost: async (hostname) =>
    (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address),
  request: ({ url, pinnedAddress, signal, byteLimit }) =>
    new Promise((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method: "GET",
          signal,
          servername: url.hostname,
          headers: {
            accept: "application/json",
            "accept-encoding": "identity",
            "user-agent": "ApplyPilot/0.1 read-only owner-started source client",
          },
          lookup: (_hostname, _options, callback) => {
            const family = isIP(pinnedAddress);
            if (family !== 4 && family !== 6) {
              callback(new Error("PINNED_ADDRESS_INVALID"), pinnedAddress, 0);
              return;
            }
            callback(null, pinnedAddress, family);
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let total = 0;
          response.on("data", (chunk: Buffer) => {
            total += chunk.byteLength;
            if (total > byteLimit) {
              response.destroy(new SecureSourceError("RESPONSE_TOO_LARGE"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => {
            const headers = Object.fromEntries(
              Object.entries(response.headers).map(([key, value]) => [key, headerValue(value)]),
            );
            resolve({
              status: response.statusCode ?? 0,
              headers,
              body: Buffer.concat(chunks),
              connectedAddress: pinnedAddress,
            });
          });
        },
      );
      request.on("error", reject);
      request.end();
    }),
};

function allowedQuery(operation: SourceOperation, capability: SourceCapabilityV2): Set<string> {
  if (capability.source === "LEVER") {
    return operation === "LIST_JOBS" ? new Set(["mode", "skip", "limit"]) : new Set(["mode"]);
  }
  return operation === "LIST_JOBS" ? new Set(["content"]) : new Set();
}

export async function validateSecureSourceUrl(
  value: string,
  capabilityInput: SourceCapabilityV2,
  operation: SourceOperation,
  resolveHost: SecureSourceTransportDependencies["resolveHost"],
): Promise<{ url: URL; pinnedAddress: string }> {
  const capability = SourceCapabilityV2Schema.parse(capabilityInput);
  if (!capability.allowedOperations.includes(operation)) {
    throw new SecureSourceError("OPERATION_NOT_APPROVED");
  }
  const url = new URL(value);
  if (url.protocol !== "https:") throw new SecureSourceError("HTTPS_REQUIRED");
  if (url.username || url.password) throw new SecureSourceError("URL_CREDENTIALS_FORBIDDEN");
  if (url.port && url.port !== "443") throw new SecureSourceError("NON_STANDARD_PORT_FORBIDDEN");
  if (url.hash) throw new SecureSourceError("URL_FRAGMENT_FORBIDDEN");
  if (url.hostname !== capability.allowedHost) throw new SecureSourceError("HOST_NOT_ALLOWLISTED");
  const prefix = capability.allowedPathPrefix.endsWith("/")
    ? capability.allowedPathPrefix.slice(0, -1)
    : capability.allowedPathPrefix;
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
    throw new SecureSourceError("PATH_NOT_ALLOWLISTED");
  }
  const queryKeys = new Set([...url.searchParams.keys()]);
  const allowed = allowedQuery(operation, capability);
  if ([...queryKeys].some((key) => !allowed.has(key))) {
    throw new SecureSourceError("QUERY_NOT_ALLOWLISTED");
  }
  if (capability.source === "LEVER" && url.searchParams.get("mode") !== "json") {
    throw new SecureSourceError("QUERY_NOT_ALLOWLISTED");
  }
  const addresses = [...new Set(await resolveHost(url.hostname))];
  if (addresses.length === 0 || addresses.some(isBlockedNetworkAddress)) {
    throw new SecureSourceError("DESTINATION_ADDRESS_FORBIDDEN");
  }
  return { url, pinnedAddress: addresses[0]! };
}

function retryAfter(headers: Readonly<Record<string, string>>, now: Date): string | null {
  const value = headers["retry-after"];
  if (!value) return null;
  const seconds = Number(value);
  const timestamp = Number.isFinite(seconds)
    ? now.getTime() + Math.max(0, Math.min(seconds, 86_400)) * 1000
    : Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export async function boundedSecureJsonGet(input: {
  initialUrl: string;
  capability: SourceCapabilityV2;
  operation: SourceOperation;
  budget: SourceRunBudget;
  now?: () => Date;
  signal?: AbortSignal;
  dependencies?: SecureSourceTransportDependencies;
}): Promise<{ body: unknown; byteCount: number; requestCount: number; redirectCount: number }> {
  const capability = SourceCapabilityV2Schema.parse(input.capability);
  const dependencies = input.dependencies ?? defaultDependencies;
  const now = input.now ?? (() => new Date());
  let next = input.initialUrl;
  let localRequests = 0;
  let localRedirects = 0;
  let retries = 0;

  while (true) {
    if (input.signal?.aborted) throw new SecureSourceError("OWNER_CANCELLED");
    input.budget.assertCurrent(now());
    input.budget.consumeAttempt();
    localRequests += 1;
    const { url, pinnedAddress } = await validateSecureSourceUrl(
      next,
      capability,
      input.operation,
      dependencies.resolveHost,
    );
    const timeout = AbortSignal.timeout(capability.requestTimeoutMs);
    const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
    let response: SecureSourceResponse;
    try {
      response = await dependencies.request({
        url,
        pinnedAddress,
        signal,
        byteLimit: capability.responseByteLimit,
      });
    } catch (error) {
      if (input.signal?.aborted) throw new SecureSourceError("OWNER_CANCELLED");
      if (signal.aborted) throw new SecureSourceError("REQUEST_TIMEOUT");
      if (retries < capability.maxRetries) {
        retries += 1;
        input.budget.retries += 1;
        continue;
      }
      throw error instanceof SecureSourceError
        ? error
        : new SecureSourceError("NETWORK_OUTCOME_UNKNOWN");
    }
    if (response.connectedAddress !== pinnedAddress) {
      throw new SecureSourceError("PINNED_ADDRESS_MISMATCH");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (localRedirects >= capability.maxRedirects)
        throw new SecureSourceError("REDIRECT_FORBIDDEN");
      const location = response.headers.location;
      if (!location) throw new SecureSourceError("REDIRECT_WITHOUT_LOCATION");
      localRedirects += 1;
      input.budget.redirects += 1;
      next = new URL(location, url).toString();
      continue;
    }
    if (response.status === 429) {
      throw new SecureSourceError("RATE_LIMITED", retryAfter(response.headers, now()));
    }
    if (response.status === 401) throw new SecureSourceError("AUTHENTICATION_REQUIRED");
    if (response.status === 403) throw new SecureSourceError("ACCESS_DENIED");
    if ([500, 502, 503, 504].includes(response.status) && retries < capability.maxRetries) {
      retries += 1;
      input.budget.retries += 1;
      continue;
    }
    if (!response.status || response.status < 200 || response.status >= 300) {
      throw new SecureSourceError(`HTTP_${response.status}`);
    }
    if ((response.headers["content-encoding"] ?? "identity").toLowerCase() !== "identity") {
      throw new SecureSourceError("CONTENT_ENCODING_FORBIDDEN");
    }
    const contentType = (response.headers["content-type"] ?? "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      throw new SecureSourceError(
        contentType.includes("html") ? "BOT_OR_ACCESS_INTERSTITIAL" : "CONTENT_TYPE_INVALID",
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body)) as unknown;
    } catch {
      throw new SecureSourceError("SCHEMA_CHANGED");
    }
    input.budget.assertCurrent(now());
    return {
      body,
      byteCount: response.body.byteLength,
      requestCount: localRequests,
      redirectCount: localRedirects,
    };
  }
}
