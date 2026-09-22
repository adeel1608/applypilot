import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

import { expect, test } from "@playwright/test";

import {
  ApplicationPacketSchema,
  InMemoryNonSubmitDurableStore,
  LoopbackNonSubmitAdapter,
  TargetIndependentNonSubmitRunner,
  RunnerTargetCapabilitySchema,
  freezeRunnerBinding,
  type RunnerTargetCapability,
} from "@applypilot/application-runner";

const fixedNow = new Date("2026-09-22T00:00:00.000Z");

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fixtureServer(): Promise<{
  server: Server;
  targetUrl: string;
  counts: { uploads: number; submissions: number };
}> {
  const counts = { uploads: 0, submissions: 0 };
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method === "GET" && request.url === "/apply") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`<!doctype html>
          <form data-form-version="fixture-form-v1">
            <input data-question-id="fictional-answer" />
            <input type="file" data-document-id="doc:fictional" />
            <button type="button" data-action="upload">Upload fictional document</button>
            <output data-upload-ack hidden></output>
          </form>
          <script>
            document.querySelector('[data-action=upload]').addEventListener('click', async () => {
              const file = document.querySelector('[data-document-id="doc:fictional"]').files[0];
              const response = await fetch('/__fixture_upload', { method: 'POST', body: await file.arrayBuffer() });
              const payload = await response.json();
              const output = document.querySelector('[data-upload-ack]');
              output.hidden = false;
              output.dataset.uploadAck = payload.acknowledgementId;
              output.dataset.receivedDigest = payload.receivedDigest;
            });
          </script>`);
        return;
      }
      if (request.method === "POST" && request.url === "/__fixture_upload") {
        counts.uploads += 1;
        const receivedDigest = sha256(Buffer.concat(chunks));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ acknowledgementId: `ack-${counts.uploads}`, receivedDigest }),
        );
        return;
      }
      if (request.method === "POST" && request.url === "/submit") {
        counts.submissions += 1;
        response.writeHead(200);
        response.end("forbidden");
        return;
      }
      response.writeHead(404);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FIXTURE_SERVER_ADDRESS_REQUIRED");
  return { server, targetUrl: `http://127.0.0.1:${address.port}/apply`, counts };
}

function capability(targetUrl: string): RunnerTargetCapability {
  const target = new URL(targetUrl);
  return RunnerTargetCapabilitySchema.parse({
    schemaVersion: 2,
    capabilityId: "runner:offline-source-preview",
    version: 1,
    predecessorVersion: null,
    targetKind: "SYNTHETIC_LOCAL",
    alias: "Fictional local target",
    allowedOrigin: target.origin,
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
}

test("proves fictional source-ledger-R2 packet to browser preview without submit", async ({
  browser,
}) => {
  const { server, targetUrl, counts } = await fixtureServer();
  const documentBytes = Buffer.from("fictional approved CV bytes");
  const documentDigest = sha256(documentBytes);
  const target = capability(targetUrl);
  const packet = ApplicationPacketSchema.parse({
    id: "packet:offline-source-preview",
    jobId: "job:fictional-source",
    jobVersionId: "job-version:fictional-source:1",
    profileVersionId: "profile-version:fictional:1",
    evaluationVersionId: "evaluation:fictional:r2:1",
    r2EvaluationId: "r2:fictional:1",
    eligibilityStatus: "ELIGIBLE",
    targetUrl,
    targetHost: new URL(targetUrl).hostname,
    jobExpiryState: "ACTIVE",
    duplicateState: "CLEAR",
    versionsCurrent: true,
    documents: [
      {
        id: "doc:fictional",
        type: "CV",
        fileName: "fictional.pdf",
        digest: documentDigest,
        approved: true,
        stale: false,
        required: true,
      },
    ],
    answers: [
      {
        questionId: "fictional-answer",
        questionText: "Fictional verified answer",
        required: true,
        sensitive: false,
        value: "fictional-value",
        truthState: "VERIFIED_ANSWER",
        disclosureState: "APPROVED",
        factReferences: ["fact:fictional"],
      },
    ],
  });

  // The preceding source/ledger/R2 stages are intentionally value-free fixture
  // evidence. The packet binds those current versions before the browser lane.
  const sourceLedgerEvidence = {
    source: "LEVER",
    externalId: "fictional-source-job-1",
    qualificationState: "QUALIFIED",
    r2EvaluationId: packet.r2EvaluationId,
  };
  expect(sourceLedgerEvidence.qualificationState).toBe("QUALIFIED");
  expect(packet.r2EvaluationId).toBe("r2:fictional:1");

  const binding = freezeRunnerBinding(packet, target);
  const store = new InMemoryNonSubmitDurableStore();
  const adapter = new LoopbackNonSubmitAdapter({
    browser,
    documentBytes: { [documentDigest]: documentBytes },
    operationKey: "offline-source-preview",
  });
  try {
    const runner = new TargetIndependentNonSubmitRunner(
      packet,
      target,
      binding,
      adapter,
      () => binding,
      () => fixedNow,
      store,
    );
    expect((await runner.map()).state).toBe("MAPPED");
    expect((await runner.fill()).state).toBe("FILLED");
    const uploaded = await runner.upload();
    expect(uploaded.uploadEvidence?.receivedDigest).toBe(documentDigest);
    expect((await runner.verify()).fieldReadBack).toEqual([
      { questionId: "fictional-answer", value: "fictional-value" },
    ]);
    const preview = await runner.fillPreview();
    expect(preview.state).toBe("FILL_PREVIEW");
    expect(preview.previewDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(counts).toEqual({ uploads: 1, submissions: 0 });

    const restarted = new TargetIndependentNonSubmitRunner(
      packet,
      target,
      binding,
      adapter,
      () => binding,
      () => fixedNow,
      store,
    );
    expect(restarted.snapshot()).toMatchObject({ state: "FILL_PREVIEW", submitEnabled: false });
    expect((restarted as unknown as { submit?: unknown }).submit).toBeUndefined();
    expect(counts).toEqual({ uploads: 1, submissions: 0 });
  } finally {
    await adapter.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
