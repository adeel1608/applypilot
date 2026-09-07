import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
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
      const separateDestination = join(data, "restored.sqlite");
      const separate = await restoreDatabase({
        databasePath: separateDestination,
        backupRoot,
        backupId: manifest.backupId,
        confirmation: `RESTORE:${manifest.backupId}`,
      });
      expect(separate.recoveryBackupId).toBeNull();
      expect(separate.restored).toMatchObject({
        schemaVersion: 2,
        integrity: "PASS",
        foreignKeyIssues: 0,
        tableCounts: { fixture: 1 },
      });
      const separateDatabase = new BetterSqlite3(separateDestination, { readonly: true });
      expect(
        separateDatabase.prepare("SELECT value FROM fixture WHERE id='one'").pluck().get(),
      ).toBe("original");
      separateDatabase.close();
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

  it("rejects an existing deterministic backup destination", async () => {
    const fixture = await createFixture("collision");
    try {
      const input = {
        databasePath: fixture.databasePath,
        backupRoot: fixture.backupRoot,
        now: new Date("2026-09-07T05:00:00.000Z"),
        randomSuffix: "deadbeef",
      };
      await createDatabaseBackup(input);
      await expect(createDatabaseBackup(input)).rejects.toThrow("BACKUP_COLLISION");
    } finally {
      await fixture.cleanup();
    }
  });

  it.each(["bad-manifest", "corrupt-backup", "wrong-schema", "incomplete"] as const)(
    "rejects %s restore material",
    async (failure) => {
      const fixture = await createFixture(failure);
      try {
        const manifest = await createDatabaseBackup({
          databasePath: fixture.databasePath,
          backupRoot: fixture.backupRoot,
          now: new Date("2026-09-07T06:00:00.000Z"),
          randomSuffix: "cafebabe",
        });
        const manifestPath = join(fixture.backupRoot, `${manifest.backupId}.manifest.json`);
        const backupPath = join(fixture.backupRoot, `${manifest.backupId}.sqlite.backup`);
        if (failure === "bad-manifest") await writeFile(manifestPath, "not-json");
        if (failure === "corrupt-backup") await writeFile(backupPath, "not-sqlite");
        if (failure === "wrong-schema") {
          await writeFile(manifestPath, JSON.stringify({ ...manifest, schemaVersion: 1 }));
        }
        if (failure === "incomplete") await unlink(manifestPath);
        expect(() =>
          previewDatabaseRestore({ backupRoot: fixture.backupRoot, backupId: manifest.backupId }),
        ).toThrow();
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it("rejects a backup root outside data/private/backups", async () => {
    const fixture = await createFixture("escape");
    try {
      await expect(
        createDatabaseBackup({
          databasePath: fixture.databasePath,
          backupRoot: join(fixture.root, "backups"),
        }),
      ).rejects.toThrow("BACKUP_ROOT_DOES_NOT_MATCH_DATABASE");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a lookalike data/private/backups root that does not belong to the database", async () => {
    const fixture = await createFixture("lookalike");
    const lookalike = join(fixture.root, "elsewhere", "data", "private", "backups");
    await mkdir(lookalike, { recursive: true });
    try {
      await expect(
        createDatabaseBackup({
          databasePath: fixture.databasePath,
          backupRoot: lookalike,
        }),
      ).rejects.toThrow("BACKUP_ROOT_DOES_NOT_MATCH_DATABASE");
    } finally {
      await fixture.cleanup();
    }
  });
});

async function createFixture(name: string): Promise<{
  root: string;
  backupRoot: string;
  databasePath: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), `applypilot-maintenance-${name}-`));
  const backupRoot = join(root, "data", "private", "backups");
  const databasePath = join(root, "data", "fixture.sqlite");
  await mkdir(backupRoot, { recursive: true });
  const sqlite = new BetterSqlite3(databasePath);
  sqlite.exec(
    "CREATE TABLE fixture (id TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version=2;",
  );
  sqlite.prepare("INSERT INTO fixture (id,value) VALUES ('one','fictional')").run();
  sqlite.close();
  return {
    root,
    backupRoot,
    databasePath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
