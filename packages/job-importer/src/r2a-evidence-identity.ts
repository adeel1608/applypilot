import { createHash } from "node:crypto";

import type {
  R2AEvidenceCollisionGroup,
  R2AEvidenceCollisionIdentity,
  R2AStructuralMetrics,
} from "@applypilot/job-sources";
import type { R2JobFieldEvidence, R2RequirementEvidence } from "@applypilot/job-model";
import { R2ADiagnosticError } from "./r2a-diagnostics";

type FieldEvidenceIdentity = {
  parserVersion: string;
  observationId: string;
  family: R2JobFieldEvidence["family"];
  canonicalField: string;
  sourcePath: string;
  start: number;
  end: number;
  ruleId: string;
  state: "SOURCE_STATED" | "DERIVED";
  modality: R2JobFieldEvidence["modality"];
  derivationInputIds: string[];
  normalizedValue: R2JobFieldEvidence["normalizedValue"];
};

type RequirementEvidenceIdentity = {
  parserVersion: string;
  observationId: string;
  family: R2RequirementEvidence["family"];
  canonicalKind: R2RequirementEvidence["canonicalKind"];
  sourcePath: string;
  start: number;
  end: number;
  ruleId: string;
  state: "SOURCE_STATED";
  modality: R2RequirementEvidence["modality"];
  condition: string | null;
  normalizedValueOrdinal: number;
  normalizedValue: R2RequirementEvidence["normalizedValue"];
};

function evidenceId(domain: "FIELD" | "REQUIREMENT", identity: readonly unknown[]): string {
  const encoded = JSON.stringify(["R2A_EVIDENCE_ID", domain, ...identity]);
  return createHash("sha256").update(encoded).digest("hex").slice(0, 32);
}

export function fieldEvidenceId(identity: FieldEvidenceIdentity): string {
  return evidenceId("FIELD", [
    identity.parserVersion,
    identity.observationId,
    identity.family,
    identity.canonicalField,
    identity.sourcePath,
    identity.start,
    identity.end,
    identity.ruleId,
    identity.state,
    identity.modality,
    identity.derivationInputIds,
    identity.normalizedValue,
  ]);
}

export function requirementEvidenceId(identity: RequirementEvidenceIdentity): string {
  return evidenceId("REQUIREMENT", [
    identity.parserVersion,
    identity.observationId,
    identity.family,
    identity.canonicalKind,
    identity.sourcePath,
    identity.start,
    identity.end,
    identity.ruleId,
    identity.state,
    identity.modality,
    identity.normalizedValueOrdinal,
    identity.condition,
    identity.normalizedValue,
  ]);
}

type TaggedEvidence =
  | { domain: "FIELD"; evidence: R2JobFieldEvidence }
  | { domain: "REQUIREMENT"; evidence: R2RequirementEvidence };

function semanticIdentity({ evidence }: TaggedEvidence): string {
  const semantic = Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== "id"));
  return JSON.stringify(semantic);
}

const safeSourcePathSegments = new Set([
  "structured",
  "visibleText",
  "sections",
  "description",
  "item",
  "clause",
  "chunk",
  "line",
  "extract",
  "derived",
  "sourceSections",
  "content",
  "title",
  "name",
  "hiringOrganization",
  "legalName",
  "company",
  "jobLocation",
  "location",
  "address",
  "addressLocality",
  "addressRegion",
  "postalCode",
  "addressCountry",
  "streetAddress",
  "text",
  "applicantLocationRequirements",
  "employmentType",
  "workHours",
  "baseSalary",
  "salaryText",
  "hoursText",
  "datePosted",
  "validThrough",
  "value",
  "minValue",
  "maxValue",
  "currency",
  "unitText",
  "salaryCurrency",
  "minimumSalary",
  "maximumSalary",
  "jobBenefits",
  "workplaceType",
  "requirements",
  "responsibilities",
  "qualifications",
  "experienceRequirements",
  "educationRequirements",
]);
const safeEvidenceFamilies = new Set([
  "IDENTITY",
  "GEOGRAPHY",
  "EMPLOYMENT",
  "HOURS",
  "SCHEDULE",
  "COMPENSATION",
  "DATES",
  "SKILLS",
  "EXPERIENCE",
  "EDUCATION",
  "LICENCES",
  "CERTIFICATIONS",
  "WORK_RIGHTS",
  "VEHICLE",
  "PHYSICAL_REQUIREMENTS",
  "TRAINING",
  "DOCUMENTS",
]);
const safeCanonicalFields = new Set([
  "title",
  "company",
  "location.alternative",
  "location.region",
  "location.locality",
  "location.state",
  "location.postcode",
  "location.country",
  "employment.type",
  "dates.posted",
  "dates.closing",
  "hours.structured",
  "hours.day",
  "hours.week",
  "hours.fortnight",
  "hours.month",
  "hours.unknown",
  "salary",
  "salary.minimum",
  "salary.maximum",
  "salary.currency",
  "salary.period",
  "schedule",
  "documents.cvResume",
  "documents.coverLetter",
  "documents.selectionCriteria",
  "documents.portfolio",
  "documents.transcript",
  "documents.licenceCertificateCopy",
  "commute.duration",
  "commute.distance",
  "travel.percentage",
  "training",
]);

