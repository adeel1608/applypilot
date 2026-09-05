PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE `job_source_records_new` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `source_id` text NOT NULL,
  `external_id` text,
  `source_url` text,
  `raw_payload_json` text NOT NULL,
  `payload_hash` text NOT NULL CHECK (`payload_hash` GLOB '[0-9a-f]*' AND length(`payload_hash`) = 64),
  `discovered_at` text NOT NULL,
  `fetched_at` text,
  `identity_kind` text NOT NULL CHECK (`identity_kind` IN ('EXTERNAL_ID','CANONICAL_URL','CONTENT_HASH','LOCAL_FINGERPRINT')),
  `identity_value` text NOT NULL,
  `acquisition_method` text NOT NULL CHECK (`acquisition_method` IN ('USER_SUPPLIED_CONTENT','FILE_UPLOAD','FIXTURE','APPROVED_SOURCE_FETCH','UNKNOWN')),
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_id`) REFERENCES `job_sources`(`id`) ON UPDATE no action ON DELETE no action,
  CHECK (
    (`identity_kind` = 'EXTERNAL_ID' AND `external_id` IS NOT NULL AND `identity_value` = `external_id`) OR
    (`identity_kind` = 'CANONICAL_URL' AND `source_url` IS NOT NULL AND `identity_value` = `source_url` AND `source_url` LIKE 'https://%') OR
    (`identity_kind` = 'CONTENT_HASH' AND `identity_value` = `payload_hash`) OR
    (`identity_kind` = 'LOCAL_FINGERPRINT' AND `identity_value` GLOB '[0-9a-f]*' AND length(`identity_value`) = 64)
  )
);

INSERT INTO `job_source_records_new`
  (`id`, `job_id`, `source_id`, `external_id`, `source_url`, `raw_payload_json`, `payload_hash`,
   `discovered_at`, `fetched_at`, `identity_kind`, `identity_value`, `acquisition_method`)
SELECT
  `id`, `job_id`, `source_id`, `external_id`, `source_url`, `raw_payload_json`, `payload_hash`,
  `discovered_at`, `fetched_at`, 'EXTERNAL_ID', `external_id`,
  CASE json_extract(`raw_payload_json`, '$.accessMode')
    WHEN 'FIXTURE_ONLY' THEN 'FIXTURE'
    WHEN 'USER_SUPPLIED_CONTENT' THEN 'USER_SUPPLIED_CONTENT'
    ELSE 'UNKNOWN'
  END
FROM `job_source_records`;

DROP TABLE `job_source_records`;
ALTER TABLE `job_source_records_new` RENAME TO `job_source_records`;
CREATE UNIQUE INDEX `job_source_records_source_identity_idx` ON `job_source_records` (`source_id`,`identity_kind`,`identity_value`);
CREATE UNIQUE INDEX `job_source_records_source_external_idx` ON `job_source_records` (`source_id`,`external_id`) WHERE `external_id` IS NOT NULL;
CREATE INDEX `job_source_records_job_idx` ON `job_source_records` (`job_id`);

CREATE TABLE `import_batches` (
  `id` text PRIMARY KEY NOT NULL,
  `input_type` text NOT NULL CHECK (`input_type` IN ('PASTED_SINGLE','PASTED_MULTI','PASTED_HTML','FILE_UPLOAD','URL')),
  `acquisition_method` text NOT NULL CHECK (`acquisition_method` IN ('USER_SUPPLIED_CONTENT','FILE_UPLOAD')),
  `source_hint` text,
  `detected_source` text NOT NULL,
  `original_filename` text,
  `source_url` text,
  `content_hash` text NOT NULL CHECK (`content_hash` GLOB '[0-9a-f]*' AND length(`content_hash`) = 64),
  `parser_version` text NOT NULL,
  `content_length` integer NOT NULL CHECK (`content_length` >= 0 AND `content_length` <= 1048576),
  `detected_jobs` integer DEFAULT 0 NOT NULL CHECK (`detected_jobs` >= 0 AND `detected_jobs` <= 100),
  `warnings_json` text DEFAULT '[]' NOT NULL,
  `raw_content_text` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('RECEIVED','PREVIEW_READY','CONFIRMED','COMPLETED','PARTIAL','FAILED')),
  `created_at` text NOT NULL,
  `confirmed_at` text,
  `completed_at` text
);
CREATE INDEX `import_batches_hash_time_idx` ON `import_batches` (`content_hash`,`created_at`);
CREATE INDEX `import_batches_status_time_idx` ON `import_batches` (`status`,`created_at`);

CREATE TABLE `import_records` (
  `id` text PRIMARY KEY NOT NULL,
  `batch_id` text NOT NULL,
  `ordinal` integer NOT NULL,
  `split_status` text NOT NULL CHECK (`split_status` IN ('CONFIDENT','REVIEW_REQUIRED','FAILED')),
  `record_status` text NOT NULL CHECK (`record_status` IN ('PREVIEW_READY','REVIEW_REQUIRED','SELECTED','SKIPPED','IMPORTED','UPDATED','DUPLICATE','FAILED')),
  `detected_source` text NOT NULL,
  `acquisition_method` text NOT NULL CHECK (`acquisition_method` IN ('USER_SUPPLIED_CONTENT','FILE_UPLOAD')),
  `source_confidence` text NOT NULL CHECK (`source_confidence` IN ('HIGH','MEDIUM','LOW')),
  `external_id` text,
  `source_url` text,
  `segment_content_hash` text NOT NULL CHECK (`segment_content_hash` GLOB '[0-9a-f]*' AND length(`segment_content_hash`) = 64),
  `identity_kind` text CHECK (`identity_kind` IN ('EXTERNAL_ID','CANONICAL_URL','CONTENT_HASH','LOCAL_FINGERPRINT')),
  `identity_value` text,
  `boundary_json` text NOT NULL,
  `original_fields_json` text NOT NULL,
  `edited_fields_json` text,
  `override_metadata_json` text,
  `warnings_json` text DEFAULT '[]' NOT NULL,
  `normalized_job_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `imported_at` text,
  FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`normalized_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
  UNIQUE (`batch_id`,`ordinal`),
  CHECK ((`identity_kind` IS NULL AND `identity_value` IS NULL) OR (`identity_kind` IS NOT NULL AND `identity_value` IS NOT NULL))
);
CREATE INDEX `import_records_batch_status_idx` ON `import_records` (`batch_id`,`record_status`);
CREATE INDEX `import_records_identity_idx` ON `import_records` (`identity_kind`,`identity_value`);
CREATE INDEX `import_records_job_idx` ON `import_records` (`normalized_job_id`);

PRAGMA user_version = 1;
COMMIT;
PRAGMA foreign_keys = ON;
