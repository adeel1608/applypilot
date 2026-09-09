import { createHash } from "node:crypto";

import {
  JobFieldFamilySchema,
  R2ANormalizationSchema,
  type R2ANormalization,
  type R2JobFieldEvidence,
  type R2RequirementEvidence,
} from "@applypilot/job-model";

const sourceText = "fictional evidence";
const source = {
  sourcePath: "fixture.text",
  start: 0,
  end: sourceText.length,
  sourceLength: sourceText.length,
  excerpt: sourceText,
  excerptHash: createHash("sha256").update(sourceText).digest("hex"),
};

export function r2FieldEvidence(
  id: string,
  family: R2JobFieldEvidence["family"],
  normalizedValue: R2JobFieldEvidence["normalizedValue"],
  input: Partial<R2JobFieldEvidence> = {},
): R2JobFieldEvidence {
  return {
    id,
    sourceObservationId: "observation-r2-fixture",
    jobVersionId: "job-version-current",
    family,
    canonicalField: `${family.toLocaleLowerCase("en-AU")}.fixture`,
    state: "SOURCE_STATED",
    modality: null,
    source,
    normalizedValue,
    extractorVersion: "3.1.0",
    ruleId: "R2_FIXTURE_FIELD",
    derivationInputIds: [],
    ownerCorrectionId: null,
    conflictSetId: null,
    ...input,
  };
}

export function r2RequirementEvidence(
  id: string,
  family: R2RequirementEvidence["family"],
  canonicalKind: R2RequirementEvidence["canonicalKind"],
  normalizedValue: R2RequirementEvidence["normalizedValue"],
  input: Partial<R2RequirementEvidence> = {},
): R2RequirementEvidence {
  return {
    id,
    sourceObservationId: "observation-r2-fixture",
    jobVersionId: "job-version-current",
    family,
    canonicalKind,
    state: "SOURCE_STATED",
    modality: "REQUIRED",
    condition: null,
    source,
    normalizedValue,
    extractorVersion: "3.1.0",
    ruleId: "R2_FIXTURE_REQUIREMENT",
    derivationInputIds: [],
    ownerCorrectionId: null,
    conflictSetId: null,
    ...input,
  };
}

export function r2TestNormalization(input: {
  fields?: R2JobFieldEvidence[];
  requirements?: R2RequirementEvidence[];
  unknownFamilies?: R2JobFieldEvidence["family"][];
  conflicts?: R2ANormalization["conflicts"];
}): R2ANormalization {
  const fields = input.fields ?? [];
  const requirements = input.requirements ?? [];
  const unknown = new Set(input.unknownFamilies ?? []);
  return R2ANormalizationSchema.parse({
    sourceObservationId: "observation-r2-fixture",
    sourceLength: sourceText.length,
    parserVersion: "3.1.0",
    evidenceContractVersion: "3.1.0",
    normalizationVersion: "3.1.0",
    fieldEvidence: fields,
    requirementEvidence: requirements,
    conflicts: input.conflicts ?? [],
    coverage: JobFieldFamilySchema.options.map((family) => ({
      family,
      state: unknown.has(family) ? "UNKNOWN" : "PARTIAL",
      evidenceIds: [
        ...fields.filter((item) => item.family === family).map(({ id }) => id),
        ...requirements.filter((item) => item.family === family).map(({ id }) => id),
      ],
      unparsedSpans: [],
      parserVersion: "3.1.0",
    })),
  });
}

export const currentR2Bindings = {
  jobVersionId: "job-version-current",
  currentJobVersionId: "job-version-current",
  profileVersionId: "profile-version-current",
  currentProfileVersionId: "profile-version-current",
  evidenceContractVersion: "3.1.0",
  currentEvidenceContractVersion: "3.1.0",
  evaluationVersionId: "evaluation-r2-current",
};
