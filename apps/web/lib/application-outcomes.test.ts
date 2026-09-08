import { describe, expect, it } from "vitest";

import { manualApplicationOutcomesForStatus } from "./application-outcomes";

describe("manual application outcomes", () => {
  it("offers employer outcomes only after a submitted state", () => {
    expect(manualApplicationOutcomesForStatus("SUBMITTED")).toEqual([
      "ASSESSMENT",
      "INTERVIEW",
      "OFFER",
      "REJECTED",
      "WITHDRAWN",
    ]);
    expect(manualApplicationOutcomesForStatus("PREPARING")).toEqual(["WITHDRAWN", "EXPIRED"]);
  });

  it("does not invent a submitted transition or reopen terminal outcomes", () => {
    expect(manualApplicationOutcomesForStatus("REJECTED")).toEqual([]);
    expect(manualApplicationOutcomesForStatus("WITHDRAWN")).toEqual([]);
    expect(manualApplicationOutcomesForStatus("EXPIRED")).toEqual([]);
  });
});
