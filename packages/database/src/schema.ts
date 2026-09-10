import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const candidateProfiles = sqliteTable("candidate_profiles", {
  id: text("id").primaryKey(),
  activeVersionId: text("active_version_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const candidateProfileVersions = sqliteTable(
  "candidate_profile_versions",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => candidateProfiles.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("candidate_profile_versions_profile_version_idx").on(
      table.profileId,
      table.version,
    ),
  ],
);

export const jobSources = sqliteTable("job_sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  capabilitiesJson: text("capabilities_json").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    category: text("category").notNull(),
    location: text("location").notNull(),
    employmentType: text("employment_type").notNull(),
    normalizedJson: text("normalized_json").notNull(),
    eligibilityStatus: text("eligibility_status"),
    fitScore: integer("fit_score"),
    applicationStatus: text("application_status").notNull().default("NEW"),
    datePosted: text("date_posted"),
    dateDiscovered: text("date_discovered").notNull(),
    dateUpdated: text("date_updated"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("jobs_company_title_idx").on(table.company, table.title),
    index("jobs_status_score_idx").on(table.eligibilityStatus, table.fitScore),
  ],
);

export const jobSourceRecords = sqliteTable(
  "job_source_records",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => jobSources.id),
    externalId: text("external_id"),
    sourceUrl: text("source_url"),
    rawPayloadJson: text("raw_payload_json").notNull(),
    payloadHash: text("payload_hash").notNull(),
    discoveredAt: text("discovered_at").notNull(),
    fetchedAt: text("fetched_at"),
    identityKind: text("identity_kind").notNull(),
    identityValue: text("identity_value").notNull(),
    acquisitionMethod: text("acquisition_method").notNull(),
  },
  (table) => [
    uniqueIndex("job_source_records_source_identity_idx").on(
      table.sourceId,
      table.identityKind,
      table.identityValue,
    ),
    uniqueIndex("job_source_records_source_external_idx").on(table.sourceId, table.externalId),
    index("job_source_records_job_idx").on(table.jobId),
  ],
);

export const importBatches = sqliteTable(
  "import_batches",
  {
    id: text("id").primaryKey(),
    inputType: text("input_type").notNull(),
    acquisitionMethod: text("acquisition_method").notNull(),
    sourceHint: text("source_hint"),
    detectedSource: text("detected_source").notNull(),
    originalFilename: text("original_filename"),
    sourceUrl: text("source_url"),
    contentHash: text("content_hash").notNull(),
    parserVersion: text("parser_version").notNull(),
    contentLength: integer("content_length").notNull(),
    detectedJobs: integer("detected_jobs").notNull().default(0),
    warningsJson: text("warnings_json").notNull().default("[]"),
    rawContentText: text("raw_content_text").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    confirmedAt: text("confirmed_at"),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("import_batches_hash_time_idx").on(table.contentHash, table.createdAt),
    index("import_batches_status_time_idx").on(table.status, table.createdAt),
  ],
);

export const importRecords = sqliteTable(
  "import_records",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    splitStatus: text("split_status").notNull(),
    recordStatus: text("record_status").notNull(),
    detectedSource: text("detected_source").notNull(),
    acquisitionMethod: text("acquisition_method").notNull(),
    sourceConfidence: text("source_confidence").notNull(),
    externalId: text("external_id"),
    sourceUrl: text("source_url"),
    segmentContentHash: text("segment_content_hash").notNull(),
    identityKind: text("identity_kind"),
    identityValue: text("identity_value"),
    boundaryJson: text("boundary_json").notNull(),
    originalFieldsJson: text("original_fields_json").notNull(),
    editedFieldsJson: text("edited_fields_json"),
    overrideMetadataJson: text("override_metadata_json"),
    warningsJson: text("warnings_json").notNull().default("[]"),
    normalizedJobId: text("normalized_job_id").references(() => jobs.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    importedAt: text("imported_at"),
  },
  (table) => [
    uniqueIndex("import_records_batch_ordinal_idx").on(table.batchId, table.ordinal),
    index("import_records_batch_status_idx").on(table.batchId, table.recordStatus),
    index("import_records_identity_idx").on(table.identityKind, table.identityValue),
    index("import_records_job_idx").on(table.normalizedJobId),
  ],
);

