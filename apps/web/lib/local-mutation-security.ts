import "server-only";

import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { LocalMutationTokenStore, assertLoopbackMutationRequest } from "@applypilot/shared";

export const LOCAL_SESSION_COOKIE = "applypilot_local_session";

export interface LocalMutationGateProof {
  action: string;
  consumedAt: string;
  loopbackValidated: true;
  localSessionValidated: true;
  nonceConsumed: true;
}

export interface LocalMutationNonceFieldSpec {
  action: string;
  fieldName: string;
}

type GateProofFor<Spec extends LocalMutationNonceFieldSpec> = LocalMutationGateProof & {
  action: Spec["action"];
};

const processState = globalThis as typeof globalThis & {
  __applypilotLocalMutationTokens?: LocalMutationTokenStore;
};

export const localMutationTokens =
  processState.__applypilotLocalMutationTokens ?? new LocalMutationTokenStore();
processState.__applypilotLocalMutationTokens = localMutationTokens;

function safeReturnPath(value: string): string {
  return value === value.trim() &&
    /^\/(?:import|jobs(?:\/[A-Za-z0-9._:-]+)?|applications|dashboard|sources|calibration)$/.test(
      value,
    )
    ? value
    : "/dashboard";
}

/** Keep the store's label contract while binding every field of a hosted owner action. */
function nonceActionKey(action: string): string {
  if (action.length > 500 || /[^A-Za-z0-9_:-]/.test(action) || action.startsWith("HOSTED_BOUND_"))
    throw new Error("INVALID_MUTATION_ACTION");
  if (/^[A-Z][A-Z0-9_]{2,80}$/.test(action)) return action;
  const parts = action.split(":"),
    hash = (value: string) => /^[a-f0-9]{64}$/.test(value),
    session = (value: string) => /^[A-Za-z0-9_-]{1,200}$/.test(value);
  let valid = false;
  if (parts[0] === "HOSTED_QUESTION_REVIEW")
    valid = parts.length === 3 && hash(parts[1]!) && hash(parts[2]!);
  else if (parts[0] === "HOSTED_STOP") valid = parts.length === 2 && session(parts[1]!);
  else if (parts.length === 6) {
    const [kind, id, version, digest, sessionId, preview] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const subject =
      /^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$/.test(id) &&
      /^[1-9][0-9]{0,15}$/.test(version) &&
      Number.isSafeInteger(Number(version)) &&
      hash(digest);
    valid =
      subject &&
      ((kind === "HOSTED_INSPECT" && sessionId === "" && preview === "") ||
        (kind === "HOSTED_DISCLOSE" && session(sessionId) && preview === "") ||
        (kind === "HOSTED_SUBMIT" && session(sessionId) && hash(preview)));
  }
  if (!valid) throw new Error("INVALID_MUTATION_ACTION");
  return `HOSTED_BOUND_${createHash("sha256").update("applypilot.web.hosted-nonce.v1\0").update(action).digest("hex").toUpperCase()}`;
}

export async function requireLocalSession(returnPath: string): Promise<string> {
  const session = (await cookies()).get(LOCAL_SESSION_COOKIE)?.value;
  if (!localMutationTokens.isSessionValid(session)) {
    redirect(`/local-session?returnTo=${encodeURIComponent(safeReturnPath(returnPath))}`);
  }
  return session;
}

export async function issueLocalMutationNonce(action: string, returnPath: string): Promise<string> {
  const session = await requireLocalSession(returnPath);
  return localMutationTokens.issue(session, nonceActionKey(action)).nonce;
}

export async function consumeLocalMutationNonce<Action extends string>(
  action: Action,
  formData: FormData,
): Promise<LocalMutationGateProof & { action: Action }> {
  const requestHeaders = await headers();
  assertLoopbackMutationRequest({
    host: requestHeaders.get("host"),
    origin: requestHeaders.get("origin"),
    forwardedHost: requestHeaders.get("x-forwarded-host"),
  });
  const session = (await cookies()).get(LOCAL_SESSION_COOKIE)?.value;
  localMutationTokens.consume(session, nonceActionKey(action), formData.get("mutationNonce"));
  return {
    action,
    consumedAt: new Date().toISOString(),
    loopbackValidated: true,
    localSessionValidated: true,
    nonceConsumed: true,
  };
}

export async function consumeLocalMutationNonceBatch<
  const Specs extends readonly LocalMutationNonceFieldSpec[],
>(
  specs: Specs,
  formData: FormData,
): Promise<{
  [Index in keyof Specs]: Specs[Index] extends LocalMutationNonceFieldSpec
    ? GateProofFor<Specs[Index]>
    : never;
}> {
  if (!specs.length) throw new Error("MUTATION_NONCE_REQUIRED");
  const fieldNames = new Set<string>();
  const consumptions = specs.map(({ action, fieldName }) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,80}$/.test(fieldName)) {
      throw new Error("MUTATION_NONCE_FIELD_INVALID");
    }
    if (fieldNames.has(fieldName)) throw new Error("MUTATION_NONCE_FIELD_DUPLICATE");
    fieldNames.add(fieldName);
    const values = formData.getAll(fieldName);
    if (!values.length) throw new Error("MUTATION_NONCE_REQUIRED");
    if (values.length !== 1) throw new Error("MUTATION_NONCE_FIELD_AMBIGUOUS");
    return { action: nonceActionKey(action), nonce: values[0] };
  });

  const requestHeaders = await headers();
  assertLoopbackMutationRequest({
    host: requestHeaders.get("host"),
    origin: requestHeaders.get("origin"),
    forwardedHost: requestHeaders.get("x-forwarded-host"),
  });
  const session = (await cookies()).get(LOCAL_SESSION_COOKIE)?.value;
  localMutationTokens.consumeBatch(session, consumptions);

  return specs.map((spec) => ({
    action: spec.action,
    consumedAt: new Date().toISOString(),
    loopbackValidated: true,
    localSessionValidated: true,
    nonceConsumed: true,
  })) as {
    [Index in keyof Specs]: Specs[Index] extends LocalMutationNonceFieldSpec
      ? GateProofFor<Specs[Index]>
      : never;
  };
}
