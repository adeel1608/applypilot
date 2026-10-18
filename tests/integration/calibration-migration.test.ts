import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createDatabaseBackup, restoreDatabase } from "../../scripts/lib/database-maintenance";
import { applyTransactionMigration } from "../../scripts/lib/database-schema";

const migrationRoot = resolve("packages/database/drizzle");
const previousHead = "5b4d16085dbc85d1e9fd16daad8f9fa976a2ae75";
const historical = readdirSync(migrationRoot)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 14)
  .sort();
const migration = () => readFileSync(join(migrationRoot, "0015_r2_calibration_intake.sql"), "utf8");
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function snapshot(db: Database.Database) {
  const names = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
  return Object.fromEntries(
    names.map((name) => {
      if (!/^[a-z0-9_]+$/.test(name)) throw new Error("FICTIONAL_TABLE_INVALID");
      const rows = db
        .prepare(`SELECT * FROM "${name}"`)
        .all()
        .map((row) => JSON.stringify(row))
        .sort();
      return [name, { count: rows.length, hash: sha(JSON.stringify(rows)) }];
    }),
  );
}
function setup() {
  const root = mkdtempSync(join(tmpdir(), "applypilot-calibration-migration-")),
    data = join(root, "data"),
    backupRoot = join(data, "private/backups"),
    databasePath = join(data, "fixture.sqlite");
  mkdirSync(backupRoot, { recursive: true });
  const db = new Database(databasePath);
  db.pragma("foreign_keys=ON");
  for (const name of historical) db.exec(readFileSync(join(migrationRoot, name), "utf8"));
  const now = "2026-10-18T00:00:00.000Z";
  db.prepare(
    "INSERT INTO candidate_profiles VALUES ('fixture-profile','fixture-profile-version',?,?)",
  ).run(now, now);
  db.prepare(
    "INSERT INTO candidate_profile_versions VALUES ('fixture-profile-version','fixture-profile',1,1,'{}',?,?)",
  ).run("a".repeat(64), now);
  for (const id of ["fictional-job-a", "fictional-job-b"]) {
    db.prepare(
      "INSERT INTO jobs(id,title,company,category,location,employment_type,normalized_json,date_discovered,created_at,updated_at) VALUES (?,?,'Example Company','Fictional role','Example city','UNKNOWN','{}',?,?,?)",
    ).run(id, id, now, now, now);
  }
  db.prepare(
    "INSERT INTO calibration_labels VALUES ('legacy-fictional-label','fictional-job-a','AMBIGUOUS','[]',?)",
  ).run(now);
  db.prepare(
    "INSERT INTO calibration_pairs VALUES ('legacy-fictional-pair','fictional-job-a','fictional-job-b','[]',?)",
  ).run(now);
  const before = snapshot(db);
  return { root, db, databasePath, backupRoot, before };
}
function cleanup(root: string) {
  const absolute = resolve(root),
    inside = relative(resolve(tmpdir()), absolute);
  if (
    !basename(absolute).startsWith("applypilot-calibration-migration-") ||
    !inside ||
    inside === ".." ||
    inside.startsWith(`..${sep}`) ||
    isAbsolute(inside)
  )
    throw new Error("FICTIONAL_MIGRATION_CLEANUP_ESCAPE");
  rmSync(absolute, { recursive: true, force: true });
}
describe("calibration schema15 migration safety", () => {
  it("preserves all historical rows through schema15 and production backup restore", async () => {
    const f = setup();
    try {
      expect(historical).toHaveLength(15);
      expect(Object.keys(f.before)).toHaveLength(79);
      const oldBytes = historical.map((name) => ({
        name,
        hash: sha(readFileSync(join(migrationRoot, name))),
      }));
      // Verify all prior migration Git content against the previously released head.
      for (const name of historical) {
        const path = `packages/database/drizzle/${name}`;
        const expected = execFileSync("git", ["rev-parse", `${previousHead}:${path}`], {
          encoding: "utf8",
          windowsHide: true,
        }).trim();
        const observed = execFileSync("git", ["hash-object", "--path", path, path], {
          encoding: "utf8",
          windowsHide: true,
        }).trim();
        expect(observed).toBe(expected);
      }
      applyTransactionMigration(f.db, migration());
      const after = snapshot(f.db);
      expect(f.db.pragma("user_version", { simple: true })).toBe(15);
      for (const [name, rows] of Object.entries(f.before)) expect(after[name]).toEqual(rows);
      const added = Object.keys(after).filter((n) => !(n in f.before));
      expect(added.sort()).toEqual([
        "r2_calibration_campaigns",
        "r2_calibration_comparisons",
        "r2_calibration_intake_qualifications",
        "r2_calibration_label_events",
        "r2_calibration_pair_events",
      ]);
      for (const name of added) expect(after[name]!.count).toBe(0);
      expect(f.db.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(f.db.pragma("foreign_key_check")).toEqual([]);
      f.db.close();
      const backup = await createDatabaseBackup({
        databasePath: f.databasePath,
        backupRoot: f.backupRoot,
      });
      const restoredPath = join(f.root, "data/restored.sqlite");
      const restored = await restoreDatabase({
        databasePath: restoredPath,
        backupRoot: f.backupRoot,
        backupId: backup.backupId,
        confirmation: `RESTORE:${backup.backupId}`,
      });
      expect(restored.restored).toMatchObject({
        schemaVersion: 15,
        integrity: "PASS",
        foreignKeyIssues: 0,
      });
      const read = new Database(restoredPath, { readonly: true });
      try {
        expect(snapshot(read)).toEqual(after);
      } finally {
        read.close();
      }
      expect(
        historical.map((name) => ({ name, hash: sha(readFileSync(join(migrationRoot, name))) })),
      ).toEqual(oldBytes);
    } finally {
      if (f.db.open) f.db.close();
      cleanup(f.root);
    }
  }, 30_000);
  it("rolls back a failed schema15 transaction without changing history", () => {
    const f = setup();
    try {
      const failedSql = migration().replace(
        "PRAGMA user_version = 15;",
        "SELECT * FROM fictional_missing_migration_table; PRAGMA user_version = 15;",
      );
      expect(failedSql).not.toEqual(migration());
      expect(() => applyTransactionMigration(f.db, failedSql)).toThrow(
        "no such table: fictional_missing_migration_table",
      );
      expect(f.db.pragma("user_version", { simple: true })).toBe(14);
      expect(snapshot(f.db)).toEqual(f.before);
      expect(f.db.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(f.db.pragma("foreign_key_check")).toEqual([]);
    } finally {
      f.db.close();
      cleanup(f.root);
    }
  });
});
