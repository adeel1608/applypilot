import {
  R2AFailureDiagnosticSchema,
  SourcePersistenceDomainCodeSchema,
  classifyR2ARangeError,
  type R2AFailureDiagnostic,
  type R2AStructuralMetrics,
  type R2ASubphase,
} from "@applypilot/job-sources";

const metricLimits = { depth: 4096, nodes: 50_000, string: 2_000_000 } as const;

function measureStructure(root: unknown) {
  const result = {
    maxDepth: 0,
    nodeCount: 0,
    scalarCount: 0,
    maxArrayLength: 0,
    maxStringLength: 0,
    metricsCapped: false,
  };
  const ancestors = new Set<object>();
  type Frame =
    | { value: unknown; depth: number }
    | { iterator: Iterator<unknown>; object: object; depth: number };
  const stack: Frame[] = [{ value: root, depth: 0 }];
  while (stack.length) {
    if (result.nodeCount === metricLimits.nodes) {
      result.metricsCapped = true;
      break;
    }
    const frame = stack.pop()!;
    if ("iterator" in frame) {
      const next = frame.iterator.next();
      if (next.done) {
        ancestors.delete(frame.object);
        continue;
      }
      stack.push(frame, { value: next.value, depth: frame.depth });
      continue;
    }
    const { value, depth } = frame;
    result.nodeCount += 1;
    result.maxDepth = Math.max(result.maxDepth, Math.min(depth, metricLimits.depth));
    if (typeof value === "string") {
      result.maxStringLength = Math.max(
        result.maxStringLength,
        Math.min(value.length, metricLimits.string),
      );
      if (value.length > metricLimits.string) result.metricsCapped = true;
    }
    if (!value || typeof value !== "object") {
      result.scalarCount += 1;
      continue;
    }
    if (Array.isArray(value)) {
      result.maxArrayLength = Math.max(
        result.maxArrayLength,
        Math.min(value.length, metricLimits.nodes),
      );
      if (value.length > metricLimits.nodes) result.metricsCapped = true;
    }
    if (depth >= metricLimits.depth || ancestors.has(value)) {
      result.metricsCapped = true;
      continue;
    }
    ancestors.add(value);
    // Iterators retain at most one child per depth, even for very wide arrays.
    const iterator = Array.isArray(value) ? value.values() : Object.values(value).values();
    stack.push({ iterator, object: value, depth: depth + 1 });
  }
  return result;
}

function structureBucket(value: unknown): R2AStructuralMetrics["departments"] {
  const { maxDepth, nodeCount } = measureStructure(value);
  return {
    depth:
      maxDepth <= 4
        ? "DEPTH_0_4"
        : maxDepth <= 16
          ? "DEPTH_5_16"
          : maxDepth <= 64
            ? "DEPTH_17_64"
            : maxDepth <= 256
              ? "DEPTH_65_256"
              : "DEPTH_257_PLUS",
    nodes:
      nodeCount <= 16
        ? "NODES_0_16"
        : nodeCount <= 256
          ? "NODES_17_256"
          : nodeCount <= 4096
            ? "NODES_257_4096"
            : "NODES_4097_PLUS",
  };
}

export function r2aStructuralMetrics(
  structured: Record<string, unknown>,
  sourceTextLength: number,
  structuredJsonLength: number | null = null,
  diagnosticStructure: Record<string, unknown> = structured,
): R2AStructuralMetrics {
  const measured = measureStructure(diagnosticStructure);
  const descriptionLength =
    typeof diagnosticStructure.description === "string"
      ? diagnosticStructure.description.length
      : 0;
  return {
    ...measured,
    sourceTextLength: Math.min(sourceTextLength, metricLimits.string),
    structuredJsonLength:
      structuredJsonLength === null ? null : Math.min(structuredJsonLength, metricLimits.string),
    descriptionLength: Math.min(descriptionLength, metricLimits.string),
    metricsCapped:
      measured.metricsCapped ||
      sourceTextLength > metricLimits.string ||
      (structuredJsonLength ?? 0) > metricLimits.string,
    departments: structureBucket(diagnosticStructure.departments),
    offices: structureBucket(diagnosticStructure.offices),
    providerMetadata: structureBucket(diagnosticStructure.providerMetadata),
  };
}

export function r2aStructureBudget(
  structured: Record<string, unknown>,
  sourceTextLength: number,
): "SOURCE_LENGTH" | "DEPTH" | "NODES" | "ARRAY_LENGTH" | "STRING_LENGTH" | null {
  if (sourceTextLength > 2_000_000) return "SOURCE_LENGTH";
  const metrics = measureStructure(structured);
  if (metrics.maxDepth > 128) return "DEPTH";
  if (metrics.nodeCount > 50_000 || metrics.metricsCapped) return "NODES";
  if (metrics.maxArrayLength > 10_000) return "ARRAY_LENGTH";
  if (metrics.maxStringLength > 262_144) return "STRING_LENGTH";
  return null;
}

export class R2ADiagnosticError extends Error {
  readonly r2aDiagnostic: R2AFailureDiagnostic;

  constructor(diagnostic: R2AFailureDiagnostic, safeCode = "R2A_NORMALIZATION_FAILED") {
    super(safeCode);
    this.name = "R2ADiagnosticError";
    this.r2aDiagnostic = R2AFailureDiagnosticSchema.parse(diagnostic);
  }
}

export class R2ADiagnosticContext {
  subphase: R2ASubphase = "R2A_OTHER";
  constructor(readonly metrics: R2AStructuralMetrics) {}

  at<T>(subphase: R2ASubphase, action: () => T): T {
    const parent = this.subphase;
    this.subphase = subphase;
    const value = action();
    this.subphase = parent;
    return value;
  }

  failure(error: unknown): R2ADiagnosticError {
    if (error instanceof R2ADiagnosticError) return error;
    const safeCode = SourcePersistenceDomainCodeSchema.safeParse(
      error instanceof Error ? error.message : null,
    );
    return new R2ADiagnosticError(
      {
        subphase: this.subphase,
        rangeErrorClass: classifyR2ARangeError(error),
        structuralBudget: null,
        metrics: this.metrics,
      },
      safeCode.success ? safeCode.data : undefined,
    );
  }
}

export function serializeR2AStructuredSource(structured: Record<string, unknown>): string {
  const context = new R2ADiagnosticContext(r2aStructuralMetrics(structured, 0));
  try {
    return context.at("R2A_SOURCE_SERIALIZE", () => JSON.stringify(structured));
  } catch (error) {
    throw context.failure(error);
  }
}
