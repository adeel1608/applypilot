PRAGMA foreign_keys = ON;

CREATE TABLE `candidate_profiles` (
  `id` text PRIMARY KEY NOT NULL,
  `active_version_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE TABLE `candidate_profile_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `profile_id` text NOT NULL,
  `version` integer NOT NULL,
  `schema_version` integer NOT NULL,
  `snapshot_json` text NOT NULL,
  `content_hash` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`profile_id`) REFERENCES `candidate_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `candidate_profile_versions_profile_version_idx` ON `candidate_profile_versions` (`profile_id`,`version`);

CREATE TABLE `job_sources` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `capabilities_json` text NOT NULL,
  `enabled` integer DEFAULT false NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `job_sources_name_unique` ON `job_sources` (`name`);

CREATE TABLE `jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `company` text NOT NULL,
  `category` text NOT NULL,
  `location` text NOT NULL,
  `employment_type` text NOT NULL,
  `normalized_json` text NOT NULL,
  `eligibility_status` text,
  `fit_score` integer,
  `application_status` text DEFAULT 'NEW' NOT NULL,
  `date_posted` text,
  `date_discovered` text NOT NULL,
  `date_updated` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX `jobs_company_title_idx` ON `jobs` (`company`,`title`);
CREATE INDEX `jobs_status_score_idx` ON `jobs` (`eligibility_status`,`fit_score`);

CREATE TABLE `job_source_records` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `source_id` text NOT NULL,
  `external_id` text NOT NULL,
  `source_url` text NOT NULL,
  `raw_payload_json` text NOT NULL,
  `payload_hash` text NOT NULL,
  `discovered_at` text NOT NULL,
  `fetched_at` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_id`) REFERENCES `job_sources`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE UNIQUE INDEX `job_source_records_source_external_idx` ON `job_source_records` (`source_id`,`external_id`);
CREATE INDEX `job_source_records_job_idx` ON `job_source_records` (`job_id`);

CREATE TABLE `eligibility_results` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `profile_version_id` text NOT NULL,
  `status` text NOT NULL,
  `reasons_json` text NOT NULL,
  `engine_version` text NOT NULL,
  `evaluated_at` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`profile_version_id`) REFERENCES `candidate_profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX `eligibility_results_job_profile_idx` ON `eligibility_results` (`job_id`,`profile_version_id`);

CREATE TABLE `fit_scores` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `profile_version_id` text NOT NULL,
  `score` integer NOT NULL,
  `reasons_json` text NOT NULL,
  `contributions_json` text NOT NULL,
  `engine_version` text NOT NULL,
  `scored_at` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`profile_version_id`) REFERENCES `candidate_profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX `fit_scores_job_profile_idx` ON `fit_scores` (`job_id`,`profile_version_id`);

CREATE TABLE `generated_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text,
  `profile_version_id` text NOT NULL,
  `type` text NOT NULL,
  `template` text NOT NULL,
  `file_name` text NOT NULL,
  `local_path` text NOT NULL,
  `content_hash` text NOT NULL,
  `page_count` integer,
  `created_at` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`profile_version_id`) REFERENCES `candidate_profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX `generated_documents_job_idx` ON `generated_documents` (`job_id`);

CREATE TABLE `applications` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `profile_version_id` text NOT NULL,
  `status` text DEFAULT 'NEW' NOT NULL,
  `source` text NOT NULL,
  `resume_document_id` text,
  `cover_letter_document_id` text,
  `submitted_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`profile_version_id`) REFERENCES `candidate_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`resume_document_id`) REFERENCES `generated_documents`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`cover_letter_document_id`) REFERENCES `generated_documents`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX `applications_status_idx` ON `applications` (`status`);

CREATE TABLE `application_events` (
  `id` text PRIMARY KEY NOT NULL,
  `application_id` text NOT NULL,
  `from_status` text,
  `to_status` text NOT NULL,
  `event_type` text NOT NULL,
  `actor` text NOT NULL,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `occurred_at` text NOT NULL,
  FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `application_events_application_time_idx` ON `application_events` (`application_id`,`occurred_at`);

CREATE TABLE `application_answers` (
  `id` text PRIMARY KEY NOT NULL,
  `application_id` text,
  `question_key` text NOT NULL,
  `question_text` text NOT NULL,
  `answer_json` text,
  `certainty` text NOT NULL,
  `profile_fact_references_json` text DEFAULT '[]' NOT NULL,
  `confirmed_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `application_answers_application_idx` ON `application_answers` (`application_id`);

CREATE TABLE `audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `event_type` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `actor` text NOT NULL,
  `redacted_metadata_json` text DEFAULT '{}' NOT NULL,
  `occurred_at` text NOT NULL
);
CREATE INDEX `audit_events_entity_time_idx` ON `audit_events` (`entity_type`,`entity_id`,`occurred_at`);

CREATE TABLE `settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value_json` text NOT NULL,
  `classification` text DEFAULT 'LOCAL_PRIVATE' NOT NULL,
  `updated_at` text NOT NULL
);