export const eligibilityResults = sqliteTable(
  "eligibility_results",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    profileVersionId: text("profile_version_id")
      .notNull()
      .references(() => candidateProfileVersions.id),
    status: text("status").notNull(),
    reasonsJson: text("reasons_json").notNull(),
    engineVersion: text("engine_version").notNull(),
    evaluatedAt: text("evaluated_at").notNull(),
  },
  (table) => [index("eligibility_results_job_profile_idx").on(table.jobId, table.profileVersionId)],
);

export const fitScores = sqliteTable(
  "fit_scores",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    profileVersionId: text("profile_version_id")
      .notNull()
      .references(() => candidateProfileVersions.id),
    score: integer("score").notNull(),
    reasonsJson: text("reasons_json").notNull(),
    contributionsJson: text("contributions_json").notNull(),
    engineVersion: text("engine_version").notNull(),
    scoredAt: text("scored_at").notNull(),
  },
  (table) => [index("fit_scores_job_profile_idx").on(table.jobId, table.profileVersionId)],
);

export const generatedDocuments = sqliteTable(
  "generated_documents",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").references(() => jobs.id),
    profileVersionId: text("profile_version_id")
      .notNull()
      .references(() => candidateProfileVersions.id),
    type: text("type").notNull(),
    template: text("template").notNull(),
    fileName: text("file_name").notNull(),
    localPath: text("local_path").notNull(),
    contentHash: text("content_hash").notNull(),
    pageCount: integer("page_count"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("generated_documents_job_idx").on(table.jobId)],
);

export const applications = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    profileVersionId: text("profile_version_id")
      .notNull()
      .references(() => candidateProfileVersions.id),
    status: text("status").notNull().default("NEW"),
    source: text("source").notNull(),
    resumeDocumentId: text("resume_document_id").references(() => generatedDocuments.id),
    coverLetterDocumentId: text("cover_letter_document_id").references(() => generatedDocuments.id),
    submittedAt: text("submitted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("applications_status_idx").on(table.status)],
);

export const applicationEvents = sqliteTable(
  "application_events",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    eventType: text("event_type").notNull(),
    actor: text("actor").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [
    index("application_events_application_time_idx").on(table.applicationId, table.occurredAt),
  ],
);

export const applicationAnswers = sqliteTable(
  "application_answers",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id").references(() => applications.id, {
      onDelete: "cascade",
    }),
    questionKey: text("question_key").notNull(),
    questionText: text("question_text").notNull(),
    answerJson: text("answer_json"),
    certainty: text("certainty").notNull(),
    profileFactReferencesJson: text("profile_fact_references_json").notNull().default("[]"),
    confirmedAt: text("confirmed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("application_answers_application_idx").on(table.applicationId)],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    actor: text("actor").notNull(),
    redactedMetadataJson: text("redacted_metadata_json").notNull().default("{}"),
    occurredAt: text("occurred_at").notNull(),
  },
  (table) => [
    index("audit_events_entity_time_idx").on(table.entityType, table.entityId, table.occurredAt),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  classification: text("classification").notNull().default("LOCAL_PRIVATE"),
  updatedAt: text("updated_at").notNull(),
});

export const sourceObservations = sqliteTable("source_observations", {
  id: text("id").primaryKey(),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
  sourceRecordId: text("source_record_id").references(() => jobSourceRecords.id, {
    onDelete: "set null",
  }),
  source: text("source").notNull(),
  tenant: text("tenant"),
  externalId: text("external_id"),
  sourceUrl: text("source_url"),
  acquisitionMethod: text("acquisition_method").notNull(),
  contentHash: text("content_hash").notNull(),
  rawSnapshotReference: text("raw_snapshot_reference").notNull(),
  observedAt: text("observed_at").notNull(),
  postedAt: text("posted_at"),
  expiresAt: text("expires_at"),
  parserVersion: text("parser_version").notNull(),
  policyVersion: text("policy_version"),
  runId: text("run_id"),
  supersedesObservationId: text("supersedes_observation_id"),
});

