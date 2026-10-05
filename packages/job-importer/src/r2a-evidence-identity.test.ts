import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { R2JobFieldEvidenceSchema, R2RequirementEvidenceSchema } from "@applypilot/job-model";
import {
  createSourcePersistenceDiagnostic,
  R2AFailureDiagnosticSchema,
} from "@applypilot/job-sources";
import { R2ADiagnosticError, r2aStructuralMetrics } from "./r2a-diagnostics";
import {
  fieldEvidenceId,
  requirementEvidenceId,
  resolveR2AEvidenceIds,
} from "./r2a-evidence-identity";

const marker = "fictional";
const excerptHash = createHash("sha256").update(marker).digest("hex");

function fieldIdentity(sourcePath = "structured.description.item.0") {
  return {
    parserVersion: "3.6.2",
    observationId: "fictional-observation",
    family: "EMPLOYMENT" as const,
    canonicalField: "employment.type",
    sourcePath,
    start: 101,
    end: 110,
    ruleId: "R2A_STRUCTURED_EMPLOYMENT",
    state: "SOURCE_STATED" as const,
    modality: null,
    derivationInputIds: [],
    normalizedValue: { kind: "EMPLOYMENT_TYPE" as const, value: "FULL_TIME" as const },
  };
}

function fieldEvidence(
  sourcePath = "structured.description.item.0",
  canonicalField = "employment.type",
) {
  return R2JobFieldEvidenceSchema.parse({
    id: "a".repeat(32),
    sourceObservationId: "fictional-observation",
    jobVersionId: null,
    family: "EMPLOYMENT",
    canonicalField,
    state: "SOURCE_STATED",
    modality: null,
    source: {
      sourcePath,
      start: 101,
      end: 110,
      sourceLength: 300,
      excerpt: marker,
      excerptHash,
    },
    normalizedValue: { kind: "EMPLOYMENT_TYPE", value: "FULL_TIME" },
    extractorVersion: "3.6.2",
    ruleId: "R2A_STRUCTURED_EMPLOYMENT",
    derivationInputIds: [],
    ownerCorrectionId: null,
    conflictSetId: null,
  });
}

function requirementEvidence(id: string) {
  return R2RequirementEvidenceSchema.parse({
    id,
    sourceObservationId: "fictional-observation",
    jobVersionId: null,
    family: "SKILLS",
    canonicalKind: "SKILL",
    state: "SOURCE_STATED",
    modality: "REQUIRED",
    condition: null,
    source: {
      sourcePath: "structured.description.item.0",
      start: 101,
      end: 110,
      sourceLength: 300,
      excerpt: marker,
      excerptHash,
    },
    normalizedValue: { kind: "TEXT", value: marker },
    extractorVersion: "3.6.2",
    ruleId: "R2A_SKILL_REQUIRED",
    derivationInputIds: [],
    ownerCorrectionId: null,
    conflictSetId: null,
  });
}

const metrics = () => r2aStructuralMetrics({ description: marker }, 300, 300);

