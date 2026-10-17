import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
const mocks = vi.hoisted(() => ({ database: vi.fn(), data: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./local-database", () => ({ getLocalDatabase: mocks.database }));
vi.mock("./local-data-directory", () => ({ resolveLocalDataDirectory: mocks.data }));
import { createHostedFixture, FICTIONAL_INSTANT } from "../../../tests/helpers/hosted-fixture";
import { captureBoundGreenhouseQuestions } from "./source-question-capture";
const fixtures: Awaited<ReturnType<typeof createHostedFixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
  vi.useRealTimers();
  vi.clearAllMocks();
});
async function fixture(provider: "GREENHOUSE" | "LEVER" = "GREENHOUSE") {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FICTIONAL_INSTANT);
  const f = await createHostedFixture(provider);
  fixtures.push(f);
  await writeFile(join(f.root, "profile.private.json"), JSON.stringify(f.profile));
  mocks.database.mockReturnValue({ sqlite: f.sqlite });
  mocks.data.mockReturnValue(f.root);
  return f;
}
describe("retained owner-bound Greenhouse question capture", () => {
  it("captures the exact qualified detail response durably with no new request or receipt", async () => {
    const f = await fixture();
    const requests = f.requests.length;
    const receipts = f.sqlite
      .prepare("SELECT count(*) FROM source_owner_action_receipts")
      .pluck()
      .get();
    expect(captureBoundGreenhouseQuestions(f.detailSourceCapability, f.subject.sourceRunId)).toBe(
      "CAPTURED",
    );
    expect(captureBoundGreenhouseQuestions(f.detailSourceCapability, f.subject.sourceRunId)).toBe(
      "CAPTURED",
    );
    expect(f.requests.length).toBe(requests);
    expect(
      f.sqlite.prepare("SELECT count(*) FROM source_owner_action_receipts").pluck().get(),
    ).toBe(receipts);
    expect(
      f.sqlite
        .prepare(
          "SELECT count(*) FROM hosted_question_discoveries WHERE source_run_id=? AND json_extract(discovery_json,'$.origin')='SOURCE_DETAIL'",
        )
        .pluck()
        .get(f.subject.sourceRunId),
    ).toBe(1);
  }, 30000);
  it.each(["version", "externalId", "run", "list"] as const)(
    "refuses mismatched %s binding without new authority",
    async (kind) => {
      const f = await fixture();
      const cap = structuredClone(f.detailSourceCapability);
      let run = f.subject.sourceRunId;
      if (kind === "version") {
        cap.version = 2;
        cap.predecessorVersion = 1;
      }
      if (kind === "externalId") cap.requestBinding!.externalId = "456";
      if (kind === "run") run = "unknown-run";
      if (kind === "list")
        run = String(
          f.sqlite
            .prepare("SELECT id FROM source_run_checkpoints WHERE operation='LIST_JOBS'")
            .pluck()
            .get(),
        );
      const requests = f.requests.length;
      expect(captureBoundGreenhouseQuestions(cap, run)).toBe("QUESTION_CAPTURE_BLOCKED");
      expect(f.requests.length).toBe(requests);
    },
    30000,
  );
  it("does not capture Lever or an unapproved questions flag", async () => {
    const f = await fixture("LEVER");
    expect(captureBoundGreenhouseQuestions(f.detailSourceCapability, f.subject.sourceRunId)).toBe(
      "NOT_REQUESTED",
    );
  }, 30000);
  it("reports absent migration or damaged retained payload without retrying the run", async () => {
    const f = await fixture();
    const requests = f.requests.length;
    f.sqlite.prepare("UPDATE source_observation_payloads SET payload_json='{}'").run();
    expect(captureBoundGreenhouseQuestions(f.detailSourceCapability, f.subject.sourceRunId)).toBe(
      "QUESTION_CAPTURE_BLOCKED",
    );
    mocks.database.mockReturnValue(null);
    expect(captureBoundGreenhouseQuestions(f.detailSourceCapability, f.subject.sourceRunId)).toBe(
      "QUESTION_CAPTURE_BLOCKED",
    );
    expect(f.requests.length).toBe(requests);
    expect(
      f.sqlite
        .prepare("SELECT count(*) FROM source_run_checkpoints WHERE status='COMPLETE'")
        .pluck()
        .get(),
    ).toBe(2);
  }, 30000);
});
