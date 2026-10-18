import { z } from "zod";
import type { HostedCapability } from "./hosted-contract";

export const HOSTED_SAFE_CODES = [
  "HOSTED_REQUEST_BUDGET_EXHAUSTED",
  "HOSTED_DESTINATION_FORBIDDEN",
  "HOSTED_METHOD_FORBIDDEN",
  "HOSTED_REDIRECT_FORBIDDEN",
  "HOSTED_RESPONSE_TOO_LARGE",
  "HOSTED_NETWORK_ADDRESS_FORBIDDEN",
  "HOSTED_NETWORK_ADDRESS_CHANGED",
  "HOSTED_DNS_FAILED",
  "HOSTED_CONTENT_ENCODING_UNSUPPORTED",
  "HOSTED_RATE_LIMIT",
  "HOSTED_AUTHENTICATION_REQUIRED",
  "HOSTED_ACCESS_CONTROL",
  "HOSTED_BOT_PROTECTION",
  "HOSTED_HTTP_FAILURE",
  "HOSTED_UPLOAD_ACK_INVALID",
  "HOSTED_OUTGOING_CONTENT_CHANGED",
  "HOSTED_SESSION_EXPIRED",
  "HOSTED_UNSUPPORTED_CONTROL",
  "HOSTED_FORM_CHANGED",
  "HOSTED_NATIVE_VALIDATION_FAILED",
  "HOSTED_DESTINATION_CHANGED",
  "HOSTED_CONTEXT_LOST",
  "HOSTED_CONFIRMATION_UNPROVEN",
  "HOSTED_TRANSPORT_OUTCOME_UNKNOWN",
  "HOSTED_ACTION_TIMEOUT",
  "HOSTED_NAVIGATION_TIMEOUT",
  "HOSTED_ANSWER_NOT_VERIFIED",
  "HOSTED_APPLICATION_BINDING_INVALID",
  "HOSTED_APPROVED_DOCUMENT_REQUIRED",
  "HOSTED_AUDIT_PERSISTENCE_FAILED",
  "HOSTED_CAPABILITY_CORRUPT",
  "HOSTED_CAPABILITY_EXPIRED",
  "HOSTED_CAPABILITY_FAMILY_CHANGED",
  "HOSTED_CAPABILITY_IMMUTABLE",
  "HOSTED_CAPABILITY_NOT_CURRENT",
  "HOSTED_CAPABILITY_SEQUENCE_INVALID",
  "HOSTED_DISCLOSURE_REPLAYED",
  "HOSTED_FACT_QUESTION_UNSUPPORTED",
  "HOSTED_FINAL_PREVIEW_CHANGED",
  "HOSTED_FINAL_PREVIEW_REQUIRED",
  "HOSTED_INSPECTION_REPLAYED",
  "HOSTED_MAPPING_CHANGED",
  "HOSTED_MODE_MISMATCH",
  "HOSTED_OPERATION_CLAIM_MISSING",
  "HOSTED_OPERATION_COMPLETION_INVALID",
  "HOSTED_OPERATION_SEQUENCE_INVALID",
  "HOSTED_OWNER_CHOICE_INVALID",
  "HOSTED_OWNER_CONSENT_INVALID",
  "HOSTED_OWNER_NONCE_REPLAY",
  "HOSTED_PACKET_BINDING_REQUIRED",
  "HOSTED_PACKET_NOT_READY",
  "HOSTED_PRIVATE_PROFILE_CHANGED",
  "HOSTED_QUESTION_CONTRACT_REQUIRED",
  "HOSTED_QUESTION_DISCOVERY_CORRUPT",
  "HOSTED_QUESTION_SUBJECT_CHANGED",
  "HOSTED_REVIEWED_BUILD_REQUIRED",
  "HOSTED_SESSION_CORRUPT",
  "HOSTED_SESSION_NOT_FOUND",
  "HOSTED_SOURCE_BINDING_INVALID",
  "HOSTED_SOURCE_STALE",
  "HOSTED_SUBJECT_NOT_CURRENT",
  "HOSTED_SUBMIT_ACTIVATION_GUARDED",
  "HOSTED_OPERATION_IN_PROGRESS",
  "HOSTED_REQUIRED_ANSWER_UNKNOWN",
  "HOSTED_QUESTION_CONTRACT_CHANGED",
  "HOSTED_QUESTION_REVIEW_INVALID",
  "HOSTED_ANSWER_OPTION_UNSUPPORTED",
  "HOSTED_APPROVED_ARTIFACT_ADMISSION_FAILED",
  "HOSTED_OWNER_CONFIRMATION_REQUIRED",
  "HOSTED_QUESTION_REVIEW_REQUIRED",
  "HOSTED_RENDERED_BINDING_CHANGED",
  "HOSTED_OWNED_RUNTIME_BUILD_CHANGED",
  "HOSTED_REVIEWED_ROLLOUT_REQUIRED",
  "HOSTED_OPERATION_STOPPED",
] as const;
const safeCodes = new Set<string>(HOSTED_SAFE_CODES);
export function hostedSafeErrorCode(value: unknown): string | null {
  return typeof value === "string" && safeCodes.has(value) ? value : null;
}
export function safeHostedError(error: unknown): string {
  return error instanceof Error && safeCodes.has(error.message)
    ? error.message
    : "HOSTED_OPERATION_STOPPED";
}