describe("R2A deterministic evidence identity", () => {
  it("separates logical source paths that share the old identity inputs", () => {
    const first = fieldIdentity("structured.description.item.0");
    const second = fieldIdentity("structured.description.item.1");
    expect([
      first.parserVersion,
      first.observationId,
      first.canonicalField,
      first.start,
      first.normalizedValue,
    ]).toEqual([
      second.parserVersion,
      second.observationId,
      second.canonicalField,
      second.start,
      second.normalizedValue,
    ]);
    expect(fieldEvidenceId(first)).not.toBe(fieldEvidenceId(second));
    expect(fieldEvidenceId(first)).toBe(fieldEvidenceId(first));
  });

  it("includes the remaining field and requirement identity components", () => {
    const field = fieldIdentity();
    expect(fieldEvidenceId(field)).not.toBe(fieldEvidenceId({ ...field, end: field.end + 1 }));
    expect(fieldEvidenceId(field)).not.toBe(fieldEvidenceId({ ...field, ruleId: "R2A_OTHER" }));
    expect(fieldEvidenceId(field)).not.toBe(fieldEvidenceId({ ...field, state: "DERIVED" }));

    const requirement = {
      parserVersion: "3.6.2",
      observationId: "fictional-observation",
      family: "SKILLS" as const,
      canonicalKind: "SKILL" as const,
      sourcePath: "structured.description.item.0",
      start: 101,
      end: 110,
      ruleId: "R2A_SKILL_REQUIRED",
      state: "SOURCE_STATED" as const,
      modality: "REQUIRED" as const,
      condition: null,
      normalizedValueOrdinal: 0,
      normalizedValue: { kind: "TEXT" as const, value: marker },
    };
    expect(requirementEvidenceId(requirement)).not.toBe(
      requirementEvidenceId({ ...requirement, normalizedValueOrdinal: 1 }),
    );
    expect(requirementEvidenceId(requirement)).not.toBe(fieldEvidenceId(field));
    expect(requirementEvidenceId(requirement)).toBe(requirementEvidenceId(requirement));
  });

  it("deduplicates only identical full semantic evidence rows", () => {
    const evidence = fieldEvidence();
    const resolved = resolveR2AEvidenceIds({
      fields: [evidence, structuredClone(evidence)],
      requirements: [],
      metrics: metrics(),
    });
    expect(resolved.fields).toHaveLength(1);
    expect(resolved.fields[0]).toEqual(evidence);
  });

  it("fails closed with structural-only details for non-identical rows sharing an ID", () => {
    const first = fieldEvidence("structured.description.item.0");
    const second = fieldEvidence("structured.description.item.1");
    let failure: R2ADiagnosticError | null = null;
    try {
      resolveR2AEvidenceIds({ fields: [first, second], requirements: [], metrics: metrics() });
    } catch (error) {
      if (error instanceof R2ADiagnosticError) failure = error;
      else throw error;
    }

    expect(failure?.message).toBe("R2A_EVIDENCE_ID_COLLISION");
    expect(failure?.r2aDiagnostic).toMatchObject({
      subphase: "R2A_EVIDENCE_ID_RESOLUTION",
      duplicateEvidenceIdGroups: [
        {
          duplicateCount: 2,
          identities: [
            {
              domain: "FIELD",
              family: "EMPLOYMENT",
              canonicalField: "employment.type",
              canonicalKind: null,
              sourcePath: "structured.description.item.0",
              start: 101,
              end: 110,
              ruleId: "R2A_STRUCTURED_EMPLOYMENT",
              state: "SOURCE_STATED",
              normalizedValueKind: "EMPLOYMENT_TYPE",
            },
            {
              domain: "FIELD",
              family: "EMPLOYMENT",
              canonicalField: "employment.type",
              canonicalKind: null,
              sourcePath: "structured.description.item.1",
              start: 101,
              end: 110,
              ruleId: "R2A_STRUCTURED_EMPLOYMENT",
              state: "SOURCE_STATED",
              normalizedValueKind: "EMPLOYMENT_TYPE",
            },
          ],
          identitiesTruncated: false,
        },
      ],
      duplicateEvidenceIdGroupsTruncated: false,
    });
    expect(JSON.stringify(failure?.r2aDiagnostic)).not.toContain(marker);
  });

  it("detects ID reuse across FIELD and REQUIREMENT domains", () => {
    const field = fieldEvidence();
    const requirement = requirementEvidence(field.id);
    expect(() =>
      resolveR2AEvidenceIds({
        fields: [field],
        requirements: [requirement],
        metrics: metrics(),
      }),
    ).toThrow("R2A_EVIDENCE_ID_COLLISION");
  });

  it("redacts provider-controlled path and field tokens before audit persistence", () => {
    const first = fieldEvidence(`structured.description.${marker}.item.0`, marker);
    const second = fieldEvidence(`structured.description.${marker}.item.1`, marker);
    let failure: R2ADiagnosticError | null = null;
    try {
      resolveR2AEvidenceIds({ fields: [first, second], requirements: [], metrics: metrics() });
    } catch (error) {
      if (error instanceof R2ADiagnosticError) failure = error;
      else throw error;
    }
    expect(failure).not.toBeNull();

    const serializedFailure = JSON.stringify(failure!.r2aDiagnostic);
    expect(serializedFailure).not.toContain(marker);
    expect(serializedFailure).toContain("structured.description.FIELD.item.0");
    expect(serializedFailure).toContain("UNSAFE_FIELD");

    const persisted = createSourcePersistenceDiagnostic({
      phase: "R2A_NORMALIZATION",
      recordIndex: 18,
      externalId: "fictional-record",
      provider: "GREENHOUSE",
      error: failure,
      pageProviderRecordCount: 29,
      acceptedRecordCount: 29,
      unusableRecordCount: 0,
    });
    expect(JSON.stringify(persisted)).not.toContain(marker);
    expect(persisted.r2a?.duplicateEvidenceIdGroups?.length).toBe(1);

    const unsafe = {
      ...failure!.r2aDiagnostic,
      duplicateEvidenceIdGroups: failure!.r2aDiagnostic.duplicateEvidenceIdGroups!.map((group) => ({
        ...group,
        identities: group.identities.map((identity, index) =>
          index === 0
            ? {
                ...identity,
                canonicalField: marker,
                sourcePath: `structured.description.${marker}`,
              }
            : identity,
        ),
      })),
    };
    expect(R2AFailureDiagnosticSchema.safeParse(unsafe).success).toBe(false);
  });
});
