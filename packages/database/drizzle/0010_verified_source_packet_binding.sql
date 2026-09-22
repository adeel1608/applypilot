PRAGMA foreign_keys = OFF;
BEGIN;

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

PRAGMA user_version = 10;
COMMIT;
PRAGMA foreign_keys = ON;
