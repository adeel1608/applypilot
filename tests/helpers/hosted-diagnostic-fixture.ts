import type { Route } from "@playwright/test";
import {
  HostedCapabilitySchema,
  PlaywrightHostedApplicationDriver,
} from "@applypilot/application-runner";

export function diagnosticCapability() {
  return HostedCapabilitySchema.parse({
    schemaVersion: 1,
    capabilityId: "fictional-diagnostic-capability",
    version: 1,
    predecessorVersion: null,
    mode: "FICTIONAL",
    scriptPolicy: "NATIVE_SCRIPT_DISABLED",
    scope: "PASSIVE_INSPECTION",
    subject: {
      provider: "LEVER",
      region: "GLOBAL",
      tenant: "fictional",
      externalId: "post",
      jobId: "fictional-job",
      jobVersionId: "fictional-version",
      profileVersionId: "fictional-profile",
      verificationId: "fictional-verification",
      sourceRunId: "fictional-run",
      sourceContentHash: "a".repeat(64),
      targetUrl: "https://jobs.lever.co/fictional/post/apply",
    },
    packetId: null,
    packetDigest: null,
    formDigest: null,
    discoveryDigest: null,
    build: {
      head: "a".repeat(40),
      tree: "b".repeat(40),
      buildDigest: "c".repeat(64),
      adapterVersion: "hosted-native-v1",
    },
    policyReference: "fictional-policy",
    policyReviewedAt: "2098-01-01T00:00:00.000Z",
    createdAt: "2098-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    allowedReads: [{ origin: "https://jobs.lever.co", path: "/fictional/post/apply" }],
    allowedWrites: [],
    confirmation: null,
    requestBudget: 10,
    responseByteLimit: 10000,
    requestTimeoutMs: 1000,
    sessionTimeoutMs: 60000,
    remoteUploadProofRequired: false,
  });
}
export const diagnosticInstant = new Date("2098-01-02T00:00:00.000Z");
export type DriverBoundary = {
  capability: ReturnType<typeof diagnosticCapability>;
  page: unknown;
  openedAt: number;
  route(route: Route): Promise<void>;
  assertHealthy(): void;
};
export function routeBoundary(driver: PlaywrightHostedApplicationDriver) {
  const boundary = driver as unknown as DriverBoundary;
  const frame = {};
  boundary.capability = diagnosticCapability();
  boundary.openedAt = diagnosticInstant.getTime();
  boundary.page = { isClosed: () => false, mainFrame: () => frame };
  return { boundary, frame };
}
export function diagnosticRoute(
  url: string,
  options: {
    method?: string;
    body?: Buffer | null;
    resource?: string;
    navigation?: boolean;
    frame?: unknown;
  } = {},
) {
  let aborted = false,
    fulfilled = false;
  const route = {
    request: () => ({
      url: () => url,
      method: () => options.method ?? "GET",
      postDataBuffer: () => options.body ?? null,
      allHeaders: async () => ({}),
      resourceType: () => options.resource ?? "document",
      isNavigationRequest: () => options.navigation ?? true,
      frame: () => options.frame,
    }),
    abort: async () => {
      aborted = true;
    },
    fulfill: async () => {
      fulfilled = true;
    },
  } as unknown as Route;
  return { route, aborted: () => aborted, fulfilled: () => fulfilled };
}
