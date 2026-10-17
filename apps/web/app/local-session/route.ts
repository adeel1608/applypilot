import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { assertLoopbackRequestHost } from "@applypilot/shared";
import { LOCAL_SESSION_COOKIE, localMutationTokens } from "@web/lib/local-mutation-security";

export const dynamic = "force-dynamic";

function safeReturnPath(value: string | null): string {
  return value &&
    value === value.trim() &&
    /^\/(?:import|jobs(?:\/[A-Za-z0-9._:-]+)?|applications|dashboard|sources)$/.test(value)
    ? value
    : "/dashboard";
}

export async function GET(request: NextRequest) {
  const requestHeaders = await headers();
  assertLoopbackRequestHost({
    host: requestHeaders.get("host"),
    forwardedHost: requestHeaders.get("x-forwarded-host"),
  });
  const session = localMutationTokens.createSession();
  // Next can normalize a numeric loopback nextUrl origin to localhost.
  // A relative destination retains the browser's validated cookie host and port.
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: safeReturnPath(request.nextUrl.searchParams.get("returnTo")) },
  });
  response.cookies.set(LOCAL_SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "strict",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
