import { CandidateProfileSchema, type CandidateProfile } from "@applypilot/candidate-profile";
import type { R2EvaluationBindings } from "@applypilot/eligibility-engine";
import type {
  R2ANormalization,
  R2JobFieldEvidence,
  R2RequirementEvidence,
} from "@applypilot/job-model";
import { testProfile } from "../../tests/fixture-data";

import type { R2GoldenCase } from "./manifest";
import {
  currentR2Bindings,
  r2FieldEvidence,
  r2RequirementEvidence,
  r2TestNormalization,
} from "./test-helpers";

export interface R2GoldenExecutableInput {
  profile: CandidateProfile;
  normalization: R2ANormalization;
  bindings: R2EvaluationBindings;
  commute: { distanceKm: number | null; durationMinutes: number | null };
}

function matchedSignals(count: number): {
  profile: CandidateProfile;
  requirements: R2RequirementEvidence[];
} {
  const skills = Array.from({ length: count }, (_, index) => ({
    id: `golden-skill-${index}`,
    name: `Golden verified signal ${index}`,
    level: "PROFICIENT" as const,
    evidence: "Fictional golden evidence",
    verification: "VERIFIED" as const,
  }));
  const profile = CandidateProfileSchema.parse({
    ...testProfile,
    skills: [...testProfile.skills, ...skills],
  });
  const requirements = skills.map((skill, index) =>
    r2RequirementEvidence(`golden-requirement-${index}`, "SKILLS", "SKILL", {
      kind: "TEXT",
      value: skill.name,
    }),
  );
  return { profile, requirements };
}

export function buildR2GoldenInput(fixture: R2GoldenCase): R2GoldenExecutableInput {
  const matched = matchedSignals(fixture.verifiedSignalCount);
  let profile = matched.profile;
  const fields: R2JobFieldEvidence[] = [];
  const requirements = [...matched.requirements];
  let unknownFamilies: R2JobFieldEvidence["family"][] = [];
  let conflicts: R2ANormalization["conflicts"] = [];
  let bindings: R2EvaluationBindings = { ...currentR2Bindings };
  const commute = { distanceKm: null as number | null, durationMinutes: null as number | null };

  switch (fixture.scenario) {
    case "VERIFIED_DISTANCE_MATCH":
      fields.push(
        r2FieldEvidence(
          "golden-commute-distance",
          "GEOGRAPHY",
          {
            kind: "VEHICLE_TRAVEL",
            value: {
              kind: "COMMUTE",
              percentage: null,
              location: null,
              distanceKm: 20,
              durationMinutes: null,
            },
          },
          { canonicalField: "commute.distance" },
        ),
      );
      commute.distanceKm = 20;
      break;
    case "UNKNOWN_REQUIREMENT":
      requirements.push(
        r2RequirementEvidence(
          "golden-unknown-skill",
          "SKILLS",
          "SKILL",
          { kind: "TEXT", value: "Customer service" },
          { state: "UNKNOWN", modality: "REQUIRED" },
        ),
      );
      break;
    case "CONDITIONAL_REQUIREMENT":
      requirements.push(
        r2RequirementEvidence(
          "golden-conditional-skill",
          "SKILLS",
          "SKILL",
          { kind: "TEXT", value: "Customer service" },
          {
            state: "CONDITIONAL",
            modality: "CONDITIONAL",
            condition: "Fictional condition requires review",
          },
        ),
      );
      break;
    case "VEHICLE_MISMATCH":
      requirements.push(
        r2RequirementEvidence("golden-own-vehicle", "VEHICLE", "VEHICLE", {
          kind: "VEHICLE_TRAVEL",
          value: {
            kind: "OWN_VEHICLE",
            percentage: null,
            location: null,
            distanceKm: null,
            durationMinutes: null,
          },
        }),
      );
      break;
    case "VERIFIED_SKILLS":
      break;
    case "STALE_BINDING":
      bindings = { ...bindings, currentJobVersionId: "golden-newer-job-version" };
      break;
    case "CONFLICTING_REQUIREMENT":
    case "DUPLICATE_AMBIGUITY": {
      const evidenceIds = ["golden-conflict-required", "golden-conflict-negated"];
      requirements.push(
        r2RequirementEvidence(
          evidenceIds[0],
          "SKILLS",
          "SKILL",
          { kind: "TEXT", value: "Customer service" },
          { state: "CONFLICTING", modality: "REQUIRED", conflictSetId: "golden-conflict" },
        ),
        r2RequirementEvidence(
          evidenceIds[1],
          "SKILLS",
          "SKILL",
          { kind: "TEXT", value: "Customer service" },
          { state: "CONFLICTING", modality: "NEGATED", conflictSetId: "golden-conflict" },
        ),
      );
      conflicts = [
        {
          id: "golden-conflict",
          canonicalField: "requirement:SKILL:customer service",
          evidenceIds,
        },
      ];
      break;
    }
    case "SPARSE_COVERAGE":
      unknownFamilies = [
        "GEOGRAPHY",
        "HOURS",
        "SCHEDULE",
        "EXPERIENCE",
        "EDUCATION",
        "LICENCES",
        "CERTIFICATIONS",
        "WORK_RIGHTS",
        "VEHICLE",
      ];
      break;
    case "UNKNOWN_WORK_RIGHTS":
      requirements.push(
        r2RequirementEvidence(
          "golden-unknown-work-rights",
          "WORK_RIGHTS",
          "WORK_RIGHTS",
          { kind: "UNKNOWN", value: null },
          { state: "UNKNOWN", modality: "REQUIRED" },
        ),
      );
      break;
    case "LICENCE_MISMATCH": {
      const licence = "Fictional regulated licence";
      profile = CandidateProfileSchema.parse({
        ...profile,
        unsupportedExperience: [...profile.unsupportedExperience, licence],
      });
      requirements.push(
        r2RequirementEvidence("golden-licence", "LICENCES", "LICENCE", {
          kind: "LICENCE_CERTIFICATION",
          value: {
            name: licence,
            type: "LICENCE",
            class: null,
            jurisdiction: "VIC",
            validityRequirement: "current",
            alternatives: [],
            condition: null,
          },
        }),
      );
      break;
    }
    case "VERIFIED_TIME_MATCH":
      profile = CandidateProfileSchema.parse({
        ...profile,
        transport: {
          ...profile.transport,
          maximumCommuteMinutes: { value: 60, verification: "VERIFIED" },
        },
      });
      fields.push(
        r2FieldEvidence(
          "golden-commute-duration",
          "GEOGRAPHY",
          {
            kind: "VEHICLE_TRAVEL",
            value: {
              kind: "COMMUTE",
              percentage: null,
              location: null,
              distanceKm: null,
              durationMinutes: 45,
            },
          },
          { canonicalField: "commute.duration" },
        ),
      );
      commute.durationMinutes = 45;
      break;
  }

  return {
    profile,
    normalization: r2TestNormalization({ fields, requirements, unknownFamilies, conflicts }),
    bindings,
    commute,
  };
}
