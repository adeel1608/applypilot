import { existsSync, readFileSync, writeFileSync } from "node:fs";

import BetterSqlite3 from "better-sqlite3";
import {
  ApplicationPacketSchema,
  LoopbackNonSubmitAdapter,
  TargetIndependentNonSubmitRunner,
  RunnerTargetCapabilitySchema,
  freezeRunnerBinding,
  type NonSubmitTargetAdapter,
} from "@applypilot/application-runner";
import {
  loadPersistedApplicationPacket as loadPacket,
  SqliteNonSubmitRunStore,
} from "@applypilot/database";

async function main(): Promise<void> {
  const [databasePath, packetId, packetDigest, runId, documentPath, barrierPath, releasePath] =
    process.argv.slice(2);
  if (
    !databasePath ||
    !packetId ||
    !packetDigest ||
    !runId ||
    !documentPath ||
    !barrierPath ||
    !releasePath
  ) {
    throw new Error("R46_09_WORKER_ARGUMENTS_REQUIRED");
  }

  const sqlite = new BetterSqlite3(databasePath);
  sqlite.pragma("foreign_keys = ON");
  const loaded = loadPacket({ sqlite, packetId, expectedDigest: packetDigest, runId });
  const packet = ApplicationPacketSchema.parse(loaded.packet);
  if (!packet.targetUrl) throw new Error("R46_09_TARGET_REQUIRED");
  const targetUrl = new URL(packet.targetUrl);
  const capability = RunnerTargetCapabilitySchema.parse({
    schemaVersion: 2,
    capabilityId: "runner:offline-source-preview",
    version: 1,
    predecessorVersion: null,
    targetKind: "SYNTHETIC_LOCAL",
    alias: "Fictional local target",
    allowedOrigin: targetUrl.origin,
    allowedPathPrefix: "/apply",
    formVersion: "fixture-form-v1",
    adapterVersion: "loopback-non-submit-v1",
    allowedOperations: ["MAP_FOR_FILL", "FILL", "UPLOAD", "VERIFY", "FILL_PREVIEW"],
    approvalState: "APPROVED",
    approvalReference: "OFFLINE_FIXTURE_APPROVAL",
    approvedAt: "2026-09-21T00:00:00.000Z",
    policyVersion: "offline-fixture-v1",
    policyExpiresAt: "2026-09-30T00:00:00.000Z",
    capabilityExpiresAt: "2026-09-30T00:00:00.000Z",
    revokedAt: null,
  });
  const binding = freezeRunnerBinding(packet, capability);
  const store = new SqliteNonSubmitRunStore(sqlite, runId, packetDigest);
  const baseAdapter = new LoopbackNonSubmitAdapter({
    documentBytes: {
      [packet.documents[0].digest]: readFileSync(documentPath),
    },
    operationKey: "r46-09-killed-worker",
  });
  const adapter: NonSubmitTargetAdapter = {
    targetKind: baseAdapter.targetKind,
    map: (value, currentBinding) => baseAdapter.map(value, currentBinding),
    fill: (value, currentBinding) => baseAdapter.fill(value, currentBinding),
    upload: async (value, currentBinding) => {
      const observation = await baseAdapter.upload(value, currentBinding);
      writeFileSync(
        barrierPath,
        JSON.stringify({ accepted: true, uploadEvidence: observation.uploadEvidence }),
      );
      while (!existsSync(releasePath)) await new Promise((resolve) => setTimeout(resolve, 10));
      return observation;
    },
    verify: (value, currentBinding) => baseAdapter.verify(value, currentBinding),
    fillPreview: (value, currentBinding) => baseAdapter.fillPreview(value, currentBinding),
  };
  const runner = new TargetIndependentNonSubmitRunner(
    packet,
    capability,
    binding,
    adapter,
    () => binding,
    () => new Date("2026-09-22T00:00:00.000Z"),
    store,
  );
  await runner.map();
  await runner.fill();
  await runner.upload();
  console.log(JSON.stringify({ state: runner.snapshot().state }));
  await baseAdapter.close();
  sqlite.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
