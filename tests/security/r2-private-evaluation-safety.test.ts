import { describe, expect, it } from "vitest";

import {
  R2_PRIVATE_EVALUATION_CONFIRMATION,
  assertR2PrivateEvaluationConfirmation,
} from "../../scripts/r2-evaluate-private";

describe("private R2 evaluation safety", () => {
  it("requires the exact explicit local-evaluation confirmation", () => {
    expect(() => assertR2PrivateEvaluationConfirmation([])).toThrow(
      `R2_PRIVATE_CONFIRMATION_REQUIRED:${R2_PRIVATE_EVALUATION_CONFIRMATION}`,
    );
    expect(() => assertR2PrivateEvaluationConfirmation(["--confirm=yes"])).toThrow();
    expect(() =>
      assertR2PrivateEvaluationConfirmation([`--confirm=${R2_PRIVATE_EVALUATION_CONFIRMATION}`]),
    ).not.toThrow();
  });
});
