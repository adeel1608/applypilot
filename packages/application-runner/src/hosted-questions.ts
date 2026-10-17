import { z } from "zod";
export function nonFactualConsentKind(question: {
  type: string;
  label: string;
}): "TERMS" | "DATA_PROCESSING" | null {
  if (
    question.type !== "checkbox" ||
    /eligible|authori[sz]|citizen|visa|sponsor|clearance|work rights|available|salary|truth|accurat|age|gender|ethnic|disabil|veteran|convict|employment/i.test(
      question.label,
    )
  )
    return null;
  const label = question.label.trim().replace(/\s+/g, " ").replace(/\.$/, "");
  if (/^(?:i )?(?:agree|accept)(?: to)? (?:the )?terms (?:and conditions|of use)$/i.test(label))
    return "TERMS";
  if (
    /^(?:i )?(?:agree|consent|accept)(?: to)? (?:the )?(?:privacy policy|processing (?:of )?(?:my personal|my|personal) data)$/i.test(
      label,
    )
  )
    return "DATA_PROCESSING";
  return null;
}
import {
  HostedQuestionDiscoverySchema,
  hostedDigest,
  type HostedForm,
  type HostedQuestionDiscovery,
  type HostedSubject,
} from "./hosted-contract";
const providerQuestions = z
  .object({
    questions: z
      .array(
        z
          .object({
            label: z.string().min(1).max(500),
            required: z.boolean(),
            fields: z
              .array(
                z
                  .object({
                    name: z.string().min(1).max(200),
                    type: z.string().min(1).max(100),
                    values: z
                      .array(
                        z
                          .object({
                            value: z.union([z.string().max(200), z.number()]),
                            label: z.string().max(500),
                          })
                          .passthrough(),
                      )
                      .max(100)
                      .optional(),
                  })
                  .passthrough(),
              )
              .min(1)
              .max(20),
          })
          .passthrough(),
      )
      .max(100),
  })
  .passthrough();
const fieldType: Record<string, "text" | "textarea" | "select" | "file" | undefined> = {
  input_text: "text",
  textarea: "textarea",
  input_file: "file",
  multi_value_single_select: "select",
};
function documentType(name: string): "CV" | "COVER_LETTER" | null {
  return name === "resume" || name === "resume_file"
    ? "CV"
    : name === "cover_letter" || name === "cover_letter_file"
      ? "COVER_LETTER"
      : null;
}
export function greenhouseQuestions(
  subject: HostedSubject,
  payload: unknown,
): HostedQuestionDiscovery {
  const parsed = providerQuestions.safeParse(payload);
  const discovery: HostedQuestionDiscovery = {
    version: "hosted-questions-v1",
    subjectDigest: hostedDigest(subject),
    complete: parsed.success,
    origin: "SOURCE_DETAIL",
    questions: [],
    groups: [],
    documentControls: [],
    safeBlockers: parsed.success ? [] : ["QUESTION_SCHEMA_CHANGED"],
  };
  if (parsed.success)
    for (const [index, question] of parsed.data.questions.entries()) {
      const alternatives: HostedQuestionDiscovery["groups"][number]["alternatives"] = [];
      for (const field of question.fields) {
        const type = fieldType[field.type];
        if (!type) {
          discovery.safeBlockers.push("QUESTION_TYPE_UNSUPPORTED");
          continue;
        }
        if (type === "file") {
          const document = documentType(field.name);
          if (!document) {
            discovery.safeBlockers.push("DOCUMENT_FIELD_UNKNOWN");
            continue;
          }
          discovery.documentControls.push({ name: field.name, documentType: document });
          alternatives.push({ kind: "DOCUMENT", documentType: document });
        } else {
          const id = `gh:${field.name}`;
          discovery.questions.push({
            id,
            label: question.label,
            controlName: field.name,
            required: question.required,
            type,
            options:
              field.values?.map((value) => ({ value: String(value.value), label: value.label })) ??
              [],
          });
          alternatives.push({ kind: "ANSWER", questionId: id });
        }
      }
      if (alternatives.length)
        discovery.groups.push({
          id: `gh-group:${index}`,
          required: question.required,
          alternatives,
          selectedAlternative: null,
        });
    }
  if (
    new Set(discovery.questions.map((question) => question.id)).size !==
      discovery.questions.length ||
    new Set(discovery.documentControls.map((control) => control.name)).size !==
      discovery.documentControls.length
  )
    discovery.safeBlockers.push("QUESTION_DUPLICATE");
  discovery.safeBlockers = [...new Set(discovery.safeBlockers)];
  discovery.complete = discovery.complete && discovery.safeBlockers.length === 0;
  return HostedQuestionDiscoverySchema.parse(discovery);
}

