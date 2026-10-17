import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HostedReviewedBuildRecordSchema,
  assertHostedBuildEvidence,
  hostedReviewGit,
} from "@applypilot/application-runner";
import { inspectDatabase } from "./database-maintenance";
import { databaseSchemaStatus } from "./database-schema";

/** Read-only admission. It creates no session, receipt, browser or external request. */
export function assertHostedOwnedStartup(root: string, databasePath: string) {
  const runtime = join(root, "data/private/runtime");
  const record = HostedReviewedBuildRecordSchema.parse(
    JSON.parse(readFileSync(join(runtime, "hosted-reviewed-build.json"), "utf8")),
  );
  if (
    hostedReviewGit(root, "rev-parse", "HEAD") !== record.build.head ||
    hostedReviewGit(root, "rev-parse", "HEAD^{tree}") !== record.build.tree ||
    hostedReviewGit(root, "status", "--porcelain").length
  )
    throw new Error("HOSTED_REVIEWED_BUILD_REQUIRED");
  assertHostedBuildEvidence(
    record,
    join(root, "apps/web/.next"),
    readFileSync(join(runtime, "hosted-quality-evidence.json")),
    root,
  );
  const database = inspectDatabase(databasePath),
    status = databaseSchemaStatus(database.schemaVersion);
  if (
    database.integrity !== "PASS" ||
    database.foreignKeyIssues ||
    status.pendingMigrations ||
    status.unsupported
  )
    throw new Error("HOSTED_DATABASE_ROLLOUT_REQUIRED");
  return record;
}