export const jobVersions = sqliteTable("job_versions", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  normalizedJson: text("normalized_json").notNull(),
  contentDigest: text("content_digest"),
  sourceObservationId: text("source_observation_id").references(() => sourceObservations.id, {
    onDelete: "set null",
  }),
  createdAt: text("created_at").notNull(),
});

export const jobFieldEvidence = sqliteTable("job_field_evidence", {
  id: text("id").primaryKey(),
  jobVersionId: text("job_version_id")
    .notNull()
    .references(() => jobVersions.id, { onDelete: "cascade" }),
  fieldName: text("field_name").notNull(),
  sourceObservationId: text("source_observation_id").references(() => sourceObservations.id),
  sourcePath: text("source_path").notNull(),
  originalText: text("original_text").notNull(),
  normalizedValueJson: text("normalized_value_json").notNull(),
  certainty: text("certainty").notNull(),
  ruleId: text("rule_id").notNull(),
  extractorVersion: text("extractor_version").notNull(),
  createdAt: text("created_at").notNull(),
});

export const requirementEvidence = sqliteTable("requirement_evidence", {
  id: text("id").primaryKey(),
  jobVersionId: text("job_version_id")
    .notNull()
    .references(() => jobVersions.id, { onDelete: "cascade" }),
  sourceObservationId: text("source_observation_id").references(() => sourceObservations.id),
  sourcePath: text("source_path").notNull(),
  startOffset: integer("start_offset").notNull(),
  endOffset: integer("end_offset").notNull(),
  originalText: text("original_text").notNull(),
  normalizedProposition: text("normalized_proposition").notNull(),
  modality: text("modality").notNull(),
  kind: text("kind").notNull(),
  conditionText: text("condition_text"),
  certainty: text("certainty").notNull(),
  ruleId: text("rule_id").notNull(),
  extractorVersion: text("extractor_version").notNull(),
  createdAt: text("created_at").notNull(),
});

export const jobFieldEvidenceV2 = sqliteTable("job_field_evidence_v2", {
  id: text("id").primaryKey(),
  jobVersionId: text("job_version_id")
    .notNull()
    .references(() => jobVersions.id, { onDelete: "restrict" }),
  sourceObservationId: text("source_observation_id").references(() => sourceObservations.id, {
    onDelete: "restrict",
  }),
  family: text("family").notNull(),
  canonicalField: text("canonical_field").notNull(),
  evidenceState: text("evidence_state").notNull(),
  modality: text("modality"),
  sourcePath: text("source_path").notNull(),
  startOffset: integer("start_offset").notNull(),
  endOffset: integer("end_offset").notNull(),
  sourceLength: integer("source_length").notNull(),
  excerpt: text("excerpt").notNull(),
  excerptHash: text("excerpt_hash").notNull(),
  normalizedValueJson: text("normalized_value_json").notNull(),
  extractorVersion: text("extractor_version").notNull(),
  ruleId: text("rule_id").notNull(),
  ownerCorrectionId: text("owner_correction_id"),
  conflictSetId: text("conflict_set_id"),
  createdAt: text("created_at").notNull(),
});

export const requirementEvidenceV2 = sqliteTable("requirement_evidence_v2", {
  id: text("id").primaryKey(),
  jobVersionId: text("job_version_id")
    .notNull()
    .references(() => jobVersions.id, { onDelete: "restrict" }),
  sourceObservationId: text("source_observation_id").references(() => sourceObservations.id, {
    onDelete: "restrict",
  }),
  family: text("family").notNull(),
  canonicalKind: text("canonical_kind").notNull(),
  evidenceState: text("evidence_state").notNull(),
  modality: text("modality").notNull(),
  conditionText: text("condition_text"),
  sourcePath: text("source_path").notNull(),
  startOffset: integer("start_offset").notNull(),
  endOffset: integer("end_offset").notNull(),
  sourceLength: integer("source_length").notNull(),
  excerpt: text("excerpt").notNull(),
  excerptHash: text("excerpt_hash").notNull(),
  normalizedValueJson: text("normalized_value_json").notNull(),
  extractorVersion: text("extractor_version").notNull(),
  ruleId: text("rule_id").notNull(),
  ownerCorrectionId: text("owner_correction_id"),
  conflictSetId: text("conflict_set_id"),
  createdAt: text("created_at").notNull(),
});

