import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  createDatabaseBackup,
  inspectDatabase,
  previewDatabaseRestore,
  restoreDatabase,
} from "../../scripts/lib/database-maintenance";

describe("database backup and restore", () => {
  it("creates a verified immutable snapshot and requires exact restore confirmation", async () => {
    const root = await mkdtemp(join(tmpdir(), "applypilot-maintenance-"));
    const data = join(root, "data");
    const privateRoot = join(data, "private");
    const backupRoot = join(privateRoot, "backups");
    const databasePath = join(data, "synthetic.sqlite");
    await mkdir(backupRoot, { recursive: true });
    const sqlite = new BetterSqlite3(databasePath);
    sqlite.exec(
      "CREATE TABLE fixture (id TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version=2;",
    );
    sqlite.prepare("INSERT INTO fixture (id,value) VALUES ('one','original')").run();
    sqlite.close();
    try {
      const manifest = await createDatabaseBackup({
        databasePath,
        backupRoot,
        now: new Date("2026-09-07T04:00:00.000Z"),
        randomSuffix: "deadbeef",
      });
      expect(previewDatabaseRestore({ backupRoot, backupId: manifest.backupId })).toMatchObject({
        integrity: "PASS",
        tableCounts: { fixture: 1 },
      });
      const changed = new BetterSqlite3(databasePath);
      changed.prepare("UPDATE fixture SET value='changed' WHERE id='one'").run();
      changed.close();
      await expect(
        restoreDatabase({
          databasePath,
          backupRoot,
          backupId: manifest.backupId,
          confirmation: "wrong",
        }),
      ).rejects.toThrow("RESTORE_CONFIRMATION_REQUIRED");
      const restored = await restoreDatabase({
        databasePath,
        backupRoot,
        backupId: manifest.backupId,
        confirmation: `RESTORE:${manifest.backupId}`,
        now: new Date("2026-09-07T04:01:00.000Z"),
      });
      expect(restored.restored).toMatchObject({ integrity: "PASS", foreignKeyIssues: 0 });
      expect(restored.recoveryBackupId).toMatch(/^backup-/);
      const verified = new BetterSqlite3(databasePath, { readonly: true });
      expect(verified.prepare("SELECT value FROM fixture WHERE id='one'").pluck().get()).toBe(
        "original",
      );
      verified.close();
      expect(inspectDatabase(databasePath).schemaVersion).toBe(2);
      expect(
        (await readFile(join(backupRoot, `${manifest.backupId}.manifest.json`))).length,
      ).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