export const HostedRejectionSiteSchema = z.enum([
  "DRIVER_REAL_MODE_INJECTION",
  "ROUTE_URL_SHAPE",
  "ROUTE_READ_DESTINATION",
  "ROUTE_GET_BODY",
  "ROUTE_METHOD_SCOPE",
  "PROXY_HTTP_DENIED",
  "PROXY_CONNECT_DENIED",
  "TRANSPORT_URL_SHAPE",
  "TRANSPORT_METHOD",
  "TRANSPORT_TIMEOUT_RANGE",
  "TRANSPORT_BYTE_LIMIT_RANGE",
  "TRANSPORT_BODY_LIMIT",
  "TRANSPORT_GET_BODY",
  "UNKNOWN_REJECTION_SITE",
]);
export const HostedTransportPhaseSchema = z.enum([
  "NOT_INVOKED",
  "VALIDATING",
  "DNS_STARTED",
  "SOCKET_OBSERVED",
  "RESPONSE_HEADERS_OBSERVED",
  "BODY_COMPLETED",
  "UNKNOWN",
]);
const observed = z.boolean().nullable();
const count = z.number().int().min(0).max(1000);
export const HostedRejectionDiagnosticSchema = z
  .object({
    schemaVersion: z.literal(1),
    safeCode: z.enum(HOSTED_SAFE_CODES),
    site: HostedRejectionSiteSchema,
    stage: z.enum(["READ", "MAP", "FILL", "UPLOAD", "VERIFY", "REVIEW", "SUBMIT", "UNKNOWN"]),
    method: z.enum(["GET", "POST", "CONNECT", "OTHER", "UNKNOWN"]),
    resource: z.enum([
      "DOCUMENT",
      "STYLESHEET",
      "IMAGE",
      "FONT",
      "SCRIPT",
      "XHR_FETCH",
      "FRAME",
      "OTHER",
      "UNKNOWN",
    ]),
    isNavigationRequest: observed,
    isMainFrame: observed,
    exactTarget: observed,
    exactRead: observed,
    exactWrite: observed,
    urlShape: z
      .object({
        nonHttps: observed,
        nonDefaultPort: observed,
        credentials: observed,
        query: observed,
        fragment: observed,
      })
      .strict(),
    transportConfig: z
      .object({
        methodValid: observed,
        timeoutValid: observed,
        byteLimitValid: observed,
        bodyLimitValid: observed,
        getBodyValid: observed,
      })
      .strict(),
    transportPhase: HostedTransportPhaseSchema,
    observationSequence: z.number().int().min(1).max(1000),
    routeAttemptCount: count,
    proxyDenialCount: count,
    secondaryRejectionCount: count,
    secondaryProxyDenialCount: count,
  })
  .strict();