export const evidenceDerivations = sqliteTable("evidence_derivations", {
  id: text("id").primaryKey(),
  derivedFieldEvidenceId: text("derived_field_evidence_id")
    .notNull()
    .references(() => jobFieldEvidenceV2.id, { onDelete: "restrict" }),
  inputFieldEvidenceId: text("input_field_evidence_id")
    .notNull()
    .references(() => jobFieldEvidenceV2.id, { onDelete: "restrict" }),
  ruleId: text("rule_id").notNull(),
  ruleVersion: text("rule_version").notNull(),
  createdAt: text("created_at").notNull(),
});

export const jobNormalizationCoverage = sqliteTable("job_normalization_coverage", {
  id: text("id").primaryKey(),
  jobVersionId: text("job_version_id")
    .notNull()
    .references(() => jobVersions.id, { onDelete: "restrict" }),
  family: text("family").notNull(),
  coverageState: text("coverage_state").notNull(),
  evidenceCount: integer("evidence_count").notNull(),
  evidenceIdsJson: text("evidence_ids_json").notNull(),
  unparsedSpansJson: text("unparsed_spans_json").notNull(),
  parserVersion: text("parser_version").notNull(),
  createdAt: text("created_at").notNull(),
});

export const jobCorrections = sqliteTable("job_corrections", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  fromJobVersionId: text("from_job_version_id")
    .notNull()
    .references(() => jobVersions.id),
  toJobVersionId: text("to_job_version_id")
    .notNull()
    .references(() => jobVersions.id),
  actor: text("actor").notNull(),
  reasonCode: text("reason_code").notNull(),
  changedFieldsJson: text("changed_fields_json").notNull(),
  beforeDigest: text("before_digest").notNull(),
  afterDigest: text("after_digest").notNull(),
  createdAt: text("created_at").notNull(),
});

export const duplicateClusters = sqliteTable("duplicate_clusters", {
  id: text("id").primaryKey(),
  canonicalJobId: text("canonical_job_id").references(() => jobs.id),
  state: text("state").notNull(),
  reasonCodesJson: text("reason_codes_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const duplicateClusterMembers = sqliteTable("duplicate_cluster_members", {
  clusterId: text("cluster_id")
    .notNull()
    .references(() => duplicateClusters.id, {
      onDelete: "cascade",
    }),
  sourceObservationId: text("source_observation_id")
    .notNull()
    .references(() => sourceObservations.id, { onDelete: "cascade" }),
  decision: text("decision").notNull(),
  addedAt: text("added_at").notNull(),
});

export const evaluationVersions = sqliteTable("evaluation_versions", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  jobVersionId: text("job_version_id").references(() => jobVersions.id),
  profileVersionId: text("profile_version_id")
    .notNull()
    .references(() => candidateProfileVersions.id),
  evaluationContext: text("evaluation_context").notNull(),
  eligibilityStatus: text("eligibility_status").notNull(),
  eligibilityReasonsJson: text("eligibility_reasons_json").notNull(),
  fitScore: integer("fit_score").notNull(),
  fitContributionsJson: text("fit_contributions_json").notNull(),
  coverageJson: text("coverage_json").notNull(),
  eligibilityEngineVersion: text("eligibility_engine_version").notNull(),
  fitEngineVersion: text("fit_engine_version").notNull(),
  weightVersion: text("weight_version").notNull(),
  stale: integer("stale", { mode: "boolean" }).notNull().default(false),
  evaluatedAt: text("evaluated_at").notNull(),
});