/** Passive metadata is collected without packet values, documents or disclosure authority. */
export function questionsFromHostedForm(
  subject: HostedSubject,
  form: HostedForm,
): HostedQuestionDiscovery {
  const discovery: HostedQuestionDiscovery = {
    version: "hosted-questions-v1",
    subjectDigest: hostedDigest(subject),
    complete: true,
    origin: "PASSIVE_FORM",
    questions: [],
    groups: [],
    documentControls: [],
    safeBlockers: [],
  };
  for (const control of form.controls) {
    if (control.type === "submit" || control.type === "hidden") continue;
    if (control.type === "file") {
      const document = documentType(control.name);
      if (!document) {
        discovery.safeBlockers.push("DOCUMENT_FIELD_UNKNOWN");
        continue;
      }
      discovery.documentControls.push({ name: control.name, documentType: document });
      // A native resume text control is the same required alternative group.
      const text = form.controls.find(
        (field) => field.name === `${control.name}_text` && field.type === "textarea",
      );
      discovery.groups.push({
        id: `form:${control.name}`,
        required: control.required || Boolean(text?.required),
        alternatives: [
          { kind: "DOCUMENT", documentType: document },
          ...(text ? [{ kind: "ANSWER" as const, questionId: `form:${text.name}` }] : []),
        ],
        selectedAlternative: null,
      });
    } else {
      const id = `form:${control.name}`;
      discovery.questions.push({
        id,
        label: control.label || control.name,
        controlName: control.name,
        required: control.required,
        type: control.type,
        options: control.options,
      });
      if (
        !control.name.endsWith("_text") ||
        !form.controls.some(
          (field) => field.name === control.name.slice(0, -5) && field.type === "file",
        )
      )
        discovery.groups.push({
          id,
          required: control.required,
          alternatives: [{ kind: "ANSWER", questionId: id }],
          selectedAlternative: null,
        });
    }
  }
  if (
    new Set(discovery.questions.map((question) => question.id)).size !== discovery.questions.length
  )
    discovery.safeBlockers.push("QUESTION_DUPLICATE");
  discovery.complete = discovery.safeBlockers.length === 0;
  return HostedQuestionDiscoverySchema.parse(discovery);
}

/** Known source-required groups cannot vanish when native HTML relies on provider validation. */
export function reconcileHostedQuestions(
  native: HostedQuestionDiscovery,
  source: HostedQuestionDiscovery | null,
): HostedQuestionDiscovery {
  if (!source) return native;
  const result = structuredClone(native);
  const fail = () => {
    result.complete = false;
    result.safeBlockers = [
      ...new Set([...result.safeBlockers, "QUESTION_SCHEMA_CHANGED" as const]),
    ];
  };
  if (
    !source.complete ||
    source.subjectDigest !== native.subjectDigest ||
    source.origin !== "SOURCE_DETAIL"
  ) {
    fail();
    return HostedQuestionDiscoverySchema.parse(result);
  }
  const signature = (
    discovery: HostedQuestionDiscovery,
    group: HostedQuestionDiscovery["groups"][number],
  ) =>
    group.alternatives
      .map((alternative) =>
        alternative.kind === "ANSWER"
          ? `ANSWER:${discovery.questions.find((q) => q.id === alternative.questionId)?.controlName ?? "MISSING"}`
          : `DOCUMENT:${discovery.documentControls.find((d) => d.documentType === alternative.documentType)?.name ?? "MISSING"}`,
      )
      .sort()
      .join("|");
  const labels = (value: string) =>
    value
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\s*\*$/, "")
      .toLowerCase();
  for (const question of source.questions) {
    const field = result.questions.find((q) => q.controlName === question.controlName);
    const documentText =
      field &&
      ((question.controlName === "resume_text" &&
        labels(question.label) === "resume" &&
        ["resume", "resume text"].includes(labels(field.label))) ||
        (question.controlName === "cover_letter_text" &&
          labels(question.label) === "cover letter" &&
          ["cover letter", "cover letter text"].includes(labels(field.label))));
    if (
      !field ||
      (!documentText && labels(field.label) !== labels(question.label)) ||
      (field.type !== question.type &&
        !(question.type === "text" && ["email", "tel", "url", "number"].includes(field.type))) ||
      hostedDigest(field.options) !== hostedDigest(question.options)
    ) {
      fail();
      continue;
    }
    field.required ||= question.required;
  }
  const matched = new Set<string>();
  for (const group of source.groups) {
    const candidate = result.groups.filter(
      (value) => signature(native, value) === signature(source, group),
    );
    if (candidate.length !== 1 || matched.has(candidate[0]!.id)) {
      fail();
      continue;
    }
    matched.add(candidate[0]!.id);
    candidate[0]!.required ||= group.required;
  }
  return HostedQuestionDiscoverySchema.parse(result);
}
