import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

import BetterSqlite3 from "better-sqlite3";

const filename = "applypilot.e2e.sqlite";
const dataDirectory = resolve("data");
const databasePath = join(dataDirectory, filename);
mkdirSync(dataDirectory, { recursive: true });
for (const suffix of ["", "-shm", "-wal"]) {
  const target = `${databasePath}${suffix}`;
  if (existsSync(target)) unlinkSync(target);
}

const environment = {
  ...process.env,
  APPLYPILOT_DB_PATH: databasePath,
  APPLYPILOT_DB_FILENAME: filename,
  APPLYPILOT_PROFILE_FILENAME: "profile.e2e.private.json",
  APPLYPILOT_SYNTHETIC_MODE: "1",
};
const sqlite = new BetterSqlite3(databasePath);
try {
  sqlite.exec(
    ["0000_applypilot_foundation.sql", "0001_real_world_job_intake.sql"]
      .map((file) => readFileSync(resolve("packages", "database", "drizzle", file), "utf8"))
      .join("\n"),
  );
} finally {
  sqlite.close();
}

const server = spawn(
  process.execPath,
  [resolve("node_modules", "next", "dist", "bin", "next"), "dev", "-H", "127.0.0.1", "-p", "3100"],
  { cwd: resolve("apps/web"), env: environment, stdio: "inherit" },
);
function cleanup(): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    const target = `${databasePath}${suffix}`;
    try {
      if (existsSync(target)) unlinkSync(target);
    } catch {
      // The ignored fictional test database is removed on the next E2E startup if Windows is still releasing it.
    }
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});
