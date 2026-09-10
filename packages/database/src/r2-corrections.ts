import { createHash } from "node:crypto";

import {
  R2ANormalizationSchema,
  type Job,
  type R2ANormalization,
  type R2JobFieldEvidence,
  type R2NormalizedValue,
  type R2RequirementEvidence,
} from "@applypilot/job-model";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function r2CorrectionValueDigest(value: unknown): string {
  return digest(stableJson(value));
}

function ownerCorrectionR2Value(field: string, job: Job): R2NormalizedValue {
  if (field === "employmentType") {
    return { kind: "EMPLOYMENT_TYPE", value: job.employmentType };
  }
  if (field === "location") {
    return {
      kind: "LOCATION",
      value: {
        rawLabel: job.location,
        locality: job.suburb,
        suburb: job.suburb,
        stateOrTerritory: job.state,
        postcode: job.postcode,
        countryCode: job.country.toUpperCase() === "AUSTRALIA" ? "AU" : "UNKNOWN",
        workplaceType: "UNKNOWN",
        remoteScope: "UNKNOWN",
      },
    };
  }
  if (field === "hoursPerWeek" && job.hoursPerWeek) {
    return { kind: "HOURS", value: { ...job.hoursPerWeek, unit: "WEEK" } };
  }
  if (field === "hoursPerFortnight" && job.hoursPerFortnight) {
    return { kind: "HOURS", value: { ...job.hoursPerFortnight, unit: "FORTNIGHT" } };
  }
  if (field === "salary" && job.salary) {
    const { minimum, maximum } = job.salary;
    return {
      kind: "SALARY",
      value: {
        shape:
          minimum !== null && maximum !== null
            ? minimum === maximum
              ? "EXACT"
              : "RANGE"
            : minimum !== null
              ? "FROM"
              : maximum !== null
                ? "UP_TO"
                : "UNKNOWN",
        minimum,
        maximum,
        currency: job.salary.currency,
        period: job.salary.period,
        superannuation: "UNKNOWN",
        commission: false,
        bonus: false,
      },
    };
  }
  if (field === "schedule") {
    const first = job.schedule.shifts[0];
    return {
      kind: "SCHEDULE",
      value: {
        days: [...new Set(job.schedule.shifts.map(({ day }) => day))],
        startTime: first?.startTime ?? null,
        endTime: first?.endTime ?? null,
        rosterType:
          job.schedule.rosterType === "VARIABLE"
            ? "ROTATING"
            : (job.schedule.rosterType ?? (job.schedule.fixed ? "FIXED" : "UNKNOWN")),
        overnight: first === undefined ? null : first.endTime.localeCompare(first.startTime) <= 0,
        timezone: job.schedule.timezone ?? null,
        exceptions: [],
      },
    };
  }
  if (field === "trainingProvided") {
    return {
      kind: "TRAINING",
      value: {
        state:
          job.trainingProvided === true
            ? "PROVIDED"
            : job.trainingProvided === false
              ? "NOT_PROVIDED"
              : "UNKNOWN",
        name: null,
      },
    };
  }
  if (field === "documentRequirements" || field === "coverLetterRequired") {
    return {
      kind: "DOCUMENT",
      value: {
        documentKind: "COVER_LETTER",
        state: job.documentRequirements.coverLetterRequired ? "REQUIRED" : "NOT_REQUIRED",
        name: null,
      },
    };
  }
  const value = (job as unknown as Record<string, unknown>)[field];
  return {
    kind: "TEXT",
    value: typeof value === "string" && value ? value : JSON.stringify(value),
  };
}

