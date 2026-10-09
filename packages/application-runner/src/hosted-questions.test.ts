import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { testProfile } from "../../../tests/fixture-data";
import { ApplicationPacketSchema, assessPacketReadiness, packetDigest } from "./beta";
import { HostedSubjectSchema, hostedDigest } from "./hosted-contract";
import {
  greenhouseQuestions,
  nonFactualConsentKind,
  reconcileHostedQuestions,
} from "./hosted-questions";
import {
  hostedVerifiedFacts,
  hostedAllowedFactPaths,
  reviewedHostedQuestions,
} from "./hosted-packet";
import { hostedSafeErrorCode, safeHostedError } from "./hosted-driver";
const subject = HostedSubjectSchema.parse({
  provider: "GREENHOUSE",
  tenant: "fictional",
  region: "GLOBAL",
  externalId: "123",
  jobId: "job:fictional",
  jobVersionId: "version:fictional",
  profileVersionId: "profile:fictional",
  verificationId: "verification:fictional",
  sourceRunId: "run:fictional",
  sourceContentHash: "a".repeat(64),
  targetUrl: "https://boards.greenhouse.io/fictional/jobs/123",
});
const payload = {
  questions: [
    { label: "First name", required: true, fields: [{ name: "first_name", type: "input_text" }] },
    {
      label: "Resume",
      required: true,
      fields: [
        { name: "resume", type: "input_file" },
        { name: "resume_text", type: "textarea" },
      ],
    },
  ],
};
describe("source and native question contract reconciliation", () => {
  it("preserves a source-required resume OR group and additional native questions", () => {
    const source = greenhouseQuestions(subject, payload);
    const native = structuredClone(source);
    native.origin = "PASSIVE_FORM";
    native.groups.forEach((group) => (group.required = false));
    native.questions.forEach((question) => {
      question.required = false;
      if (question.controlName === "resume_text") question.label = "Resume text";
    });
    const result = reconcileHostedQuestions(native, source);
    expect(result.complete).toBe(true);
    expect(result.groups.every((group) => group.required)).toBe(true);
    expect(result.groups[1]!.alternatives).toHaveLength(2);
    expect(native.groups.every((group) => !group.required)).toBe(true);
  });
  it.each(["missing", "label", "options", "incomplete"] as const)(
    "blocks known source %s rather than dropping it",
    (kind) => {
      const source = greenhouseQuestions(subject, payload);
      const native = structuredClone(source);
      native.origin = "PASSIVE_FORM";
      if (kind === "missing")
        native.questions = native.questions.filter((q) => q.controlName !== "first_name");
      if (kind === "label") native.questions[0]!.label = "Citizenship";
      if (kind === "options") native.questions[0]!.options = [{ value: "canary", label: "canary" }];
      if (kind === "incomplete") source.complete = false;
      expect(reconcileHostedQuestions(native, source)).toMatchObject({
        complete: false,
        safeBlockers: ["QUESTION_SCHEMA_CHANGED"],
      });
    },
  );
  it("uses native discovery when no separately retained source question contract exists", () => {
    const native = greenhouseQuestions(subject, payload);
    native.origin = "PASSIVE_FORM";
    expect(reconcileHostedQuestions(native, null)).toEqual(native);
  });
  it.each([
    "I consent to the privacy policy and certify I meet all job requirements",
    "I agree to the terms and conditions and hold a valid licence",
    "I agree to processing my personal data and have five years of experience",
  ])("does not reinterpret a mixed factual statement as owner consent", (label) => {
    expect(nonFactualConsentKind({ type: "checkbox", label })).toBeNull();
  });
});
function reviewed() {
  const discovery = greenhouseQuestions(subject, payload);
  return reviewedHostedQuestions({
    discovery,
    facts: hostedVerifiedFacts(testProfile),
    selections: discovery.groups.map((group) => ({ groupId: group.id, alternative: 0 })),
    answers: discovery.questions.map((q) => ({
      questionId: q.id,
      factPath: q.controlName === "first_name" ? "identity.firstName" : null,
    })),
  });
}
function packet() {
  return ApplicationPacketSchema.parse({
    id: "packet:fictional",
    jobId: subject.jobId,
    jobVersionId: subject.jobVersionId,
    profileVersionId: subject.profileVersionId,
    evaluationVersionId: "evaluation:fictional",
    eligibilityStatus: "ELIGIBLE",
    targetUrl: subject.targetUrl,
    targetHost: "boards.greenhouse.io",
    jobExpiryState: "ACTIVE",
    duplicateState: "CLEAR",
    versionsCurrent: true,
    documents: [
      {
        id: "cv:fictional",
        type: "CV",
        fileName: "Fictional.pdf",
        digest: "b".repeat(64),
        approved: true,
        stale: false,
        required: true,
      },
    ],
    ...reviewed(),
  });
}
describe("hosted question/fact boundaries", () => {
  it("preserves required resume file OR text without requiring an unknown unselected child", () => {
    const p = packet();
    expect(p.answers.find((a) => a.questionId === "gh:resume_text")?.truthState).toBe("UNKNOWN");
    expect(p.questionContract?.groups[1]?.alternatives).toHaveLength(2);
    expect(assessPacketReadiness(p).blockers).toEqual([]);
    expect(assessPacketReadiness({ ...p, documents: [] }).blockers.length).toBeGreaterThan(0);
    expect(
      assessPacketReadiness({
        ...p,
        questionContract: {
          ...p.questionContract!,
          groups: p.questionContract!.groups.map((g) =>
            g.id === "gh-group:1" ? { ...g, selectedAlternative: 1 } : g,
          ),
        },
      }).blockers.length,
    ).toBeGreaterThan(0);
  });
  it("changes version3 digest when selected alternatives or discovery change", () => {
    const p = packet();
    expect(
      packetDigest({
        ...p,
        questionContract: { ...p.questionContract!, discoveryDigest: "c".repeat(64) },
      }),
    ).not.toBe(packetDigest(p));
  });
  it("does not add a question contract or owner-choice default to legacy packets", () => {
    const legacy = JSON.parse(JSON.stringify(packet())) as Record<string, unknown>;
    delete legacy.questionContract;
    const p = ApplicationPacketSchema.parse(legacy);
    expect(Object.hasOwn(p, "questionContract")).toBe(false);
    expect(p.answers.every((a) => !Object.hasOwn(a, "ownerChoice"))).toBe(true);
    expect(packetDigest(p)).toBe(
      packetDigest(ApplicationPacketSchema.parse(JSON.parse(JSON.stringify(p)))),
    );
  });
  it.each([
    { questions: null },
    {
      questions: [
        { ...payload.questions[0], fields: [{ name: "first_name", type: "custom_widget" }] },
      ],
    },
    { questions: [payload.questions[0], payload.questions[0]] },
  ])("blocks malformed/incomplete provider question contracts", (value) => {
    expect(greenhouseQuestions(subject, value).complete).toBe(false);
  });
  it("requires verified primitive wrappers and keeps explicit full-name provenance", () => {
    const facts = hostedVerifiedFacts({
      ...testProfile,
      unverified: { value: "Do not promote", verification: "USER_CONFIRMATION_REQUIRED" },
      unknown: { value: null, verification: "UNKNOWN" },
    });
    expect(facts.map((f) => f.path)).not.toContain("unverified");
    expect(facts.find((f) => f.path === "identity.fullName")).toMatchObject({
      references: ["identity.firstName", "identity.lastName"],
      transform: "JOIN_NAME",
    });
    const missing = hostedVerifiedFacts({
      ...testProfile,
      identity: {
        ...testProfile.identity,
        lastName: { value: "Unknown", verification: "UNKNOWN" },
      },
    });
    expect(missing.map((f) => f.path)).not.toContain("identity.fullName");
  });
  it("refuses unrelated verified facts for a standard question", () => {
    const d = greenhouseQuestions(subject, payload);
    expect(() =>
      reviewedHostedQuestions({
        discovery: d,
        facts: hostedVerifiedFacts(testProfile),
        selections: d.groups.map((g) => ({ groupId: g.id, alternative: 0 })),
        answers: [{ questionId: "gh:first_name", factPath: "contact.email" }],
      }),
    ).toThrow("HOSTED_FACT_QUESTION_UNSUPPORTED");
    expect(
      hostedAllowedFactPaths({ label: "Are you a citizen?", controlName: "first_name" }),
    ).toEqual([]);
  });
  it.each([
    "I agree that I have work rights",
    "I consent to accurate employment facts",
    "I agree to the privacy policy and have clearance",
  ])("never treats factual attestation as a nonfactual consent", (label) => {
    expect(nonFactualConsentKind({ type: "checkbox", label })).toBeNull();
  });
  it("requires explicit mandatory owner consent and keeps false choice false", () => {
    const p = packet();
    const id = randomUUID();
    const answer = {
      questionId: "privacy",
      questionText: "I consent to the privacy policy",
      required: true,
      sensitive: true,
      value: false,
      truthState: "OWNER_CHOICE" as const,
      disclosureState: "APPROVED" as const,
      factReferences: [],
      ownerChoice: { receiptId: id, kind: "DATA_PROCESSING" as const },
    };
    const group = {
      id: "privacy",
      required: true,
      selectedAlternative: 0,
      alternatives: [{ kind: "ANSWER" as const, questionId: "privacy" }],
    };
    const declined = ApplicationPacketSchema.parse({
      ...p,
      answers: [...p.answers, answer],
      questionContract: { ...p.questionContract, groups: [...p.questionContract!.groups, group] },
    });
    expect(declined.answers.at(-1)?.value).toBe(false);
    expect(assessPacketReadiness(declined).blockers.length).toBeGreaterThan(0);
    expect(
      assessPacketReadiness({
        ...declined,
        answers: declined.answers.map((a) =>
          a.questionId === "privacy" ? { ...a, value: true } : a,
        ),
      }).blockers,
    ).toEqual([]);
  });
  it("emits only closed safe codes, never message or query canaries", () => {
    expect(safeHostedError(new Error("PRIVATE_FAKE_CANARY"))).toBe("HOSTED_OPERATION_STOPPED");
    expect(hostedSafeErrorCode("HOSTED_FORM_CHANGED\nPRIVATE_FAKE_CANARY")).toBeNull();
    expect(hostedSafeErrorCode("HOSTED_FORM_CHANGED")).toBe("HOSTED_FORM_CHANGED");
    expect(hostedDigest(subject)).toMatch(/^[a-f0-9]{64}$/);
  });
});
