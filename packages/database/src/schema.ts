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
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    rawPayloadJson: text("raw_payload_json").notNull(),
    payloadHash: text("payload_hash").notNull(),
    discoveredAt: text("discovered_at").notNull(),
    fetchedAt: text("fetched_at").notNull(),
  },
  (table) => [
    uniqueIndex("job_source_records_source_external_idx").on(table.sourceId, table.externalId),
    index("job_source_records_job_idx").on(table.jobId),
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
