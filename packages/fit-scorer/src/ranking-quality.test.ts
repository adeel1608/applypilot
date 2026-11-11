import { describe, expect, it } from "vitest";
import { CandidateProfileSchema } from "@applypilot/candidate-profile";
import { evaluateR2Eligibility } from "@applypilot/eligibility-engine";
import {
  currentR2Bindings,
  r2RequirementEvidence,
  r2TestNormalization,
} from "../../../fixtures/r2/test-helpers";
import { testProfile } from "../../../tests/fixture-data";
import { R2_UNREVIEWED_CALIBRATION_CONTEXT, scoreR2JobFit } from "./r2";

function profile(skill: string | null, responsibility?: string) {
  return CandidateProfileSchema.parse({
    ...testProfile,
    skills: skill ? [{ id: "fictional-skill", name: skill, verification: "VERIFIED" }] : [],
    employment: responsibility
      ? [
          {
            ...testProfile.employment[0]!,
            id: "fictional-role",
            title: "Fictional operator",
            responsibilities: [responsibility],
            verification: "VERIFIED",
          },
        ]
      : [],
    education: [],
    licences: [],
    certifications: [],
  });
}
function run(
  p: ReturnType<typeof profile>,
  requirements: ReturnType<typeof r2RequirementEvidence>[],
  stale = false,
) {
  const normalization = r2TestNormalization({ requirements });
  const eligibility = evaluateR2Eligibility({
    profile: p,
    normalization,
    bindings: { ...currentR2Bindings, ...(stale ? { currentJobVersionId: "changed" } : {}) },
    evaluatedAt: "2026-09-09T00:00:00.000Z",
  });
  return {
    eligibility,
    fit: scoreR2JobFit({
      profile: p,
      normalization,
      eligibility,
      calibrationContext: R2_UNREVIEWED_CALIBRATION_CONTEXT,
    }),
  };
}
const skill = (id: string, text: string) =>
  r2RequirementEvidence(id, "SKILLS", "SKILL", { kind: "TEXT", value: text });

