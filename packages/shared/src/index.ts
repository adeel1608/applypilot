export const VerificationStatus = {
  VERIFIED: "VERIFIED",
  USER_CONFIRMATION_REQUIRED: "USER_CONFIRMATION_REQUIRED",
  UNKNOWN: "UNKNOWN",
} as const;

export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en-AU")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

export * from "./loopback-security";
export * from "./local-mutation-token";
