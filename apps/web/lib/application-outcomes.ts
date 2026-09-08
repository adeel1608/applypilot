import { canTransitionBetaApplication } from "@applypilot/application-tracker";
import type { BetaApplicationStatus } from "@applypilot/job-model";

export const ManualApplicationOutcomes = [
  "ASSESSMENT",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
  "EXPIRED",
] as const;

export type ManualApplicationOutcome = (typeof ManualApplicationOutcomes)[number];

export function manualApplicationOutcomesForStatus(
  status: BetaApplicationStatus,
): ManualApplicationOutcome[] {
  return ManualApplicationOutcomes.filter((outcome) =>
    canTransitionBetaApplication(status, outcome),
  );
}
