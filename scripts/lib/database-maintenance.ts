import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

const BackupIdSchema = z.string().regex(/^backup-[0-9TZ.-]+-[a-f0-9]{8}$/);

export interface DatabaseSnapshot {
  schemaVersion: number;
  integrity: "PASS" | "FAIL";
  foreignKeyIssues: number;
  tableCounts: Record<string, number>;
}

export interface BackupManifest extends DatabaseSnapshot {
  version: 1;
  backupId: string;
  fileName: string;
  createdAt: string;
  byteLength: number;
  sha256: string;
}

function safeTables(sqlite: BetterSqlite3.Database): string[] {
  return (
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
  )
    .map(({ name }) => name)
    .filter((name) => /^[A-Za-z0-9_]+$/.test(name))
    .sort();
}

export function inspectDatabase(databasePath: string): DatabaseSnapshot {
  const sqlite = new BetterSqlite3(databasePath, { readonly: true, fileMustExist: true });
  try {
    const tableCounts = Object.fromEntries(
      safeTables(sqlite).map((table) => [
        table,
        Number(sqlite.prepare(`SELECT count(*) FROM "${table}"`).pluck().get()),
      ]),
    );
    return {
      schemaVersion: Number(sqlite.pragma("user_version", { simple: true })),
      integrity: sqlite.pragma("integrity_check", { simple: true }) === "ok" ? "PASS" : "FAIL",
      foreignKeyIssues: (sqlite.pragma("foreign_key_check") as unknown[]).length,
      tableCounts,
    };
  } finally {
    sqlite.close();
  }
}

function assertBackupRoot(backupRoot: string): string {
  const root = resolve(backupRoot);
  const segments = root.split(/[\\/]+/).map((part) => part.toLowerCase());
  if (!segments.includes("data") || !segments.includes("private") || basename(root) !== "backups") {
    throw new Error("PRIVATE_BACKUP_ROOT_REQUIRED");
  }
  mkdirSync(root, { recursive: true });
  const real = realpathSync(root);
  const parent = realpathSync(dirname(root));
  const fromParent = relative(parent, real);
  if (!fromParent || fromParent.startsWith(`..${sep}`) || isAbsolute(fromParent)) {
    throw new Error("BACKUP_ROOT_SYMLINK_ESCAPE");
  }
  return real;
}

function backupPaths(backupRoot: string, backupId: string) {
  const id = BackupIdSchema.parse(backupId);
  const root = assertBackupRoot(backupRoot);
  return {
    root,
    database: join(root, `${id}.sqlite.backup`),
    manifest: join(root, `${id}.manifest.json`),
  };
}

function assertDatabaseQuiescent(databasePath: string): void {
  const sqlite = new BetterSqlite3(databasePath, { fileMustExist: true, timeout: 1_000 });
  try {
    const checkpoint = sqlite.pragma("wal_checkpoint(TRUNCATE)") as Array<{
      busy?: number;
      log?: number;
      checkpointed?: number;
    }>;
    if (checkpoint.some(({ busy }) => Number(busy ?? 0) !== 0)) {
      throw new Error("DATABASE_WRITER_ACTIVE");
    }
    sqlite.exec("BEGIN EXCLUSIVE; COMMIT;");
  } catch (error) {
    if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
    if (error instanceof Error && error.message === "DATABASE_WRITER_ACTIVE") throw error;
    throw new Error("DATABASE_NOT_QUIESCENT", { cause: error });
  } finally {
    sqlite.close();
  }
}

