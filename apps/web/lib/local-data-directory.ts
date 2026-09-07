import "server-only";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

const repositoryManifestSchema = z.object({
  name: z.literal("applypilot"),
  private: z.literal(true),
  workspaces: z
    .array(z.string())
    .refine((workspaces) => workspaces.includes("apps/*") && workspaces.includes("packages/*")),
});

export function resolveLocalDataDirectory(): string {
  let directory = process.cwd();
  while (true) {
    try {
      // Inspect the local checkout at runtime; do not package its files into build output.
      const manifest: unknown = JSON.parse(
        readFileSync(/* turbopackIgnore: true */ join(directory, "package.json"), "utf8"),
      );
      if (repositoryManifestSchema.safeParse(manifest).success) return join(directory, "data");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("LOCAL_REPOSITORY_ROOT_NOT_FOUND");
      }
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("LOCAL_REPOSITORY_ROOT_NOT_FOUND");
    directory = parent;
  }
}
