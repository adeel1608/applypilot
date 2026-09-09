import { createHash } from "node:crypto";

import type BetterSqlite3 from "better-sqlite3";
import {
  R2ANormalizationSchema,
  R2JobFieldEvidenceSchema,
  R2NormalizedValueSchema,
  R2RequirementEvidenceSchema,
  SourceEvidencePointerSchema,
  type R2ANormalization,
} from "@applypilot/job-model";

function stableId(jobVersionId: string, kind: string, id: string): string {
  return createHash("sha256").update(`${jobVersionId}\n${kind}\n${id}`).digest("hex");
}

export function r2aSemanticDigest(input: R2ANormalization): string {
  const value = R2ANormalizationSchema.parse(input);
  const sorted = <T>(items: T[]): T[] =>
    items.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return createHash("sha256")
    .update(
      JSON.stringify({
        parserVersion: value.parserVersion,
        evidenceContractVersion: value.evidenceContractVersion,
        normalizationVersion: value.normalizationVersion,
        fieldEvidence: sorted(
          value.fieldEvidence.map((item) => ({
            family: item.family,
            canonicalField: item.canonicalField,
            state: item.state,
            modality: item.modality,
            source: item.source,
            normalizedValue: item.normalizedValue,
            extractorVersion: item.extractorVersion,
            ruleId: item.ruleId,
          })),
        ),
        requirementEvidence: sorted(
          value.requirementEvidence.map((item) => ({
            family: item.family,
            canonicalKind: item.canonicalKind,
            state: item.state,
            modality: item.modality,
            condition: item.condition,
            source: item.source,
            normalizedValue: item.normalizedValue,
            extractorVersion: item.extractorVersion,
            ruleId: item.ruleId,
          })),
        ),
        conflicts: sorted(
          value.conflicts.map((item) => ({
            canonicalField: item.canonicalField,
            evidenceCount: item.evidenceIds.length,
          })),
        ),
        coverage: sorted(
          value.coverage.map((item) => ({
            family: item.family,
            state: item.state,
            unparsedSpans: item.unparsedSpans,
            parserVersion: item.parserVersion,
          })),
        ),
      }),
    )
    .digest("hex");
}

export interface R2APersistenceSummary {
  jobVersionId: string;
  fieldEvidenceCount: number;
  requirementEvidenceCount: number;
  coverageCount: number;
  conflictCount: number;
  unknownCoverageCount: number;
  created: boolean;
}

export class R2ARepository {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  available(): boolean {
    return Boolean(
      this.sqlite
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='job_field_evidence_v2'")
        .get(),
    );
  }

