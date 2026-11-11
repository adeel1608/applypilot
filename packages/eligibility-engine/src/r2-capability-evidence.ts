import type { CandidateProfile } from "@applypilot/candidate-profile";
import type { R2RequirementEvidence } from "@applypilot/job-model";

export const R2_CAPABILITY_EVIDENCE_VERSION = "r2-capability-evidence-2";
// Literal identifiers only: no abbreviation, synonym, version or domain equivalence.
const programmingIdentifier =
  /^(?:c\+\+|c#|f#|\.net|python|java|javascript|typescript|rust|ruby|swift|kotlin|sql)(?:\d+(?:\.\d+)*)?$/i;
const negativeOrConditional =
  /\b(?:no|not|never|without|if|unless|when|could|would|may|might|lack|lacks|lacking|unfamiliar|unable|incomplete|unearned|free|less|cannot|contingent|pending|aspiring|depending|can['’]t|don['’]t|doesn['’]t|didn['’]t|isn['’]t|wasn['’]t|haven['’]t|hasn['’]t|aren['’]t|weren['’]t|won['’]t|wouldn['’]t|couldn['’]t|shouldn['’]t)\b|\bnon[-\s]+/i;
const restrictedScope =
  /\b(?:only|limited|learning|beginner|exposure|supervision|supervised|or|either|partial|partially|except|excluding|assisted|guidance|trainee|equivalent)\b|\//i;

export function r2CapabilityTokens(text: string): string[] {
  return (
    text
      .normalize("NFKD")
      .toLocaleLowerCase("en-AU")
      .match(
        /[a-z0-9_]+[+#]+[a-z0-9_]*(?:[.-][a-z0-9_]+)*(?:[+#]+[a-z0-9_]*)?|\.[a-z0-9_]+(?:[.-][a-z0-9_]+)*(?:[+#]+[a-z0-9_]*)?|[a-z0-9_]+(?:\.[a-z0-9_]+)+(?:-[a-z0-9_]+)*(?:[+#]+[a-z0-9_]*)?|[a-z0-9_]+/g,
      ) ?? []
  );
}
export function r2CapabilityLabel(text: string): string[] {
  let label = text
    .trim()
    .replace(
      /\s+(?:(?:is|are)\s+)?(?:required|essential|mandatory|preferred|desirable)\s*[.!]?$/i,
      "",
    )
    .replace(
      /^(?:(?:experience|proficiency|proficient|skills?|knowledge)\s+(?:in|with|of)\s+|ability\s+to\s+|must\s+(?:have|possess)\s+)+/i,
      "",
    )
    .replace(/\s+skills?\s*[.!]?$/i, "")
    .trim();
  const programming = label.match(/^(.+?)\s+programming\s*[.!]?$/i);
  if (programming && programmingIdentifier.test(programming[1]!)) label = programming[1]!;
  return r2CapabilityTokens(label);
}
function contains(fact: string[], need: string[]) {
  return need.length > 0 && fact.some((_, i) => need.every((token, j) => fact[i + j] === token));
}
function same(a: string[], b: string[]) {
  return a.length > 0 && a.length === b.length && a.every((token, i) => token === b[i]);
}
function affirmativeOptionalLabel(text: string): string {
  return text.replace(
    /\s+(?:(?:is|are)\s+)?(?:preferred|desirable|advantage(?:ous)?)\s+(?:but\s+)?not essential\s*[.!]?$/i,
    "",
  );
}
export function supportsR2CapabilityText(candidate: string, required: string): boolean {
  required = affirmativeOptionalLabel(required);
  if (
    negativeOrConditional.test(candidate) ||
    negativeOrConditional.test(required) ||
    restrictedScope.test(candidate) ||
    restrictedScope.test(required)
  )
    return false;
  const fact = r2CapabilityLabel(candidate),
    need = r2CapabilityLabel(required);
  if (same(fact, need)) return true;
  if (need.some((token) => token.length <= 2 && !/[+#.]|\d/.test(token))) return false;
  return contains(fact, need);
}
export function wholeR2CapabilityLabel(fact: string, required: string): boolean {
  return (
    supportsR2CapabilityText(fact, required) &&
    same(r2CapabilityLabel(fact), r2CapabilityLabel(affirmativeOptionalLabel(required)))
  );
}
export function r2FactReference<T extends { id: string }>(
  family: string,
  rows: T[],
  index: number,
): string {
  const row = rows[index]!;
  const id = encodeURIComponent(row.id).replace(/\./g, "%2E");
  return rows.filter((other) => other.id === row.id).length > 1
    ? `${family}.${id}.records.${index}`
    : `${family}.${id}`;
}
export function r2SemanticFactKey(kind: string, record: Record<string, unknown>): string {
  if (kind === "SKILL") return `${kind}:${JSON.stringify(r2CapabilityLabel(String(record.name)))}`;
  if (kind === "EDUCATION")
    return `${kind}:${JSON.stringify([r2CapabilityTokens(String(record.qualification)), r2CapabilityTokens(String(record.field)), record.status])}`;
  if (kind === "LICENCE" || kind === "CERTIFICATION")
    return `${kind}:${JSON.stringify([r2CapabilityTokens(String(record.name)), record.jurisdiction ?? null, record.class ?? null, record.expiresOn ?? record.expiresAt ?? null])}`;
  const body = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "id"));
  return `${kind}:${JSON.stringify(body)}`;
}
export function isR2ExplicitlyUnsupported(
  profile: CandidateProfile,
  claim: string,
  experience = false,
): boolean {
  const scope = (text: string) =>
    r2CapabilityLabel(experience ? text.replace(/\s+experience\s*[.!]?$/i, "") : text);
  const required = scope(claim);
  return [...profile.unsupportedExperience, ...profile.forbiddenClaims].some((negative) => {
    const excluded = scope(negative.replace(/^(?:no|not|without)\s+/i, ""));
    return contains(required, excluded);
  });
}
export function r2VerifiedSkillFacts(profile: CandidateProfile) {
  return profile.skills.flatMap((record, index) =>
    record.verification === "VERIFIED"
      ? [
          {
            record,
            reference: r2FactReference("skills", profile.skills, index),
            semanticKey: r2SemanticFactKey("SKILL", record),
          },
        ]
      : [],
  );
}

export function r2RequirementHasCondition(evidence: R2RequirementEvidence): boolean {
  const value = evidence.normalizedValue;
  const typedCondition =
    typeof value.value === "object" && value.value !== null && "condition" in value.value
      ? value.value.condition
      : null;
  return (
    evidence.condition !== null ||
    typedCondition !== null ||
    evidence.modality === "CONDITIONAL" ||
    evidence.state === "CONDITIONAL"
  );
}
export function r2RequirementHasExcludedScope(evidence: R2RequirementEvidence): boolean {
  const value = evidence.normalizedValue;
  const text =
    value.kind === "TEXT" || value.kind === "PHYSICAL"
      ? value.value
      : value.kind === "EXPERIENCE"
        ? value.value.domain
        : null;
  return (
    !["SOURCE_STATED", "OWNER_CORRECTED", "DERIVED"].includes(evidence.state) ||
    !["REQUIRED", "PREFERRED"].includes(evidence.modality) ||
    r2RequirementHasCondition(evidence) ||
    (text !== null &&
      negativeOrConditional.test(
        evidence.modality === "PREFERRED" ? affirmativeOptionalLabel(text) : text,
      ))
  );
}

/** Literal evidence overlap only. This must never be used as prerequisite satisfaction. */
export function r2LiteralSkillOverlap(profile: CandidateProfile, evidence: R2RequirementEvidence) {
  const value = evidence.normalizedValue;
  if (
    r2RequirementHasExcludedScope(evidence) ||
    !["SKILL", "EXPERIENCE"].includes(evidence.canonicalKind)
  )
    return [];
  const text =
    value.kind === "TEXT" ? value.value : value.kind === "EXPERIENCE" ? value.value.domain : null;
  if (
    !text ||
    negativeOrConditional.test(
      evidence.modality === "PREFERRED" ? affirmativeOptionalLabel(text) : text,
    )
  )
    return [];
  if (
    /\b(?:only|limited|learning|beginner|exposure|supervision|supervised|partial|partially|except|excluding|assisted|guidance|trainee)\b/i.test(
      text,
    )
  )
    return [];
  // A technical word describing recruitment/management of other people is not tool-use evidence.
  if (
    /\brecruit(?:ing|ment|ed)?\b|\bhir(?:ing|ed)\b|\b(?:manag(?:e|ing|ement|ed)|train(?:ing|ed)?|collaborat(?:e|ed|ing))\b[^.!?]*\b(?:developers?|engineers?|experts?|staff|team|people|others|recruiters?)\b/i.test(
      text,
    )
  )
    return [];
  const source = r2CapabilityTokens(text);
  return r2VerifiedSkillFacts(profile).filter((fact) => {
    if (
      negativeOrConditional.test(fact.record.name) ||
      restrictedScope.test(fact.record.name) ||
      isR2ExplicitlyUnsupported(profile, fact.record.name)
    )
      return false;
    const need = r2CapabilityLabel(fact.record.name);
    if (need.length === 1 && need[0]!.length <= 2 && !/[+#.]|\d/.test(need[0]!)) {
      // Ambiguous single letters require explicit named-language programming context.
      return (
        programmingIdentifier.test(need[0]!) &&
        source.some((token, i) => token === need[0] && source[i + 1] === "programming")
      );
    }
    return contains(source, need);
  });
}
