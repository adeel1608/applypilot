import { describe, expect, it } from "vitest";

import { r2aStructuralMetrics, r2aStructureBudget } from "./r2a-diagnostics";

describe("safe R2A structure measurements", () => {
  it("counts deep fictional metadata iteratively and returns only structural buckets", () => {
    let nested: unknown = "fictional";
    for (let index = 0; index < 1_723; index += 1) nested = { value: nested };
    const structured = { providerMetadata: [nested] };
    const metrics = r2aStructuralMetrics(structured, 17_753, 17_753);

    expect(metrics.maxDepth).toBe(1_725);
    expect(metrics.providerMetadata.depth).toBe("DEPTH_257_PLUS");
    expect(metrics.nodeCount).toBeLessThan(50_000);
    expect(JSON.stringify(metrics)).not.toContain("fictional");
    expect(r2aStructureBudget(structured, 17_753)).toBe("DEPTH");
  });

  it("reports deterministic safe budgets for an oversized array and source", () => {
    expect(r2aStructureBudget({ offices: Array.from({ length: 10_001 }, () => "x") }, 1)).toBe(
      "ARRAY_LENGTH",
    );
    expect(r2aStructureBudget({}, 2_000_001)).toBe("SOURCE_LENGTH");
  });
});
