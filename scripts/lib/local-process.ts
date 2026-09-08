import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import { z } from "zod";

import { repositoryRoot } from "./runtime-safety";

export const localHost = "127.0.0.1" as const;
export const defaultLocalPort = 3000;

export const OwnedProcessMetadataSchema = z.object({
  version: z.literal(1),
  application: z.literal("applypilot"),
  pid: z.number().int().positive(),
  ownerMarker: z.uuid(),
  startedAt: z.iso.datetime(),
  repositoryRoot: z.string().min(1),
  entrypoint: z.literal("local-server-process.ts"),
  host: z.literal(localHost),
  port: z.number().int().min(1024).max(65535),
});

export type OwnedProcessMetadata = z.infer<typeof OwnedProcessMetadataSchema>;

export interface ObservedProcess {
  pid: number;
  commandLine: string;
  createdAt: string;
}

export interface LocalRuntimePaths {
  directory: string;
  metadata: string;
  log: string;
}

export function configuredLocalPort(value = process.env.APPLYPILOT_LOCAL_PORT): number {
  const port = value === undefined ? defaultLocalPort : Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("UNSAFE_LOCAL_PORT");
  }
  return port;
}

export function assertConfiguredLocalHost(
  value = process.env.APPLYPILOT_LOCAL_HOST,
): typeof localHost {
  if (value !== undefined && value !== localHost) throw new Error("UNSAFE_LOCAL_HOST");
  return localHost;
}

export function localRuntimePaths(root = repositoryRoot()): LocalRuntimePaths {
  const repository = realpathSync(resolve(root));
  const directory = join(repository, "data", "private", "runtime");
  mkdirSync(directory, { recursive: true });
  if (lstatSync(directory).isSymbolicLink()) throw new Error("RUNTIME_DIRECTORY_SYMLINK_FORBIDDEN");
  const realDirectory = realpathSync(directory);
  const fromRepository = relative(repository, realDirectory);
  if (
    !fromRepository ||
    fromRepository === ".." ||
    fromRepository.startsWith(`..${sep}`) ||
    isAbsolute(fromRepository)
  ) {
    throw new Error("RUNTIME_DIRECTORY_OUTSIDE_REPOSITORY");
  }
  return {
    directory: realDirectory,
    metadata: join(realDirectory, "local-process.json"),
    log: join(realDirectory, "local-process.log"),
  };
}

export function readOwnedProcessMetadata(path: string): OwnedProcessMetadata | null {
  if (!existsSync(path)) return null;
  if (lstatSync(path).isSymbolicLink()) throw new Error("PROCESS_METADATA_SYMLINK_FORBIDDEN");
  return OwnedProcessMetadataSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

export function writeOwnedProcessMetadata(path: string, metadata: OwnedProcessMetadata): void {
  const parsed = OwnedProcessMetadataSchema.parse(metadata);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(parsed, null, 2), { flag: "wx", mode: 0o600 });
  try {
    if (existsSync(path)) throw new Error("PROCESS_METADATA_ALREADY_EXISTS");
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function openPrivateRuntimeLog(path: string): number {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error("PROCESS_LOG_SYMLINK_FORBIDDEN");
  }
  return openSync(path, "a", 0o600);
}

export function closeRuntimeLog(descriptor: number): void {
  closeSync(descriptor);
}

export function inspectProcess(pid: number): ObservedProcess | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform !== "win32") return null;
  const command = [
    `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'`,
    "if ($null -eq $p) { exit 3 }",
    "[pscustomobject]@{ ProcessId = $p.ProcessId; CommandLine = $p.CommandLine; CreationDate = $p.CreationDate.ToString('o') } | ConvertTo-Json -Compress",
  ].join("; ");
  try {
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5_000,
      },
    );
    const parsed = JSON.parse(output) as {
      ProcessId?: unknown;
      CommandLine?: unknown;
      CreationDate?: unknown;
    };
    if (
      Number(parsed.ProcessId) !== pid ||
      typeof parsed.CommandLine !== "string" ||
      typeof parsed.CreationDate !== "string"
    ) {
      return null;
    }
    return { pid, commandLine: parsed.CommandLine, createdAt: parsed.CreationDate };
  } catch {
    return null;
  }
}

export function processMatchesMetadata(
  metadataInput: OwnedProcessMetadata,
  observed: ObservedProcess,
  root = repositoryRoot(),
): boolean {
  const metadata = OwnedProcessMetadataSchema.parse(metadataInput);
  if (observed.pid !== metadata.pid || resolve(metadata.repositoryRoot) !== resolve(root))
    return false;
  const command = observed.commandLine.toLowerCase();
  if (
    !command.includes(metadata.ownerMarker.toLowerCase()) ||
    !command.includes(metadata.entrypoint.toLowerCase())
  ) {
    return false;
  }
  const observedTime = Date.parse(observed.createdAt);
  const recordedTime = Date.parse(metadata.startedAt);
  return Number.isFinite(observedTime) && Math.abs(observedTime - recordedTime) <= 30_000;
}

export async function isPortOpen(port: number, host = localHost): Promise<boolean> {
  return await new Promise((resolveResult) => {
    const socket = createConnection({ host, port });
    const finish = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolveResult(value);
    };
    socket.setTimeout(400);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function waitForPort(
  port: number,
  open: boolean,
  timeoutMs = 30_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await isPortOpen(port)) === open) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  return (await isPortOpen(port)) === open;
}

export function safeEntrypointName(path: string): string {
  return basename(path);
}
