import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { schema } from "./schema";

export * from "./schema";

export function openApplyPilotDatabase(path: string) {
  const sqlite = new BetterSqlite3(path);
  sqlite.pragma("foreign_keys = ON");
  if (path !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }
  return {
    db: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
}
