import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { SourceAllowlistSchema, type PublicPostingCapability } from "./public-postings";
import { SourceAllowlistV2Schema, type SourceCapabilityV2 } from "./source-capability";

export type PrivateAllowlistResult =
  | { status: "SOURCE_READY_AWAITING_TENANT"; capabilities: [] }
  | { status: "SOURCE_ALLOWLIST_READY"; capabilities: PublicPostingCapability[] };

export type PrivateAllowlistV2Result =
  | { status: "WAITING_FOR_APPROVED_TENANT"; capabilities: [] }
  | { status: "SOURCE_ALLOWLIST_V2_READY"; capabilities: SourceCapabilityV2[] };

async function readConfinedAllowlist(
  repositoryRoot: string,
  filename = "source-allowlist.json",
): Promise<string | null> {
  if (!/^[A-Za-z0-9._-]+\.json$/.test(filename))
    throw new Error("SOURCE_ALLOWLIST_FILENAME_INVALID");
  const root = resolve(repositoryRoot);
  const privateRoot = join(root, "data", "private");
  const path = join(privateRoot, filename);
  let fileStat;
  try {
    fileStat = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!fileStat.isFile() || fileStat.isSymbolicLink())
    throw new Error("SOURCE_ALLOWLIST_UNSAFE_FILE");
  if ((await stat(path)).size > 128_000) throw new Error("SOURCE_ALLOWLIST_TOO_LARGE");
  const [resolvedPrivateRoot, resolvedPath] = await Promise.all([
    realpath(privateRoot),
    realpath(path),
  ]);
  const fromRoot = relative(resolvedPrivateRoot, resolvedPath);
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) {
    throw new Error("SOURCE_ALLOWLIST_PATH_ESCAPE");
  }
  return readFile(resolvedPath, "utf8");
}

export async function loadPrivateSourceAllowlist(
  repositoryRoot: string,
): Promise<PrivateAllowlistResult> {
  const body = await readConfinedAllowlist(repositoryRoot);
  if (body === null) return { status: "SOURCE_READY_AWAITING_TENANT", capabilities: [] };
  const parsed = SourceAllowlistSchema.parse(JSON.parse(body) as unknown);
  return { status: "SOURCE_ALLOWLIST_READY", capabilities: parsed.capabilities };
}

export async function loadPrivateSourceAllowlistV2(
  repositoryRoot: string,
  filename = "source-allowlist.json",
): Promise<PrivateAllowlistV2Result> {
  const body = await readConfinedAllowlist(repositoryRoot, filename);
  if (body === null) return { status: "WAITING_FOR_APPROVED_TENANT", capabilities: [] };
  const parsed = SourceAllowlistV2Schema.parse(JSON.parse(body) as unknown);
  return { status: "SOURCE_ALLOWLIST_V2_READY", capabilities: parsed.capabilities };
}
