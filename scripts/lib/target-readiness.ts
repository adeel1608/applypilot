import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";

const ClassificationSummarySchema = z
  .object({
    visibleSectionCount: z.number().int().min(0).max(100),
    reviewRequiredCount: z.number().int().min(0).max(200),
    documentRequiredCount: z.number().int().min(0).max(200),
    unsupportedCount: z.number().int().min(0).max(200),
  })
  .strict();

const EvidenceRowSchema = z
  .object({
    id: z.string().min(1),
    state: z.literal("COMPLETED"),
    safeStopReason: z.null(),
    fieldCount: z.number().int().min(1).max(200),
    classificationSummaryJson: z.string().min(2).max(2_000),
    operation: z.literal("OPEN_AND_INSPECT_ONLY"),
    targetUrl: z.url(),
    targetOrigin: z.url(),
    targetPath: z.string().startsWith("/").max(2_000),
    bindingAllowedPathPrefix: z.string().startsWith("/").max(2_000),
    bindingFormVersion: z.string().min(1).max(100),
    bindingAdapterVersion: z.string().min(1).max(100),
    boundVersion: z.number().int().positive(),
    targetKind: z.literal("REAL_TARGET"),
    capabilityAllowedOrigin: z.url(),
    capabilityAllowedPathPrefix: z.string().startsWith("/").max(2_000),
    capabilityFormVersion: z.string().min(1).max(100),
    capabilityAdapterVersion: z.string().min(1).max(100),
    allowedOperationsJson: z.string().min(2).max(200),
    boundApprovalState: z.literal("APPROVED"),
    boundApprovedAt: z.iso.datetime(),
    boundConfigurationDigest: z.string().regex(/^[a-f0-9]{64}$/),
    terminalVersion: z.number().int().positive(),
    terminalState: z.literal("REVOKED"),
    terminalRevokedAt: z.iso.datetime(),
    terminalConfigurationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export interface FirstRealTargetValidationReadiness {
  state: "PROVEN" | "REQUIRED";
  completedInspectionCount: number;
}

function required(): FirstRealTargetValidationReadiness {
  return { state: "REQUIRED", completedInspectionCount: 0 };
}

function pathIsWithinScope(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
}

function isConsistentEvidence(row: z.infer<typeof EvidenceRowSchema>): boolean {
  let summary: z.infer<typeof ClassificationSummarySchema>;
  let operations: unknown;
  let target: URL;
  let targetOrigin: URL;
  let capabilityOrigin: URL;
  try {
    summary = ClassificationSummarySchema.parse(JSON.parse(row.classificationSummaryJson));
    operations = JSON.parse(row.allowedOperationsJson) as unknown;
    target = new URL(row.targetUrl);
    targetOrigin = new URL(row.targetOrigin);
    capabilityOrigin = new URL(row.capabilityAllowedOrigin);
  } catch {
    return false;
  }
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.hash ||
    targetOrigin.protocol !== "https:" ||
    targetOrigin.username ||
    targetOrigin.password ||
    capabilityOrigin.protocol !== "https:" ||
    capabilityOrigin.username ||
    capabilityOrigin.password ||
    targetOrigin.pathname !== "/" ||
    targetOrigin.search ||
    targetOrigin.hash ||
    capabilityOrigin.pathname !== "/" ||
    capabilityOrigin.search ||
    capabilityOrigin.hash
  ) {
    return false;
  }
  const targetPath = `${target.pathname}${target.search}`;
  const aggregateCount =
    summary.reviewRequiredCount + summary.documentRequiredCount + summary.unsupportedCount;
  return (
    Array.isArray(operations) &&
    operations.length === 1 &&
    operations[0] === "OPEN_AND_INSPECT_ONLY" &&
    target.origin === targetOrigin.origin &&
    targetOrigin.origin === capabilityOrigin.origin &&
    targetPath === row.targetPath &&
    row.bindingAllowedPathPrefix === row.capabilityAllowedPathPrefix &&
    pathIsWithinScope(row.targetPath, row.capabilityAllowedPathPrefix) &&
    row.bindingFormVersion === row.capabilityFormVersion &&
    row.bindingAdapterVersion === row.capabilityAdapterVersion &&
    row.terminalVersion === row.boundVersion + 1 &&
    aggregateCount <= row.fieldCount
  );
}

export function firstRealTargetValidationReadiness(
  database: BetterSqlite3.Database,
): FirstRealTargetValidationReadiness {
  const tables = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name IN ('runner_inspection_bindings','runner_target_capability_versions')`,
    )
    .all() as Array<{ name: string }>;
  if (tables.length !== 2) return required();

  const rawRows = database
    .prepare(
      `SELECT b.id,
              b.state,
              b.safe_stop_reason AS safeStopReason,
              b.field_count AS fieldCount,
              b.classification_summary_json AS classificationSummaryJson,
              b.operation,
              b.target_url AS targetUrl,
              b.target_origin AS targetOrigin,
              b.target_path AS targetPath,
              b.allowed_path_prefix AS bindingAllowedPathPrefix,
              b.form_version AS bindingFormVersion,
              b.adapter_version AS bindingAdapterVersion,
              c.version AS boundVersion,
              c.target_kind AS targetKind,
              c.allowed_origin AS capabilityAllowedOrigin,
              c.allowed_path_prefix AS capabilityAllowedPathPrefix,
              c.form_version AS capabilityFormVersion,
              c.adapter_version AS capabilityAdapterVersion,
              c.allowed_operations_json AS allowedOperationsJson,
              c.approval_state AS boundApprovalState,
              c.approved_at AS boundApprovedAt,
              c.configuration_digest AS boundConfigurationDigest,
              terminal.version AS terminalVersion,
              terminal.approval_state AS terminalState,
              terminal.revoked_at AS terminalRevokedAt,
              terminal.configuration_digest AS terminalConfigurationDigest
       FROM runner_inspection_bindings b
       JOIN runner_target_capability_versions c ON c.id=b.target_capability_version_id
       LEFT JOIN runner_target_capability_versions terminal
         ON terminal.predecessor_id=c.id AND terminal.version=c.version+1
       WHERE b.state='COMPLETED' AND c.target_kind='REAL_TARGET'
       ORDER BY b.updated_at,b.id
       LIMIT 101`,
    )
    .all();
  if (rawRows.length === 0 || rawRows.length > 100) return required();

  const rows = z.array(EvidenceRowSchema).safeParse(rawRows);
  if (!rows.success || !rows.data.every(isConsistentEvidence)) return required();
  return { state: "PROVEN", completedInspectionCount: rows.data.length };
}