export async function createDatabaseBackup(input: {
  databasePath: string;
  backupRoot: string;
  now?: Date;
  randomSuffix?: string;
}): Promise<BackupManifest> {
  const now = input.now ?? new Date();
  const suffix = input.randomSuffix ?? randomUUID().replaceAll("-", "").slice(0, 8);
  if (!/^[a-f0-9]{8}$/.test(suffix)) throw new Error("INVALID_BACKUP_SUFFIX");
  const backupId = `backup-${now.toISOString().replaceAll(":", "-")}-${suffix}`;
  const paths = backupPaths(input.backupRoot, backupId);
  if (existsSync(paths.database) || existsSync(paths.manifest)) throw new Error("BACKUP_COLLISION");
  const sourceBefore = inspectDatabase(input.databasePath);
  if (sourceBefore.integrity !== "PASS" || sourceBefore.foreignKeyIssues) {
    throw new Error("SOURCE_DATABASE_INVALID");
  }
  const source = new BetterSqlite3(input.databasePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(paths.database);
  } finally {
    source.close();
  }
  const backup = inspectDatabase(paths.database);
  if (
    backup.integrity !== "PASS" ||
    backup.foreignKeyIssues ||
    backup.schemaVersion !== sourceBefore.schemaVersion ||
    JSON.stringify(backup.tableCounts) !== JSON.stringify(sourceBefore.tableCounts)
  ) {
    throw new Error("BACKUP_VERIFICATION_FAILED");
  }
  const bytes = readFileSync(paths.database);
  const manifest: BackupManifest = {
    version: 1,
    backupId,
    fileName: basename(paths.database),
    createdAt: now.toISOString(),
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...backup,
  };
  writeFileSync(paths.manifest, JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
  return manifest;
}

export function previewDatabaseRestore(input: {
  backupRoot: string;
  backupId: string;
}): BackupManifest {
  const paths = backupPaths(input.backupRoot, input.backupId);
  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8")) as BackupManifest;
  if (manifest.backupId !== input.backupId || manifest.fileName !== basename(paths.database)) {
    throw new Error("BACKUP_MANIFEST_BINDING_MISMATCH");
  }
  const bytes = readFileSync(paths.database);
  if (
    bytes.byteLength !== manifest.byteLength ||
    createHash("sha256").update(bytes).digest("hex") !== manifest.sha256
  ) {
    throw new Error("BACKUP_DIGEST_MISMATCH");
  }
  const snapshot = inspectDatabase(paths.database);
  if (
    snapshot.integrity !== "PASS" ||
    snapshot.foreignKeyIssues ||
    snapshot.schemaVersion !== manifest.schemaVersion ||
    JSON.stringify(snapshot.tableCounts) !== JSON.stringify(manifest.tableCounts)
  ) {
    throw new Error("BACKUP_VERIFICATION_FAILED");
  }
  return manifest;
}

export async function restoreDatabase(input: {
  databasePath: string;
  backupRoot: string;
  backupId: string;
  confirmation: string;
  now?: Date;
}): Promise<{ restored: DatabaseSnapshot; recoveryBackupId: string | null }> {
  if (input.confirmation !== `RESTORE:${input.backupId}`)
    throw new Error("RESTORE_CONFIRMATION_REQUIRED");
  const manifest = previewDatabaseRestore(input);
  const paths = backupPaths(input.backupRoot, input.backupId);
  const target = resolve(input.databasePath);
  const temporary = `${target}.restore-${input.backupId}.tmp`;
  if (existsSync(temporary)) throw new Error("RESTORE_TEMP_COLLISION");
  let recoveryBackupId: string | null = null;
  if (existsSync(target)) {
    assertDatabaseQuiescent(target);
    recoveryBackupId = (
      await createDatabaseBackup({
        databasePath: target,
        backupRoot: input.backupRoot,
        now: input.now,
      })
    ).backupId;
  }
  copyFileSync(paths.database, temporary, constants.COPYFILE_EXCL);
  const staged = inspectDatabase(temporary);
  if (
    staged.integrity !== "PASS" ||
    staged.foreignKeyIssues ||
    staged.schemaVersion !== manifest.schemaVersion
  ) {
    throw new Error("RESTORE_STAGING_VERIFICATION_FAILED");
  }
  const displaced = `${target}.pre-restore-${input.backupId}.sqlite.backup`;
  if (existsSync(displaced)) throw new Error("RESTORE_RECOVERY_COLLISION");
  try {
    if (existsSync(target)) renameSync(target, displaced);
    renameSync(temporary, target);
  } catch (error) {
    if (!existsSync(target) && existsSync(displaced)) renameSync(displaced, target);
    throw error;
  }
  const restored = inspectDatabase(target);
  if (
    restored.integrity !== "PASS" ||
    restored.foreignKeyIssues ||
    restored.schemaVersion !== manifest.schemaVersion ||
    JSON.stringify(restored.tableCounts) !== JSON.stringify(manifest.tableCounts)
  ) {
    const failed = `${target}.failed-${input.backupId}.sqlite.backup`;
    renameSync(target, failed);
    if (existsSync(displaced)) renameSync(displaced, target);
    throw new Error("RESTORE_FINAL_VERIFICATION_FAILED");
  }
  return { restored, recoveryBackupId };
}
