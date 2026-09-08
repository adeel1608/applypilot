import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { LocalMutationTokenStore, assertLoopbackMutationRequest } from "@applypilot/shared";

export const LOCAL_SESSION_COOKIE = "applypilot_local_session";

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

export async function consumeLocalMutationNonce(action: string, formData: FormData): Promise<void> {
  const requestHeaders = await headers();
  assertLoopbackMutationRequest({
    host: requestHeaders.get("host"),
    origin: requestHeaders.get("origin"),
    forwardedHost: requestHeaders.get("x-forwarded-host"),
  });
  const session = (await cookies()).get(LOCAL_SESSION_COOKIE)?.value;
  localMutationTokens.consume(session, action, formData.get("mutationNonce"));
}
