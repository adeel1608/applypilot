import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, SocketAddress, type LookupFunction } from "node:net";

import {
  SourceCapabilityV2Schema,
  SourceRunBudget,
  SourceSchemaDiagnosticSchema,
  type SourceCapabilityV2,
  type SourceOperation,
  type SourceSchemaDiagnostic,
  type SourceTransportLifecycleStage,
} from "./source-capability";
import { isBlockedNetworkAddress } from "./public-postings";

export class SecureSourceError extends Error {
  readonly schemaDiagnostic: SourceSchemaDiagnostic | null;

  constructor(
    readonly code: string,
    readonly retryAfter: string | null = null,
    readonly lifecycleStage: SourceTransportLifecycleStage | null = null,
    schemaDiagnostic: SourceSchemaDiagnostic | null = null,
  ) {
    super(code);
    const parsed = SourceSchemaDiagnosticSchema.safeParse(schemaDiagnostic);
    this.schemaDiagnostic = schemaDiagnostic === null ? null : parsed.success ? parsed.data : null;
  }
}

const transportStageRank: Record<SourceTransportLifecycleStage, number> = {
  DNS: -1,
  REQUEST_CREATED: 0,
  SOCKET_ASSIGNED: 1,
  TCP_CONNECTED: 2,
  TLS_ESTABLISHED: 3,
  REQUEST_FLUSHED: 4,
  RESPONSE_HEADERS: 5,
  RESPONSE_BODY: 6,
  PERSISTENCE: 7,
};

function nodeErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" && /^[A-Z0-9_]{2,80}$/.test(value) ? value : null;
}

/**
 * Classify only stable Node error codes and trusted local lifecycle state. The
 * result is diagnostic, never a declaration that an HTTP attempt is safe to
 * retry; the source capability's retry budget remains authoritative.
 */
export function classifySecureSourceTransportError(
  error: unknown,
  stage: SourceTransportLifecycleStage,
): SecureSourceError {
  if (error instanceof SecureSourceError) {
    return error.lifecycleStage
      ? error
      : new SecureSourceError(error.code, error.retryAfter, stage, error.schemaDiagnostic);
  }
  const code = nodeErrorCode(error);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_FAIL") {
    return new SecureSourceError("DNS_RESOLUTION_FAILED", null, stage);
  }
  if (
    code === "ENETUNREACH" ||
    code === "EHOSTUNREACH" ||
    code === "ENETDOWN" ||
    code === "EHOSTDOWN" ||
    code === "ENONET"
  ) {
    return new SecureSourceError("NETWORK_ROUTE_UNAVAILABLE", null, stage);
  }
  if (code === "ECONNREFUSED") return new SecureSourceError("CONNECTION_REFUSED", null, stage);
  if (code === "ECONNRESET" || code === "ECONNABORTED" || code === "EPIPE") {
    return new SecureSourceError("CONNECTION_RESET", null, stage);
  }
  if (code === "ETIMEDOUT") return new SecureSourceError("REQUEST_TIMEOUT", null, stage);
  const beforeTlsEstablished = transportStageRank[stage] < transportStageRank.TLS_ESTABLISHED;
  if (
    beforeTlsEstablished &&
    (code === "EPROTO" ||
      code?.startsWith("ERR_TLS_") ||
      code?.startsWith("ERR_SSL_") ||
      code?.startsWith("ERR_OSSL_") ||
      code?.startsWith("CERT_") ||
      code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
      code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      code === "SELF_SIGNED_CERT_IN_CHAIN")
  ) {
    return new SecureSourceError("TLS_HANDSHAKE_FAILED", null, stage);
  }
  return new SecureSourceError("NETWORK_OUTCOME_UNKNOWN", null, stage);
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

function canonicalAddress(address: string): string | null {
  const version = isIP(address);
  if (version !== 4 && version !== 6) return null;
  try {
    return new SocketAddress({
      address,
      family: version === 4 ? "ipv4" : "ipv6",
      port: 443,
    }).address;
  } catch {
    return null;
  }
}

function sameNetworkAddress(left: string, right: string): boolean {
  const canonicalLeft = canonicalAddress(left);
  const canonicalRight = canonicalAddress(right);
  return canonicalLeft !== null && canonicalLeft === canonicalRight;
}

export function createPinnedSourceLookup(pinnedAddress: string): {
  family: 4 | 6;
  lookup: LookupFunction;
} {
  const family = isIP(pinnedAddress);
  if (family !== 4 && family !== 6) throw new SecureSourceError("PINNED_ADDRESS_INVALID");
  return {
    family,
    lookup: (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address: pinnedAddress, family }]);
        return;
      }
      callback(null, pinnedAddress, family);
    },
  };
}