  recordNormalization(jobVersionId: string, input: R2ANormalization): R2APersistenceSummary {
    const normalization = R2ANormalizationSchema.parse(input);
    if (!this.available()) throw new Error("R2A_SCHEMA_NOT_AVAILABLE");
    const version = this.sqlite
      .prepare(
        `SELECT source_observation_id AS sourceObservationId
         FROM job_versions WHERE id = ?`,
      )
      .get(jobVersionId) as { sourceObservationId: string | null } | undefined;
    if (!version) throw new Error("R2A_JOB_VERSION_NOT_FOUND");
    if (version.sourceObservationId !== normalization.sourceObservationId) {
      throw new Error("R2A_OBSERVATION_VERSION_MISMATCH");
    }
    const linked = [...normalization.fieldEvidence, ...normalization.requirementEvidence].every(
      ({ sourceObservationId }) => sourceObservationId === normalization.sourceObservationId,
    );
    if (!linked) throw new Error("R2A_EVIDENCE_OBSERVATION_MISMATCH");
    const existing = Number(
      this.sqlite
        .prepare("SELECT count(*) FROM job_normalization_coverage WHERE job_version_id = ?")
        .pluck()
        .get(jobVersionId),
    );
    if (existing > 0) {
      const summary = this.summary(jobVersionId);
      const persisted = this.getNormalization(jobVersionId);
      if (
        !persisted ||
        r2aSemanticDigest(persisted) !== r2aSemanticDigest(normalization) ||
        summary.fieldEvidenceCount !== normalization.fieldEvidence.length ||
        summary.requirementEvidenceCount !== normalization.requirementEvidence.length ||
        summary.coverageCount !== normalization.coverage.length
      ) {
        throw new Error("R2A_IMMUTABLE_VERSION_CONFLICT");
      }
      return { ...summary, created: false };
    }

    const createdAt = this.now().toISOString();
    const fieldIds = new Map(
      normalization.fieldEvidence.map(({ id }) => [id, stableId(jobVersionId, "field", id)]),
    );
    const requirementIds = new Map(
      normalization.requirementEvidence.map(({ id }) => [
        id,
        stableId(jobVersionId, "requirement", id),
      ]),
    );
    const conflictIds = new Map(
      normalization.conflicts.map(({ id }) => [id, stableId(jobVersionId, "conflict", id)]),
    );

    this.sqlite.transaction(() => {
      const insertField = this.sqlite.prepare(
        `INSERT INTO job_field_evidence_v2
          (id, job_version_id, source_observation_id, family, canonical_field, evidence_state,
           modality, source_path, start_offset, end_offset, source_length, excerpt, excerpt_hash,
           normalized_value_json, extractor_version, rule_id, owner_correction_id, conflict_set_id,
           created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const evidence of normalization.fieldEvidence) {
        insertField.run(
          fieldIds.get(evidence.id),
          jobVersionId,
          evidence.sourceObservationId,
          evidence.family,
          evidence.canonicalField,
          evidence.state,
          evidence.modality,
          evidence.source.sourcePath,
          evidence.source.start,
          evidence.source.end,
          evidence.source.sourceLength,
          evidence.source.excerpt,
          evidence.source.excerptHash,
          JSON.stringify(evidence.normalizedValue),
          evidence.extractorVersion,
          evidence.ruleId,
          evidence.ownerCorrectionId,
          evidence.conflictSetId ? conflictIds.get(evidence.conflictSetId) : null,
          createdAt,
        );
      }

      const insertRequirement = this.sqlite.prepare(
        `INSERT INTO requirement_evidence_v2
          (id, job_version_id, source_observation_id, family, canonical_kind, evidence_state,
           modality, condition_text, source_path, start_offset, end_offset, source_length, excerpt,
           excerpt_hash, normalized_value_json, extractor_version, rule_id, owner_correction_id,
           conflict_set_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const evidence of normalization.requirementEvidence) {
        insertRequirement.run(
          requirementIds.get(evidence.id),
          jobVersionId,
          evidence.sourceObservationId,
          evidence.family,
          evidence.canonicalKind,
          evidence.state,
          evidence.modality,
          evidence.condition,
          evidence.source.sourcePath,
          evidence.source.start,
          evidence.source.end,
          evidence.source.sourceLength,
          evidence.source.excerpt,
          evidence.source.excerptHash,
          JSON.stringify(evidence.normalizedValue),
          evidence.extractorVersion,
          evidence.ruleId,
          evidence.ownerCorrectionId,
          evidence.conflictSetId ? conflictIds.get(evidence.conflictSetId) : null,
          createdAt,
        );
      }

      const insertDerivation = this.sqlite.prepare(
        `INSERT INTO evidence_derivations
          (id, derived_field_evidence_id, input_field_evidence_id, rule_id, rule_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const evidence of normalization.fieldEvidence) {
        if (evidence.state !== "DERIVED") continue;
        for (const inputId of evidence.derivationInputIds) {
          const derivedId = fieldIds.get(evidence.id);
          const persistedInputId = fieldIds.get(inputId);
          if (!derivedId || !persistedInputId) throw new Error("R2A_DERIVATION_INPUT_NOT_FOUND");
          insertDerivation.run(
            stableId(jobVersionId, "derivation", `${evidence.id}:${inputId}`),
            derivedId,
            persistedInputId,
            evidence.ruleId,
            evidence.extractorVersion,
            createdAt,
          );
        }
      }

      const insertCoverage = this.sqlite.prepare(
        `INSERT INTO job_normalization_coverage
          (id, job_version_id, family, coverage_state, evidence_count, evidence_ids_json,
           unparsed_spans_json, parser_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const coverage of normalization.coverage) {
        const persistedEvidenceIds = coverage.evidenceIds.map(
          (id) => fieldIds.get(id) ?? requirementIds.get(id) ?? id,
        );
        insertCoverage.run(
          stableId(jobVersionId, "coverage", coverage.family),
          jobVersionId,
          coverage.family,
          coverage.state,
          persistedEvidenceIds.length,
          JSON.stringify(persistedEvidenceIds),
          JSON.stringify(coverage.unparsedSpans),
          coverage.parserVersion,
          createdAt,
        );
      }
    })();
    return { ...this.summary(jobVersionId), created: true };
  }

  summary(jobVersionId: string): Omit<R2APersistenceSummary, "created"> {
    const fieldEvidenceCount = Number(
      this.sqlite
        .prepare("SELECT count(*) FROM job_field_evidence_v2 WHERE job_version_id = ?")
        .pluck()
        .get(jobVersionId),
    );
    const requirementEvidenceCount = Number(
      this.sqlite
        .prepare("SELECT count(*) FROM requirement_evidence_v2 WHERE job_version_id = ?")
        .pluck()
        .get(jobVersionId),
    );
    const coverageCount = Number(
      this.sqlite
        .prepare("SELECT count(*) FROM job_normalization_coverage WHERE job_version_id = ?")
        .pluck()
        .get(jobVersionId),
    );
    const conflictCount = Number(
      this.sqlite
        .prepare(
          `SELECT count(DISTINCT conflict_set_id) FROM (
             SELECT conflict_set_id FROM job_field_evidence_v2 WHERE job_version_id = ?
             UNION ALL
             SELECT conflict_set_id FROM requirement_evidence_v2 WHERE job_version_id = ?
           ) WHERE conflict_set_id IS NOT NULL`,
        )
        .pluck()
        .get(jobVersionId, jobVersionId),
    );
    const unknownCoverageCount = Number(
      this.sqlite
        .prepare(
          "SELECT count(*) FROM job_normalization_coverage WHERE job_version_id = ? AND coverage_state = 'UNKNOWN'",
        )
        .pluck()
        .get(jobVersionId),
    );
    return {
      jobVersionId,
      fieldEvidenceCount,
      requirementEvidenceCount,
      coverageCount,
      conflictCount,
      unknownCoverageCount,
    };
  }

  getNormalization(jobVersionId: string): R2ANormalization | null {
    if (!this.available()) return null;
    const version = this.sqlite
      .prepare("SELECT source_observation_id AS sourceObservationId FROM job_versions WHERE id = ?")
      .get(jobVersionId) as { sourceObservationId: string | null } | undefined;
    if (!version?.sourceObservationId) return null;
    type FieldRow = {
      id: string;
      sourceObservationId: string;
      family: string;
      canonicalField: string;
      evidenceState: string;
      modality: string | null;
      sourcePath: string;
      startOffset: number;
      endOffset: number;
      sourceLength: number;
      excerpt: string;
      excerptHash: string;
      normalizedValueJson: string;
      extractorVersion: string;
      ruleId: string;
      ownerCorrectionId: string | null;
      conflictSetId: string | null;
    };
    const fieldRows = this.sqlite
      .prepare(
        `SELECT id, source_observation_id AS sourceObservationId, family,
                canonical_field AS canonicalField, evidence_state AS evidenceState, modality,
                source_path AS sourcePath, start_offset AS startOffset, end_offset AS endOffset,
                source_length AS sourceLength, excerpt, excerpt_hash AS excerptHash,
                normalized_value_json AS normalizedValueJson, extractor_version AS extractorVersion,
                rule_id AS ruleId, owner_correction_id AS ownerCorrectionId,
                conflict_set_id AS conflictSetId
         FROM job_field_evidence_v2 WHERE job_version_id = ? ORDER BY rowid`,
      )
      .all(jobVersionId) as FieldRow[];
    const requirementRows = this.sqlite
      .prepare(
        `SELECT id, source_observation_id AS sourceObservationId, family,
                canonical_kind AS canonicalField, evidence_state AS evidenceState, modality,
                condition_text AS conditionText, source_path AS sourcePath,
                start_offset AS startOffset, end_offset AS endOffset, source_length AS sourceLength,
                excerpt, excerpt_hash AS excerptHash, normalized_value_json AS normalizedValueJson,
                extractor_version AS extractorVersion, rule_id AS ruleId,
                owner_correction_id AS ownerCorrectionId, conflict_set_id AS conflictSetId
         FROM requirement_evidence_v2 WHERE job_version_id = ? ORDER BY rowid`,
      )
      .all(jobVersionId) as Array<FieldRow & { conditionText: string | null }>;
    const derivations = this.sqlite
      .prepare(
        `SELECT derived_field_evidence_id AS derivedId, input_field_evidence_id AS inputId
         FROM evidence_derivations WHERE derived_field_evidence_id IN
           (SELECT id FROM job_field_evidence_v2 WHERE job_version_id = ?)`,
      )
      .all(jobVersionId) as Array<{ derivedId: string; inputId: string }>;
    const sourceFor = (row: FieldRow) =>
      SourceEvidencePointerSchema.parse({
        sourcePath: row.sourcePath,
        start: row.startOffset,
        end: row.endOffset,
        sourceLength: row.sourceLength,
        excerpt: row.excerpt,
        excerptHash: row.excerptHash,
      });
    const fieldEvidence = fieldRows.map((row) =>
      R2JobFieldEvidenceSchema.parse({
        id: row.id,
        sourceObservationId: row.sourceObservationId,
        jobVersionId,
        family: row.family,
        canonicalField: row.canonicalField,
        state: row.evidenceState,
        modality: row.modality,
        source: sourceFor(row),
        normalizedValue: R2NormalizedValueSchema.parse(JSON.parse(row.normalizedValueJson)),
        extractorVersion: row.extractorVersion,
        ruleId: row.ruleId,
        derivationInputIds: derivations
          .filter(({ derivedId }) => derivedId === row.id)
          .map(({ inputId }) => inputId),
        ownerCorrectionId: row.ownerCorrectionId,
        conflictSetId: row.conflictSetId,
      }),
    );
    const requirementEvidence = requirementRows.map((row) =>
      R2RequirementEvidenceSchema.parse({
        id: row.id,
        sourceObservationId: row.sourceObservationId,
        jobVersionId,
        family: row.family,
        canonicalKind: row.canonicalField,
        state: row.evidenceState,
        modality: row.modality,
        condition: row.conditionText,
        source: sourceFor(row),
        normalizedValue: R2NormalizedValueSchema.parse(JSON.parse(row.normalizedValueJson)),
        extractorVersion: row.extractorVersion,
        ruleId: row.ruleId,
        derivationInputIds: [],
        ownerCorrectionId: row.ownerCorrectionId,
        conflictSetId: row.conflictSetId,
      }),
    );
    const coverageRows = this.sqlite
      .prepare(
        `SELECT family, coverage_state AS coverageState, evidence_ids_json AS evidenceIdsJson,
                unparsed_spans_json AS unparsedSpansJson, parser_version AS parserVersion
         FROM job_normalization_coverage WHERE job_version_id = ? ORDER BY family`,
      )
      .all(jobVersionId) as Array<{
      family: string;
      coverageState: string;
      evidenceIdsJson: string;
      unparsedSpansJson: string;
      parserVersion: string;
    }>;
    if (coverageRows.length === 0) return null;
    const conflictGroups = new Map<string, string[]>();
    for (const item of [...fieldEvidence, ...requirementEvidence]) {
      if (!item.conflictSetId) continue;
      const ids = conflictGroups.get(item.conflictSetId) ?? [];
      ids.push(item.id);
      conflictGroups.set(item.conflictSetId, ids);
    }
    const sourceLength = Math.max(
      0,
      ...fieldEvidence.map(({ source }) => source.sourceLength),
      ...requirementEvidence.map(({ source }) => source.sourceLength),
    );
    return R2ANormalizationSchema.parse({
      sourceObservationId: version.sourceObservationId,
      sourceLength,
      parserVersion: coverageRows[0]?.parserVersion ?? "3.0.0",
      evidenceContractVersion: "3.0.0",
      normalizationVersion: "3.0.0",
      fieldEvidence,
      requirementEvidence,
      conflicts: [...conflictGroups].map(([id, evidenceIds]) => ({
        id,
        canonicalField:
          fieldEvidence.find((item) => item.conflictSetId === id)?.canonicalField ??
          requirementEvidence.find((item) => item.conflictSetId === id)?.canonicalKind ??
          "unknown",
        evidenceIds,
      })),
      coverage: coverageRows.map((row) => ({
        family: row.family,
        state: row.coverageState,
        evidenceIds: JSON.parse(row.evidenceIdsJson),
        unparsedSpans: JSON.parse(row.unparsedSpansJson),
        parserVersion: row.parserVersion,
      })),
    });
  }
}
