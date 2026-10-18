import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { isBlockedNetworkAddress } from "@applypilot/job-sources";
import {
  HostedDiagnosticError,
  hostedDiagnostic,
  hostedMethodClass,
  hostedUrlShape,
  safeHostedError,
  type HostedRejectionSite,
  type HostedTransportPhase,
} from "./hosted-diagnostics";

export interface HostedHttpRequest {
  url: URL;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body: Buffer | null;
  byteLimit: number;
  timeoutMs: number;
}
export interface HostedHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}
export type HostedHttpTransport = (input: HostedHttpRequest) => Promise<HostedHttpResponse>;

/** One pinned public HTTPS attempt. No redirects, retry, raw error logging or application API client. */
export const pinnedHostedHttpTransport: HostedHttpTransport = async (input) => {
  let phase: HostedTransportPhase = "VALIDATING";
  let site: HostedRejectionSite = "UNKNOWN_REJECTION_SITE";
  let firstFailurePhase: HostedTransportPhase | null = null;
  const failure = (code: string) => {
    firstFailurePhase ??= phase;
    return new Error(code);
  };
  const urlShape = hostedUrlShape(input.url);
  const transportConfig = {
    methodValid: ["GET", "POST"].includes(input.method),
    timeoutValid:
      Number.isInteger(input.timeoutMs) && input.timeoutMs >= 100 && input.timeoutMs <= 30000,
    byteLimitValid:
      Number.isInteger(input.byteLimit) && input.byteLimit >= 1000 && input.byteLimit <= 5_000_000,
    bodyLimitValid: (input.body?.length ?? 0) <= 5_000_000,
    getBodyValid: !(input.method === "GET" && input.body),
  };
  try {
    if (Object.values(urlShape).some(Boolean)) site = "TRANSPORT_URL_SHAPE";
    else if (!transportConfig.methodValid) site = "TRANSPORT_METHOD";
    else if (!transportConfig.timeoutValid) site = "TRANSPORT_TIMEOUT_RANGE";
    else if (!transportConfig.byteLimitValid) site = "TRANSPORT_BYTE_LIMIT_RANGE";
    else if (!transportConfig.bodyLimitValid) site = "TRANSPORT_BODY_LIMIT";
    else if (!transportConfig.getBodyValid) site = "TRANSPORT_GET_BODY";
    if (site !== "UNKNOWN_REJECTION_SITE") throw failure("HOSTED_DESTINATION_FORBIDDEN");
    const deadline = Date.now() + input.timeoutMs;
    let addresses: string[];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      phase = "DNS_STARTED";
      addresses = (
        await Promise.race([
          lookup(input.url.hostname, { all: true, verbatim: true }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(failure("HOSTED_DNS_FAILED")), input.timeoutMs);
            timer.unref();
          }),
        ])
      ).map((value) => value.address);
    } catch {
      throw failure("HOSTED_DNS_FAILED");
    } finally {
      clearTimeout(timer);
    }
    if (!addresses.length || addresses.some(isBlockedNetworkAddress))
      throw failure("HOSTED_NETWORK_ADDRESS_FORBIDDEN");
    const pinned = addresses[0]!;
    const family = isIP(pinned);
    if (family !== 4 && family !== 6) throw failure("HOSTED_NETWORK_ADDRESS_FORBIDDEN");
    return await new Promise<HostedHttpResponse>((resolve, reject) => {
      const headers = Object.fromEntries(
        Object.entries(input.headers).filter(([key]) =>
          [
            "accept",
            "content-type",
            "cookie",
            "origin",
            "referer",
            "user-agent",
            "x-csrf-token",
            "x-xsrf-token",
          ].includes(key.toLowerCase()),
        ),
      );
      headers["accept-encoding"] = "identity";
      const outgoing = request(
        input.url,
        {
          method: input.method,
          headers,
          family,
          servername: input.url.hostname,
          lookup: (_host, options, callback) =>
            options.all
              ? callback(null, [{ address: pinned, family }])
              : callback(null, pinned, family),
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        },
        (response) => {
          phase = "RESPONSE_HEADERS_OBSERVED";
          const connected = response.socket.remoteAddress?.replace(/^::ffff:/, "");
          if (connected !== pinned.replace(/^::ffff:/, "")) {
            response.destroy();
            reject(failure("HOSTED_NETWORK_ADDRESS_CHANGED"));
            return;
          }
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
            response.destroy();
            reject(failure("HOSTED_REDIRECT_FORBIDDEN"));
            return;
          }
          if (
            response.headers["content-encoding"] &&
            response.headers["content-encoding"] !== "identity"
          ) {
            response.destroy();
            reject(failure("HOSTED_CONTENT_ENCODING_UNSUPPORTED"));
            return;
          }
          let length = 0;
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > input.byteLimit) {
              response.destroy();
              reject(failure("HOSTED_RESPONSE_TOO_LARGE"));
            } else chunks.push(Buffer.from(chunk));
          });
          response.on("end", () => {
            phase = "BODY_COMPLETED";
            resolve({
              status: response.statusCode ?? 500,
              headers: Object.fromEntries(
                Object.entries(response.headers).flatMap(([key, value]) =>
                  value === undefined ||
                  ["content-length", "transfer-encoding", "connection"].includes(key)
                    ? []
                    : [
                        [
                          key,
                          Array.isArray(value)
                            ? value.join(key === "set-cookie" ? "\n" : ", ")
                            : value,
                        ],
                      ],
                ),
              ),
              body: Buffer.concat(chunks),
            });
          });
          response.on("error", () => reject(failure("HOSTED_TRANSPORT_OUTCOME_UNKNOWN")));
        },
      );
      outgoing.on("socket", () => {
        phase = "SOCKET_OBSERVED";
      });
      outgoing.on("error", () => reject(failure("HOSTED_TRANSPORT_OUTCOME_UNKNOWN")));
      if (input.body) outgoing.write(input.body);
      outgoing.end();
    });
  } catch (error) {
    throw new HostedDiagnosticError(
      safeHostedError(error),
      hostedDiagnostic(safeHostedError(error), {
        site,
        method: hostedMethodClass(input.method),
        urlShape,
        transportConfig,
        transportPhase: firstFailurePhase ?? phase,
      }),
    );
  }
};