export const calibrationLabels = sqliteTable("calibration_labels", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  reasonCodesJson: text("reason_codes_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const calibrationPairs = sqliteTable("calibration_pairs", {
  id: text("id").primaryKey(),
  preferredJobId: text("preferred_job_id")
    .notNull()
    .references(() => jobs.id),
  otherJobId: text("other_job_id")
    .notNull()
    .references(() => jobs.id),
  reasonCodesJson: text("reason_codes_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const jobQueueEntries = sqliteTable("job_queue_entries", {
  jobId: text("job_id")
    .primaryKey()
    .references(() => jobs.id, { onDelete: "cascade" }),
  state: text("state").notNull(),
  evaluationVersionId: text("evaluation_version_id").references(() => evaluationVersions.id),
  reasonCode: text("reason_code").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const r2CalibrationRuns = sqliteTable("r2_calibration_runs", {
  id: text("id").primaryKey(),
  scorerVersion: text("scorer_version").notNull(),
  weightVersion: text("weight_version").notNull(),
  corpusVersion: text("corpus_version").notNull(),
  fictionalCaseCount: integer("fictional_case_count").notNull(),
  privateReviewedCount: integer("private_reviewed_count").notNull(),
  roleFamilyCount: integer("role_family_count").notNull(),
  statusCount: integer("status_count").notNull(),
  ordinalAgreementBasisPoints: integer("ordinal_agreement_basis_points").notNull(),
  topK: integer("top_k").notNull(),
  topKUtilityBasisPoints: integer("top_k_utility_basis_points").notNull(),
  state: text("state").notNull(),
  createdAt: text("created_at").notNull(),
});

export const r2EvaluationVersions = sqliteTable("r2_evaluation_versions", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "restrict" }),
  jobVersionId: text("job_version_id")
    .notNull()
    .references(() => jobVersions.id, { onDelete: "restrict" }),
  profileVersionId: text("profile_version_id")
    .notNull()
    .references(() => candidateProfileVersions.id, { onDelete: "restrict" }),
  evidenceContractVersion: text("evidence_contract_version").notNull(),
  normalizationVersion: text("normalization_version").notNull(),
  coverageVersion: text("coverage_version").notNull(),
  eligibilityStatus: text("eligibility_status").notNull(),
  eligibilityReasonsJson: text("eligibility_reasons_json").notNull(),
  fitScore: integer("fit_score").notNull(),
  fitContributionsJson: text("fit_contributions_json").notNull(),
  eligibilityEngineVersion: text("eligibility_engine_version").notNull(),
  fitScorerVersion: text("fit_scorer_version").notNull(),
  weightVersion: text("weight_version").notNull(),
  calibrationState: text("calibration_state").notNull(),
  calibrationContextVersion: text("calibration_context_version").notNull(),
  calibrationRunId: text("calibration_run_id").references(() => r2CalibrationRuns.id, {
    onDelete: "restrict",
  }),
  recommended: integer("recommended", { mode: "boolean" }).notNull(),
  coveragePercent: integer("coverage_percent").notNull(),
  unresolvedUnknownCount: integer("unresolved_unknown_count").notNull(),
  unresolvedConditionCount: integer("unresolved_condition_count").notNull(),
  unresolvedConflictCount: integer("unresolved_conflict_count").notNull(),
  stale: integer("stale", { mode: "boolean" }).notNull().default(false),
  evaluatedAt: text("evaluated_at").notNull(),
});