function safeDiagnosticSourcePath(sourcePath: string): string {
  if (sourcePath.length > 256) return "UNSAFE_PATH";
  const segments = sourcePath.split(".");
  if (segments.length > 32) return "UNSAFE_PATH";
  return segments
    .map((segment) => {
      if (safeSourcePathSegments.has(segment) || /^(?:0|[1-9]\d{0,5})$/.test(segment)) {
        return segment;
      }
      const indexedProperty = /^([A-Za-z][A-Za-z0-9_]*)\[(?:0|[1-9]\d{0,5})\]$/.exec(segment);
      if (indexedProperty && safeSourcePathSegments.has(indexedProperty[1]!)) return segment;
      const extractedFamily = /^extract\[([A-Z_]+)\]$/.exec(segment);
      if (extractedFamily && safeEvidenceFamilies.has(extractedFamily[1]!)) return segment;
      return "FIELD";
    })
    .join(".");
}

function safeDiagnosticCanonicalField(
  canonicalField: string,
): Exclude<R2AEvidenceCollisionIdentity["canonicalField"], null> {
  return safeCanonicalFields.has(canonicalField)
    ? (canonicalField as Exclude<R2AEvidenceCollisionIdentity["canonicalField"], null>)
    : "UNSAFE_FIELD";
}

function safeRuleId(ruleId: string): string {
  return ruleId.length <= 128 && /^[A-Z0-9_]+$/.test(ruleId) ? ruleId : "UNSAFE_RULE";
}

function diagnosticIdentity(item: TaggedEvidence): R2AEvidenceCollisionIdentity {
  if (item.domain === "FIELD") {
    const evidence = item.evidence;
    return {
      domain: "FIELD",
      family: evidence.family,
      canonicalField: safeDiagnosticCanonicalField(evidence.canonicalField),
      canonicalKind: null,
      sourcePath: safeDiagnosticSourcePath(evidence.source.sourcePath),
      start: evidence.source.start,
      end: evidence.source.end,
      ruleId: safeRuleId(evidence.ruleId),
      state: evidence.state,
      normalizedValueKind: evidence.normalizedValue.kind,
    };
  }
  const evidence = item.evidence;
  return {
    domain: "REQUIREMENT",
    family: evidence.family,
    canonicalField: null,
    canonicalKind: evidence.canonicalKind,
    sourcePath: safeDiagnosticSourcePath(evidence.source.sourcePath),
    start: evidence.source.start,
    end: evidence.source.end,
    ruleId: safeRuleId(evidence.ruleId),
    state: evidence.state,
    normalizedValueKind: evidence.normalizedValue.kind,
  };
}

function collisionError(
  groups: TaggedEvidence[][],
  metrics: R2AStructuralMetrics,
): R2ADiagnosticError {
  const maximumGroups = 16;
  const maximumIdentitiesPerGroup = 16;
  const duplicateEvidenceIdGroups: R2AEvidenceCollisionGroup[] = groups
    .slice(0, maximumGroups)
    .map((group) => ({
      duplicateCount: group.length,
      identities: group.slice(0, maximumIdentitiesPerGroup).map(diagnosticIdentity),
      identitiesTruncated: group.length > maximumIdentitiesPerGroup,
    }));
  const duplicateEvidenceIdGroupsTruncated =
    groups.length > maximumGroups ||
    duplicateEvidenceIdGroups.some(({ identitiesTruncated }) => identitiesTruncated);
  return new R2ADiagnosticError(
    {
      subphase: "R2A_EVIDENCE_ID_RESOLUTION",
      rangeErrorClass: null,
      structuralBudget: null,
      metrics,
      duplicateEvidenceIdGroups,
      duplicateEvidenceIdGroupsTruncated,
    },
    "R2A_EVIDENCE_ID_COLLISION",
  );
}

export function resolveR2AEvidenceIds(input: {
  fields: R2JobFieldEvidence[];
  requirements: R2RequirementEvidence[];
  metrics: R2AStructuralMetrics;
}): { fields: R2JobFieldEvidence[]; requirements: R2RequirementEvidence[] } {
  const groups = new Map<string, TaggedEvidence[]>();
  for (const evidence of input.fields) {
    const group = groups.get(evidence.id) ?? [];
    group.push({ domain: "FIELD", evidence });
    groups.set(evidence.id, group);
  }
  for (const evidence of input.requirements) {
    const group = groups.get(evidence.id) ?? [];
    group.push({ domain: "REQUIREMENT", evidence });
    groups.set(evidence.id, group);
  }

  const collisions = [...groups.values()].filter((group) => {
    if (group.length < 2) return false;
    const identity = semanticIdentity(group[0]!);
    return group.some(
      (item) => item.domain !== group[0]!.domain || semanticIdentity(item) !== identity,
    );
  });
  if (collisions.length > 0) throw collisionError(collisions, input.metrics);

  const seen = new Set<string>();
  const fields = input.fields.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  const requirements = input.requirements.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return { fields, requirements };
}
