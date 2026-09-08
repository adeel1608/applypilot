import { cookies } from "next/headers";
import { join } from "node:path";

import { assertLoopbackRequestHost } from "@applypilot/shared";
import { getLocalDatabase, hasBetaSchema } from "@web/lib/local-database";
import { LOCAL_SESSION_COOKIE, localMutationTokens } from "@web/lib/local-mutation-security";
import { resolveLocalDataDirectory } from "@web/lib/local-data-directory";
import { readPrivateDocumentArtifact } from "@web/lib/private-document";

export const dynamic = "force-dynamic";

function safeError(status: number, code: string): Response {
  return new Response(code, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  try {
    assertLoopbackRequestHost({
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
    });
  } catch {
    return safeError(403, "LOCAL_REQUEST_REQUIRED");
  }
  const session = (await cookies()).get(LOCAL_SESSION_COOKIE)?.value;
  if (!localMutationTokens.isSessionValid(session)) {
    return safeError(401, "LOCAL_SESSION_REQUIRED");
  }
  const local = getLocalDatabase();
  if (!local || !hasBetaSchema(local.sqlite)) return safeError(503, "BETA_DATABASE_NOT_READY");
  const disposition = new URL(request.url).searchParams.get("disposition");
  if (disposition !== null && disposition !== "inline" && disposition !== "attachment") {
    return safeError(400, "INVALID_DOCUMENT_DISPOSITION");
  }
  try {
    const { artifactId } = await context.params;
    const document = await readPrivateDocumentArtifact(
      local.sqlite,
      join(resolveLocalDataDirectory(), "private"),
      artifactId,
    );
    const mode =
      document.format === "PDF" && disposition !== "attachment" ? "inline" : "attachment";
    const body = new ArrayBuffer(document.bytes.byteLength);
    new Uint8Array(body).set(document.bytes);
    return new Response(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `${mode}; filename="${document.fileName}"`,
        "Content-Type": document.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "DOCUMENT_UNAVAILABLE";
    const status =
      code === "DOCUMENT_ARTIFACT_NOT_FOUND" || code === "DOCUMENT_FILE_NOT_FOUND" ? 404 : 409;
    return safeError(status, code);
  }
}