export type HostedRejectionDiagnostic = z.infer<typeof HostedRejectionDiagnosticSchema>;
export type HostedTransportPhase = HostedRejectionDiagnostic["transportPhase"];
export type HostedRejectionSite = HostedRejectionDiagnostic["site"];
export function hostedMethodClass(method?: string): HostedRejectionDiagnostic["method"] {
  return method === undefined
    ? "UNKNOWN"
    : method === "GET" || method === "POST" || method === "CONNECT"
      ? method
      : "OTHER";
}
export function hostedUrlShape(url: URL): HostedRejectionDiagnostic["urlShape"] {
  return {
    nonHttps: url.protocol !== "https:",
    nonDefaultPort: !!url.port,
    credentials: !!(url.username || url.password),
    query: !!url.search,
    fragment: !!url.hash,
  };
}
export function hostedExactMatches(url: URL, cap: HostedCapability, stage: string) {
  const matches = (entry: { origin: string; path: string }) =>
    entry.origin === url.origin && entry.path === url.pathname;
  return {
    exactTarget: url.href === cap.subject.targetUrl,
    exactRead: cap.allowedReads.some(matches),
    exactWrite: cap.allowedWrites.some((entry) => matches(entry) && entry.operation === stage),
  };
}
export function hostedDiagnostic(
  safeCode: string,
  fields: Partial<Omit<HostedRejectionDiagnostic, "safeCode" | "schemaVersion">> = {},
): HostedRejectionDiagnostic {
  return HostedRejectionDiagnosticSchema.parse({
    schemaVersion: 1,
    safeCode: hostedSafeErrorCode(safeCode) ?? "HOSTED_OPERATION_STOPPED",
    site: "UNKNOWN_REJECTION_SITE",
    stage: "UNKNOWN",
    method: "UNKNOWN",
    resource: "UNKNOWN",
    isNavigationRequest: null,
    isMainFrame: null,
    exactTarget: null,
    exactRead: null,
    exactWrite: null,
    urlShape: {
      nonHttps: null,
      nonDefaultPort: null,
      credentials: null,
      query: null,
      fragment: null,
    },
    transportConfig: {
      methodValid: null,
      timeoutValid: null,
      byteLimitValid: null,
      bodyLimitValid: null,
      getBodyValid: null,
    },
    transportPhase: "UNKNOWN",
    observationSequence: 1,
    routeAttemptCount: 0,
    proxyDenialCount: 0,
    secondaryRejectionCount: 0,
    secondaryProxyDenialCount: 0,
    ...fields,
  });
}
/** Carries only a closed public code and strictly parsed value-free evidence. Never a raw cause. */
export class HostedDiagnosticError extends Error {
  readonly diagnostic: HostedRejectionDiagnostic | null;
  constructor(
    safeCode: string,
    diagnostic: unknown = null,
    readonly auditPersistenceFailed = false,
    readonly cleanupFailed = false,
  ) {
    super(hostedSafeErrorCode(safeCode) ?? "HOSTED_OPERATION_STOPPED");
    const parsed = HostedRejectionDiagnosticSchema.safeParse(diagnostic);
    this.diagnostic = parsed.success ? parsed.data : null;
  }
}
export function hostedErrorDiagnostic(error: unknown): HostedRejectionDiagnostic | null {
  if (!(error instanceof HostedDiagnosticError)) return null;
  const parsed = HostedRejectionDiagnosticSchema.safeParse(error.diagnostic);
  return parsed.success ? parsed.data : null;
}
/** First observation is immutable; secondary counters are bounded and not a physical root-cause claim. */
export class HostedRejectionRecorder {
  private first: HostedRejectionDiagnostic | null = null;
  private secondary = 0;
  private secondaryProxy = 0;
  record(diagnostic: HostedRejectionDiagnostic, observedProxyDenial = false): void {
    const value = HostedRejectionDiagnosticSchema.parse(diagnostic);
    if (!this.first) this.first = value;
    else {
      this.secondary = Math.min(1000, this.secondary + 1);
      if (observedProxyDenial) this.secondaryProxy = Math.min(1000, this.secondaryProxy + 1);
    }
  }
  snapshot(): HostedRejectionDiagnostic | null {
    return this.first
      ? HostedRejectionDiagnosticSchema.parse({
          ...this.first,
          secondaryRejectionCount: this.secondary,
          secondaryProxyDenialCount: this.secondaryProxy,
        })
      : null;
  }
}
