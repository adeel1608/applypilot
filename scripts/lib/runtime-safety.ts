import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { z } from "zod";

const ManifestSchema = z.object({ name: z.literal("applypilot"), private: z.literal(true) });

export function repositoryRoot(): string {
  let candidate = resolve(process.cwd());
  while (true) {
    try {
      const manifest = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8")) as unknown;
      if (ManifestSchema.safeParse(manifest).success) return candidate;
    } catch {
      // Continue walking to the filesystem root.
    }
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error("APPLYPILOT_REPOSITORY_ROOT_NOT_FOUND");
    candidate = parent;
  }
}

export function confinedDataPath(input: string | undefined, fallback: string): string {
  const root = repositoryRoot();
  const dataRoot = resolve(root, "data");
  const target = resolve(root, input ?? fallback);
  const fromData = relative(dataRoot, target);
  if (
    fromData === "" ||
    fromData === ".." ||
    fromData.startsWith(`..${sep}`) ||
    isAbsolute(fromData)
  ) {
    throw new Error("LOCAL_DATA_PATH_OUTSIDE_REPOSITORY_DATA");
  }
  return target;
}

export function localDatabasePath(): string {
  const target = confinedDataPath(process.env.APPLYPILOT_DB_PATH, "data/applypilot.local.sqlite");
  if (!target.toLowerCase().endsWith(".sqlite")) throw new Error("LOCAL_DATABASE_MUST_BE_SQLITE");
  return target;
}
