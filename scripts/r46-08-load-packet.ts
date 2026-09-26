import BetterSqlite3 from "better-sqlite3";

import { loadPersistedApplicationPacket, SqliteNonSubmitRunStore } from "@applypilot/database";

const [databasePath, packetId, packetDigest, runId, bindingDigest] = process.argv.slice(2);
if (!databasePath || !packetId || !packetDigest || !runId || !bindingDigest) {
  throw new Error("R46_08_CHILD_ARGUMENTS_REQUIRED");
}
const sqlite = new BetterSqlite3(databasePath);
sqlite.pragma("foreign_keys = ON");
try {
  const loaded = loadPersistedApplicationPacket({
    sqlite,
    packetId,
    expectedDigest: packetDigest,
    runId,
    now: new Date("2026-09-22T00:00:00.000Z"),
  });
  const store = new SqliteNonSubmitRunStore(
    sqlite,
    runId,
    packetDigest,
    () => new Date("2026-09-22T00:00:00.000Z"),
  );
  const snapshot = store.load(bindingDigest);
  if (
    !snapshot ||
    !sqlite.prepare("SELECT 1 FROM application_run_previews WHERE run_id=?").get(runId)
  ) {
    throw new Error("R46_08_CHILD_PACKET_OR_PREVIEW_MISSING");
  }
  process.stdout.write(JSON.stringify({ packetDigest: loaded.digest, state: snapshot.state }));
} finally {
  sqlite.close();
}
