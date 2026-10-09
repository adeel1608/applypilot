import { PacketAnswerSchema, PacketQuestionContractSchema, type PacketAnswer } from "./beta";
import { hostedDigest, type HostedQuestionDiscovery } from "./hosted-contract";
import { nonFactualConsentKind } from "./hosted-questions";

export interface HostedVerifiedFact {
  path: string;
  value: string | number | boolean;
  references?: string[];
  transform?: "JOIN_NAME";
}
export function hostedVerifiedFacts(snapshot: unknown): HostedVerifiedFact[] {
  const facts: HostedVerifiedFact[] = [];
  const visit = (value: unknown, path: string, depth: number) => {
    if (depth > 8 || facts.length >= 500 || !value || typeof value !== "object") return;
    const fact = value as { verification?: unknown; value?: unknown };
    if (
      fact.verification === "VERIFIED" &&
      ["string", "number", "boolean"].includes(typeof fact.value) &&
      (typeof fact.value !== "string" || (fact.value.length > 0 && fact.value.length <= 5000))
    ) {
      facts.push({ path, value: fact.value as string | number | boolean });
      return;
    }
    for (const [key, item] of Object.entries(value).slice(0, 500))
      if (
        /^[A-Za-z][A-Za-z0-9]*$|^[0-9]+$/.test(key) &&
        !["constructor", "prototype", "__proto__"].includes(key)
      )
        visit(item, path ? `${path}.${key}` : key, depth + 1);
  };
  visit(snapshot, "", 0);
  const first = facts.find((fact) => fact.path === "identity.firstName");
  const last = facts.find((fact) => fact.path === "identity.lastName");
  if (typeof first?.value === "string" && typeof last?.value === "string")
    facts.push({
      path: "identity.fullName",
      value: `${first.value} ${last.value}`,
      references: [first.path, last.path],
      transform: "JOIN_NAME",
    });
  return facts;
}

export function hostedAllowedFactPaths(question: { label: string; controlName: string }): string[] {
  const label = question.label
    .trim()
    .replace(/\s*\*$/, "")
    .toLowerCase();
  const name = question.controlName.toLowerCase();
  if (
    ["first name", "given name"].includes(label) &&
    ["first_name", "firstname", "given_name"].includes(name)
  )
    return ["identity.firstName"];
  if (
    ["last name", "surname", "family name"].includes(label) &&
    ["last_name", "lastname", "surname", "family_name"].includes(name)
  )
    return ["identity.lastName"];
  if (["full name", "name"].includes(label) && ["name", "full_name", "fullname"].includes(name))
    return ["identity.fullName"];
  if (["email", "email address"].includes(label) && ["email", "email_address"].includes(name))
    return ["contact.email"];
  if (
    ["phone", "phone number", "telephone"].includes(label) &&
    ["phone", "phone_number", "telephone"].includes(name)
  )
    return ["contact.phone"];
  return [];
}

/** Owner selects existing fact paths and alternatives, never promotes a free-text claim. */
export function reviewedHostedQuestions(input: {
  discovery: HostedQuestionDiscovery;
  facts: HostedVerifiedFact[];
  selections: { groupId: string; alternative: number | null }[];
  answers: {
    questionId: string;
    factPath: string | null;
    ownerChoice?: { value: boolean; receiptId: string; kind: "TERMS" | "DATA_PROCESSING" };
  }[];
}) {
  const discovery = input.discovery;
  if (
    !discovery.complete ||
    input.selections.length !== discovery.groups.length ||
    new Set(input.selections.map((value) => value.groupId)).size !== input.selections.length ||
    new Set(input.answers.map((value) => value.questionId)).size !== input.answers.length
  )
    throw new Error("HOSTED_QUESTION_REVIEW_INVALID");
  const groups = discovery.groups.map((group) => {
    const selection = input.selections.find((value) => value.groupId === group.id);
    if (
      !selection ||
      (selection.alternative !== null &&
        (!Number.isInteger(selection.alternative) ||
          selection.alternative < 0 ||
          selection.alternative >= group.alternatives.length))
    )
      throw new Error("HOSTED_QUESTION_REVIEW_INVALID");
    return { ...group, selectedAlternative: selection.alternative };
  });
  const answers: PacketAnswer[] = discovery.questions.map((question) => {
    const selected = input.answers.find((value) => value.questionId === question.id);
    const fact = selected?.factPath
      ? input.facts.find((value) => value.path === selected.factPath)
      : null;
    if (fact && !hostedAllowedFactPaths(question).includes(fact.path))
      throw new Error("HOSTED_FACT_QUESTION_UNSUPPORTED");
    const choice = selected?.ownerChoice;
    if (
      (selected?.factPath && !fact) ||
      (choice && (fact || choice.kind !== nonFactualConsentKind(question)))
    )
      throw new Error("HOSTED_QUESTION_REVIEW_INVALID");
    const value = choice ? choice.value : (fact?.value ?? null);
    if (
      value !== null &&
      question.options.length &&
      question.type !== "checkbox" &&
      !question.options.some((option) => option.value === String(value))
    )
      throw new Error("HOSTED_ANSWER_OPTION_UNSUPPORTED");
    return PacketAnswerSchema.parse({
      questionId: question.id,
      questionText: question.label,
      required: question.required,
      sensitive:
        Boolean(choice) ||
        /health|gender|ethnic|race|disabil|veteran|criminal|salary/i.test(question.label),
      value,
      truthState: choice ? "OWNER_CHOICE" : fact ? "VERIFIED_ANSWER" : "UNKNOWN",
      disclosureState: choice || fact ? "APPROVED" : "UNKNOWN",
      factReferences: fact ? (fact.references ?? [fact.path]) : [],
      ...(fact?.transform ? { factTransform: fact.transform } : {}),
      ...(choice ? { ownerChoice: { receiptId: choice.receiptId, kind: choice.kind } } : {}),
    });
  });
  return {
    answers,
    questionContract: PacketQuestionContractSchema.parse({
      version: discovery.version,
      discoveryDigest: hostedDigest(discovery),
      complete: true,
      groups,
    }),
  };
}
