import { createHash } from "node:crypto";

import { SeekAdapterError } from "./errors";
import {
  SeekCheckpointSchema,
  SeekCursorSchema,
  SeekDiscoveryQuerySchema,
  type SeekCheckpoint,
  type SeekCursor,
  type SeekDiscoveryQuery,
} from "./schemas";
import type { SeekAccessMode } from "./types";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function hashPayload(value: unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : stableStringify(value))
    .digest("hex");
}

function uniqueSorted(values: string[]): string[] {
  const entries = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim().replace(/\s+/g, " ");
    entries.set(trimmed.toLocaleLowerCase("en-AU"), trimmed);
  }
  return [...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

export function canonicalizeSeekQuery(input: unknown): SeekDiscoveryQuery {
  const parsed = SeekDiscoveryQuerySchema.parse(input);
  return {
    ...parsed,
    keywords: uniqueSorted(parsed.keywords),
    locations: uniqueSorted(parsed.locations),
    employmentTypes: [...new Set(parsed.employmentTypes)].sort(),
    location: parsed.location
      ? {
          ...parsed.location,
          text: parsed.location.text?.replace(/\s+/g, " "),
          suburb: parsed.location.suburb?.replace(/\s+/g, " "),
        }
      : undefined,
  };
}

export function hashSeekQuery(input: unknown): string {
  const query = canonicalizeSeekQuery(input);
  const { pageCursor: _pageCursor, ...identity } = query;
  void _pageCursor;
  return hashPayload(identity);
}

export function encodeSeekCursor(cursor: SeekCursor): string {
  const parsed = SeekCursorSchema.parse(cursor);
  return Buffer.from(stableStringify(parsed), "utf8").toString("base64url");
}

export function decodeSeekCursor(
  encoded: string,
  expected: { queryHash: string; mode: SeekAccessMode },
): SeekCursor {
  try {
    const parsed = SeekCursorSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString()));
    if (parsed.queryHash !== expected.queryHash || parsed.mode !== expected.mode) {
      throw new Error("Cursor identity does not match the query and mode");
    }
    return parsed;
  } catch (error) {
    throw new SeekAdapterError("CHECKPOINT_MISMATCH", {
      message: "SEEK cursor is invalid or belongs to a different query",
      cause: error,
    });
  }
}

export function validateSeekCheckpoint(
  input: unknown,
  expected: { queryHash: string; mode: SeekAccessMode; now: Date },
): SeekCheckpoint {
  try {
    const checkpoint = SeekCheckpointSchema.parse(input);
    if (checkpoint.queryHash !== expected.queryHash || checkpoint.mode !== expected.mode) {
      throw new Error("Checkpoint identity does not match the query and mode");
    }
    if (Date.parse(checkpoint.expiresAt) <= expected.now.getTime()) {
      throw new Error("Checkpoint is stale");
    }
    return checkpoint;
  } catch (error) {
    throw new SeekAdapterError("CHECKPOINT_MISMATCH", {
      message: "SEEK checkpoint is stale, invalid, or belongs to a different query",
      cause: error,
    });
  }
}

export function canonicalizeSeekUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch (error) {
    throw new SeekAdapterError("MALFORMED_RESPONSE", {
      message: "SEEK source URL is invalid",
      cause: error,
    });
  }
  if (url.protocol !== "https:") {
    throw new SeekAdapterError("MALFORMED_RESPONSE", {
      message: "SEEK source URL must use HTTPS",
      sourceUrl: input,
    });
  }
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}
