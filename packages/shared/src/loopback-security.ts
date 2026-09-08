export interface LoopbackMutationHeaders {
  host: string | null;
  origin: string | null;
  forwardedHost?: string | null;
}

function parseLoopbackAuthority(authority: string): { hostname: string; port: string } | null {
  const value = authority.trim().toLowerCase();
  if (!value || /[\s,@/\\]/.test(value)) return null;
  try {
    const url = new URL(`http://${value}`);
    if (url.username || url.password || url.pathname !== "/") return null;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    const port = url.port || "80";
    const numericPort = Number(port);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) return null;
    return { hostname: url.hostname, port };
  } catch {
    return null;
  }
}

export function assertLoopbackRequestHost(input: {
  host: string | null;
  forwardedHost?: string | null;
}): { hostname: string; port: string } {
  if (
    input.forwardedHost &&
    input.forwardedHost.trim().toLowerCase() !== input.host?.trim().toLowerCase()
  ) {
    throw new Error("FORWARDED_HOST_UNTRUSTED");
  }
  const host = input.host ? parseLoopbackAuthority(input.host) : null;
  if (!host) throw new Error("LOCAL_REQUEST_REQUIRED");
  return host;
}

export function assertLoopbackMutationRequest(input: LoopbackMutationHeaders): void {
  const host = assertLoopbackRequestHost(input);
  if (!input.origin || input.origin === "null") throw new Error("MUTATION_ORIGIN_REQUIRED");
  let origin: URL;
  try {
    origin = new URL(input.origin);
  } catch {
    throw new Error("MUTATION_ORIGIN_INVALID");
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    throw new Error("MUTATION_ORIGIN_INVALID");
  }
  if (origin.username || origin.password || origin.pathname !== "/") {
    throw new Error("MUTATION_ORIGIN_INVALID");
  }
  const originAuthority = parseLoopbackAuthority(origin.host);
  if (!originAuthority) throw new Error("FOREIGN_MUTATION_ORIGIN");
  if (originAuthority.hostname !== host.hostname || originAuthority.port !== host.port) {
    throw new Error("MUTATION_ORIGIN_MISMATCH");
  }
}
