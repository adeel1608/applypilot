import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  R2AFailureDiagnosticSchema,
  classifyR2ASchemaFailure,
  createSourcePersistenceDiagnostic,
  validateSourceAuditMetadata,
} from "@applypilot/job-sources";

import { R2ADiagnosticContext, r2aStructuralMetrics, r2aStructureBudget } from "./r2a-diagnostics";

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

  it("keeps final schema classification closed, bounded, and content-free", () => {
    const marker = "fictional-private-message-id-path";
    const error = new ZodError([
      { code: "custom", path: [marker], message: `duplicate evidence id: ${marker}` },
      {
        code: "custom",
        path: [marker],
        message: "conflict members must be linked conflicting evidence",
      },
      { code: "custom", path: [marker], message: marker },
      { code: "custom", path: [marker], message: marker },
    ]);
    const metrics = r2aStructuralMetrics({}, 0, 0);
    const context = new R2ADiagnosticContext(metrics);
    context.subphase = "R2A_SCHEMA_PARSE";
    const diagnostic = context.failure(error).r2aDiagnostic;
    expect(diagnostic.schemaFailureClasses).toEqual([
      "DUPLICATE_EVIDENCE_ID",
      "CONFLICT_MEMBER_LINK",
      "OTHER_SCHEMA_INVALID",
    ]);
    expect(JSON.stringify(diagnostic)).not.toContain(marker);
    const persistenceDiagnostic = createSourcePersistenceDiagnostic({
      phase: "R2A_NORMALIZATION",
      recordIndex: 18,
      externalId: marker,
      provider: "GREENHOUSE",
      error: context.failure(error),
      pageProviderRecordCount: 29,
      acceptedRecordCount: 29,
      unusableRecordCount: 0,
    });
    expect(persistenceDiagnostic.r2a?.schemaFailureClasses).toEqual(
      diagnostic.schemaFailureClasses,
    );
    const audit = validateSourceAuditMetadata("source.run.stopped", {
      runId: "fictional-run",
      code: "PERSISTENCE_FAILED",
      transportStage: "PERSISTENCE",
      persistenceDiagnostic,
      requestCount: 1,
      recordCount: 29,
    });
    expect(JSON.stringify(audit)).not.toContain(marker);
    expect(JSON.stringify(audit)).toContain("DUPLICATE_EVIDENCE_ID");
    expect(classifyR2ASchemaFailure(new Error(marker))).toBeNull();
    expect(
      R2AFailureDiagnosticSchema.safeParse({ ...diagnostic, schemaFailureClasses: [marker] })
        .success,
    ).toBe(false);
    expect(
      R2AFailureDiagnosticSchema.safeParse({
        ...diagnostic,
        schemaFailureClasses: ["DUPLICATE_EVIDENCE_ID", "DUPLICATE_EVIDENCE_ID"],
      }).success,
    ).toBe(false);
    expect(
      R2AFailureDiagnosticSchema.safeParse({ ...diagnostic, subphase: "R2A_FIELD_EVIDENCE" })
        .success,
    ).toBe(false);
    expect(
      R2AFailureDiagnosticSchema.safeParse({ ...diagnostic, schemaFailureClasses: [] }).success,
    ).toBe(false);
    expect(R2AFailureDiagnosticSchema.safeParse({ ...diagnostic, message: marker }).success).toBe(
      false,
    );
    context.subphase = "R2A_FIELD_EVIDENCE";
    expect(context.failure(error).r2aDiagnostic).not.toHaveProperty("schemaFailureClasses");
    expect(
      R2AFailureDiagnosticSchema.safeParse({
        subphase: "R2A_SCHEMA_PARSE",
        rangeErrorClass: null,
        structuralBudget: null,
        metrics,
      }).success,
    ).toBe(true);
  });
});
