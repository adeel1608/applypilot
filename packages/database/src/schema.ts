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
};
