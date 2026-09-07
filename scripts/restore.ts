import { join } from "node:path";

import { previewDatabaseRestore, restoreDatabase } from "./lib/database-maintenance";
import { localDatabasePath, repositoryRoot } from "./lib/runtime-safety";

async function main(): Promise<void> {
  const previewIndex = process.argv.indexOf("--preview");
  const confirmIndex = process.argv.indexOf("--confirm");
  const backupId =
    previewIndex >= 0
      ? process.argv[previewIndex + 1]
      : confirmIndex >= 0
        ? process.argv[confirmIndex + 1]
        : null;
  if (!backupId)
    throw new Error(
      "Usage: restore --preview <backup-id> OR restore --confirm <backup-id> RESTORE:<backup-id>",
    );
  const backupRoot = join(repositoryRoot(), "data", "private", "backups");
  if (previewIndex >= 0) {
    const manifest = previewDatabaseRestore({ backupRoot, backupId });
    console.log(
      `RESTORE_PREVIEW id=${manifest.backupId} schema_version=${manifest.schemaVersion} integrity=${manifest.integrity}`,
    );
  } else {
    const confirmation = process.argv[confirmIndex + 2] ?? "";
    const result = await restoreDatabase({
      databasePath: localDatabasePath(),
      backupRoot,
      backupId,
      confirmation,
    });
    console.log(
      `RESTORE_COMPLETE id=${backupId} schema_version=${result.restored.schemaVersion} integrity=${result.restored.integrity} recovery_backup=${result.recoveryBackupId ?? "none"}`,
    );
  }
}

void main();