const defaultDependencies: SecureSourceTransportDependencies = {
  resolveHost: async (hostname) =>
    (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address),
  request: ({ url, pinnedAddress, signal, byteLimit }) =>
    new Promise((resolve, reject) => {
      const pinned = createPinnedSourceLookup(pinnedAddress);
      let lifecycleStage: SourceTransportLifecycleStage = "REQUEST_CREATED";
      const advance = (next: SourceTransportLifecycleStage) => {
        if (transportStageRank[next] > transportStageRank[lifecycleStage]) lifecycleStage = next;
      };
      const rejectSafely = (error: unknown) =>
        reject(classifySecureSourceTransportError(error, lifecycleStage));
      const request = httpsRequest(
        url,
        {
          method: "GET",
          signal,
          servername: url.hostname,
          family: pinned.family,
          headers: {
            accept: "application/json",
            "accept-encoding": "identity",
            "user-agent": "ApplyPilot/0.1 read-only owner-started source client",
          },
          lookup: pinned.lookup,
        },
        (response) => {
          advance("RESPONSE_HEADERS");
          const connectedAddress = response.socket.remoteAddress ?? "";
          const chunks: Buffer[] = [];
          let total = 0;
          response.on("data", (chunk: Buffer) => {
            advance("RESPONSE_BODY");
            total += chunk.byteLength;
            if (total > byteLimit) {
              response.destroy(new SecureSourceError("RESPONSE_TOO_LARGE"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            const headers = Object.fromEntries(
              Object.entries(response.headers).map(([key, value]) => [key, headerValue(value)]),
            );
            resolve({
              status: response.statusCode ?? 0,
              headers,
              body: Buffer.concat(chunks),
              connectedAddress,
            });
          });
          response.on("error", rejectSafely);
        },
      );
      request.on("socket", (socket) => {
        advance("SOCKET_ASSIGNED");
        socket.on("connect", () => advance("TCP_CONNECTED"));
        socket.on("secureConnect", () => advance("TLS_ESTABLISHED"));
      });
      request.on("finish", () => advance("REQUEST_FLUSHED"));
      request.on("error", rejectSafely);
      request.end();
    }),
};

function allowedQuery(operation: SourceOperation, capability: SourceCapabilityV2): Set<string> {
  if (capability.source === "LEVER") {
    return operation === "LIST_JOBS" ? new Set(["mode", "skip", "limit"]) : new Set(["mode"]);
  }
  return operation === "LIST_JOBS" ? new Set(["content"]) : new Set();
}

function exactlyOne(searchParams: URLSearchParams, key: string): string {
  const values = searchParams.getAll(key);
  if (values.length !== 1) throw new SecureSourceError("QUERY_NOT_ALLOWLISTED");
  return values[0]!;
}

function canonicalNonnegativeInteger(value: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new SecureSourceError("QUERY_NOT_ALLOWLISTED");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new SecureSourceError("QUERY_NOT_ALLOWLISTED");
  return parsed;
}

function validateLeverRequestSemantics(
  url: URL,
  capability: SourceCapabilityV2,
  operation: SourceOperation,
): void {
  if (exactlyOne(url.searchParams, "mode") !== "json") {
    throw new SecureSourceError("QUERY_NOT_ALLOWLISTED");
  }
  const prefix = capability.allowedPathPrefix;
  if (operation === "LIST_JOBS") {
    if (url.pathname !== prefix || url.searchParams.size !== 3) {
      throw new SecureSourceError("QUERY_NOT_ALLOWLISTED");
    }
    const skip = canonicalNonnegativeInteger(exactlyOne(url.searchParams, "skip"));
    const limit = canonicalNonnegativeInteger(exactlyOne(url.searchParams, "limit"));
    if (
      skip >= capability.recordCap ||
      limit < 1 ||
      limit > capability.pageSizeCap ||
      skip + limit > capability.recordCap
    ) {
      throw new SecureSourceError("QUERY_NOT_ALLOWLISTED");
    }
    return;
  }
  const suffix = url.pathname.startsWith(`${prefix}/`) ? url.pathname.slice(prefix.length + 1) : "";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(suffix) || url.searchParams.size !== 1) {
    throw new SecureSourceError("QUERY_NOT_ALLOWLISTED");
  }
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
  if (capability.source === "LEVER") validateLeverRequestSemantics(url, capability, operation);
  let resolvedAddresses: string[];
  try {
    resolvedAddresses = await resolveHost(url.hostname);
  } catch {
    throw new SecureSourceError("DNS_RESOLUTION_FAILED", null, "DNS");
  }
  const addresses = [...new Set(resolvedAddresses)];
  if (addresses.length === 0) throw new SecureSourceError("DNS_RESOLUTION_FAILED", null, "DNS");
  if (addresses.some(isBlockedNetworkAddress)) {
    throw new SecureSourceError("DESTINATION_ADDRESS_FORBIDDEN", null, "DNS");
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
      const lifecycleStage =
        error instanceof SecureSourceError ? error.lifecycleStage : "REQUEST_CREATED";
      if (input.signal?.aborted)
        throw new SecureSourceError("OWNER_CANCELLED", null, lifecycleStage);
      if (signal.aborted) throw new SecureSourceError("REQUEST_TIMEOUT", null, lifecycleStage);
      // Socket/TLS outcomes can be ambiguous after request creation. A safe
      // diagnostic code must never be treated as permission for a blind retry.
      throw classifySecureSourceTransportError(error, "REQUEST_CREATED");
    }
    if (!sameNetworkAddress(response.connectedAddress, pinnedAddress)) {
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
