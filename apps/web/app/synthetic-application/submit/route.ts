import { assertLoopbackMutationRequest } from "@applypilot/shared";

const allowedCases = new Set([
  "simple",
  "required-unknown",
  "conditional",
  "document-upload",
  "changed-page",
  "changed-field",
  "redirect",
  "captcha",
  "mfa",
  "auth-required",
  "http-401",
  "http-403",
  "http-429",
  "access-denied",
  "rate-limit",
  "unsupported-control",
  "slow-response",
  "success-receipt",
  "different-action",
  "lost-response",
]);

export async function POST(request: Request): Promise<Response> {
  if (process.env.APPLYPILOT_SYNTHETIC_MODE !== "1")
    return new Response("Not found", { status: 404 });
  assertLoopbackMutationRequest({
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    forwardedHost: request.headers.get("x-forwarded-host"),
  });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(contentLength) || contentLength > 1_000_000) {
    return Response.json({ status: "REJECTED", reason: "BODY_TOO_LARGE" }, { status: 413 });
  }
  const fixture = new URL(request.url).searchParams.get("case") ?? "simple";
  if (!allowedCases.has(fixture)) return Response.json({ status: "REJECTED" }, { status: 400 });
  const form = await request.formData();
  const formVersion = String(form.get("formVersion") ?? "");
  if (!/^synthetic-form-v[12]$/.test(formVersion)) {
    return Response.json({ status: "PAUSED", reason: "FORM_CHANGED" }, { status: 409 });
  }
  if (fixture === "http-401") {
    return Response.json({ status: "PAUSED", reason: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  }
  if (fixture === "http-403") {
    return Response.json({ status: "PAUSED", reason: "ACCESS_CONTROL" }, { status: 403 });
  }
  if (fixture === "http-429") {
    return Response.json({ status: "PAUSED", reason: "RATE_LIMIT" }, { status: 429 });
  }
  if (fixture === "slow-response") {
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }
  if (fixture === "lost-response") {
    return Response.json({ status: "OUTCOME_UNKNOWN" }, { status: 504 });
  }
  if (fixture === "redirect") {
    return Response.redirect(new URL("/synthetic-application?case=changed-page", request.url), 303);
  }
  if (fixture === "success-receipt") {
    return Response.json({
      status: "SYNTHETIC_SUBMITTED",
      fixture,
      formVersion,
      receipt: "fixture-receipt-001",
    });
  }
  return Response.json({ status: "SYNTHETIC_SUBMITTED", fixture, formVersion });
}
