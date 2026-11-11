import { type CandidateProfile } from "@applypilot/candidate-profile";
import type { R2RequirementEvidence } from "@applypilot/job-model";
import {
  supportsR2CapabilityText,
  wholeR2CapabilityLabel,
  isR2ExplicitlyUnsupported,
  r2FactReference,
  r2SemanticFactKey,
  r2VerifiedSkillFacts,
  r2RequirementHasExcludedScope,
} from "./r2-capability-evidence";
export { supportsR2CapabilityText } from "./r2-capability-evidence";

export interface R2CapabilityMatch {
  reference: string;
  kind: "SKILL" | "EXPERIENCE" | "EDUCATION";
  references: string[];
  semanticKey: string;
}

function wholeCapabilityLabel(fact: string, required: string): boolean {
  return wholeR2CapabilityLabel(fact, required);
}

function employmentSupports(fact: string, required: string): boolean {
  // This affirmative modifier narrows the candidate's assertion; it does not
  // allow a bare skill to satisfy a requirement for independent work.
  fact = fact.replace(/\s+without supervision\s*[.!]?$/i, "");
  if (!supportsR2CapabilityText(fact, required)) return false;
  if (wholeCapabilityLabel(fact, required)) return true;
  const direct =
    fact.match(/^used\s+(.+)$/i) ??
    fact.match(
      /^(?:operated|programmed|developed|implemented|designed|built|created|tested|maintained)\b[^.!?;\n]*\b(?:using|with|in)\s+(.+)$/i,
    );
  if (!direct) return false;
  // The direct-use object must be the whole required label, never an embedded
  // word in a different object such as "Python recruiters".
  return wholeCapabilityLabel(direct[1]!.trim().replace(/[.!]$/, ""), required);
}

/** Shared positive-capability admission; negative constraints retain their separate semantics. */
export function matchR2Capability(
  profile: CandidateProfile,
  requirement: R2RequirementEvidence,
): R2CapabilityMatch | null {
  // A narrower unsupported advanced claim does not deny a separately verified basic fact.
  // A direct negative for the required scope still prevents positive admission.
  const value = requirement.normalizedValue;
  const contradicted = (text: string) =>
    isR2ExplicitlyUnsupported(profile, text, value.kind === "EXPERIENCE");
  if (
    r2RequirementHasExcludedScope(requirement) ||
    !["SKILL", "EXPERIENCE", "QUALIFICATION", "PHYSICAL", "GENERAL"].includes(
      requirement.canonicalKind,
    ) ||
    !["SOURCE_STATED", "OWNER_CORRECTED", "DERIVED"].includes(requirement.state) ||
    requirement.condition !== null ||
    ["CONDITIONAL", "NEGATED", "UNKNOWN"].includes(requirement.modality)
  )
    return null;
  if (value.kind === "EDUCATION") {
    const need = value.value;
    if (need.condition || (!need.level && !need.field)) return null;
    const matches = profile.education
      .map((e, index) => ({ e, index }))
      .filter(({ e }) => e.verification === "VERIFIED")
      .sort((a, b) => a.e.id.localeCompare(b.e.id) || a.index - b.index)
      .filter(
        ({ e }) =>
          (!need.level || supportsR2CapabilityText(e.qualification, need.level)) &&
          (!need.field || supportsR2CapabilityText(e.field, need.field)) &&
          (e.status === "COMPLETED" ||
            (e.status === "IN_PROGRESS" &&
              need.currentStudyAllowed === true &&
              need.completionRequired !== true)) &&
          !contradicted([need.level, need.field].filter(Boolean).join(" ")),
      );
    const match = matches[0];
    if (!match) return null;
    const semanticKey = r2SemanticFactKey("EDUCATION", match.e);
    const references = matches
      .filter(({ e }) => r2SemanticFactKey("EDUCATION", e) === semanticKey)
      .map(({ index }) => r2FactReference("education", profile.education, index))
      .sort();
    return { reference: references[0]!, references, semanticKey, kind: "EDUCATION" };
  }
  if (!["TEXT", "PHYSICAL", "EXPERIENCE"].includes(value.kind)) return null;
  if (
    value.kind === "EXPERIENCE" &&
    ((value.value.minimum !== null && value.value.minimum > 0) ||
      value.value.maximum !== null ||
      value.value.recency !== null ||
      value.value.alternatives.length > 0 ||
      value.value.condition !== null)
  )
    return null;
  const text =
    value.kind === "EXPERIENCE"
      ? value.value.domain
      : value.kind === "TEXT" || value.kind === "PHYSICAL"
        ? value.value
        : null;
  if (!text || contradicted(text)) return null;
  const skills = r2VerifiedSkillFacts(profile)
    .filter((s) => wholeCapabilityLabel(s.record.name, text))
    .sort(
      (a, b) =>
        a.semanticKey.localeCompare(b.semanticKey) || a.reference.localeCompare(b.reference),
    );
  const skill = skills[0];
  if (skill) {
    const references = skills
      .filter((s) => s.semanticKey === skill.semanticKey)
      .map((s) => s.reference)
      .sort();
    return { reference: references[0]!, references, semanticKey: skill.semanticKey, kind: "SKILL" };
  }
  const roleMatches: R2CapabilityMatch[] = [];
  for (const { role, index: roleIndex } of profile.employment
    .map((role, index) => ({ role, index }))
    .filter(({ role }) => role.verification === "VERIFIED")
    .sort((a, b) => a.role.id.localeCompare(b.role.id) || a.index - b.index)) {
    const baseReference = r2FactReference("employment", profile.employment, roleIndex);
    const baseKey = r2SemanticFactKey("EXPERIENCE", role);
    if (value.kind === "EXPERIENCE" && wholeCapabilityLabel(role.title, text))
      roleMatches.push({
        reference: `${baseReference}.title`,
        references: [`${baseReference}.title`],
        semanticKey: `${baseKey}:title`,
        kind: "EXPERIENCE",
      });
    const index = role.responsibilities.findIndex((r) => employmentSupports(r, text));
    if (index >= 0)
      roleMatches.push({
        reference: `${baseReference}.responsibilities.${index}`,
        references: [`${baseReference}.responsibilities.${index}`],
        semanticKey: `${baseKey}:responsibilities.${index}`,
        kind: "EXPERIENCE",
      });
  }
  const match = roleMatches.sort(
    (a, b) => a.semanticKey.localeCompare(b.semanticKey) || a.reference.localeCompare(b.reference),
  )[0];
  if (!match) return null;
  const references = roleMatches
    .filter((m) => m.semanticKey === match.semanticKey)
    .map((m) => m.reference)
    .sort();
  return { ...match, references, reference: references[0]! };
}
