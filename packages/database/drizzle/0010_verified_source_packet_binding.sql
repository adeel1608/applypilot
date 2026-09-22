PRAGMA foreign_keys = OFF;
BEGIN;

-- 0007 made page_digest unique per run. Identical provider content at a
-- distinct cursor is still a distinct request/page, so rebuild this
-- disposable-only schema-10 table without that over-broad uniqueness rule.
ALTER TABLE `source_run_pages` RENAME TO `source_run_pages_legacy`;
CREATE TABLE `source_run_pages` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `page_number` integer NOT NULL CHECK (`page_number` > 0),
  `cursor` text NOT NULL,
  `next_cursor` text,
  `page_digest` text NOT NULL CHECK (length(`page_digest`) = 64),
  `request_count` integer NOT NULL CHECK (`request_count` >= 0),
  `record_count` integer NOT NULL CHECK (`record_count` >= 0),
  `byte_count` integer NOT NULL CHECK (`byte_count` >= 0),
  `created_at` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `source_run_checkpoints`(`id`) ON DELETE CASCADE,
  UNIQUE (`run_id`,`page_number`)
);
INSERT INTO `source_run_pages`
  (id,run_id,page_number,cursor,next_cursor,page_digest,request_count,record_count,byte_count,created_at)
SELECT id,run_id,page_number,cursor,next_cursor,page_digest,request_count,record_count,byte_count,created_at
FROM `source_run_pages_legacy`;
DROP TABLE `source_run_pages_legacy`;

ALTER TABLE `application_packets`
  ADD COLUMN `r2_evaluation_id` text REFERENCES `r2_evaluation_versions`(`id`) ON DELETE RESTRICT;

CREATE INDEX `application_packets_r2_evaluation_idx`
  ON `application_packets` (`r2_evaluation_id`);

CREATE TABLE `source_record_verifications` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `capability_version_id` text NOT NULL,
  `page_id` text NOT NULL,
  `source` text NOT NULL,
  `tenant` text,
  `external_id` text,
  `record_index` integer NOT NULL CHECK (`record_index` >= 0),
  `page_digest` text NOT NULL CHECK (length(`page_digest`) = 64),
  `content_hash` text CHECK (`content_hash` IS NULL OR length(`content_hash`) = 64),
  `source_observation_id` text,
  `job_version_id` text,
  `disposition` text NOT NULL CHECK (`disposition` IN ('ACCEPTED','UNUSABLE')),
  `qualification_state` text NOT NULL CHECK (`qualification_state` IN ('PAGE_PERSISTED','QUALIFIED')),
  `parser_version` text NOT NULL,
  `policy_version` text,
  `verified_at` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `source_run_checkpoints`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`capability_version_id`) REFERENCES `source_capability_versions`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`page_id`) REFERENCES `source_run_pages`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`source_observation_id`) REFERENCES `source_observations`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`job_version_id`) REFERENCES `job_versions`(`id`) ON DELETE RESTRICT,
  UNIQUE (`run_id`,`page_id`,`record_index`,`disposition`)
);

CREATE INDEX `source_record_verifications_external_idx`
  ON `source_record_verifications` (`source`,`tenant`,`external_id`,`qualification_state`,`verified_at`);
CREATE INDEX `source_record_verifications_content_idx`
  ON `source_record_verifications` (`content_hash`,`qualification_state`,`verified_at`);

CREATE TABLE `application_run_operations` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `binding_digest` text NOT NULL CHECK (length(`binding_digest`) = 64),
  `operation` text NOT NULL CHECK (`operation` IN ('MAP_FOR_FILL','FILL','UPLOAD','VERIFY','FILL_PREVIEW')),
  `operation_key` text NOT NULL,
  `state` text NOT NULL,
  `effect_json` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `application_runs`(`id`) ON DELETE RESTRICT,
  UNIQUE (`run_id`,`operation_key`)
);

CREATE INDEX `application_run_operations_run_idx`
  ON `application_run_operations` (`run_id`,`operation`,`created_at`);

CREATE TABLE `application_run_previews` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `packet_digest` text NOT NULL CHECK (length(`packet_digest`) = 64),
  `preview_digest` text NOT NULL CHECK (length(`preview_digest`) = 64),
  `snapshot_json` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `application_runs`(`id`) ON DELETE RESTRICT,
  UNIQUE (`run_id`)
);

PRAGMA user_version = 10;
COMMIT;
PRAGMA foreign_keys = ON;
