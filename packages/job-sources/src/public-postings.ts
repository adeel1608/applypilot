import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { z } from "zod";

export const PublicPostingCapabilitySchema = z
  .object({
    source: z.enum(["GREENHOUSE", "LEVER"]),
    tenant: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    region: z.enum(["GLOBAL", "EU"]).optional(),
    allowedHost: z.string().min(1).max(253),
    allowedPathPrefix: z.string().startsWith("/").max(500),
    allowedOperations: z.array(z.literal("LIST_JOBS")).min(1).max(1),
    approved: z.literal(true),
    policyReviewedAt: z.iso.datetime(),
    policyExpiresAt: z.iso.datetime(),
    requestBudget: z.number().int().min(1).max(30),
    recordCap: z.number().int().min(1).max(500),
  })
  .superRefine((value, context) => {
    const expectedHost =
      value.source === "GREENHOUSE"
        ? "boards-api.greenhouse.io"
        : value.region === "EU"
          ? "api.eu.lever.co"
          : "api.lever.co";
    if (value.allowedHost !== expectedHost) {
      context.addIssue({ code: "custom", message: "Host is not the official endpoint for source" });
    }
    const expectedPrefix =
      value.source === "GREENHOUSE"
        ? `/v1/boards/${value.tenant}/`
        : `/v0/postings/${value.tenant}`;
    if (value.allowedPathPrefix !== expectedPrefix) {
      context.addIssue({
        code: "custom",
        message: "Path prefix does not match the approved tenant",
      });
    }
  });

export const SourceAllowlistSchema = z.object({
  version: z.literal(1),
  capabilities: z.array(PublicPostingCapabilitySchema).max(20),
});

export type PublicPostingCapability = z.infer<typeof PublicPostingCapabilitySchema>;

export interface PublicPosting {
  source: "GREENHOUSE" | "LEVER";
  tenant: string;
  externalId: string;
  title: string;
  location: string | null;
  description: string;
  sourceUrl: string;
  applicationUrl: string;
  postedAt: string | null;
  rawPayload: unknown;
}

export type SourceReadiness =
  | { status: "SOURCE_READY_AWAITING_TENANT" }
  | { status: "SOURCE_DISABLED"; reason: "CAPABILITY_EXPIRED" | "CAPABILITY_NOT_APPROVED" }
  | { status: "SOURCE_ENABLED"; source: "GREENHOUSE" | "LEVER"; tenantAlias: string };

export function publicSourceReadiness(
  capability: unknown,
  now: Date = new Date(),
): SourceReadiness {
  if (capability === null || capability === undefined) {
    return { status: "SOURCE_READY_AWAITING_TENANT" };
  }
  const parsed = PublicPostingCapabilitySchema.safeParse(capability);
  if (!parsed.success) return { status: "SOURCE_DISABLED", reason: "CAPABILITY_NOT_APPROVED" };
  if (Date.parse(parsed.data.policyExpiresAt) <= now.getTime()) {
    return { status: "SOURCE_DISABLED", reason: "CAPABILITY_EXPIRED" };
  }
  return {
    status: "SOURCE_ENABLED",
    source: parsed.data.source,
    tenantAlias: parsed.data.tenant,
  };
}

function blockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

export function isBlockedNetworkAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return blockedIpv4(address);
  if (version !== 6) return true;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isBlockedNetworkAddress(normalized.slice("::ffff:".length));
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff")
  );
}

export interface PublicGetDependencies {
  fetch: typeof globalThis.fetch;
  resolveHost: (hostname: string) => Promise<string[]>;
}

const defaultDependencies: PublicGetDependencies = {
  fetch: globalThis.fetch,
  resolveHost: async (hostname) =>
    (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address),
};

export class PublicSourceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function validateEndpoint(
  value: string,
  capability: PublicPostingCapability,
  resolveHost: PublicGetDependencies["resolveHost"],
): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new PublicSourceError("HTTPS_REQUIRED");
  if (url.username || url.password) throw new PublicSourceError("URL_CREDENTIALS_FORBIDDEN");
  if (url.port && url.port !== "443") throw new PublicSourceError("NON_STANDARD_PORT_FORBIDDEN");
  if (url.hostname !== capability.allowedHost) throw new PublicSourceError("HOST_NOT_ALLOWLISTED");
  if (!url.pathname.startsWith(capability.allowedPathPrefix)) {
    throw new PublicSourceError("PATH_NOT_ALLOWLISTED");
  }
  const addresses = await resolveHost(url.hostname);
  if (addresses.length === 0 || addresses.some(isBlockedNetworkAddress)) {
    throw new PublicSourceError("DESTINATION_ADDRESS_FORBIDDEN");
  }
  return url;
}

async function readBoundedJson(response: Response, byteLimit: number): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > byteLimit) throw new PublicSourceError("RESPONSE_TOO_LARGE");
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    total += item.value.byteLength;
    if (total > byteLimit) {
      await reader.cancel();
      throw new PublicSourceError("RESPONSE_TOO_LARGE");
    }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new PublicSourceError("INVALID_JSON_RESPONSE");
  }
}

const activeTenants = new Set<string>();

export async function boundedPublicGet(
  initialUrl: string,
  capabilityInput: PublicPostingCapability,
  options: {
    now?: Date;
    timeoutMs?: number;
    byteLimit?: number;
    dependencies?: PublicGetDependencies;
  } = {},
): Promise<unknown> {
  const capability = PublicPostingCapabilitySchema.parse(capabilityInput);
  const now = options.now ?? new Date();
  if (Date.parse(capability.policyExpiresAt) <= now.getTime()) {
    throw new PublicSourceError("CAPABILITY_EXPIRED");
  }
  const key = `${capability.source}:${capability.tenant}`;
  if (activeTenants.has(key)) throw new PublicSourceError("TENANT_REQUEST_ALREADY_ACTIVE");
  const dependencies = options.dependencies ?? defaultDependencies;
  const timeoutMs = Math.min(options.timeoutMs ?? 10_000, 30_000);
  const byteLimit = Math.min(options.byteLimit ?? 2_000_000, 5_000_000);
  activeTenants.add(key);
  try {
    let next = initialUrl;
    let requestCount = 0;
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      if (requestCount >= capability.requestBudget) {
        throw new PublicSourceError("REQUEST_BUDGET_EXCEEDED");
      }
      const url = await validateEndpoint(next, capability, dependencies.resolveHost);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        requestCount += 1;
        response = await dependencies.fetch(url, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new PublicSourceError("REDIRECT_WITHOUT_LOCATION");
        next = new URL(location, url).toString();
        continue;
      }
      if (response.status === 429) throw new PublicSourceError("RATE_LIMITED_STOP");
      if (response.status === 401 || response.status === 403) {
        throw new PublicSourceError("ACCESS_DENIED_STOP");
      }
      if (
        [500, 502, 503, 504].includes(response.status) &&
        requestCount < capability.requestBudget
      ) {
        continue;
      }
      if (!response.ok) throw new PublicSourceError(`HTTP_${response.status}`);
      return readBoundedJson(response, byteLimit);
    }
    throw new PublicSourceError("TOO_MANY_REDIRECTS");
  } finally {
    activeTenants.delete(key);
  }
}
