import type { SeekErrorCode } from "./types";

const ERROR_DEFAULTS: Record<SeekErrorCode, { retryable: boolean; humanActionRequired: boolean }> =
  {
    RATE_LIMITED: { retryable: true, humanActionRequired: false },
    AUTH_REQUIRED: { retryable: false, humanActionRequired: true },
    CAPTCHA_DETECTED: { retryable: false, humanActionRequired: true },
    BOT_PROTECTION: { retryable: false, humanActionRequired: true },
    ACCESS_DENIED: { retryable: false, humanActionRequired: true },
    PAGE_CHANGED: { retryable: false, humanActionRequired: true },
    NETWORK_ERROR: { retryable: true, humanActionRequired: false },
    MALFORMED_RESPONSE: { retryable: false, humanActionRequired: true },
    JOB_REMOVED: { retryable: false, humanActionRequired: false },
    NOT_FOUND: { retryable: false, humanActionRequired: false },
    UNSUPPORTED_PAGE: { retryable: false, humanActionRequired: true },
    RETRYABLE_SERVER_ERROR: { retryable: true, humanActionRequired: false },
    NON_RETRYABLE_ERROR: { retryable: false, humanActionRequired: true },
    DUPLICATE_PAGE: { retryable: false, humanActionRequired: true },
    CHECKPOINT_MISMATCH: { retryable: false, humanActionRequired: true },
  };

export interface SeekAdapterErrorOptions {
  message?: string;
  retryable?: boolean;
  humanActionRequired?: boolean;
  safeRetryAfter?: string | null;
  sourceUrl?: string | null;
  diagnosticCode?: string;
  cause?: unknown;
}

export function sanitizeSourceReference(sourceUrl?: string | null): string | null {
  if (!sourceUrl) return null;
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol !== "https:") return "[invalid-source-url]";
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "[invalid-source-url]";
  }
}

export class SeekAdapterError extends Error {
  readonly retryable: boolean;
  readonly humanActionRequired: boolean;
  readonly safeRetryAfter: string | null;
  readonly sourceReference: string | null;
  readonly sourceUrl: string | null;
  readonly diagnosticCode: string;
  readonly causeClass: string | null;

  constructor(
    readonly code: SeekErrorCode,
    options: SeekAdapterErrorOptions = {},
  ) {
    super(options.message ?? `SEEK adapter stopped with ${code}`);
    this.name = "SeekAdapterError";
    this.retryable = options.retryable ?? ERROR_DEFAULTS[code].retryable;
    this.humanActionRequired =
      options.humanActionRequired ?? ERROR_DEFAULTS[code].humanActionRequired;
    this.safeRetryAfter = options.safeRetryAfter ?? null;
    this.sourceReference = sanitizeSourceReference(options.sourceUrl);
    this.sourceUrl = this.sourceReference;
    this.diagnosticCode = options.diagnosticCode ?? `SEEK_${code}`;
    this.causeClass =
      options.cause instanceof Error
        ? options.cause.name.slice(0, 80)
        : options.cause === undefined
          ? null
          : "NonErrorCause";
  }
}

export function parseRetryAfter(value: string | null, now: Date): string | null {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) {
    return new Date(now.getTime() + Number(value.trim()) * 1000).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(Math.max(parsed, now.getTime())).toISOString();
}

export interface SeekAccessSignal {
  status: number;
  marker?: "CAPTCHA" | "BOT" | "MFA" | "PAGE_CHANGED";
  retryAfter?: string | null;
  sourceUrl?: string | null;
  now?: Date;
}

export function classifySeekAccessSignal(signal: SeekAccessSignal): SeekAdapterError {
  const options = { sourceUrl: signal.sourceUrl };
  if (signal.marker === "CAPTCHA") {
    return new SeekAdapterError("CAPTCHA_DETECTED", options);
  }
  if (signal.marker === "BOT") {
    return new SeekAdapterError("BOT_PROTECTION", options);
  }
  if (signal.marker === "MFA") {
    return new SeekAdapterError("AUTH_REQUIRED", {
      ...options,
      diagnosticCode: "SEEK_MFA_REQUIRED",
    });
  }
  if (signal.marker === "PAGE_CHANGED") {
    return new SeekAdapterError("PAGE_CHANGED", options);
  }
  if (signal.status === 401) return new SeekAdapterError("AUTH_REQUIRED", options);
  if (signal.status === 403) return new SeekAdapterError("ACCESS_DENIED", options);
  if (signal.status === 404) return new SeekAdapterError("NOT_FOUND", options);
  if (signal.status === 410) return new SeekAdapterError("JOB_REMOVED", options);
  if (signal.status === 429) {
    return new SeekAdapterError("RATE_LIMITED", {
      ...options,
      safeRetryAfter: parseRetryAfter(signal.retryAfter ?? null, signal.now ?? new Date()),
    });
  }
  if (signal.status >= 500) return new SeekAdapterError("RETRYABLE_SERVER_ERROR", options);
  return new SeekAdapterError("NON_RETRYABLE_ERROR", options);
}

export async function executeWithSeekRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    wait?: (safeRetryAfter: string | null) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<T> {
  const maxAttempts = Math.min(Math.max(options.maxAttempts ?? 3, 1), 3);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!(error instanceof SeekAdapterError) || !error.retryable || attempt === maxAttempts) {
        throw error;
      }
      if (options.wait) {
        await options.wait(error.safeRetryAfter);
      } else if (error.safeRetryAfter && Date.parse(error.safeRetryAfter) > Date.now()) {
        // Do not retry before a declared Retry-After time. A scheduler can inject a wait function.
        throw error;
      } else {
        const jitter = 0.75 + (options.random ?? Math.random)() * 0.5;
        const delayMs = Math.round(Math.min(100 * 2 ** (attempt - 1), 1_000) * jitter);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}
