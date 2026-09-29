import { describe, expect, it } from "vitest";

import {
  R2JobFieldEvidenceSchema,
  R2RequirementEvidenceSchema,
  R2ANormalizationSchema,
  SourceEvidencePointerSchema,
  assertR2ASourcePointers,
} from "@applypilot/job-model";
import { r2aGoldenFixtures } from "../../../fixtures/r2a/manifest";
import {
  assertR2AExcerptHashes,
  normalizeR2AJobEvidence,
  parseR2ASections,
} from "./r2a-normalization";

describe("R2A evidence normalization", () => {
  it("accepts only bounded source pointers and linked derived/conflicting evidence", () => {
    expect(() =>
      SourceEvidencePointerSchema.parse({
        sourcePath: "visibleText",
        start: 0,
        end: 6,
        sourceLength: 5,
        excerpt: "123456",
        excerptHash: "a".repeat(64),
      }),
    ).toThrow();
    expect(() =>
      R2JobFieldEvidenceSchema.parse({
        id: "derived",
        sourceObservationId: "observation",
        jobVersionId: null,
        family: "IDENTITY",
        canonicalField: "title",
        state: "DERIVED",
        modality: null,
        source: {
          sourcePath: "visibleText",
          start: 0,
          end: 4,
          sourceLength: 4,
          excerpt: "Role",
          excerptHash: "a".repeat(64),
        },
        normalizedValue: { kind: "TEXT", value: "Role" },
        extractorVersion: "3.1.0",
        ruleId: "fixture",
        derivationInputIds: [],
        ownerCorrectionId: null,
        conflictSetId: null,
      }),
    ).toThrow();
  });

  it("enforces requirement evidence invariants at the domain boundary", () => {
    const requirement = {
      id: "requirement",
      sourceObservationId: "observation",
      jobVersionId: null,
      family: "SKILLS" as const,
      canonicalKind: "GENERAL" as const,
      state: "SOURCE_STATED" as const,
      modality: "UNKNOWN" as const,
      condition: null,
      source: {
        sourcePath: "visibleText",
        start: 0,
        end: 7,
        sourceLength: 7,
        excerpt: "unknown",
        excerptHash: "b23a6a8439c0dde5515893e7c90c1e3233b8616e634470f20dc4928bcf3609bc",
      },
      normalizedValue: { kind: "TEXT" as const, value: "unknown" },
      extractorVersion: "3.1.0",
      ruleId: "fixture",
      derivationInputIds: [],
      ownerCorrectionId: null,
      conflictSetId: null,
    };
    expect(R2RequirementEvidenceSchema.parse(requirement)).toMatchObject({
      state: "SOURCE_STATED",
      modality: "UNKNOWN",
    });
    expect(R2RequirementEvidenceSchema.parse({ ...requirement, state: "UNKNOWN" })).toMatchObject({
      state: "UNKNOWN",
      modality: "UNKNOWN",
    });
    expect(() => R2RequirementEvidenceSchema.parse({ ...requirement, state: "DERIVED" })).toThrow();
    expect(() =>
      R2RequirementEvidenceSchema.parse({
        ...requirement,
        modality: "CONDITIONAL",
        condition: null,
      }),
    ).toThrow();
    expect(() =>
      R2RequirementEvidenceSchema.parse({ ...requirement, state: "OWNER_CORRECTED" }),
    ).toThrow();
    expect(() =>
      R2RequirementEvidenceSchema.parse({ ...requirement, state: "CONFLICTING" }),
    ).toThrow();
  });

  it("rejects cross-kind derivation and tampered excerpt hashes", () => {
    const structured = {
      jobLocation: {
        address: { addressLocality: "Geelong", addressRegion: "VIC", postalCode: "3220" },
      },
      requirements: "RSA required",
    };
    const source = JSON.stringify(structured);
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      structured,
      sourceObservationId: "observation:derivation-boundary",
    });
    const derivedIndex = result.fieldEvidence.findIndex(({ state }) => state === "DERIVED");
    expect(derivedIndex).toBeGreaterThanOrEqual(0);
    const invalid = structuredClone(result);
    invalid.fieldEvidence[derivedIndex]!.derivationInputIds = [invalid.requirementEvidence[0]!.id];
    expect(() => R2ANormalizationSchema.parse(invalid)).toThrow();

    const tampered = structuredClone(result);
    tampered.fieldEvidence[0]!.source.excerptHash = "a".repeat(64);
    expect(() => assertR2AExcerptHashes(tampered)).toThrow("R2A_EXCERPT_HASH_MISMATCH");
  });

  it("parses ordinary headings without requiring colons", () => {
    const sections = parseR2ASections(
      "Requirements\n- Skill required\nWhat you'll do\n- Serve guests",
    );
    expect(sections.map(({ heading }) => heading)).toEqual(["requirements", "what you'll do"]);
    expect(sections[0]?.items[0]?.text).toBe("Skill required");
  });

  it.each(r2aGoldenFixtures)("normalizes fictional $id with complete provenance", (fixture) => {
    const result = normalizeR2AJobEvidence({
      sourceText: fixture.text,
      sourceObservationId: `observation:${fixture.id}`,
      structured: fixture.structured,
      explicitLocation: fixture.location,
    });
    assertR2ASourcePointers(result, fixture.text);
    expect(result.parserVersion).toBe("3.5.2");
    expect(result.coverage).toHaveLength(17);
    for (const family of fixture.expectedFamilies) {
      expect(result.coverage.find((item) => item.family === family)?.state).not.toBe("UNKNOWN");
    }
    for (const expected of fixture.expectedModalities ?? []) {
      expect(result.requirementEvidence.some(({ modality }) => modality === expected)).toBe(true);
    }
  });

  it("keeps structured and prose employment conflicts instead of choosing one", () => {
    const fixture = r2aGoldenFixtures.find(({ id }) => id === "structured-conflict")!;
    const result = normalizeR2AJobEvidence({
      sourceText: fixture.text,
      sourceObservationId: "observation:conflict",
      structured: fixture.structured,
      explicitLocation: fixture.location,
    });
    const employment = result.fieldEvidence.filter(
      ({ canonicalField }) => canonicalField === "employment.type",
    );
    expect(
      new Set(employment.map(({ normalizedValue }) => JSON.stringify(normalizedValue))).size,
    ).toBe(2);
    expect(
      employment.every(({ state, conflictSetId }) => state === "CONFLICTING" && conflictSetId),
    ).toBe(true);
  });

  it("keeps valid and unrestricted work-right wording distinct", () => {
    const source =
      "Requirements\nValid Australian work rights required\nUnrestricted work rights preferred";
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      sourceObservationId: "observation:rights",
    });
    const kinds = result.requirementEvidence
      .filter(({ family }) => family === "WORK_RIGHTS")
      .map(
        ({ normalizedValue }) =>
          normalizedValue.kind === "WORK_RIGHTS" && normalizedValue.value.kind,
      );
    expect(kinds).toContain("VALID_AUSTRALIAN_WORK_RIGHTS");
    expect(kinds).toContain("UNRESTRICTED_WORK_RIGHTS");
  });

  it("retains weekly and fortnightly hours as separate units", () => {
    const source = "Hours\n20 hours per week\n40 hours per fortnight";
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      sourceObservationId: "observation:hours",
    });
    const units = result.fieldEvidence.flatMap(({ normalizedValue }) =>
      normalizedValue.kind === "HOURS" ? [normalizedValue.value.unit] : [],
    );
    expect(units).toEqual(expect.arrayContaining(["WEEK", "FORTNIGHT"]));
  });

  it("uses UNKNOWN salary period and true tri-state document requirements", () => {
    const source = "Salary: $90000\nDocuments\nPlease send a cover letter\nCV not required";
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      sourceObservationId: "observation:unknowns",
    });
    const salary = result.fieldEvidence.find(
      ({ normalizedValue }) => normalizedValue.kind === "SALARY",
    );
    expect(salary?.normalizedValue.kind === "SALARY" && salary.normalizedValue.value.period).toBe(
      "UNKNOWN",
    );
    const documents = result.fieldEvidence.flatMap(({ normalizedValue }) =>
      normalizedValue.kind === "DOCUMENT" ? [normalizedValue.value] : [],
    );
    expect(documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ documentKind: "COVER_LETTER", state: "UNKNOWN" }),
        expect.objectContaining({ documentKind: "CV_RESUME", state: "NOT_REQUIRED" }),
      ]),
    );
  });

  it("does not treat employment words in benefit prose as scoped employment evidence", () => {
    const source =
      "Benefits\nFull-time parking support is available\nRequirements\nCustomer service skill required";
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      sourceObservationId: "observation:scope",
    });
    expect(result.fieldEvidence.filter(({ family }) => family === "EMPLOYMENT")).toHaveLength(0);
    expect(result.coverage.find(({ family }) => family === "EMPLOYMENT")?.state).toBe("PARTIAL");
  });

  it("keeps commute duration and distance as separate typed evidence", () => {
    const source = "Travel\nCommute is 35 minutes\nCommute distance is 18 km";
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      sourceObservationId: "observation:commute",
    });
    const commute = result.fieldEvidence.filter(({ canonicalField }) =>
      canonicalField.startsWith("commute."),
    );
    expect(commute.map(({ canonicalField }) => canonicalField)).toEqual(
      expect.arrayContaining(["commute.duration", "commute.distance"]),
    );
    expect(
      commute.find(({ canonicalField }) => canonicalField === "commute.duration"),
    ).toMatchObject({ normalizedValue: { value: { durationMinutes: 35, distanceKm: null } } });
    expect(
      commute.find(({ canonicalField }) => canonicalField === "commute.distance"),
    ).toMatchObject({ normalizedValue: { value: { durationMinutes: null, distanceKm: 18 } } });
  });

  it("does not infer vehicle scope from a driver's licence requirement", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Requirements",
          content: "A fictional driver's licence is required.",
          kind: "REQUIREMENTS",
        },
      ],
    };
    const result = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(structured),
      structured,
      sourceObservationId: "observation:fictional-driver-licence-scope",
    });

    expect(result.requirementEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonicalKind: "LICENCE", family: "LICENCES" }),
      ]),
    );
    expect(result.coverage.find(({ family }) => family === "LICENCES")?.unparsedSpans).toHaveLength(
      0,
    );
    expect(result.coverage.find(({ family }) => family === "VEHICLE")?.state).toBe("UNKNOWN");
  });

  it("aligns travel requirement coverage with the existing location requirement kind", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Requirements",
          content: "Travel to fictional client sites is required.",
          kind: "REQUIREMENTS",
        },
      ],
    };
    const result = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(structured),
      structured,
      sourceObservationId: "observation:fictional-travel-scope",
    });

    expect(result.requirementEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonicalKind: "LOCATION", family: "GEOGRAPHY" }),
      ]),
    );
    expect(
      result.coverage.find(({ family }) => family === "GEOGRAPHY")?.unparsedSpans,
    ).toHaveLength(0);
    expect(result.coverage.find(({ family }) => family === "VEHICLE")?.state).toBe("UNKNOWN");
  });

  it("does not count a physical ability as a separate skills family", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Requirements",
          content: "Ability to lift fictional 10 kg loads is required.",
          kind: "REQUIREMENTS",
        },
      ],
    };
    const result = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(structured),
      structured,
      sourceObservationId: "observation:fictional-physical-scope",
    });

    expect(result.requirementEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonicalKind: "PHYSICAL", family: "PHYSICAL_REQUIREMENTS" }),
      ]),
    );
    expect(
      result.coverage.find(({ family }) => family === "PHYSICAL_REQUIREMENTS")?.unparsedSpans,
    ).toHaveLength(0);
    expect(result.coverage.find(({ family }) => family === "SKILLS")?.state).toBe("UNKNOWN");
  });

  it("splits structured semicolon clauses with exact child pointers and inherited modality", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Requirements",
          content:
            "A fictional bachelor's degree; at least 3 years of fictional field experience is preferred.",
          kind: "REQUIREMENTS",
        },
      ],
    };
    const source = JSON.stringify(structured);
    const input = {
      sourceText: source,
      structured,
      sourceObservationId: "observation:fictional-structured-semicolon",
    };
    const result = normalizeR2AJobEvidence(input);
    const again = normalizeR2AJobEvidence(input);

    expect(result.requirementEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalKind: "QUALIFICATION",
          family: "EDUCATION",
          modality: "REQUIRED",
          source: expect.objectContaining({
            sourcePath: expect.stringMatching(/\.clause\[0\]$/),
          }),
        }),
        expect.objectContaining({
          canonicalKind: "EXPERIENCE",
          family: "EXPERIENCE",
          modality: "PREFERRED",
          source: expect.objectContaining({
            sourcePath: expect.stringMatching(/\.clause\[1\]$/),
          }),
        }),
      ]),
    );
    expect(result.coverage.find(({ family }) => family === "EDUCATION")).toMatchObject({
      state: "PARTIAL",
      unparsedSpans: [],
    });
    expect(result.coverage.find(({ family }) => family === "EXPERIENCE")).toMatchObject({
      state: "PARTIAL",
      unparsedSpans: [],
    });
    expect(result.coverage.find(({ family }) => family === "SKILLS")?.state).toBe("UNKNOWN");
    expect(result.requirementEvidence).toEqual(again.requirementEvidence);
    assertR2ASourcePointers(result, source);
    assertR2AExcerptHashes(result);
  });

  it("splits structured sentence clauses without splitting decimal or abbreviation periods", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Requirements",
          content:
            "A fictional 3.5-year diploma (e.g. a technical credential) is preferred. At least 3 years of fictional field experience is required.",
          kind: "REQUIREMENTS",
        },
      ],
    };
    const source = JSON.stringify(structured);
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      structured,
      sourceObservationId: "observation:fictional-structured-sentences",
    });

    expect(result.requirementEvidence).toHaveLength(2);
    expect(
      result.requirementEvidence.map(({ family, modality }) => ({ family, modality })),
    ).toEqual(
      expect.arrayContaining([
        { family: "EDUCATION", modality: "PREFERRED" },
        { family: "EXPERIENCE", modality: "REQUIRED" },
      ]),
    );
    expect(result.requirementEvidence.map(({ source: pointer }) => pointer.sourcePath)).toEqual([
      expect.stringMatching(/\.clause\[0\]$/),
      expect.stringMatching(/\.clause\[1\]$/),
    ]);
    expect(result.requirementEvidence[0]?.source.excerpt).toContain("3.5-year");
    assertR2ASourcePointers(result, source);
    assertR2AExcerptHashes(result);
  });

  it("extracts a quantified secondary experience proposition from a structured span", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Requirements",
          content:
            "A fictional bachelor's degree and at least 3 years of fictional field experience are required.",
          kind: "REQUIREMENTS",
        },
      ],
    };
    const source = JSON.stringify(structured);
    const input = {
      sourceText: source,
      structured,
      sourceObservationId: "observation:fictional-secondary-experience",
    };
    const result = normalizeR2AJobEvidence(input);
    const again = normalizeR2AJobEvidence(input);
    const experience = result.requirementEvidence.find(({ family }) => family === "EXPERIENCE");

    expect(result.requirementEvidence.map(({ family }) => family)).toEqual([
      "EDUCATION",
      "EXPERIENCE",
    ]);
    expect(experience).toMatchObject({
      canonicalKind: "EXPERIENCE",
      modality: "REQUIRED",
      derivationInputIds: [],
      source: { sourcePath: expect.stringMatching(/\.extract\[EXPERIENCE\]$/) },
    });
    expect(experience?.source.excerpt).toContain("3 years");
    expect(experience?.source.excerpt).toContain("experience");
    expect(experience?.source.excerpt).not.toContain("degree");
    expect(result.requirementEvidence).toEqual(again.requirementEvidence);
    assertR2ASourcePointers(result, source);
    assertR2AExcerptHashes(result);
  });

  it("extracts only an explicit named secondary skills proposition", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Requirements",
          content:
            "A fictional degree is required and demonstrated programming skill in fictional controls are preferred.",
          kind: "REQUIREMENTS",
        },
      ],
    };
    const source = JSON.stringify(structured);
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      structured,
      sourceObservationId: "observation:fictional-secondary-skills",
    });
    const skill = result.requirementEvidence.find(({ family }) => family === "SKILLS");

    expect(skill).toMatchObject({
      canonicalKind: "SKILL",
      family: "SKILLS",
      modality: "PREFERRED",
      derivationInputIds: [],
      source: { sourcePath: expect.stringMatching(/\.extract\[SKILLS\]$/) },
    });
    expect(skill?.source.excerpt).toContain("programming skill");
    expect(skill?.source.excerpt).not.toContain("degree");
    assertR2ASourcePointers(result, source);
    assertR2AExcerptHashes(result);
  });

  it("leaves a generic experience mention unparsed without a safe secondary extractor", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Requirements",
          content: "A fictional degree and general experience are required.",
          kind: "REQUIREMENTS",
        },
      ],
    };
    const result = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(structured),
      structured,
      sourceObservationId: "observation:fictional-ambiguous-secondary",
    });

    expect(result.requirementEvidence.map(({ family }) => family)).toEqual(["EDUCATION"]);
    expect(result.coverage.find(({ family }) => family === "EXPERIENCE")).toMatchObject({
      state: "PARTIAL",
      unparsedSpans: [expect.any(Object)],
    });
  });

  it("treats certificate-level education as EDUCATION rather than a second certification scope", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Requirements",
          content:
            "A fictional bachelor's degree and Certificate IV in fictional systems are preferred.",
          kind: "REQUIREMENTS",
        },
      ],
    };
    const source = JSON.stringify(structured);
    const input = {
      sourceText: source,
      structured,
      sourceObservationId: "observation:fictional-education-certificate-scope",
    };
    const result = normalizeR2AJobEvidence(input);
    const again = normalizeR2AJobEvidence(input);

    expect(result.coverage.find(({ family }) => family === "EDUCATION")).toMatchObject({
      state: "PARTIAL",
      unparsedSpans: [],
    });
    expect(result.coverage.find(({ family }) => family === "CERTIFICATIONS")?.state).toBe(
      "UNKNOWN",
    );
    expect(result.requirementEvidence.map(({ family }) => family)).toEqual(["EDUCATION"]);
    expect(result.requirementEvidence[0]).toMatchObject({
      modality: "PREFERRED",
      ruleId: "R2A_QUALIFICATION_PREFERRED",
    });
    expect(result.requirementEvidence).toEqual(again.requirementEvidence);
    assertR2ASourcePointers(result, source);
    assertR2AExcerptHashes(result);
  });

  it("keeps explicit certification scope beside a formal education credential", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Requirements",
          content: "A fictional bachelor's degree and a current RSA certification are required.",
          kind: "REQUIREMENTS",
        },
      ],
    };
    const source = JSON.stringify(structured);
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      structured,
      sourceObservationId: "observation:fictional-explicit-certification-scope",
    });

    expect(result.coverage.find(({ family }) => family === "CERTIFICATIONS")).toMatchObject({
      state: "PARTIAL",
      unparsedSpans: [expect.any(Object)],
    });
    expect(result.requirementEvidence[0]).toMatchObject({
      canonicalKind: "QUALIFICATION",
      family: "EDUCATION",
    });
    assertR2ASourcePointers(result, source);
    assertR2AExcerptHashes(result);
  });

  it("classifies a standalone certificate-level credential as education", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Requirements",
          content: "Certificate IV in fictional network systems",
          kind: "REQUIREMENTS",
        },
      ],
    };
    const source = JSON.stringify(structured);
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      structured,
      sourceObservationId: "observation:fictional-certificate-iv-education",
    });

    expect(result.coverage.find(({ family }) => family === "EDUCATION")).toMatchObject({
      state: "PARTIAL",
      unparsedSpans: [],
    });
    expect(result.coverage.find(({ family }) => family === "CERTIFICATIONS")?.state).toBe(
      "UNKNOWN",
    );
    expect(result.requirementEvidence[0]).toMatchObject({
      canonicalKind: "QUALIFICATION",
      family: "EDUCATION",
      modality: "REQUIRED",
      ruleId: "R2A_QUALIFICATION_REQUIRED_SECTION_DEFAULT",
    });
    assertR2ASourcePointers(result, source);
    assertR2AExcerptHashes(result);
  });

  it("keeps vague generic certificate wording unresolved", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Requirements",
          content: "Experience with a certificate process may be helpful.",
          kind: "REQUIREMENTS",
        },
      ],
    };
    const source = JSON.stringify(structured);
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      structured,
      sourceObservationId: "observation:fictional-vague-certificate-wording",
    });

    expect(result.coverage.find(({ family }) => family === "CERTIFICATIONS")).toMatchObject({
      state: "PARTIAL",
      unparsedSpans: [expect.any(Object)],
    });
    expect(result.requirementEvidence.some(({ family }) => family === "CERTIFICATIONS")).toBe(
      false,
    );
    assertR2ASourcePointers(result, source);
    assertR2AExcerptHashes(result);
  });

  it("does not split structured comma-separated content", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Requirements",
          content: "A fictional degree, along with a fictional portfolio, is required.",
          kind: "REQUIREMENTS",
        },
      ],
    };
    const result = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(structured),
      structured,
      sourceObservationId: "observation:fictional-comma-boundary",
    });

    expect(result.requirementEvidence).toHaveLength(1);
    expect(result.requirementEvidence[0]?.canonicalKind).toBe("QUALIFICATION");
    expect(result.requirementEvidence[0]?.source.sourcePath).not.toMatch(/\.clause\[/);
  });

  it("does not split structured and/or content into separate requirements", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Requirements",
          content: "A fictional degree is required and/or general experience is preferred.",
          kind: "REQUIREMENTS",
        },
      ],
    };
    const result = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(structured),
      structured,
      sourceObservationId: "observation:fictional-conjunction-boundary",
    });

    expect(result.requirementEvidence).toHaveLength(1);
    expect(result.requirementEvidence[0]).toMatchObject({
      canonicalKind: "QUALIFICATION",
      modality: "PREFERRED",
    });
    expect(result.requirementEvidence[0]?.source.sourcePath).not.toMatch(/\.clause\[/);
  });

  it("preserves preferred section defaults while child lexical modality takes precedence", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Desirable",
          content: "A fictional degree. A fictional diploma must be completed.",
          kind: "REQUIREMENTS",
        },
      ],
    };
    const source = JSON.stringify(structured);
    const result = normalizeR2AJobEvidence({
      sourceText: source,
      structured,
      sourceObservationId: "observation:fictional-preferred-section",
    });

    expect(result.requirementEvidence.map(({ modality }) => modality)).toEqual([
      "PREFERRED",
      "REQUIRED",
    ]);
    expect(result.requirementEvidence.map(({ ruleId }) => ruleId)).toEqual([
      "R2A_QUALIFICATION_PREFERRED_SECTION_DEFAULT",
      "R2A_QUALIFICATION_REQUIRED",
    ]);
    assertR2ASourcePointers(result, source);
    assertR2AExcerptHashes(result);
  });

  it("preserves source state separately from conditional modality", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: "Requirements\nRSA must be obtained within 30 days",
      sourceObservationId: "observation:conditional",
    });
    expect(result.requirementEvidence[0]).toMatchObject({
      state: "SOURCE_STATED",
      modality: "CONDITIONAL",
    });
  });

  it.each([
    ["RSA is required", "REQUIRED"],
    ["RSA is preferred", "PREFERRED"],
    ["RSA must be obtained within 30 days", "CONDITIONAL"],
    ["RSA is not required", "NEGATED"],
  ] as const)("keeps evidence state independent for %s", (text, modality) => {
    const result = normalizeR2AJobEvidence({
      sourceText: `Requirements\n${text}`,
      sourceObservationId: `observation:${modality}`,
    });
    expect(result.requirementEvidence[0]).toMatchObject({ state: "SOURCE_STATED", modality });
  });

  it("creates requirement conflicts only for opposite claims about the same proposition", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: "Requirements\nRSA required\nRSA not required\nFirst Aid required",
      sourceObservationId: "observation:requirement-conflict",
    });
    const rsa = result.requirementEvidence.filter(({ normalizedValue }) =>
      JSON.stringify(normalizedValue).toLowerCase().includes("rsa"),
    );
    const firstAid = result.requirementEvidence.find(({ normalizedValue }) =>
      JSON.stringify(normalizedValue).toLowerCase().includes("first aid"),
    );
    expect(rsa).toHaveLength(2);
    expect(rsa.every(({ state, conflictSetId }) => state === "CONFLICTING" && conflictSetId)).toBe(
      true,
    );
    expect(firstAid).toMatchObject({ state: "SOURCE_STATED", conflictSetId: null });
  });

  it("conflicts opposite sponsorship availability propositions", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: "Requirements\nVisa sponsorship available\nVisa sponsorship not available",
      sourceObservationId: "observation:sponsorship-conflict",
    });
    const sponsorship = result.requirementEvidence.filter(
      ({ normalizedValue }) =>
        normalizedValue.kind === "WORK_RIGHTS" &&
        normalizedValue.value.kind.startsWith("SPONSORSHIP_"),
    );
    expect(sponsorship).toHaveLength(2);
    expect(
      sponsorship.every(({ state, conflictSetId }) => state === "CONFLICTING" && conflictSetId),
    ).toBe(true);
  });

  it("keeps unknown material visible through conservative coverage", () => {
    const result = normalizeR2AJobEvidence({
      sourceText:
        "Employment type\nA rotating arrangement selected later\nMystery heading\nUnparsed material",
      sourceObservationId: "observation:coverage",
    });
    expect(result.coverage.find(({ family }) => family === "EMPLOYMENT")).toMatchObject({
      state: "PARTIAL",
    });
    expect(
      result.coverage.some(
        ({ state, unparsedSpans }) => state !== "COMPLETE" && unparsedSpans.length,
      ),
    ).toBe(true);
  });

  it("classifies material under an unknown heading without claiming complete coverage", () => {
    const result = normalizeR2AJobEvidence({
      sourceText:
        "Other Conditions\nMust hold an RSA\nWork rights may be required\nExperience preferred\nWeekend schedule\nCover letter optional",
      sourceObservationId: "observation:unknown-heading",
    });
    expect(result.requirementEvidence.map(({ family }) => family)).toEqual(
      expect.arrayContaining([
        "CERTIFICATIONS",
        "WORK_RIGHTS",
        "EXPERIENCE",
        "SCHEDULE",
        "DOCUMENTS",
      ]),
    );
    expect(
      result.coverage
        .filter(({ family }) =>
          ["CERTIFICATIONS", "WORK_RIGHTS", "EXPERIENCE", "SCHEDULE", "DOCUMENTS"].includes(family),
        )
        .every(({ state }) => state !== "COMPLETE"),
    ).toBe(true);
  });

  it("normalizes nested JSON-LD arrays with exact serialized provenance", () => {
    const structured = {
      title: "Guest Experience Lead",
      hiringOrganization: { name: "Fictional Hospitality" },
      employmentType: ["FULL_TIME"],
      datePosted: "2026-09-01",
      validThrough: "2026-10-10T17:00:00+10:00",
      baseSalary: {
        currency: "AUD",
        value: { minValue: 80000, maxValue: 95000, unitText: "YEAR" },
      },
      skills: ["Customer service required"],
      qualifications: ["Certificate IV preferred"],
      jobLocation: [
        {
          address: {
            addressLocality: "Geelong",
            addressRegion: "VIC",
            postalCode: "3220",
            addressCountry: "AU",
          },
        },
      ],
    };
    const result = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(structured),
      structured,
      sourceObservationId: "observation:jsonld",
    });
    assertR2ASourcePointers(result, JSON.stringify(structured));
    expect(result.fieldEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonicalField: "title", state: "SOURCE_STATED" }),
        expect.objectContaining({ canonicalField: "company", state: "SOURCE_STATED" }),
        expect.objectContaining({ canonicalField: "location.locality", state: "SOURCE_STATED" }),
        expect.objectContaining({ canonicalField: "location.alternative", state: "DERIVED" }),
        expect.objectContaining({ canonicalField: "employment.type", state: "SOURCE_STATED" }),
        expect.objectContaining({ canonicalField: "dates.posted", state: "SOURCE_STATED" }),
        expect.objectContaining({ canonicalField: "salary", state: "DERIVED" }),
      ]),
    );
  });

  it("parses inert structured HTML description content by family", () => {
    const structured = {
      description:
        "<h2>Requirements</h2><p>RSA required.</p><h2>Experience</h2><p>2 years experience required.</p><p>Valid Australian work rights required.</p><p>Please include a cover letter.</p>",
    };
    const result = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(structured),
      structured,
      sourceObservationId: "observation:html-description",
    });
    assertR2ASourcePointers(result, JSON.stringify(structured));
    expect(result.requirementEvidence.map(({ family }) => family)).toEqual(
      expect.arrayContaining(["CERTIFICATIONS", "EXPERIENCE", "WORK_RIGHTS"]),
    );
    expect(
      result.fieldEvidence.some(
        ({ normalizedValue }) =>
          normalizedValue.kind === "DOCUMENT" &&
          normalizedValue.value.documentKind === "COVER_LETTER",
      ),
    ).toBe(true);
  });

  it("qualifies fully parsed structured list scope without executing provider HTML", () => {
    const structured = {
      description:
        "<h2>Requirements</h2><ul><li>Customer service experience required.</li><li>Communication skills required.</li></ul><h2>Hours</h2><p>18 hours per week</p><h2>Roster</h2><p>Fixed Monday-Friday 09:00-13:00 AEST</p>",
      requirementTexts: ["Customer service experience required.", "Communication skills required."],
    };
    const sourceText = JSON.stringify(structured);
    const result = normalizeR2AJobEvidence({
      sourceText,
      structured,
      sourceObservationId: "observation:structured-list-scope",
    });
    expect(result.coverage.find(({ family }) => family === "EXPERIENCE")).toMatchObject({
      state: "COMPLETE",
      unparsedSpans: [],
    });
    expect(result.coverage.find(({ family }) => family === "SKILLS")).toMatchObject({
      state: "COMPLETE",
      unparsedSpans: [],
    });
    expect(result.coverage.find(({ family }) => family === "HOURS")).toMatchObject({
      state: "COMPLETE",
      unparsedSpans: [],
    });
    expect(result.coverage.find(({ family }) => family === "SCHEDULE")).toMatchObject({
      state: "COMPLETE",
      unparsedSpans: [],
    });
    expect(
      result.requirementEvidence.some(({ normalizedValue }) =>
        /<li|<ul>/i.test(JSON.stringify(normalizedValue)),
      ),
    ).toBe(false);
  });

  it("extracts long structured section chunks with exact provenance and conservative boundaries", () => {
    const longRequirement = `${"Fictional engineering context. ".repeat(34)}Python skill preferred.`;
    const structured = {
      description: [
        "Fictional overview.",
        "Salary: AUD 80,000 per year",
        `Extended fictional context ${"with reliable systems. ".repeat(72)}`,
        "Required qualifications and experience",
        "A Bachelor degree is required.",
        "3 years of experience preferred.",
        'Python skill may be required when supporting "fictional" trials.',
        longRequirement,
        "Responsibilities",
        "Use Python systems to support fictional service delivery.",
        "Uncategorized details",
        "RSA certification required.",
      ].join("\n"),
      sourceSections: [
        {
          heading: "Required qualifications and experience",
          kind: "REQUIREMENTS",
          content: [
            "A Bachelor degree is required.",
            "3 years of experience preferred.",
            'Python skill may be required when supporting "fictional" trials.',
            longRequirement,
          ].join("\n"),
        },
        {
          heading: "Responsibilities",
          kind: "RESPONSIBILITIES",
          content: "Use Python systems to support fictional service delivery.",
        },
        {
          heading: "Uncategorized details",
          kind: "OTHER",
          content: "RSA certification required.",
        },
        { heading: "Benefits", kind: "BENEFITS", content: "Fictional gym access." },
      ],
      requirementTexts: [],
    };
    const sourceText = JSON.stringify(structured);
    const input = {
      sourceText,
      structured,
      sourceObservationId: "observation:long-section-chunks",
    };
    const result = normalizeR2AJobEvidence(input);
    assertR2ASourcePointers(result, sourceText);
    assertR2AExcerptHashes(result);
    expect(normalizeR2AJobEvidence(input)).toEqual(result);

    const salary = result.fieldEvidence.find(({ canonicalField }) => canonicalField === "salary");
    expect(salary?.source.sourcePath).toMatch(/^structured\.description\.line\[/);
    expect(salary?.source.excerpt).toContain("Salary: AUD 80,000 per year");

    const requirements = result.requirementEvidence;
    expect(requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonicalKind: "QUALIFICATION", modality: "REQUIRED" }),
        expect.objectContaining({ canonicalKind: "EXPERIENCE", modality: "PREFERRED" }),
        expect.objectContaining({ canonicalKind: "SKILL", modality: "CONDITIONAL" }),
        expect.objectContaining({ canonicalKind: "SKILL", modality: "PREFERRED" }),
      ]),
    );
    expect(
      requirements.every(
        ({ source }) =>
          !source.sourcePath.startsWith("structured.sourceSections[1]") &&
          !source.sourcePath.startsWith("structured.sourceSections[2]") &&
          !source.sourcePath.startsWith("structured.sourceSections[3]"),
      ),
    ).toBe(true);
    expect(
      result.requirementEvidence.some(({ canonicalKind }) => canonicalKind === "CERTIFICATION"),
    ).toBe(false);
    expect(
      result.requirementEvidence
        .filter(({ source }) => source.sourcePath.startsWith("structured.sourceSections[0]"))
        .every(({ source }) => source.excerpt.length <= 1000),
    ).toBe(true);
    expect(result.coverage.find(({ family }) => family === "EDUCATION")?.state).not.toBe("UNKNOWN");
    expect(result.coverage.find(({ family }) => family === "EXPERIENCE")?.state).not.toBe(
      "UNKNOWN",
    );
  });

  it("uses structured requirement text as fallback and keeps unknown sections field-only", () => {
    const structured = {
      description: "A fictional role with RSA certification required.",
      sourceSections: [
        {
          heading: "Additional information",
          kind: "OTHER",
          content: "RSA certification required.",
        },
      ],
      requirementTexts: [],
    };
    const result = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(structured),
      structured,
      sourceObservationId: "observation:unknown-section-remains-conservative",
    });
    expect(result.requirementEvidence).toHaveLength(0);
    expect(result.coverage.find(({ family }) => family === "CERTIFICATIONS")?.state).toBe(
      "PARTIAL",
    );

    const fallback = { requirementTexts: ["A Bachelor degree is required."] };
    const fallbackResult = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(fallback),
      structured: fallback,
      sourceObservationId: "observation:structured-requirement-fallback",
    });
    expect(fallbackResult.requirementEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ canonicalKind: "QUALIFICATION" })]),
    );
  });

  it("adds only explicit unsectioned description requirements with exact source provenance", () => {
    const structured = {
      description: [
        "Python skill required.",
        "Python skill essential.",
        'Rust skill preferred — include "Unicode".',
        "Go skill may be required.",
        "Scala skill is not required.",
        "Use Ruby skill required.",
        "Use Dart skill required.",
        "Use Kotlin skill required.",
      ].join("\n"),
      sourceSections: [
        { heading: "Requirements", kind: "REQUIREMENTS", content: "Python skill required." },
        {
          heading: "Responsibilities",
          kind: "RESPONSIBILITIES",
          content: "Use Ruby skill required.",
        },
        { heading: "Additional information", kind: "OTHER", content: "Use Dart skill required." },
        { heading: "Benefits", kind: "BENEFITS", content: "Use Kotlin skill required." },
      ],
      requirementTexts: [],
    };
    const sourceText = JSON.stringify(structured);
    const input = {
      sourceText,
      structured,
      sourceObservationId: "observation:structured-description-requirement-supplement",
    };
    const result = normalizeR2AJobEvidence(input);
    assertR2ASourcePointers(result, sourceText);
    assertR2AExcerptHashes(result);
    expect(normalizeR2AJobEvidence(input)).toEqual(result);
    expect(
      result.requirementEvidence.map(({ modality, canonicalKind }) => ({
        modality,
        canonicalKind,
      })),
    ).toEqual([
      { modality: "REQUIRED", canonicalKind: "SKILL" },
      { modality: "PREFERRED", canonicalKind: "SKILL" },
    ]);
    expect(result.requirementEvidence[1]?.source.sourcePath).toMatch(
      /^structured\.description\.line\[\d+\]\.chunk\[0\]$/,
    );
    expect(result.requirementEvidence[1]?.source.excerpt).toContain("Rust skill preferred");
    expect(
      result.requirementEvidence.some(
        ({ source }) =>
          source.sourcePath.startsWith("structured.sourceSections[1]") ||
          source.sourcePath.startsWith("structured.sourceSections[2]") ||
          source.sourcePath.startsWith("structured.sourceSections[3]"),
      ),
    ).toBe(false);
  });

  it("does not supplement HTML description text when structured sections are present", () => {
    const structured = {
      description: "<p>Swift skill required.</p>",
      sourceSections: [
        { heading: "Additional information", kind: "OTHER", content: "Fictional context." },
      ],
      requirementTexts: [],
    };
    const sourceText = JSON.stringify(structured);
    const result = normalizeR2AJobEvidence({
      sourceText,
      structured,
      sourceObservationId: "observation:html-description-not-supplemented",
    });
    assertR2ASourcePointers(result, sourceText);
    expect(result.requirementEvidence).toEqual([]);
  });

  it("uses requirement sections once without leaving duplicate array scope unresolved", () => {
    const requirement = "Customer service experience required.";
    const structured = {
      description: "Fictional service role with mentoring.\nHours\n18 hours per week",
      sourceSections: [{ heading: "Requirements", kind: "REQUIREMENTS", content: requirement }],
      requirementTexts: [requirement],
    };
    const sourceText = JSON.stringify(structured);
    const result = normalizeR2AJobEvidence({
      sourceText,
      structured,
      sourceObservationId: "observation:section-array-requirement-deduplication",
    });
    assertR2ASourcePointers(result, sourceText);
    assertR2AExcerptHashes(result);

    expect(result.requirementEvidence).toHaveLength(1);
    expect(result.requirementEvidence[0]?.source.sourcePath).toMatch(
      /^structured\.sourceSections\[0\]\.content/,
    );
    expect(result.coverage.find(({ family }) => family === "EXPERIENCE")).toMatchObject({
      state: "COMPLETE",
      unparsedSpans: [],
    });
    expect(
      result.coverage
        .flatMap(({ unparsedSpans }) => unparsedSpans)
        .some(({ sourcePath }) => sourcePath.startsWith("structured.requirementTexts")),
    ).toBe(false);
  });

  it.each([
    [
      "neutral skill under requirements",
      "Requirements",
      "REQUIREMENTS",
      "Ruby programming knowledge",
      "REQUIRED",
      true,
    ],
    [
      "neutral experience under requirements",
      "Minimum Requirements",
      "REQUIREMENTS",
      "3+ years experience in a fictional engineering team",
      "REQUIRED",
      true,
    ],
    [
      "neutral qualification under requirements",
      "Qualifications",
      "REQUIREMENTS",
      "A bachelor degree in fictional systems engineering",
      "REQUIRED",
      true,
    ],
    [
      "neutral preferred qualification",
      "Preferred Qualifications",
      "REQUIREMENTS",
      "A bachelor degree in fictional systems engineering",
      "PREFERRED",
      true,
    ],
    [
      "preferred bullet under requirements",
      "Requirements",
      "REQUIREMENTS",
      "Ruby programming knowledge preferred",
      "PREFERRED",
      false,
    ],
    [
      "conditional bullet under requirements",
      "Requirements",
      "REQUIREMENTS",
      "May be required to travel for a fictional event",
      "CONDITIONAL",
      false,
    ],
    [
      "negated bullet under requirements",
      "Requirements",
      "REQUIREMENTS",
      "A fictional driver licence is not required",
      "NEGATED",
      false,
    ],
    [
      "explicit required bullet under requirements",
      "Requirements",
      "REQUIREMENTS",
      "Three years experience is required",
      "REQUIRED",
      false,
    ],
  ] as const)(
    "uses lexical modality before section context for %s",
    (_name, heading, kind, content, expected, inherited) => {
      const structured = { sourceSections: [{ heading, kind, content }] };
      const sourceText = JSON.stringify(structured);
      const result = normalizeR2AJobEvidence({
        sourceText,
        structured,
        sourceObservationId: `observation:section-modality:${_name}`,
      });
      expect(result.requirementEvidence).toHaveLength(1);
      expect(result.requirementEvidence[0]?.modality).toBe(expected);
      if (inherited) {
        expect(result.requirementEvidence[0]?.ruleId).toMatch(/_SECTION_DEFAULT$/);
      } else {
        expect(result.requirementEvidence[0]?.ruleId).not.toMatch(/_SECTION_DEFAULT$/);
      }
    },
  );

  it.each([
    ["responsibilities", "RESPONSIBILITIES", "Ruby programming knowledge"],
    ["benefits", "BENEFITS", "A fictional driver licence is required"],
    ["other", "OTHER", "3+ years experience in a fictional team"],
  ] as const)("does not infer requirement modality from %s sections", (_name, kind, content) => {
    const structured = { sourceSections: [{ heading: _name, kind, content }] };
    const result = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(structured),
      structured,
      sourceObservationId: `observation:section-no-fallback:${_name}`,
    });
    expect(result.requirementEvidence).toEqual([]);
  });

  it("limits section fallback to spans originating in structured REQUIREMENTS sections", () => {
    const structured = {
      sourceSections: [{ heading: "Requirements", kind: "REQUIREMENTS", content: "" }],
      requirements: ["Ruby programming knowledge"],
      skills: ["Python programming knowledge"],
      qualifications: ["A bachelor degree in fictional systems engineering"],
    };
    const result = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(structured),
      structured,
      sourceObservationId: "observation:structured-arrays-no-section-default",
    });
    expect(
      result.requirementEvidence.map(({ modality, source }) => ({
        modality,
        sourcePath: source.sourcePath,
      })),
    ).toEqual([
      { modality: "UNKNOWN", sourcePath: "structured.requirements[0]" },
      { modality: "UNKNOWN", sourcePath: "structured.skills[0]" },
      { modality: "UNKNOWN", sourcePath: "structured.qualifications[0]" },
    ]);
  });

  it("keeps description modality lexical and neutral facts unknown", () => {
    const neutralStructured = { description: "Ruby programming knowledge." };
    const neutral = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(neutralStructured),
      structured: neutralStructured,
      sourceObservationId: "observation:neutral-description-is-unknown",
    });
    expect(neutral.requirementEvidence.map(({ modality }) => modality)).toEqual(["UNKNOWN"]);
    expect(neutral.requirementEvidence[0]?.ruleId).not.toMatch(/_SECTION_DEFAULT$/);

    const structured = {
      description: "Three years experience is required.\nCloud deployment preferred.",
      sourceSections: [
        { heading: "Responsibilities", kind: "RESPONSIBILITIES", content: "A fictional role." },
      ],
    };
    const sourceText = JSON.stringify(structured);
    const result = normalizeR2AJobEvidence({
      sourceText,
      structured,
      sourceObservationId: "observation:description-context-is-not-inherited",
    });
    expect(result.requirementEvidence.map(({ modality }) => modality)).toEqual([
      "REQUIRED",
      "PREFERRED",
    ]);
    expect(
      result.requirementEvidence.every(({ ruleId }) => !ruleId.endsWith("_SECTION_DEFAULT")),
    ).toBe(true);
  });

  it("preserves the exact bullet pointer and excerpt hash for inherited modality", () => {
    const bullet = "3+ years experience in a fictional engineering team";
    const bulletSpan = `- ${bullet}`;
    const structured = {
      sourceSections: [{ heading: "Requirements", kind: "REQUIREMENTS", content: bulletSpan }],
    };
    const sourceText = JSON.stringify(structured);
    const input = {
      sourceText,
      structured,
      sourceObservationId: "observation:section-pointer",
    };
    const result = normalizeR2AJobEvidence(input);
    assertR2ASourcePointers(result, sourceText);
    assertR2AExcerptHashes(result);
    expect(result.requirementEvidence[0]?.source.excerpt).toBe(bulletSpan);
    expect(
      sourceText.slice(
        result.requirementEvidence[0]!.source.start,
        result.requirementEvidence[0]!.source.end,
      ),
    ).toBe(bulletSpan);
    expect(result.requirementEvidence[0]?.source.sourcePath).toMatch(
      /^structured\.sourceSections\[0\]\.content\.line\[0\]/,
    );
    expect(normalizeR2AJobEvidence(input)).toEqual(result);
    expect(result.requirementEvidence[0]?.ruleId).toBe("R2A_EXPERIENCE_REQUIRED_SECTION_DEFAULT");
  });

  it("keeps ambiguous mixed headings and untrusted standalone text unknown", () => {
    const mixed = {
      sourceSections: [
        {
          heading: "Required and Preferred Qualifications",
          kind: "REQUIREMENTS",
          content: "Ruby programming knowledge",
        },
      ],
    };
    const mixedResult = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(mixed),
      structured: mixed,
      sourceObservationId: "observation:ambiguous-heading",
    });
    const standaloneResult = normalizeR2AJobEvidence({
      sourceText: "Ruby programming knowledge",
      sourceObservationId: "observation:no-trusted-section",
    });
    expect(mixedResult.requirementEvidence[0]?.modality).toBe("UNKNOWN");
    expect(standaloneResult.requirementEvidence[0]?.modality).toBe("UNKNOWN");
    expect(mixedResult.requirementEvidence[0]?.ruleId).not.toMatch(/_SECTION_DEFAULT$/);
    expect(standaloneResult.requirementEvidence[0]?.ruleId).not.toMatch(/_SECTION_DEFAULT$/);
  });

  it("keeps conflict detection stable when section context supplies REQUIRED", () => {
    const structured = {
      sourceSections: [
        {
          heading: "Requirements",
          kind: "REQUIREMENTS",
          content: "Access to a vehicle\nAccess to a vehicle is not required",
        },
      ],
    };
    const result = normalizeR2AJobEvidence({
      sourceText: JSON.stringify(structured),
      structured,
      sourceObservationId: "observation:section-default-conflict",
    });
    expect(result.requirementEvidence).toHaveLength(2);
    expect(result.requirementEvidence.map(({ modality }) => modality)).toEqual([
      "REQUIRED",
      "NEGATED",
    ]);
    expect(
      result.requirementEvidence.every(
        ({ state, conflictSetId }) => state === "CONFLICTING" && conflictSetId,
      ),
    ).toBe(true);
    expect(result.conflicts).toHaveLength(1);
  });

  it("parses Australian full state names and does not conflict location alternatives", () => {
    const geelong = normalizeR2AJobEvidence({
      sourceText: "Location: Geelong Victoria 3220",
      sourceObservationId: "observation:geelong",
    });
    expect(
      geelong.fieldEvidence.find(({ canonicalField }) => canonicalField === "location.alternative")
        ?.normalizedValue,
    ).toMatchObject({
      value: { locality: "Geelong", stateOrTerritory: "VIC", postcode: "3220" },
    });

    const alternatives = normalizeR2AJobEvidence({
      sourceText: "Location: Geelong VIC 3220 or Ballarat VIC 3350",
      sourceObservationId: "observation:alternatives",
    });
    expect(
      alternatives.fieldEvidence.filter(
        ({ canonicalField }) => canonicalField === "location.alternative",
      ),
    ).toHaveLength(2);
    expect(alternatives.fieldEvidence.some(({ conflictSetId }) => conflictSetId)).toBe(false);
  });

  it("flags postcode and state contradictions as a region conflict", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: "Location: Sydney VIC 2000",
      sourceObservationId: "observation:region-conflict",
    });
    const region = result.fieldEvidence.filter(({ conflictSetId }) => conflictSetId);
    expect(region.map(({ canonicalField }) => canonicalField)).toEqual(
      expect.arrayContaining(["location.state", "location.postcode"]),
    );
    expect(region.every(({ state }) => state === "CONFLICTING")).toBe(true);
  });

  it.each([
    ["Salary: $80k per year", 80000, 80000, "YEAR"],
    ["Salary: $80K-$95K", 80000, 95000, "UNKNOWN"],
    ["Salary: AUD 80,000–95,000 per annum", 80000, 95000, "YEAR"],
    ["Salary: AUD 30-35 per hour", 30, 35, "HOUR"],
    ["Salary: $90000", 90000, 90000, "UNKNOWN"],
  ] as const)("normalizes salary %s", (text, minimum, maximum, period) => {
    const result = normalizeR2AJobEvidence({
      sourceText: text,
      sourceObservationId: `observation:salary:${minimum}`,
    });
    expect(
      result.fieldEvidence.find(({ canonicalField }) => canonicalField === "salary"),
    ).toMatchObject({
      normalizedValue: { value: { minimum, maximum, period } },
    });
  });

  it("preserves salary modifiers and safe unknown negotiable values", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: "Salary: $30 per hour + super\nSalary: $100k + bonus\nSalary negotiable",
      sourceObservationId: "observation:salary-modifiers",
    });
    const salaries = result.fieldEvidence.flatMap(({ normalizedValue }) =>
      normalizedValue.kind === "SALARY" ? [normalizedValue.value] : [],
    );
    expect(salaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ minimum: 30, period: "HOUR", superannuation: "PLUS" }),
        expect.objectContaining({ minimum: 100000, bonus: true }),
        expect.objectContaining({ shape: "UNKNOWN", minimum: null, maximum: null }),
      ]),
    );
  });

  it("handles conditional and optional document wording conservatively", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: "Documents\nCV required; cover letter optional; portfolio not required",
      sourceObservationId: "observation:documents",
    });
    const values = result.fieldEvidence.flatMap(({ normalizedValue }) =>
      normalizedValue.kind === "DOCUMENT" ? [normalizedValue.value] : [],
    );
    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ documentKind: "CV_RESUME", state: "REQUIRED" }),
        expect.objectContaining({ documentKind: "COVER_LETTER", state: "UNKNOWN" }),
        expect.objectContaining({ documentKind: "PORTFOLIO", state: "NOT_REQUIRED" }),
      ]),
    );

    const mixed = normalizeR2AJobEvidence({
      sourceText: "Documents\nCV required; cover letter not required",
      sourceObservationId: "observation:documents-mixed",
    });
    expect(
      mixed.fieldEvidence.flatMap(({ normalizedValue }) =>
        normalizedValue.kind === "DOCUMENT" ? [normalizedValue.value] : [],
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ documentKind: "CV_RESUME", state: "REQUIRED" }),
        expect.objectContaining({ documentKind: "COVER_LETTER", state: "NOT_REQUIRED" }),
      ]),
    );
  });

  it("does not parse shift counts as times", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: "Schedule\n2 shifts per week",
      sourceObservationId: "observation:shift-count",
    });
    expect(
      result.fieldEvidence.some(({ normalizedValue }) => normalizedValue.kind === "SCHEDULE"),
    ).toBe(false);
  });

  it("parses only credible twelve- and twenty-four-hour time ranges", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: "Schedule\nMonday 9am-5pm\nFriday 17:00–23:30",
      sourceObservationId: "observation:time-ranges",
    });
    const schedules = result.fieldEvidence.flatMap(({ normalizedValue }) =>
      normalizedValue.kind === "SCHEDULE" ? [normalizedValue.value] : [],
    );
    expect(schedules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ startTime: "09:00", endTime: "17:00" }),
        expect.objectContaining({ startTime: "17:00", endTime: "23:30" }),
      ]),
    );
  });

  it("keeps date-only precision and unknown timezone explicit", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: "Closing date: 10 October 2026",
      sourceObservationId: "observation:date-precision",
    });
    expect(
      result.fieldEvidence.find(({ canonicalField }) => canonicalField === "dates.closing"),
    ).toMatchObject({
      normalizedValue: {
        value: { value: "2026-10-10", precision: "DATE_ONLY", timezone: "UNKNOWN", offset: null },
      },
    });
    const dateTime = normalizeR2AJobEvidence({
      sourceText: "Applications close: 2026-10-10T17:00:00+10:00",
      sourceObservationId: "observation:date-time-precision",
    });
    expect(
      dateTime.fieldEvidence.find(({ canonicalField }) => canonicalField === "dates.closing"),
    ).toMatchObject({
      normalizedValue: {
        value: {
          value: "2026-10-10T17:00:00+10:00",
          precision: "DATE_TIME",
          timezone: "KNOWN",
          offset: "+10:00",
        },
      },
    });
  });

  it("emits each work-right proposition from one clause", () => {
    const result = normalizeR2AJobEvidence({
      sourceText:
        "Requirements\nValid Australian work rights with no sponsorship, maximum 20 hours per week, visa expires 10 October 2027",
      sourceObservationId: "observation:work-rights-multiple",
    });
    const kinds = result.requirementEvidence.flatMap(({ normalizedValue }) =>
      normalizedValue.kind === "WORK_RIGHTS" ? [normalizedValue.value.kind] : [],
    );
    expect(kinds).toEqual(
      expect.arrayContaining([
        "VALID_AUSTRALIAN_WORK_RIGHTS",
        "SPONSORSHIP_NOT_AVAILABLE",
        "HOURS_CONDITION",
        "EXPIRY_CONDITION",
      ]),
    );
  });

  it("links material same-field contradictions and leaves alternatives alone", () => {
    const result = normalizeR2AJobEvidence({
      sourceText:
        "Title: Fictional One\nTitle: Fictional Two\nEmployment type: Full-time\nEmployment type: Part-time\n20 hours per week\n30 hours per week\nSalary: $30 per hour\nSalary: $40 per hour\nTraining is provided\nNo training is provided\nDocuments\nCV required\nCV not required",
      sourceObservationId: "observation:field-conflicts",
    });
    for (const field of [
      "title",
      "employment.type",
      "hours.week",
      "salary",
      "training",
      "documents.cvResume",
    ]) {
      const evidence = result.fieldEvidence.filter(
        ({ canonicalField }) => canonicalField === field,
      );
      expect(evidence.length).toBeGreaterThanOrEqual(2);
      expect(
        evidence.every(({ state, conflictSetId }) => state === "CONFLICTING" && conflictSetId),
      ).toBe(true);
    }
  });

  it("marks conflicting closing dates without overwriting either value", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: "Closing date: 10 October 2026\nApplications close: 12 October 2026",
      sourceObservationId: "observation:dates",
    });
    const closing = result.fieldEvidence.filter(
      ({ canonicalField }) => canonicalField === "dates.closing",
    );
    expect(closing).toHaveLength(2);
    expect(closing.every(({ state }) => state === "CONFLICTING")).toBe(true);
  });

  it("keeps structured and prose location conflicts linked", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: '{"location":"Perth WA 6000"}\nLocation: Sydney NSW 2000',
      sourceObservationId: "observation:location-priority",
      structured: { location: "Perth WA 6000" },
      explicitLocation: "Sydney NSW 2000",
    });
    const locations = result.fieldEvidence.filter(
      ({ canonicalField }) => canonicalField === "location.alternative",
    );
    expect(locations).toHaveLength(2);
    expect(
      locations.every(({ state, conflictSetId }) => state === "CONFLICTING" && conflictSetId),
    ).toBe(true);
  });

  it("distinguishes training not provided from training provided", () => {
    const result = normalizeR2AJobEvidence({
      sourceText: "Benefits\nNo training is provided",
      sourceObservationId: "observation:training",
    });
    expect(
      result.fieldEvidence.find(({ family }) => family === "TRAINING")?.normalizedValue,
    ).toMatchObject({ value: { state: "NOT_PROVIDED" } });
  });

  it.each([999, 1000, 1001, 4096])(
    "bounds structured title evidence at the %i-character accepted boundary",
    (length) => {
      const title = `Fictional title ${"t".repeat(length - "Fictional title ".length)}`;
      const structured = { title };
      const result = normalizeR2AJobEvidence({
        sourceText: JSON.stringify(structured),
        sourceObservationId: `observation:structured-title:${length}`,
        structured,
      });
      const evidence = result.fieldEvidence.find(
        ({ canonicalField }) => canonicalField === "title",
      );
      expect(evidence?.source.excerpt.length).toBeLessThanOrEqual(1000);
      expect(
        evidence?.normalizedValue.kind === "TEXT" ? evidence.normalizedValue.value.length : null,
      ).toBeLessThanOrEqual(1000);
    },
  );

  it.each([199, 200, 201, 1000])(
    "preserves a %i-character raw location while bounding derived locality and suburb",
    (length) => {
      const location = `Fictional ${"l".repeat(length - "Fictional ".length)}`;
      const structured = { jobLocation: location };
      const result = normalizeR2AJobEvidence({
        sourceText: JSON.stringify(structured),
        sourceObservationId: `observation:structured-location:${length}`,
        structured,
      });
      const value = result.fieldEvidence.find(
        ({ canonicalField }) => canonicalField === "location.alternative",
      )?.normalizedValue;
      expect(value?.kind).toBe("LOCATION");
      if (value?.kind !== "LOCATION") throw new Error("TEST_LOCATION_EVIDENCE_REQUIRED");
      expect(value.value.rawLabel).toBe(location);
      expect(value.value.locality?.length ?? 0).toBeLessThanOrEqual(200);
      expect(value.value.suburb?.length ?? 0).toBeLessThanOrEqual(200);
    },
  );

  it.each([999, 1000, 1001, 4097])(
    "uses the exact recognized token from a %i-character structured commitment",
    (length) => {
      const commitment = `Full-time ${"c".repeat(length - "Full-time ".length)}`;
      const structured = { employmentType: commitment };
      const result = normalizeR2AJobEvidence({
        sourceText: JSON.stringify(structured),
        sourceObservationId: `observation:structured-commitment:${length}`,
        structured,
      });
      const evidence = result.fieldEvidence.find(
        ({ canonicalField }) => canonicalField === "employment.type",
      );
      expect(evidence?.normalizedValue).toEqual({ kind: "EMPLOYMENT_TYPE", value: "FULL_TIME" });
      expect(evidence?.source.excerpt).toBe("Full-time");
    },
  );

  it("omits invalid numeric semantics instead of coercing or throwing", () => {
    const travel100 = normalizeR2AJobEvidence({
      sourceText: "Travel up to 100% may be required",
      sourceObservationId: "observation:travel-100",
    });
    expect(
      travel100.fieldEvidence.find(({ canonicalField }) => canonicalField === "travel.percentage")
        ?.normalizedValue,
    ).toMatchObject({ value: { percentage: 100 } });

    for (const percentage of [101, 150]) {
      const result = normalizeR2AJobEvidence({
        sourceText: `Travel up to ${percentage}% may be required`,
        sourceObservationId: `observation:travel-${percentage}`,
      });
      expect(
        result.fieldEvidence.some(({ canonicalField }) => canonicalField === "travel.percentage"),
      ).toBe(false);
    }

    const negative = normalizeR2AJobEvidence({
      sourceText:
        "Experience\n-5 years experience required\nHours\n-5 hours per week\nCommute -5 km or -10 minutes",
      sourceObservationId: "observation:negative-numeric",
    });
    const experience = negative.requirementEvidence.find(
      ({ normalizedValue }) => normalizedValue.kind === "EXPERIENCE",
    )?.normalizedValue;
    expect(experience?.kind).toBe("EXPERIENCE");
    if (experience?.kind !== "EXPERIENCE") throw new Error("TEST_EXPERIENCE_REQUIRED");
    expect(experience.value.minimum).toBeNull();
    expect(negative.fieldEvidence.some(({ family }) => family === "HOURS")).toBe(false);
    expect(
      negative.fieldEvidence.some(({ canonicalField }) => canonicalField.startsWith("commute.")),
    ).toBe(false);

    const nonFiniteDigits = "9".repeat(400);
    const nonFinite = normalizeR2AJobEvidence({
      sourceText: `${nonFiniteDigits} hours per week\nCommute ${nonFiniteDigits} km\nCommute ${nonFiniteDigits} minutes`,
      sourceObservationId: "observation:non-finite-numeric",
    });
    expect(
      nonFinite.fieldEvidence.some(
        ({ family, canonicalField }) => family === "HOURS" || canonicalField.startsWith("commute."),
      ),
    ).toBe(false);

    const reversed = normalizeR2AJobEvidence({
      sourceText: "20-10 hours per week\n5-2 years experience required\nSalary: AUD 50-10 per hour",
      sourceObservationId: "observation:reversed-numeric",
    });
    expect(reversed.fieldEvidence.some(({ family }) => family === "HOURS")).toBe(false);
    expect(
      reversed.requirementEvidence.find(
        ({ normalizedValue }) => normalizedValue.kind === "EXPERIENCE",
      )?.normalizedValue,
    ).toMatchObject({ value: { minimum: null, maximum: null } });
    expect(reversed.fieldEvidence.some(({ canonicalField }) => canonicalField === "salary")).toBe(
      false,
    );
  });

  it("omits unsupported structured salary semantics while retaining safe supported values", () => {
    const normalizeSalary = (baseSalary: Record<string, unknown>, id: string) => {
      const structured = { baseSalary };
      return normalizeR2AJobEvidence({
        sourceText: JSON.stringify(structured),
        sourceObservationId: `observation:salary-boundary:${id}`,
        structured,
      });
    };
    const zero = normalizeSalary(
      { currency: "AUD", value: { minValue: 0, maxValue: 0, unitText: "hour" } },
      "zero",
    );
    expect(
      zero.fieldEvidence.find(({ canonicalField }) => canonicalField === "salary")?.normalizedValue,
    ).toMatchObject({ value: { minimum: 0, maximum: 0, currency: "AUD", period: "HOUR" } });

    for (const [id, baseSalary] of [
      [
        "negative-min",
        { currency: "AUD", value: { minValue: -1, maxValue: 10, unitText: "hour" } },
      ],
      [
        "negative-max",
        { currency: "AUD", value: { minValue: 1, maxValue: -10, unitText: "hour" } },
      ],
      ["reverse", { currency: "AUD", value: { minValue: 10, maxValue: 1, unitText: "hour" } }],
    ] as const) {
      const result = normalizeSalary(baseSalary, id);
      expect(result.fieldEvidence.some(({ canonicalField }) => canonicalField === "salary")).toBe(
        false,
      );
    }

    const longOptional = normalizeSalary(
      {
        currency: "C".repeat(4097),
        value: { minValue: 1, maxValue: 2, unitText: "interval".repeat(600) },
      },
      "long-optional",
    );
    expect(
      longOptional.fieldEvidence.find(({ canonicalField }) => canonicalField === "salary")
        ?.normalizedValue,
    ).toMatchObject({ value: { minimum: 1, maximum: 2, currency: null, period: "UNKNOWN" } });
    expect(longOptional.fieldEvidence.some(({ source }) => source.excerpt.length > 1000)).toBe(
      false,
    );
  });
});