describe("fictional ranking scope generalization", () => {
  it("orders separate fictional positive, composite, repeated and adversarial pairs without private judgments", () => {
    const p = CandidateProfileSchema.parse({
      ...profile(null),
      unsupportedExperience: ["Aircraft certification"],
      forbiddenClaims: [],
      skills: ["Python", "Rust", "Communication"].map((name, i) => ({
        id: `fictional-${i}`,
        name,
        verification: "VERIFIED",
      })),
    });
    const specific = [skill("python", "Python"), skill("rust", "Rust")];
    const generic = Array.from({ length: 8 }, (_, i) => skill(`generic-${i}`, "Communication"));
    const composite = [skill("composite", "Python and Aircraft certification")];
    const qualified = [skill("qualified", "Python only under supervision")];
    expect(run(p, specific).fit.score).toBeGreaterThan(run(p, generic).fit.score);
    expect(run(p, specific.slice().reverse()).fit).toEqual(run(p, specific).fit);
    expect(run(p, [skill("positive", "Must have Python skills")]).fit.score).toBeGreaterThan(
      run(p, composite).fit.score,
    );
    expect(run(p, [skill("positive", "Python skills are required.")]).fit.score).toBeGreaterThan(
      run(p, qualified).fit.score,
    );
    expect(run(p, composite).fit.recommended).toBe(false);
  });
  it("distinguishes an unsupported advanced claim from an exact negative", () => {
    const p = profile("Python");
    p.unsupportedExperience = ["Advanced Python"];
    p.forbiddenClaims = [];
    expect(run(p, [skill("basic", "Python")]).fit.score).toBe(7);
    expect(run(p, [skill("advanced", "Advanced Python")]).fit.score).toBe(0);
    p.unsupportedExperience = ["Python"];
    expect(run(p, [skill("direct-negative", "Python")]).fit.score).toBe(0);
  });
  it("does not infer the Python capability from a different verified skill label containing the word", () => {
    expect(run(profile("Python recruitment"), [skill("scope", "Python")]).fit.score).toBe(0);
  });
  it.each([
    "Python and aircraft certification",
    "Proficient English and written communication",
    "Python only if authorised",
    "Python under supervision",
  ])("rejects a partial fact for composite/qualified requirement %s", (text) => {
    const result = run(profile(text.includes("communication") ? "communication" : "Python"), [
      skill("scope", text),
    ]);
    expect(result.fit.score).toBe(0);
    expect(result.eligibility.reasons).toContainEqual(
      expect.objectContaining({ code: "R2_MANDATORY_CAPABILITY_UNCONFIRMED" }),
    );
  });
  it.each([
    "Did not use Python",
    "Could use Python if authorised",
    "Python only under supervision",
    "Learning Python",
    "Limited Python exposure",
    "Python or Rust",
    "C/C++",
    "Lack Python proficiency",
    "Unfamiliar with Python",
    "Used Python partially",
    "Python except deployment",
    "Assisted with Python under guidance",
    "Python-free systems",
    "Python-less systems",
    "Didn't use Python",
    "Can’t use Python",
    "Python pending authorisation",
    "Python contingent on training",
  ])("rejects qualified employment fact %s", (fact) => {
    expect(run(profile(null, fact), [skill("scope", "Python")]).fit.score).toBe(0);
  });
  it.each([
    "Lack Python proficiency",
    "Python or Rust",
    "Python except deployment",
    "Python-free systems",
    "Don't use Python",
  ])("rejects qualified required scope %s", (text) => {
    expect(run(profile("Python"), [skill("scope", text)]).fit.score).toBe(0);
  });
  it.each(["Python", "robotics", "control"])(
    "does not infer programming scope from the shorter fact %s",
    (name) => {
      expect(run(profile(name), [skill("scope", `${name} programming`)]).fit.score).toBe(0);
    },
  );
  it("recognizes identical bounded skills in verified affirmative employment sentences", () => {
    const result = run(profile(null, "Built fictional tools using Python"), [
      skill("scope", "Experience with Python"),
    ]);
    expect(result.fit.score).toBe(7);
    expect(result.fit.contributions[0]?.candidateFactReferences).toEqual([
      "employment.fictional-role.responsibilities.0",
    ]);
  });
  it.each([
    "Recruited Python developers",
    "Hired Python developers",
    "Managed a Python team",
    "Trained others in Python",
    "Collaborated with Python developers",
    "Used Python recruiters",
    "Built pipelines using Python Developers",
    "Non-Python programming",
  ])("does not infer direct capability from unrelated employment wording %s", (responsibility) => {
    expect(run(profile(null, responsibility), [skill("scope", "Python")]).fit.score).toBe(0);
  });
  it("does not infer skill from an embedded role title and permits exact unquantified experience titles", () => {
    const p = profile(null, "Unrelated duties");
    p.employment[0]!.title = "Python Recruitment Consultant";
    expect(run(p, [skill("scope", "Python")]).fit.score).toBe(0);
    const experience = r2RequirementEvidence("exact-role", "EXPERIENCE", "EXPERIENCE", {
      kind: "EXPERIENCE",
      value: {
        domain: "Python Recruitment Consultant",
        minimum: null,
        maximum: null,
        unit: "UNKNOWN",
        recency: null,
        alternatives: [],
        condition: null,
      },
    });
    expect(run(p, [experience]).fit.score).toBe(7);
  });
  it("never treats skill identity as proof of quantified or recent experience", () => {
    for (const change of [
      { minimum: 5, unit: "YEAR" as const },
      { recency: "within the last year" },
      { alternatives: ["EQUIVALENT"] },
    ]) {
      const requirement = r2RequirementEvidence("years", "EXPERIENCE", "EXPERIENCE", {
        kind: "EXPERIENCE",
        value: {
          domain: "Python",
          minimum: null,
          maximum: null,
          unit: "UNKNOWN",
          recency: null,
          alternatives: [],
          condition: null,
          ...change,
        },
      });
      const result = run(profile("Python"), [requirement]);
      expect(result.fit.score).toBe(0);
      expect(result.eligibility.reasons).toContainEqual(
        expect.objectContaining({ code: "R2_MANDATORY_CAPABILITY_UNCONFIRMED" }),
      );
    }
  });
  it("requires credential level and field on the same verified completed education record", () => {
    const p = CandidateProfileSchema.parse({
      ...profile(null),
      education: [
        {
          ...testProfile.education[0]!,
          id: "fictional-degree",
          qualification: "Bachelor",
          field: "Engineering",
          status: "COMPLETED",
          verification: "VERIFIED",
        },
      ],
    });
    const req = r2RequirementEvidence("degree", "EDUCATION", "QUALIFICATION", {
      kind: "EDUCATION",
      value: {
        level: "Doctorate",
        field: "Engineering",
        equivalence: null,
        completionRequired: true,
        currentStudyAllowed: null,
        condition: null,
      },
    });
    expect(run(p, [req]).fit.score).toBe(0);
    const matching = r2RequirementEvidence("degree-match", "EDUCATION", "QUALIFICATION", {
      kind: "EDUCATION",
      value: {
        level: "Bachelor",
        field: "Engineering",
        equivalence: null,
        completionRequired: true,
        currentStudyAllowed: null,
        condition: null,
      },
    });
    expect(run(p, [matching]).fit.score).toBe(7);
    p.education[0]!.status = "IN_PROGRESS";
    expect(run(p, [matching]).fit.score).toBe(0);
    const study = r2RequirementEvidence("study", "EDUCATION", "QUALIFICATION", {
      kind: "EDUCATION",
      value: {
        level: "Bachelor",
        field: "Engineering",
        equivalence: null,
        completionRequired: false,
        currentStudyAllowed: true,
        condition: null,
      },
    });
    expect(run(p, [study]).fit.score).toBe(7);
    p.education[0]!.status = "COMPLETED";
    p.education[0]!.field = "History";
    p.education.push({
      ...p.education[0]!,
      id: "fictional-other-degree",
      qualification: "Certificate",
      field: "Engineering",
    });
    expect(run(p, [matching]).fit.score).toBe(0);
    p.education = [
      { ...p.education[0]!, qualification: "Incomplete Bachelor", field: "Engineering" },
    ];
    expect(run(p, [matching]).fit.score).toBe(0);
  });
  it("deduplicates repeated facts at strongest modality and retains every source reference in either order", () => {
    const first = skill("a", "Python"),
      second = { ...skill("b", "Experience with Python"), modality: "PREFERRED" as const };
    const a = run(profile("Python"), [first, second]);
    const b = run(profile("Python"), [second, first]);
    expect(a.fit.score).toBe(7);
    expect(b.fit).toEqual(a.fit);
    expect(a.fit.contributions[0]?.jobEvidenceReferences).toEqual(["a", "b"]);
    expect(run(profile("Python"), [first, second], true).fit.contributions).toEqual([]);
  });
  it("deduplicates repeated credential evidence and keeps distinct verified skill facts separate", () => {
    const p = CandidateProfileSchema.parse({
      ...profile("Python"),
      licences: [
        { id: "fictional-licence", name: "Example driving licence", verification: "VERIFIED" },
      ],
    });
    const licence = (id: string) =>
      r2RequirementEvidence(id, "LICENCES", "LICENCE", {
        kind: "LICENCE_CERTIFICATION",
        value: {
          type: "LICENCE",
          name: "Example driving licence",
          jurisdiction: null,
          class: null,
          alternatives: [],
          validityRequirement: null,
          condition: null,
        },
      });
    const a = licence("licence-a"),
      b = { ...licence("licence-b"), modality: "PREFERRED" as const };
    const forward = run(p, [a, b, skill("python", "Python")]).fit;
    expect(forward.score).toBe(14);
    expect(run(p, [b, a, skill("python", "Python")]).fit).toEqual(forward);
    expect(
      forward.contributions.find((c) => c.code === "R2_LICENCE_VERIFIED_MATCH")
        ?.jobEvidenceReferences,
    ).toEqual(["licence-a", "licence-b"]);
  });
  it("keeps unsupported, unverified, negated and conditional evidence out of positive contributions", () => {
    const p = profile("Python");
    p.skills[0]!.verification = "UNKNOWN";
    expect(run(p, [skill("unknown", "Python")]).fit.score).toBe(0);
    for (const modality of ["UNKNOWN", "CONDITIONAL", "NEGATED"] as const)
      expect(
        run(profile("Python"), [
          {
            ...skill("scope", "Python"),
            modality,
            condition: modality === "CONDITIONAL" ? "if authorised" : null,
          },
        ]).fit.score,
      ).toBe(0);
    const negative = profile(null);
    negative.unsupportedExperience = ["Python"];
    expect(run(negative, [skill("negative", "Python")]).fit.recommended).toBe(false);
    negative.skills = profile("Python").skills;
    expect(run(negative, [skill("contradicted", "Python")]).fit.score).toBe(0);
  });
});
