import "server-only";

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
  return /^\/(?:import|jobs(?:\/[A-Za-z0-9._:-]+)?|applications|dashboard|sources)$/.test(value)
    ? value
    : "/dashboard";
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
  return localMutationTokens.issue(session, action).nonce;
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
  localMutationTokens.consume(session, action, formData.get("mutationNonce"));
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
    return { action, nonce: values[0] };
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