export const r2DuplicateCandidates = sqliteTable("r2_duplicate_candidates", {
  id: text("id").primaryKey(),
  leftObservationId: text("left_observation_id")
    .notNull()
    .references(() => sourceObservations.id, { onDelete: "restrict" }),
  rightObservationId: text("right_observation_id")
    .notNull()
    .references(() => sourceObservations.id, { onDelete: "restrict" }),
  detectorVersion: text("detector_version").notNull(),
  state: text("state").notNull(),
  matchedSignalsJson: text("matched_signals_json").notNull(),
  conflictingSignalsJson: text("conflicting_signals_json").notNull(),
  evidenceDigest: text("evidence_digest").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const r2DuplicateDecisionVersions = sqliteTable("r2_duplicate_decision_versions", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id")
    .notNull()
    .references(() => r2DuplicateCandidates.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  decision: text("decision").notNull(),
  actor: text("actor").notNull(),
  reasonCode: text("reason_code").notNull(),
  evidenceVersion: text("evidence_version").notNull(),
  supersedesDecisionId: text("supersedes_decision_id"),
  createdAt: text("created_at").notNull(),
});

export const r2QueueDecisionVersions = sqliteTable("r2_queue_decision_versions", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  state: text("state").notNull(),
  freshness: text("freshness").notNull(),
  jobVersionId: text("job_version_id")
    .notNull()
    .references(() => jobVersions.id, { onDelete: "restrict" }),
  profileVersionId: text("profile_version_id")
    .notNull()
    .references(() => candidateProfileVersions.id, { onDelete: "restrict" }),
  r2EvaluationId: text("r2_evaluation_id")
    .notNull()
    .references(() => r2EvaluationVersions.id, { onDelete: "restrict" }),
  evidenceContractVersion: text("evidence_contract_version").notNull(),
  duplicateResolutionVersion: text("duplicate_resolution_version").notNull(),
  coverageVersion: text("coverage_version").notNull(),
  actor: text("actor").notNull(),
  reasonCode: text("reason_code").notNull(),
  supersedesDecisionId: text("supersedes_decision_id"),
  createdAt: text("created_at").notNull(),
});

export const r2CorrectionOverlayBindings = sqliteTable("r2_correction_overlay_bindings", {
  id: text("id").primaryKey(),
  correctionId: text("correction_id")
    .notNull()
    .references(() => jobCorrections.id, { onDelete: "restrict" }),
  targetKind: text("target_kind").notNull(),
  targetKey: text("target_key").notNull(),
  sourceObservationId: text("source_observation_id")
    .notNull()
    .references(() => sourceObservations.id, { onDelete: "restrict" }),
  sourceValueDigest: text("source_value_digest").notNull(),
  correctedValueJson: text("corrected_value_json").notNull(),
  applicabilityRuleVersion: text("applicability_rule_version").notNull(),
  createdAt: text("created_at").notNull(),
});

export const r2AuditEvents = sqliteTable("r2_audit_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  safeMetadataJson: text("safe_metadata_json").notNull(),
  occurredAt: text("occurred_at").notNull(),
});

