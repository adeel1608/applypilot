import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

interface SessionRecord {
  expiresAt: number;
}

interface NonceRecord {
  sessionHash: string;
  action: string;
  expiresAt: number;
  used: boolean;
}

export interface LocalMutationTokenOptions {
  sessionLifetimeMs?: number;
  nonceLifetimeMs?: number;
  now?: () => number;
  randomToken?: () => string;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function equalHash(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/** Process-local sessions and nonces. Plaintext token values are never persisted or logged. */
export class LocalMutationTokenStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly nonces = new Map<string, NonceRecord>();
  private readonly sessionLifetimeMs: number;
  private readonly nonceLifetimeMs: number;
  private readonly now: () => number;
  private readonly randomToken: () => string;

  constructor(options: LocalMutationTokenOptions = {}) {
    this.sessionLifetimeMs = options.sessionLifetimeMs ?? 8 * 60 * 60 * 1000;
    this.nonceLifetimeMs = options.nonceLifetimeMs ?? 15 * 60 * 1000;
    this.now = options.now ?? Date.now;
    this.randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
  }

  createSession(): { token: string; expiresAt: string } {
    this.prune();
    const token = this.randomToken();
    if (!TOKEN_PATTERN.test(token)) throw new Error("INVALID_LOCAL_SESSION_TOKEN");
    const expiresAt = this.now() + this.sessionLifetimeMs;
    this.sessions.set(hash(token), { expiresAt });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  isSessionValid(token: string | null | undefined): token is string {
    if (!token || !TOKEN_PATTERN.test(token)) return false;
    const record = this.sessions.get(hash(token));
    return Boolean(record && record.expiresAt > this.now());
  }

  issue(sessionToken: string, action: string): { nonce: string; expiresAt: string } {
    this.prune();
    if (!this.isSessionValid(sessionToken)) throw new Error("LOCAL_SESSION_REQUIRED");
    if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(action)) throw new Error("INVALID_MUTATION_ACTION");
    const nonce = this.randomToken();
    const expiresAt = this.now() + this.nonceLifetimeMs;
    this.nonces.set(hash(nonce), {
      sessionHash: hash(sessionToken),
      action,
      expiresAt,
      used: false,
    });
    return { nonce, expiresAt: new Date(expiresAt).toISOString() };
  }

  consume(sessionToken: string | null | undefined, action: string, nonce: unknown): void {
    if (!this.isSessionValid(sessionToken)) throw new Error("LOCAL_SESSION_REQUIRED");
    if (typeof nonce !== "string" || !TOKEN_PATTERN.test(nonce)) {
      throw new Error("MUTATION_NONCE_REQUIRED");
    }
    const record = this.nonces.get(hash(nonce));
    if (!record) throw new Error("MUTATION_NONCE_INVALID");
    if (record.used) throw new Error("MUTATION_NONCE_REPLAYED");
    if (record.expiresAt <= this.now()) {
      record.used = true;
      throw new Error("MUTATION_NONCE_EXPIRED");
    }
    if (!equalHash(record.sessionHash, hash(sessionToken))) {
      throw new Error("MUTATION_NONCE_SESSION_MISMATCH");
    }
    if (record.action !== action) throw new Error("MUTATION_NONCE_ACTION_MISMATCH");
    record.used = true;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, value] of this.sessions) {
      if (value.expiresAt <= now) this.sessions.delete(key);
    }
    for (const [key, value] of this.nonces) {
      if (value.expiresAt + this.nonceLifetimeMs <= now) this.nonces.delete(key);
    }
  }
}
