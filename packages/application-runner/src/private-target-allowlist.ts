import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { RunnerTargetAllowlistSchema, type RunnerTargetCapability } from "./target-runner";

export type PrivateRunnerTargetAllowlistResult =
  | { status: "WAITING_FOR_APPROVED_TARGET"; capabilities: [] }
  | { status: "RUNNER_TARGET_ALLOWLIST_READY"; capabilities: RunnerTargetCapability[] };

export async function loadPrivateRunnerTargetAllowlist(
  repositoryRoot: string,
  filename = "runner-target-allowlist.json",
): Promise<PrivateRunnerTargetAllowlistResult> {
  if (!/^[A-Za-z0-9._-]+\.json$/.test(filename))
    throw new Error("RUNNER_ALLOWLIST_FILENAME_INVALID");
  const root = resolve(repositoryRoot);
  const privateRoot = join(root, "data", "private");
  const path = join(privateRoot, filename);
  let file;
  try {
    file = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { status: "WAITING_FOR_APPROVED_TARGET", capabilities: [] };
    throw error;
  }
  if (!file.isFile() || file.isSymbolicLink()) throw new Error("RUNNER_ALLOWLIST_UNSAFE_FILE");
  if ((await stat(path)).size > 128_000) throw new Error("RUNNER_ALLOWLIST_TOO_LARGE");
  const [resolvedRoot, resolvedPath] = await Promise.all([realpath(privateRoot), realpath(path)]);
  const fromRoot = relative(resolvedRoot, resolvedPath);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
    throw new Error("RUNNER_ALLOWLIST_PATH_ESCAPE");
  const parsed = RunnerTargetAllowlistSchema.parse(
    JSON.parse(await readFile(resolvedPath, "utf8")) as unknown,
  );
  return { status: "RUNNER_TARGET_ALLOWLIST_READY", capabilities: parsed.capabilities };
}
