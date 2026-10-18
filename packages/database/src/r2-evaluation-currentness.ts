import {
  R2A_EVIDENCE_CONTRACT_VERSION,
  R2A_NORMALIZATION_VERSION,
  R2A_PARSER_VERSION,
} from "@applypilot/job-model";
import { R2_ELIGIBILITY_ENGINE_VERSION } from "@applypilot/eligibility-engine";
import { R2_FIT_SCORER_VERSION, R2_FIT_WEIGHT_VERSION } from "@applypilot/fit-scorer";

export function currentR2EvaluationVersions() {
  return {
    evidenceContractVersion: R2A_EVIDENCE_CONTRACT_VERSION,
    normalizationVersion: R2A_NORMALIZATION_VERSION,
    coverageVersion: `${R2A_PARSER_VERSION}:${R2A_NORMALIZATION_VERSION}`,
    eligibilityEngineVersion: R2_ELIGIBILITY_ENGINE_VERSION,
    scorerVersion: R2_FIT_SCORER_VERSION,
    weightVersion: R2_FIT_WEIGHT_VERSION,
  };
}
export type R2EvaluationVersions = ReturnType<typeof currentR2EvaluationVersions>;
export function r2EvaluationVersionsAreCurrent(
  value: Partial<Record<keyof R2EvaluationVersions, unknown>> | null | undefined,
): boolean {
  if (!value) return false;
  return Object.entries(currentR2EvaluationVersions()).every(
    ([key, expected]) => value[key as keyof R2EvaluationVersions] === expected,
  );
}
/** Fixed SQL for the canonical evaluation alias e. No user-controlled SQL fragments. */
export function r2CurrentEvaluationSql(): string {
  const versions = currentR2EvaluationVersions();
  const columns = {
    evidenceContractVersion: "evidence_contract_version",
    normalizationVersion: "normalization_version",
    coverageVersion: "coverage_version",
    eligibilityEngineVersion: "eligibility_engine_version",
    scorerVersion: "fit_scorer_version",
    weightVersion: "weight_version",
  };
  return `coalesce((${Object.entries(columns)
    .map(
      ([key, column]) =>
        `e.${column}='${versions[key as keyof R2EvaluationVersions].replaceAll("'", "''")}'`,
    )
    .join(" AND ")}),0)`;
}
