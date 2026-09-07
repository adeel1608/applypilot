import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { SourceAllowlistSchema, type PublicPostingCapability } from "./public-postings";

export type PrivateAllowlistResult =
  | { status: "SOURCE_READY_AWAITING_TENANT"; capabilities: [] }
  | { status: "SOURCE_ALLOWLIST_READY"; capabilities: PublicPostingCapability[] };

export async function loadPrivateSourceAllowlist(
  repositoryRoot: string,
): Promise<PrivateAllowlistResult> {
  const root = resolve(repositoryRoot);
  const privateRoot = join(root, "data", "private");
  const path = join(privateRoot, "source-allowlist.json");
  let fileStat;
  try {
    fileStat = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "SOURCE_READY_AWAITING_TENANT", capabilities: [] };
    }
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
  const parsed = SourceAllowlistSchema.parse(
    JSON.parse(await readFile(resolvedPath, "utf8")) as unknown,
  );
  return { status: "SOURCE_ALLOWLIST_READY", capabilities: parsed.capabilities };
}