export function ownerCorrectedR2Normalization(input: {
  prior: R2ANormalization;
  job: Job;
  changedFields: Set<string>;
  correctionId: string;
}): R2ANormalization {
  const effective = new Map<
    string,
    { canonicalField: string; family: R2JobFieldEvidence["family"] }
  >();
  const correctedRequirementFields = new Set(
    [...input.changedFields].filter((field) =>
      [
        "requirements",
        "preferredRequirements",
        "requiredSkills",
        "workRightsRequirement",
        "vehicleRequirement",
      ].includes(field),
    ),
  );
  for (const field of input.changedFields) {
    if (["suburb", "state", "postcode", "country"].includes(field)) {
      effective.set("location", { canonicalField: "location.alternative", family: "GEOGRAPHY" });
    } else if (field === "location") {
      effective.set(field, { canonicalField: "location.alternative", family: "GEOGRAPHY" });
    } else if (field === "employmentType") {
      effective.set(field, { canonicalField: "employment.type", family: "EMPLOYMENT" });
    } else if (["hoursPerWeek", "hoursPerFortnight"].includes(field)) {
      effective.set(field, { canonicalField: field, family: "HOURS" });
    } else if (field === "schedule") {
      effective.set(field, { canonicalField: field, family: "SCHEDULE" });
    } else if (field === "salary") {
      effective.set(field, { canonicalField: field, family: "COMPENSATION" });
    } else if (field === "trainingProvided") {
      effective.set(field, { canonicalField: field, family: "TRAINING" });
    } else if (["documentRequirements", "coverLetterRequired"].includes(field)) {
      effective.set(field, { canonicalField: field, family: "DOCUMENTS" });
    } else if (["title", "company", "category", "description"].includes(field)) {
      effective.set(field, { canonicalField: field, family: "IDENTITY" });
    }
  }
  if (effective.size === 0 && correctedRequirementFields.size === 0) return input.prior;
  const affectedCanonical = new Set(
    [...effective.values()].map(({ canonicalField }) => canonicalField),
  );
  const removedIds = new Set(
    input.prior.fieldEvidence
      .filter(({ canonicalField }) => affectedCanonical.has(canonicalField))
      .map(({ id }) => id),
  );
  const removeRequirementFamilies = new Set<R2RequirementEvidence["family"]>();
  if (
    correctedRequirementFields.has("requirements") ||
    correctedRequirementFields.has("preferredRequirements") ||
    correctedRequirementFields.has("requiredSkills")
  ) {
    removeRequirementFamilies.add("SKILLS");
  }
  if (correctedRequirementFields.has("workRightsRequirement")) {
    removeRequirementFamilies.add("WORK_RIGHTS");
  }
  if (correctedRequirementFields.has("vehicleRequirement")) {
    removeRequirementFamilies.add("VEHICLE");
  }
  const removedRequirementIds = new Set(
    input.prior.requirementEvidence
      .filter(({ family }) => removeRequirementFamilies.has(family))
      .map(({ id }) => id),
  );
  const removedConflictIds = new Set(
    input.prior.conflicts
      .filter(({ evidenceIds }) =>
        evidenceIds.some((id) => removedIds.has(id) || removedRequirementIds.has(id)),
      )
      .map(({ id }) => id),
  );
  const carried = input.prior.fieldEvidence
    .filter(({ id }) => !removedIds.has(id))
    .map((item) =>
      item.conflictSetId && removedConflictIds.has(item.conflictSetId)
        ? { ...item, state: "SOURCE_STATED" as const, conflictSetId: null }
        : item,
    );
  const emptyHash = digest("");
  const corrected = [...effective].map(
    ([field, descriptor]): R2JobFieldEvidence => ({
      id: digest(`${input.correctionId}\n${descriptor.canonicalField}`).slice(0, 32),
      sourceObservationId: input.prior.sourceObservationId,
      jobVersionId: null,
      family: descriptor.family,
      canonicalField: descriptor.canonicalField,
      state: "OWNER_CORRECTED",
      modality: null,
      source: {
        sourcePath: `ownerCorrection.${field}`,
        start: 0,
        end: 0,
        sourceLength: input.prior.sourceLength,
        excerpt: "",
        excerptHash: emptyHash,
      },
      normalizedValue: ownerCorrectionR2Value(field, input.job),
      extractorVersion: input.prior.parserVersion,
      ruleId: "R2A_OWNER_CORRECTED",
      derivationInputIds: [],
      ownerCorrectionId: input.correctionId,
      conflictSetId: null,
    }),
  );
  const correctedRequirements: R2RequirementEvidence[] = [];
  const emptyPointer = (field: string, index: number) => ({
    sourcePath: `ownerCorrection.${field}.${index}`,
    start: 0,
    end: 0,
    sourceLength: input.prior.sourceLength,
    excerpt: "",
    excerptHash: emptyHash,
  });
  const addTextRequirements = (
    field: "requirements" | "preferredRequirements" | "requiredSkills",
    values: string[],
    modality: "REQUIRED" | "PREFERRED",
  ) => {
    values.forEach((value, index) => {
      correctedRequirements.push({
        id: digest(`${input.correctionId}\n${field}\n${index}`).slice(0, 32),
        sourceObservationId: input.prior.sourceObservationId,
        jobVersionId: null,
        family: "SKILLS",
        canonicalKind: "SKILL",
        state: "OWNER_CORRECTED",
        modality,
        condition: null,
        source: emptyPointer(field, index),
        normalizedValue: { kind: "TEXT", value },
        extractorVersion: input.prior.parserVersion,
        ruleId: "R2A_OWNER_CORRECTED_REQUIREMENT",
        derivationInputIds: [],
        ownerCorrectionId: input.correctionId,
        conflictSetId: null,
      });
    });
  };
  if (correctedRequirementFields.has("requirements")) {
    addTextRequirements("requirements", input.job.requirements, "REQUIRED");
  }
  if (correctedRequirementFields.has("requiredSkills")) {
    addTextRequirements("requiredSkills", input.job.requiredSkills, "REQUIRED");
  }
  if (correctedRequirementFields.has("preferredRequirements")) {
    addTextRequirements("preferredRequirements", input.job.preferredRequirements, "PREFERRED");
  }
  if (correctedRequirementFields.has("workRightsRequirement")) {
    const value = input.job.workRightsRequirement;
    correctedRequirements.push({
      id: digest(`${input.correctionId}\nworkRightsRequirement`).slice(0, 32),
      sourceObservationId: input.prior.sourceObservationId,
      jobVersionId: null,
      family: "WORK_RIGHTS",
      canonicalKind: "WORK_RIGHTS",
      state: value === "NOT_SPECIFIED" || value === "UNKNOWN" ? "UNKNOWN" : "OWNER_CORRECTED",
      modality: value === "NOT_SPECIFIED" || value === "UNKNOWN" ? "UNKNOWN" : "REQUIRED",
      condition: null,
      source: emptyPointer("workRightsRequirement", 0),
      normalizedValue: {
        kind: "WORK_RIGHTS",
        value: {
          kind:
            value === "VALID_AUSTRALIA"
              ? "VALID_AUSTRALIAN_WORK_RIGHTS"
              : value === "UNRESTRICTED_AUSTRALIA"
                ? "UNRESTRICTED_WORK_RIGHTS"
                : "UNKNOWN",
          wording: null,
          condition: null,
        },
      },
      extractorVersion: input.prior.parserVersion,
      ruleId: "R2A_OWNER_CORRECTED_REQUIREMENT",
      derivationInputIds: [],
      ownerCorrectionId: input.correctionId,
      conflictSetId: null,
    });
  }
  if (correctedRequirementFields.has("vehicleRequirement")) {
    const value = input.job.vehicleRequirement;
    correctedRequirements.push({
      id: digest(`${input.correctionId}\nvehicleRequirement`).slice(0, 32),
      sourceObservationId: input.prior.sourceObservationId,
      jobVersionId: null,
      family: "VEHICLE",
      canonicalKind: "VEHICLE",
      state: value === "UNKNOWN" ? "UNKNOWN" : "OWNER_CORRECTED",
      modality:
        value === "REQUIRED" ? "REQUIRED" : value === "NOT_REQUIRED" ? "NEGATED" : "UNKNOWN",
      condition: null,
      source: emptyPointer("vehicleRequirement", 0),
      normalizedValue: {
        kind: "VEHICLE_TRAVEL",
        value: {
          kind: "OWN_VEHICLE",
          percentage: null,
          location: null,
          distanceKm: null,
          durationMinutes: null,
        },
      },
      extractorVersion: input.prior.parserVersion,
      ruleId: "R2A_OWNER_CORRECTED_REQUIREMENT",
      derivationInputIds: [],
      ownerCorrectionId: input.correctionId,
      conflictSetId: null,
    });
  }
  const fieldEvidence = [...carried, ...corrected];
  const requirementEvidence = [
    ...input.prior.requirementEvidence.filter(({ id }) => !removedRequirementIds.has(id)),
    ...correctedRequirements,
  ];
  const coverage = input.prior.coverage.map((item) => {
    const additions = [
      ...corrected.filter(({ family }) => family === item.family).map(({ id }) => id),
      ...correctedRequirements.filter(({ family }) => family === item.family).map(({ id }) => id),
    ];
    return {
      ...item,
      state: additions.length > 0 && item.state === "UNKNOWN" ? ("PARTIAL" as const) : item.state,
      evidenceIds: [
        ...item.evidenceIds.filter((id) => !removedIds.has(id) && !removedRequirementIds.has(id)),
        ...additions,
      ],
    };
  });
  return R2ANormalizationSchema.parse({
    ...input.prior,
    fieldEvidence,
    requirementEvidence,
    conflicts: input.prior.conflicts.filter(({ id }) => !removedConflictIds.has(id)),
    coverage,
  });
}
