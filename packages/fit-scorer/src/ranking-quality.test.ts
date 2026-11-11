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
  it("preserves exact named-language programming evidence with unrelated negative claims", () => {
    for (const name of ["C++", "C#", ".NET", "Python"]) {
      const p = profile(name);
      p.forbiddenClaims = ["cash-handling experience", "expert Python developer"];
      expect(run(p, [skill("language", `${name} programming`)]).fit.score).toBe(7);
    }
    const p = profile("C++");
    p.skills[0]!.verification = "UNKNOWN";
    const a = run(p, [skill("unverified", "C++ programming")]);
    expect(a.eligibility.status).not.toBe("INELIGIBLE");
    expect(a.fit.contributions.filter((c) => c.points > 0)).toEqual([]);
  });
  it("preserves exact Basic scope and affirmative unassisted use without inventing higher scope", () => {
    expect(run(profile("Basic Python"), [skill("basic", "Basic Python")]).fit.score).toBe(7);
    expect(
      run(profile(null, "Used Python without supervision"), [skill("used", "Python")]).fit.score,
    ).toBe(7);
    expect(
      run(profile("Basic Python"), [skill("advanced", "Advanced Python")]).eligibility.reasons,
    ).toContainEqual(expect.objectContaining({ code: "R2_MANDATORY_CAPABILITY_UNCONFIRMED" }));
  });
  it("keeps literal overlap separate from a complete compound prerequisite and mixed-source support", () => {
    const p = profile("Python");
    p.unsupportedExperience = [];
    p.forbiddenClaims = [];
    const compound = skill("compound", "Python and aircraft certification");
    const preferred = { ...skill("whole", "Python"), modality: "PREFERRED" as const };
    const result = run(p, [compound, preferred]);
    expect(result.fit.score).toBe(7);
    expect(result.eligibility.reasons).toContainEqual(
      expect.objectContaining({
        code: "R2_MANDATORY_CAPABILITY_UNCONFIRMED",
        jobEvidenceReferences: ["compound"],
      }),
    );
    expect(result.fit.contributions[0]).toMatchObject({
      requirementSupport: [
        { jobEvidenceReference: "compound", scope: "PARTIAL_EVIDENCE" },
        { jobEvidenceReference: "whole", scope: "FULL_REQUIREMENT" },
      ],
    });
    expect(result.fit).toMatchObject({
      evidenceOpportunity: {
        usableRequirementCount: 2,
        fullySupportedRequirementIds: ["whole"],
        partialEvidenceRequirementIds: ["compound"],
        unmatchedUsableRequirementIds: [],
      },
    });
    expect(result.fit.recommended).toBe(false);
    expect(run(p, [preferred, compound]).fit).toEqual(result.fit);
  });
  it("preserves distinct knowledge behind colliding IDs and coalesces identical semantic facts", () => {
    const p = CandidateProfileSchema.parse({
      ...profile(null),
      forbiddenClaims: [],
      unsupportedExperience: [],
      skills: [
        { id: "collision", name: "C", verification: "VERIFIED" },
        { id: "collision", name: "C++", verification: "VERIFIED" },
        { id: "duplicate", name: "C++", verification: "VERIFIED" },
      ],
    });
    const result = run(p, [skill("c", "C"), skill("cpp", "C++ programming")]);
    expect(result.fit.score).toBe(14);
    expect(result.fit.contributions.flatMap((c) => c.candidateFactReferences).sort()).toEqual([
      "skills.collision.records.0",
      "skills.collision.records.1",
      "skills.duplicate",
    ]);
    expect(new Set(result.fit.contributions.flatMap((c) => c.jobEvidenceReferences))).toEqual(
      new Set(["c", "cpp"]),
    );
  });
  it("retains every reference for identical verified employment records without multiplying points", () => {
    const p = profile(null, "Used Python");
    p.employment.push({ ...p.employment[0]!, id: "fictional-role-copy" });
    const a = run(p, [skill("python", "Python")]);
    expect(a.fit.score).toBe(7);
    expect(a.fit.contributions[0]?.candidateFactReferences).toEqual([
      "employment.fictional-role-copy.responsibilities.0",
      "employment.fictional-role.responsibilities.0",
    ]);
  });
  it.each([
    ["C+", "C"],
    ["C+++", "C++"],
    ["C##", "C#"],
    [".NET+", ".NET"],
    ["C++17", "C++17.0 programming"],
    [".NET", "ASP.NET programming"],
  ])("preserves malformed or different technical identifiers %s / %s", (fact, required) => {
    expect(
      run(profile(fact), [skill("identifier", required)]).fit.contributions.filter(
        (c) => c.points > 0,
      ),
    ).toEqual([]);
  });
  it("excludes every explicit condition and unknown source state from support and opportunity", () => {
    const licence = r2RequirementEvidence(
      "licence",
      "LICENCES",
      "LICENCE",
      {
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
      },
      { condition: "if authorised" },
    );
    const p = CandidateProfileSchema.parse({
      ...profile("Python"),
      licences: [{ id: "held", name: "Example driving licence", verification: "VERIFIED" }],
    });
    const typed = r2RequirementEvidence("typed-condition", "EXPERIENCE", "EXPERIENCE", {
      kind: "EXPERIENCE",
      value: {
        domain: "Python",
        minimum: null,
        maximum: null,
        unit: "UNKNOWN",
        recency: null,
        alternatives: [],
        condition: "if assigned",
      },
    });
    const unknown = { ...skill("unknown-state", "Python"), state: "UNKNOWN" as const };
    for (const evidence of [licence, typed, unknown]) {
      const a = run(p, [evidence]);
      expect(a.fit.contributions.filter((c) => c.points > 0)).toEqual([]);
      expect(a.fit.evidenceOpportunity).toMatchObject({
        usableRequirementCount: 0,
        excludedRequirementIds: [evidence.id],
      });
      expect(a.eligibility.status).toBe("REVIEW_REQUIRED");
      if (evidence !== unknown)
        expect(a.eligibility.unresolvedMaterialConditions).toBeGreaterThan(0);
    }
  });
  it("retains affirmative optional language evidence while rejecting its conditional variant", () => {
    const preferred = {
      ...skill("optional", "Python programming is preferred but not essential."),
      modality: "PREFERRED" as const,
    };
    expect(run(profile("Python"), [preferred]).fit.score).toBe(4);
    expect(
      run(profile("Python"), [
        {
          ...preferred,
          normalizedValue: {
            kind: "TEXT",
            value: "Python programming is preferred but not essential if authorised.",
          },
        },
      ]).fit.score,
    ).toBe(0);
  });
  it("does not turn a generic credential name into a more specific held credential", () => {
    const p = CandidateProfileSchema.parse({
      ...profile(null),
      licences: [{ id: "generic", name: "Driving licence", verification: "VERIFIED" }],
    });
    const requirement = r2RequirementEvidence("specific-licence", "LICENCES", "LICENCE", {
      kind: "LICENCE_CERTIFICATION",
      value: {
        type: "LICENCE",
        name: "Class MR driving licence",
        class: null,
        jurisdiction: null,
        alternatives: [],
        validityRequirement: null,
        condition: null,
      },
    });
    const result = run(p, [requirement]);
    expect(result.fit.score).toBe(0);
    expect(result.eligibility.status).toBe("REVIEW_REQUIRED");
  });
  it("keeps typed licence class unresolved and rejects an exact forbidden credential claim", () => {
    const p = CandidateProfileSchema.parse({
      ...profile(null),
      forbiddenClaims: [],
      unsupportedExperience: [],
      licences: [{ id: "held", name: "Driving licence", verification: "VERIFIED" }],
    });
    const requirement = r2RequirementEvidence("typed-class", "LICENCES", "LICENCE", {
      kind: "LICENCE_CERTIFICATION",
      value: {
        type: "LICENCE",
        name: "Driving licence",
        class: "MR",
        jurisdiction: null,
        alternatives: [],
        validityRequirement: null,
        condition: null,
      },
    });
    expect(run(p, [requirement]).eligibility.status).toBe("REVIEW_REQUIRED");
    const exact = {
      ...requirement,
      id: "forbidden-credential",
      normalizedValue: {
        kind: "LICENCE_CERTIFICATION" as const,
        value: {
          type: "LICENCE" as const,
          name: "Driving licence",
          class: null,
          jurisdiction: null,
          alternatives: [],
          validityRequirement: null,
          condition: null,
        },
      },
    };
    p.forbiddenClaims = ["Driving licence"];
    const result = run(p, [exact]);
    expect(result.fit.contributions.filter((c) => c.points > 0)).toEqual([]);
    expect(result.eligibility.status).toBe("INELIGIBLE");
  });
  it.each([
    "Python-free systems",
    "No Python experience necessary",
    "Python if authorised",
    "Recruit Python developers",
    "Manage a team of Python experts",
    "Train others in Python",
  ])("does not count incidental or negative/conditional literal overlap: %s", (text) => {
    expect(
      run(profile("Python"), [skill("scope", text)]).fit.contributions.filter((c) => c.points > 0),
    ).toEqual([]);
  });
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
    expect(result.fit.score).toBe(/only|supervision/.test(text) ? 0 : 7);
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
    const result = run(profile("Python"), [skill("scope", text)]);
    expect(result.fit.score).toBe(text === "Python or Rust" ? 7 : 0);
    if (text === "Python or Rust")
      expect(result.fit.contributions[0]?.requirementSupport).toEqual([
        { jobEvidenceReference: "scope", scope: "PARTIAL_EVIDENCE" },
      ]);
  });
  it.each(["Python", "robotics", "control"])(
    "does not infer programming scope from the shorter fact %s",
    (name) => {
      const result = run(profile(name), [skill("scope", `${name} programming`)]);
      expect(result.fit.score).toBe(7);
      if (name !== "Python") {
        expect(result.fit.contributions[0]?.requirementSupport).toEqual([
          { jobEvidenceReference: "scope", scope: "PARTIAL_EVIDENCE" },
        ]);
        expect(result.eligibility.reasons).toContainEqual(
          expect.objectContaining({ code: "R2_MANDATORY_CAPABILITY_UNCONFIRMED" }),
        );
      }
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
      expect(result.fit.score).toBe(7);
      expect(result.fit.contributions[0]?.requirementSupport).toEqual([
        { jobEvidenceReference: "years", scope: "PARTIAL_EVIDENCE" },
      ]);
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
