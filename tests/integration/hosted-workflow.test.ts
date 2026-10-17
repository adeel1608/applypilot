import { afterEach, describe, expect, it } from "vitest";
import { writeFile, readFile, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
  hostedOwnerAction,
  hostedDigest,
  HostedApplicationService,
  PlaywrightHostedApplicationDriver,
} from "@applypilot/application-runner";
import {
  createHostedFixture,
  fictionalHostedProof,
  FICTIONAL_BUILD,
  HOSTED_PRIVACY_CANARY,
} from "../helpers/hosted-fixture";
const fixtures: Awaited<ReturnType<typeof createHostedFixture>>[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});
async function fixture(
  provider: "GREENHOUSE" | "LEVER",
  options: Parameters<typeof createHostedFixture>[1] = {},
) {
  const value = await createHostedFixture(provider, options);
  fixtures.push(value);
  return value;
}
describe("FICTIONAL production hosted workflow acceptance", () => {
  it.each(["GREENHOUSE", "LEVER"] as const)(
    "runs %s actual HTTP readers, repositories, R2, packet, browser service and one confirmed fictional submission",
    async (provider) => {
      const f = await fixture(provider, { requireCookie: true });
      const inspected = await f.service.inspect(
        f.passiveCap,
        fictionalHostedProof(hostedOwnerAction("INSPECT", f.passiveCap)),
      );
      expect(inspected.state).toBe("INSPECTED");
      expect(inspected.discovery?.complete).toBe(true);
      expect(f.stats().confirmedPosts).toBe(0);
      const prepared = await f.preparePacket(inspected.id);
      expect(prepared.evaluation.recommended).toBe(1);
      expect(prepared.result.status).toBe("READY_TO_APPLY");
      const review = await f.service.prepare(
        inspected.id,
        prepared.applicationCap,
        fictionalHostedProof(hostedOwnerAction("DISCLOSE", prepared.applicationCap, inspected.id)),
      );
      expect(review.state).toBe("REVIEW_READY");
      expect(review.proofs).toMatchObject([{ proof: "LOCAL_ATTACHED", acknowledgementId: null }]);
      expect(f.stats().confirmedPosts).toBe(0);
      expect(review.preview?.materialDiffCount).toBe(0);
      const proof = fictionalHostedProof(
        hostedOwnerAction(
          "SUBMIT",
          prepared.applicationCap,
          review.id,
          hostedDigest(review.preview),
        ),
      );
      const submitted = await f.service.submit(review.id, proof);
      expect({ state: submitted.state, safeStopCode: submitted.safeStopCode }).toEqual({
        state: "CONFIRMED_SUBMITTED",
        safeStopCode: null,
      });
      expect(f.stats().confirmedPosts).toBe(1);
      expect(submitted.confirmationDigest).toMatch(/^[a-f0-9]{64}$/);
      await expect(f.service.submit(review.id, proof)).rejects.toThrow("HOSTED_CONTEXT_LOST");
      expect(f.stats().confirmedPosts).toBe(1);
      expect(
        f.sqlite
          .prepare("SELECT count(*) AS count FROM hosted_submit_guards WHERE mode='REAL'")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        f.sqlite
          .prepare("SELECT count(*) AS count FROM hosted_operation_claims WHERE state='CLAIMED'")
          .get(),
      ).toEqual({ count: 0 });
      expect(f.sqlite.pragma("foreign_key_check")).toEqual([]);
      const audit = JSON.stringify(
        f.sqlite
          .prepare(
            "SELECT redacted_metadata_json FROM audit_events WHERE entity_type='HOSTED_APPLICATION'",
          )
          .all(),
      );
      expect(audit).not.toContain(HOSTED_PRIVACY_CANARY);
      expect(audit).not.toContain("fictional-token");
      expect(audit).not.toContain("fictional-cookie-canary");
    },
    60_000,
  );
  it("blocks required remote proof instead of equating local attachment with a remote acknowledgement", async () => {
    const f = await fixture("LEVER", { remoteUpload: true });
    const session = await f.service.inspect(
      f.passiveCap,
      fictionalHostedProof(hostedOwnerAction("INSPECT", f.passiveCap)),
    );
    const { applicationCap } = await f.preparePacket(session.id);
    await expect(
      f.service.prepare(
        session.id,
        applicationCap,
        fictionalHostedProof(hostedOwnerAction("DISCLOSE", applicationCap, session.id)),
      ),
    ).rejects.toThrow("HOSTED_UPLOAD_ACK_INVALID");
    expect(f.stats()).toEqual({ acknowledgedUploads: 0, confirmedPosts: 0 });
  }, 60_000);
  it("preserves a lost submit response as OUTCOME_UNKNOWN and never resends after restart", async () => {
    const f = await fixture("GREENHOUSE", { lostResponse: true });
    const session = await f.service.inspect(
      f.passiveCap,
      fictionalHostedProof(hostedOwnerAction("INSPECT", f.passiveCap)),
    );
    const { applicationCap } = await f.preparePacket(session.id);
    const review = await f.service.prepare(
      session.id,
      applicationCap,
      fictionalHostedProof(hostedOwnerAction("DISCLOSE", applicationCap, session.id)),
    );
    const result = await f.service.submit(
      review.id,
      fictionalHostedProof(
        hostedOwnerAction("SUBMIT", applicationCap, review.id, hostedDigest(review.preview)),
      ),
    );
    expect(result.state).toBe("OUTCOME_UNKNOWN");
    expect(f.stats().confirmedPosts).toBe(1);
    const restarted = new HostedApplicationService({
      store: f.store,
      reviewedBuild: FICTIONAL_BUILD,
      driverFactory: () => {
        throw new Error("FICTIONAL_NO_REPLAY");
      },
    });
    expect(restarted.recover()).toEqual({ stopped: 0, outcomeUnknown: 0 });
    await expect(restarted.submit(result.id, fictionalHostedProof("ignored"))).rejects.toThrow(
      "HOSTED_CONTEXT_LOST",
    );
    expect(f.stats().confirmedPosts).toBe(1);
  }, 60_000);
  it.each([
    [{ extraControls: '<div data-sitekey="fictional">Captcha</div>' }, "HOSTED_BOT_PROTECTION"],
    [
      { extraControls: '<input type="hidden" name="tracking" value="private-canary">' },
      "HOSTED_UNSUPPORTED_CONTROL",
    ],
    [{ extraControls: '<div role="combobox">Custom widget</div>' }, "HOSTED_BOT_PROTECTION"],
    [{ initialStatus: 401 }, "HOSTED_AUTHENTICATION_REQUIRED"],
    [{ initialStatus: 403 }, "HOSTED_ACCESS_CONTROL"],
    [{ initialStatus: 429 }, "HOSTED_RATE_LIMIT"],
    [
      { initialStatus: 302, extraHeaders: { location: "https://example.test/escape" } },
      "HOSTED_REDIRECT_FORBIDDEN",
    ],
    [
      { formAction: "https://jobs.lever.co/fake/submit?secret=canary" },
      "HOSTED_DESTINATION_CHANGED",
    ],
  ] as const)(
    "contains unsupported or protected native target %#",
    async (options, code) => {
      const f = await fixture("LEVER", options);
      await expect(
        f.service.inspect(
          f.passiveCap,
          fictionalHostedProof(hostedOwnerAction("INSPECT", f.passiveCap)),
        ),
      ).rejects.toThrow(code);
      expect(f.stats().confirmedPosts).toBe(0);
      expect(f.store.listSessions()[0]?.state).toBe("STOPPED");
      expect(f.store.listSessions()[0]?.safeStopCode).toBe(code);
      expect(
        f.sqlite
          .prepare("SELECT count(*) AS count FROM hosted_operation_claims WHERE state='CLAIMED'")
          .get(),
      ).toEqual({ count: 0 });
    },
    30000,
  );
  it("consumes a zero-choice review nonce once and rejects factual consent substitution", async () => {
    const f = await fixture("LEVER");
    const session = await f.service.inspect(
      f.passiveCap,
      fictionalHostedProof(hostedOwnerAction("INSPECT", f.passiveCap)),
    );
    const proof = fictionalHostedProof(
      `HOSTED_QUESTION_REVIEW:${hostedDigest(session.capability.subject)}:${hostedDigest(session.discovery)}`,
    );
    expect(
      f.store.recordQuestionChoices(session.capability.subject, session.discovery!, [], proof).size,
    ).toBe(0);
    expect(() =>
      f.store.recordQuestionChoices(session.capability.subject, session.discovery!, [], proof),
    ).toThrow("HOSTED_OWNER_NONCE_REPLAY");
    const invalid = fictionalHostedProof(proof.action);
    expect(() =>
      f.store.recordQuestionChoices(
        session.capability.subject,
        session.discovery!,
        [
          {
            questionId: session.discovery!.questions.find((q) => q.controlName === "first_name")!
              .id,
            value: true,
          },
        ],
        invalid,
      ),
    ).toThrow("HOSTED_OWNER_CHOICE_INVALID");
    expect(
      f.sqlite.prepare("SELECT count(*) AS count FROM hosted_question_review_receipts").get(),
    ).toEqual({ count: 1 });
  }, 30000);
  it("claims preparation and final action once during concurrent owner actions", async () => {
    const f = await fixture("LEVER");
    const s = await f.service.inspect(
      f.passiveCap,
      fictionalHostedProof(hostedOwnerAction("INSPECT", f.passiveCap)),
    );
    const p = await f.preparePacket(s.id);
    const first = f.service.prepare(
      s.id,
      p.applicationCap,
      fictionalHostedProof(hostedOwnerAction("DISCLOSE", p.applicationCap, s.id)),
    );
    await expect(
      f.service.prepare(
        s.id,
        p.applicationCap,
        fictionalHostedProof(hostedOwnerAction("DISCLOSE", p.applicationCap, s.id)),
      ),
    ).rejects.toThrow("HOSTED_OPERATION_IN_PROGRESS");
    const review = await first;
    const proof = fictionalHostedProof(
      hostedOwnerAction("SUBMIT", p.applicationCap, review.id, hostedDigest(review.preview)),
    );
    const submit = f.service.submit(review.id, proof);
    await expect(f.service.submit(review.id, proof)).rejects.toThrow(
      "HOSTED_OPERATION_IN_PROGRESS",
    );
    expect((await submit).state).toBe("CONFIRMED_SUBMITTED");
    expect(f.stats().confirmedPosts).toBe(1);
  }, 60000);
  it.each(["profile", "document", "preview"] as const)(
    "blocks changed %s before submit activation",
    async (kind) => {
      const f = await fixture("LEVER");
      const s = await f.service.inspect(
        f.passiveCap,
        fictionalHostedProof(hostedOwnerAction("INSPECT", f.passiveCap)),
      );
      const p = await f.preparePacket(s.id);
      const review = await f.service.prepare(
        s.id,
        p.applicationCap,
        fictionalHostedProof(hostedOwnerAction("DISCLOSE", p.applicationCap, s.id)),
      );
      if (kind === "profile")
        f.sqlite
          .prepare("UPDATE candidate_profile_versions SET content_hash=?")
          .run("d".repeat(64));
      if (kind === "document") f.sqlite.prepare("UPDATE document_artifacts SET stale=1").run();
      if (kind === "preview")
        f.sqlite
          .prepare(
            "UPDATE hosted_browser_sessions SET preview_json=json_set(preview_json,'$.preparedAt','2026-10-09T04:00:00.000Z') WHERE id=?",
          )
          .run(review.id);
      await expect(
        f.service.submit(
          review.id,
          fictionalHostedProof(
            hostedOwnerAction("SUBMIT", p.applicationCap, review.id, hostedDigest(review.preview)),
          ),
        ),
      ).rejects.toThrow();
      expect(f.stats().confirmedPosts).toBe(0);
      expect(f.sqlite.prepare("SELECT count(*) AS count FROM hosted_submit_guards").get()).toEqual({
        count: 0,
      });
    },
    60000,
  );
  it.each(["INSPECTED", "MAP_FOR_FILL", "FILL", "UPLOAD", "SUBMIT"] as const)(
    "recovers lost %s context without reopening or replay",
    async (stage) => {
      const f = await fixture("LEVER");
      const s = await f.service.inspect(
        f.passiveCap,
        fictionalHostedProof(hostedOwnerAction("INSPECT", f.passiveCap)),
      );
      if (stage !== "INSPECTED") {
        const p = await f.preparePacket(s.id);
        f.store.bindApplication(
          s.id,
          p.applicationCap,
          fictionalHostedProof(hostedOwnerAction("DISCLOSE", p.applicationCap, s.id)),
          f.service.runtimeId,
          FICTIONAL_BUILD,
        );
        const prior =
          stage === "MAP_FOR_FILL"
            ? "INSPECTED"
            : stage === "FILL"
              ? "MAPPED"
              : stage === "UPLOAD"
                ? "FILLED"
                : "REVIEW_READY";
        f.sqlite.prepare("UPDATE hosted_browser_sessions SET state=? WHERE id=?").run(prior, s.id);
        // Crash fixture represents a committed claim with no remote request; actual recovery is exercised.
        f.sqlite
          .prepare(
            "INSERT INTO hosted_operation_claims(id,session_id,operation,state,capability_digest,runtime_id,claimed_at) VALUES(?,?,?,'CLAIMED',?,?,?)",
          )
          .run(
            `crash-${stage}`,
            s.id,
            stage,
            hostedDigest(p.applicationCap),
            f.service.runtimeId,
            "2026-10-09T05:00:00.000Z",
          );
      }
      let opens = 0;
      const restarted = new HostedApplicationService({
        store: f.store,
        reviewedBuild: FICTIONAL_BUILD,
        driverFactory: () => {
          opens++;
          throw new Error("FICTIONAL_NO_REPLAY");
        },
      });
      const result = restarted.recover();
      expect(result).toEqual(
        ["FILL", "UPLOAD", "SUBMIT"].includes(stage)
          ? { stopped: 0, outcomeUnknown: 1 }
          : { stopped: 1, outcomeUnknown: 0 },
      );
      expect(opens).toBe(0);
      expect(f.stats().confirmedPosts).toBe(0);
      expect(restarted.recover()).toEqual({ stopped: 0, outcomeUnknown: 0 });
    },
    30000,
  );
  it.each(["digest", "corrupt", "junction"] as const)(
    "rejects %s artifact before attachment",
    async (kind) => {
      const f = await fixture("LEVER");
      const s = await f.service.inspect(
        f.passiveCap,
        fictionalHostedProof(hostedOwnerAction("INSPECT", f.passiveCap)),
      );
      const p = await f.preparePacket(s.id);
      if (kind === "digest")
        f.sqlite.prepare("UPDATE document_artifacts SET content_digest=?").run("e".repeat(64));
      if (kind === "corrupt")
        await writeFile(join(f.root, "fictional-cv.pdf"), "%PDF-invalid-canary");
      if (kind === "junction") {
        const actual = join(f.root, "actual");
        await mkdir(actual);
        await writeFile(
          join(actual, "fictional-cv.pdf"),
          await readFile(join(f.root, "fictional-cv.pdf")),
        );
        const linked = join(f.root, "linked");
        await symlink(actual, linked, process.platform === "win32" ? "junction" : "dir");
        f.sqlite
          .prepare("UPDATE document_artifacts SET local_path=?")
          .run(join(linked, "fictional-cv.pdf"));
      }
      await expect(
        f.service.prepare(
          s.id,
          p.applicationCap,
          fictionalHostedProof(hostedOwnerAction("DISCLOSE", p.applicationCap, s.id)),
        ),
      ).rejects.toThrow();
      expect(f.stats().confirmedPosts).toBe(0);
    },
    30000,
  );
  it.each(["pattern", "maxlength"] as const)(
    "blocks native %s rejection before final consent",
    async (kind) => {
      const f = await fixture("LEVER", {
        firstNameAttributes: kind === "pattern" ? 'pattern="OnlyThisName"' : 'maxlength="2"',
      });
      const s = await f.service.inspect(
        f.passiveCap,
        fictionalHostedProof(hostedOwnerAction("INSPECT", f.passiveCap)),
      );
      const p = await f.preparePacket(s.id);
      await expect(
        f.service.prepare(
          s.id,
          p.applicationCap,
          fictionalHostedProof(hostedOwnerAction("DISCLOSE", p.applicationCap, s.id)),
        ),
      ).rejects.toThrow(
        kind === "pattern" ? "HOSTED_NATIVE_VALIDATION_FAILED" : "HOSTED_OUTGOING_CONTENT_CHANGED",
      );
      expect(f.stats().confirmedPosts).toBe(0);
      expect(f.sqlite.prepare("SELECT count(*) FROM hosted_final_consents").pluck().get()).toBe(0);
      expect(f.sqlite.prepare("SELECT count(*) FROM hosted_submit_guards").pluck().get()).toBe(0);
    },
    60000,
  );
  it.each(["constraint", "destination", "control"] as const)(
    "blocks %s drift in the same owned context before submit activation",
    async (kind) => {
      const f = await fixture("LEVER");
      const s = await f.service.inspect(
        f.passiveCap,
        fictionalHostedProof(hostedOwnerAction("INSPECT", f.passiveCap)),
      );
      const p = await f.preparePacket(s.id);
      const review = await f.service.prepare(
        s.id,
        p.applicationCap,
        fictionalHostedProof(hostedOwnerAction("DISCLOSE", p.applicationCap, s.id)),
      );
      await f.mutateFictionalAttribute(
        kind === "destination" ? "form" : "#first",
        kind === "destination" ? "action" : kind === "control" ? "name" : "pattern",
        kind === "destination" ? "https://unapproved.test/escape" : "changed",
      );
      await expect(
        f.service.submit(
          review.id,
          fictionalHostedProof(
            hostedOwnerAction("SUBMIT", p.applicationCap, review.id, hostedDigest(review.preview)),
          ),
        ),
      ).rejects.toThrow(kind === "destination" ? "HOSTED_FORM_CHANGED" : "HOSTED_FORM_CHANGED");
      expect(f.stats().confirmedPosts).toBe(0);
      expect(f.sqlite.prepare("SELECT count(*) FROM hosted_submit_guards").pluck().get()).toBe(0);
    },
    60000,
  );
  it.each([
    { formAttributes: "novalidate" },
    { firstNameAttributes: "multiple" },
    { extraControls: '<input name="extra" type="text" form="outside">' },
  ])(
    "rejects unsupported boolean or external form overrides %#",
    async (options) => {
      const f = await fixture("LEVER", options);
      await expect(
        f.service.inspect(
          f.passiveCap,
          fictionalHostedProof(hostedOwnerAction("INSPECT", f.passiveCap)),
        ),
      ).rejects.toThrow("HOSTED_UNSUPPORTED_CONTROL");
      expect(f.stats().confirmedPosts).toBe(0);
    },
    30000,
  );
  it("rejects a fictional bridge in REAL mode before browser or transport dispatch", async () => {
    const f = await fixture("LEVER");
    const count = f.requests.length;
    const driver = new PlaywrightHostedApplicationDriver({
      transport: f.transport,
      fictionalTransport: true,
    });
    try {
      await expect(driver.inspect({ ...f.passiveCap, mode: "REAL" })).rejects.toThrow(
        "HOSTED_DESTINATION_FORBIDDEN",
      );
    } finally {
      await driver.close();
    }
    expect(f.requests.length).toBe(count);
  }, 30000);
});
