import { join } from "node:path";

import { createDatabaseBackup } from "./lib/database-maintenance";
import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";

async function main(): Promise<void> {
  const manifest = await createDatabaseBackup({
    databasePath: localDatabasePath(),
    backupRoot: join(repositoryRoot(), "data", "private", "backups"),
  });
  console.log(
    `BACKUP_COMPLETE id=${manifest.backupId} schema_version=${manifest.schemaVersion} integrity=${manifest.integrity}`,
  );
}

void main();
