import { createGreenBannerParentGrant } from "@applypilot/application-runner";
import { GreenBannerGrantRepository, openApplyPilotDatabase } from "@applypilot/database";

import { localDatabasePath } from "./lib/runtime-safety";

async function main(): Promise<void> {
  const mainSha = process.argv[2];
  if (!mainSha) throw new Error("CURRENT_MAIN_SHA_REQUIRED");
  const grant = createGreenBannerParentGrant({
    schemaVersion: 1,
    grantId: "GREEN_BANNER_SESSION_GRANT_V1",
    grantType: "GREEN_BANNER_SESSION_GRANT_V1",
    allowedOperations: [
      "SOURCE_LIST_JOBS",
      "OPEN_AND_INSPECT_ONLY",
      "MAP_FOR_FILL",
      "FILL",
      "UPLOAD",
      "VERIFY",
      "FILL_PREVIEW",
    ],
    scope: {
      sourceProviders: ["LEVER", "GREENHOUSE"],
      sourceHosts: ["api.lever.co", "api.eu.lever.co", "boards-api.greenhouse.io"],
      targetOrigins: ["https://jobs.lever.co", "https://boards.greenhouse.io"],
      maxChildTtlMs: 2 * 60 * 60 * 1000,
    },
    mainSha,
    createdAt: new Date().toISOString(),
  });
  const database = openApplyPilotDatabase(localDatabasePath());
  try {
    const repository = new GreenBannerGrantRepository(database.sqlite);
    const result = repository.persistParentGrant(grant);
    console.log(
      `GREEN_BANNER_PARENT ${result.created ? "CREATED" : "EXISTING"} id=${grant.grantId} digest=${grant.grantDigest} main=${grant.mainSha}`,
    );
  } finally {
    database.close();
  }
}

void main();
