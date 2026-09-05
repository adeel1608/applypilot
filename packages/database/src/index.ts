import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { schema } from "./schema";

export * from "./schema";
export * from "./job-discovery-repository";
export * from "./job-import-repository";

export function openApplyPilotDatabase(path: string) {
  const sqlite = new BetterSqlite3(path);
  sqlite.pragma("foreign_keys = ON");
  if (path !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }
  return {
    db: drizzle(sqlite, { schema }),
    sqlite,
    close: () => sqlite.close(),
  };
}
