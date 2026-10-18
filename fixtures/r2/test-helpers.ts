import { createHash } from "node:crypto";

import {
  JobFieldFamilySchema,
  R2A_PARSER_VERSION,
  R2A_NORMALIZATION_VERSION,
  R2A_EVIDENCE_CONTRACT_VERSION,
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
    extractorVersion: R2A_PARSER_VERSION,
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
    extractorVersion: R2A_PARSER_VERSION,
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
  partialFamilies?: R2JobFieldEvidence["family"][];
  conflicts?: R2ANormalization["conflicts"];
}): R2ANormalization {
  const fields = input.fields ?? [];
  const requirements = input.requirements ?? [];
  const unknown = new Set(input.unknownFamilies ?? []);
  const partial = new Set(input.partialFamilies ?? []);
  return R2ANormalizationSchema.parse({
    sourceObservationId: "observation-r2-fixture",
    sourceLength: sourceText.length,
    parserVersion: R2A_PARSER_VERSION,
    evidenceContractVersion: R2A_EVIDENCE_CONTRACT_VERSION,
    normalizationVersion: R2A_NORMALIZATION_VERSION,
    fieldEvidence: fields,
    requirementEvidence: requirements,
    conflicts: input.conflicts ?? [],
    coverage: JobFieldFamilySchema.options.map((family) => ({
      family,
      state: unknown.has(family)
        ? "UNKNOWN"
        : partial.has(family)
          ? "PARTIAL"
          : [
                ...fields.filter((item) => item.family === family),
                ...requirements.filter((item) => item.family === family),
              ].length > 0
            ? "COMPLETE"
            : "UNKNOWN",
      evidenceIds: [
        ...fields.filter((item) => item.family === family).map(({ id }) => id),
        ...requirements.filter((item) => item.family === family).map(({ id }) => id),
      ],
      unparsedSpans: [],
      parserVersion: R2A_PARSER_VERSION,
    })),
  });
}

export const currentR2Bindings = {
  jobVersionId: "job-version-current",
  currentJobVersionId: "job-version-current",
  profileVersionId: "profile-version-current",
  currentProfileVersionId: "profile-version-current",
  evidenceContractVersion: R2A_EVIDENCE_CONTRACT_VERSION,
  currentEvidenceContractVersion: R2A_EVIDENCE_CONTRACT_VERSION,
  evaluationVersionId: "evaluation-r2-current",
};