export const documentArtifacts = sqliteTable("document_artifacts", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  jobVersionId: text("job_version_id").references(() => jobVersions.id),
  profileVersionId: text("profile_version_id")
    .notNull()
    .references(() => candidateProfileVersions.id),
  type: text("type").notNull(),
  template: text("template").notNull(),
  format: text("format").notNull(),
  fileName: text("file_name").notNull(),
  localPath: text("local_path").notNull(),
  contentDigest: text("content_digest").notNull(),
  claimEvidenceJson: text("claim_evidence_json").notNull(),
  layoutResultJson: text("layout_result_json").notNull(),
  version: integer("version").notNull(),
  stale: integer("stale", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const documentApprovals = sqliteTable("document_approvals", {
  id: text("id").primaryKey(),
  documentArtifactId: text("document_artifact_id")
    .notNull()
    .references(() => documentArtifacts.id, { onDelete: "cascade" }),
  contentDigest: text("content_digest").notNull(),
  approvedBy: text("approved_by").notNull(),
  approvedAt: text("approved_at").notNull(),
  invalidatedAt: text("invalidated_at"),
  invalidationReason: text("invalidation_reason"),
});

export const applicationPackets = sqliteTable("application_packets", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  jobVersionId: text("job_version_id").references(() => jobVersions.id),
  profileVersionId: text("profile_version_id")
    .notNull()
    .references(() => candidateProfileVersions.id),
  evaluationVersionId: text("evaluation_version_id").references(() => evaluationVersions.id),
  targetUrl: text("target_url"),
  targetHost: text("target_host"),
  status: text("status").notNull(),
  readinessJson: text("readiness_json").notNull(),
  version: integer("version").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const applicationPacketDocuments = sqliteTable("application_packet_documents", {
  packetId: text("packet_id")
    .notNull()
    .references(() => applicationPackets.id, {
      onDelete: "cascade",
    }),
  documentArtifactId: text("document_artifact_id")
    .notNull()
    .references(() => documentArtifacts.id),
  required: integer("required", { mode: "boolean" }).notNull(),
});

export const applicationQuestions = sqliteTable("application_questions", {
  id: text("id").primaryKey(),
  packetId: text("packet_id")
    .notNull()
    .references(() => applicationPackets.id, {
      onDelete: "cascade",
    }),
  questionKey: text("question_key").notNull(),
  questionText: text("question_text").notNull(),
  optionsJson: text("options_json").notNull(),
  required: integer("required", { mode: "boolean" }).notNull(),
  sensitive: integer("sensitive", { mode: "boolean" }).notNull(),
  version: integer("version").notNull(),
  createdAt: text("created_at").notNull(),
});

export const applicationAnswerVersions = sqliteTable("application_answer_versions", {
  id: text("id").primaryKey(),
  questionId: text("question_id")
    .notNull()
    .references(() => applicationQuestions.id, {
      onDelete: "cascade",
    }),
  answerJson: text("answer_json"),
  certainty: text("certainty").notNull(),
  factReferencesJson: text("fact_references_json").notNull(),
  disclosureState: text("disclosure_state").notNull(),
  version: integer("version").notNull(),
  createdAt: text("created_at").notNull(),
});

export const applicationEventsV2 = sqliteTable("application_events_v2", {
  id: text("id").primaryKey(),
  applicationId: text("application_id").references(() => applications.id, { onDelete: "cascade" }),
  packetId: text("packet_id").references(() => applicationPackets.id),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  eventType: text("event_type").notNull(),
  actor: text("actor").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  metadataJson: text("metadata_json").notNull(),
  occurredAt: text("occurred_at").notNull(),
});

export const applicationRuns = sqliteTable("application_runs", {
  id: text("id").primaryKey(),
  packetId: text("packet_id")
    .notNull()
    .references(() => applicationPackets.id, {
      onDelete: "cascade",
    }),
  targetKind: text("target_kind").notNull(),
  targetHost: text("target_host").notNull(),
  formVersion: text("form_version").notNull(),
  state: text("state").notNull(),
  stopReason: text("stop_reason"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const runnerCheckpoints = sqliteTable("runner_checkpoints", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => applicationRuns.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  state: text("state").notNull(),
  safeMetadataJson: text("safe_metadata_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const finalActionConsents = sqliteTable("final_action_consents", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => applicationRuns.id, { onDelete: "cascade" }),
  packetDigest: text("packet_digest").notNull(),
  targetHost: text("target_host").notNull(),
  formVersion: text("form_version").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull(),
});

export const capabilityConfigs = sqliteTable("capability_configs", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  tenant: text("tenant").notNull(),
  region: text("region"),
  allowedHost: text("allowed_host").notNull(),
  allowedPathPrefix: text("allowed_path_prefix").notNull(),
  policyVersion: text("policy_version").notNull(),
  approved: integer("approved", { mode: "boolean" }).notNull(),
  expiresAt: text("expires_at").notNull(),
  requestBudget: integer("request_budget").notNull(),
  recordBudget: integer("record_budget").notNull(),
  createdAt: text("created_at").notNull(),
});

export const discoveryRuns = sqliteTable("discovery_runs", {
  id: text("id").primaryKey(),
  capabilityConfigId: text("capability_config_id")
    .notNull()
    .references(() => capabilityConfigs.id),
  status: text("status").notNull(),
  cursorJson: text("cursor_json"),
  requestCount: integer("request_count").notNull(),
  recordCount: integer("record_count").notNull(),
  safeErrorCode: text("safe_error_code"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

export const schema = {
  candidateProfiles,
  candidateProfileVersions,
  jobSources,
  jobSourceRecords,
  importBatches,
  importRecords,
  jobs,
  eligibilityResults,
  fitScores,
  generatedDocuments,
  applications,
  applicationEvents,
  applicationAnswers,
  auditEvents,
  settings,
  sourceObservations,
  jobVersions,
  jobFieldEvidence,
  requirementEvidence,
  jobFieldEvidenceV2,
  requirementEvidenceV2,
  evidenceDerivations,
  jobNormalizationCoverage,
  jobCorrections,
  duplicateClusters,
  duplicateClusterMembers,
  evaluationVersions,
  calibrationLabels,
  calibrationPairs,
  jobQueueEntries,
  r2EvaluationVersions,
  r2DuplicateCandidates,
  r2DuplicateDecisionVersions,
  r2QueueDecisionVersions,
  r2CorrectionOverlayBindings,
  r2CalibrationRuns,
  r2AuditEvents,
  documentArtifacts,
  documentApprovals,
  applicationPackets,
  applicationPacketDocuments,
  applicationQuestions,
  applicationAnswerVersions,
  applicationEventsV2,
  applicationRuns,
  runnerCheckpoints,
  finalActionConsents,
  capabilityConfigs,
  discoveryRuns,
};
