import { type CandidateProfile } from "@applypilot/candidate-profile";
import type { R2RequirementEvidence } from "@applypilot/job-model";
import { matchesEvidenceText } from "@applypilot/shared";

// These markers make a whole statement unsuitable as proof of an unqualified capability.
// Reject rather than trying to infer which neighbouring clause a qualification modifies.
const qualifiedScope =
  /\b(?:no|not|never|without|if|unless|when|could|would|may|might|only|limited|learning|beginner|basic|exposure|supervision|supervised|or|either|lack|lacks|lacking|unfamiliar|unable|partial|partially|except|excluding|assisted|guidance|trainee|incomplete|unearned|equivalent|free|less|cannot|contingent|pending|aspiring|depending|can['’]t|don['’]t|doesn['’]t|didn['’]t|isn['’]t|wasn['’]t|haven['’]t|hasn['’]t|aren['’]t|weren['’]t|won['’]t|wouldn['’]t|couldn['’]t|shouldn['’]t)\b|\//i;
const wrapper =
  /^(?:(?:experience|proficiency|proficient|skills?|knowledge)\s+(?:in|with|of)\s+|ability\s+to\s+|must\s+(?:have|possess)\s+)+/i;

/** A verified fact must contain the entire bounded requirement, in that direction. */
export function supportsR2CapabilityText(candidate: string, required: string): boolean {
  if (
    qualifiedScope.test(candidate) ||
    qualifiedScope.test(required) ||
    /\bnon[-\s]+/i.test(candidate) ||
    /\bnon[-\s]+/i.test(required)
  )
    return false;
  const target = required
    .trim()
    .replace(
      /\s+(?:(?:is|are)\s+)?(?:required|essential|mandatory|preferred|desirable)\s*[.!]?$/i,
      "",
    )
    .replace(wrapper, "")
    .replace(/\s+skills?$/i, "")
    .trim();
  if (!target || !matchesEvidenceText(candidate, target)) return false;
  // The symmetric utility retains conservative short-token / punctuation rules.
  // This extra check prevents its reverse containment from accepting partial scope.
  const tokens = (text: string) =>
    text
      .normalize("NFKD")
      .toLocaleLowerCase("en-AU")
      .match(/c\+\+\d*|c#\d*|f#\d*|\.net\d*|[a-z0-9]+/g) ?? [];
  const fact = tokens(candidate),
    need = tokens(target);
  return need.length > 0 && fact.some((_, i) => need.every((token, j) => fact[i + j] === token));
}

export interface R2CapabilityMatch {
  reference: string;
  kind: "SKILL" | "EXPERIENCE" | "EDUCATION";
}

function wholeCapabilityLabel(fact: string, required: string): boolean {
  return supportsR2CapabilityText(fact, required) && supportsR2CapabilityText(required, fact);
}

function employmentSupports(fact: string, required: string): boolean {
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
  const contradicted = (text: string) =>
    [...profile.unsupportedExperience, ...profile.forbiddenClaims].some((negative) =>
      supportsR2CapabilityText(text, negative),
    );
  const value = requirement.normalizedValue;
  if (
    requirement.condition !== null ||
    ["CONDITIONAL", "NEGATED", "UNKNOWN"].includes(requirement.modality)
  )
    return null;
  if (value.kind === "EDUCATION") {
    const need = value.value;
    if (need.condition || (!need.level && !need.field)) return null;
    const match = profile.education
      .filter((e) => e.verification === "VERIFIED")
      .sort((a, b) => a.id.localeCompare(b.id))
      .find(
        (e) =>
          (!need.level || supportsR2CapabilityText(e.qualification, need.level)) &&
          (!need.field || supportsR2CapabilityText(e.field, need.field)) &&
          (e.status === "COMPLETED" ||
            (e.status === "IN_PROGRESS" &&
              need.currentStudyAllowed === true &&
              need.completionRequired !== true)) &&
          !contradicted([need.level, need.field].filter(Boolean).join(" ")),
      );
    return match ? { reference: `education.${match.id}`, kind: "EDUCATION" } : null;
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
  const skill = profile.skills
    .filter((s) => s.verification === "VERIFIED")
    .sort((a, b) => a.id.localeCompare(b.id))
    .find((s) => wholeCapabilityLabel(s.name, text));
  if (skill) return { reference: `skills.${skill.id}`, kind: "SKILL" };
  for (const role of profile.employment
    .filter((e) => e.verification === "VERIFIED")
    .sort((a, b) => a.id.localeCompare(b.id))) {
    if (value.kind === "EXPERIENCE" && wholeCapabilityLabel(role.title, text))
      return { reference: `employment.${role.id}.title`, kind: "EXPERIENCE" };
    const index = role.responsibilities.findIndex((r) => employmentSupports(r, text));
    if (index >= 0)
      return { reference: `employment.${role.id}.responsibilities.${index}`, kind: "EXPERIENCE" };
  }
  return null;
}
