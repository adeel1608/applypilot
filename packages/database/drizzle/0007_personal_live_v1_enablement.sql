PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE `source_capability_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `capability_id` text NOT NULL,
  `version` integer NOT NULL CHECK (`version` > 0),
  `predecessor_id` text,
  `source` text NOT NULL CHECK (`source` IN ('GREENHOUSE','LEVER')),
  `alias` text NOT NULL,
  `tenant` text NOT NULL,
  `region` text NOT NULL CHECK (`region` IN ('GLOBAL','EU')),
  `allowed_host` text NOT NULL,
  `allowed_path_prefix` text NOT NULL,
  `allowed_operations_json` text NOT NULL,
  `approval_state` text NOT NULL CHECK (`approval_state` IN ('DRAFT','APPROVED','REVOKED','EXPIRED','SUPERSEDED')),
  `approval_reference` text,
  `approved_at` text,
  `policy_version` text NOT NULL,
  `policy_reviewed_at` text NOT NULL,
  `policy_expires_at` text NOT NULL,
  `capability_expires_at` text NOT NULL,
  `request_budget` integer NOT NULL CHECK (`request_budget` BETWEEN 1 AND 30),
  `record_cap` integer NOT NULL CHECK (`record_cap` BETWEEN 1 AND 500),
  `page_size_cap` integer NOT NULL CHECK (`page_size_cap` BETWEEN 1 AND 100),
  `response_byte_limit` integer NOT NULL CHECK (`response_byte_limit` BETWEEN 1 AND 5000000),
  `request_timeout_ms` integer NOT NULL CHECK (`request_timeout_ms` BETWEEN 100 AND 30000),
  `run_timeout_ms` integer NOT NULL CHECK (`run_timeout_ms` BETWEEN 200 AND 300000),
  `max_redirects` integer NOT NULL CHECK (`max_redirects` BETWEEN 0 AND 3),
  `max_retries` integer NOT NULL CHECK (`max_retries` BETWEEN 0 AND 2),
  `max_concurrency` integer NOT NULL CHECK (`max_concurrency` = 1),
  `parser_version` text NOT NULL,
  `configuration_digest` text NOT NULL CHECK (length(`configuration_digest`) = 64),
  `revoked_at` text,
  `revocation_reason` text CHECK (`revocation_reason` IS NULL OR `revocation_reason` IN ('OWNER_REVOKED','POLICY_CHANGED','SECURITY_STOP','SUPERSEDED')),
  `created_at` text NOT NULL,
  FOREIGN KEY (`predecessor_id`) REFERENCES `source_capability_versions`(`id`) ON DELETE RESTRICT,
  UNIQUE (`capability_id`,`version`),
  UNIQUE (`capability_id`,`configuration_digest`),
  CHECK ((`approval_state` = 'APPROVED' AND `approval_reference` IS NOT NULL AND `approved_at` IS NOT NULL AND `revoked_at` IS NULL AND `revocation_reason` IS NULL)
      OR (`approval_state` NOT IN ('APPROVED','REVOKED','SUPERSEDED') AND `approval_reference` IS NULL AND `approved_at` IS NULL AND `revoked_at` IS NULL AND `revocation_reason` IS NULL)
      OR (`approval_state` IN ('REVOKED','SUPERSEDED') AND `approval_reference` IS NULL AND `approved_at` IS NULL AND `revoked_at` IS NOT NULL AND `revocation_reason` IS NOT NULL)),
  CHECK (`page_size_cap` <= `record_cap`),
  CHECK (`run_timeout_ms` > `request_timeout_ms`)
);
CREATE INDEX `source_capability_approval_state_idx`
  ON `source_capability_versions` (`capability_id`,`approval_state`,`version`);
CREATE INDEX `source_capability_tenant_idx`
  ON `source_capability_versions` (`source`,`region`,`tenant`,`version`);

CREATE TABLE `source_run_checkpoints` (
  `id` text PRIMARY KEY NOT NULL,
  `capability_version_id` text NOT NULL,
  `capability_digest` text NOT NULL CHECK (length(`capability_digest`) = 64),
  `operation` text NOT NULL CHECK (`operation` IN ('LIST_JOBS','GET_JOB')),
  `status` text NOT NULL CHECK (`status` IN ('RUNNING','COMPLETE','PARTIAL','STOPPED','OUTCOME_UNKNOWN')),
  `current_cursor` text,
  `next_cursor` text,
  `seen_page_digests_json` text NOT NULL DEFAULT '[]',
  `request_count` integer NOT NULL DEFAULT 0 CHECK (`request_count` BETWEEN 0 AND 30),
  `page_count` integer NOT NULL DEFAULT 0 CHECK (`page_count` BETWEEN 0 AND 30),
  `record_count` integer NOT NULL DEFAULT 0 CHECK (`record_count` BETWEEN 0 AND 500),
  `byte_count` integer NOT NULL DEFAULT 0 CHECK (`byte_count` >= 0),
  `retry_count` integer NOT NULL DEFAULT 0 CHECK (`retry_count` BETWEEN 0 AND 2),
  `redirect_count` integer NOT NULL DEFAULT 0 CHECK (`redirect_count` BETWEEN 0 AND 3),
  `safe_error_code` text,
  `retry_after` text,
  `owner_started_at` text NOT NULL,
  `owner_cancelled_at` text,
  `completed_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`capability_version_id`) REFERENCES `source_capability_versions`(`id`) ON DELETE RESTRICT
);
CREATE INDEX `source_run_capability_time_idx`
  ON `source_run_checkpoints` (`capability_version_id`,`owner_started_at`);
CREATE UNIQUE INDEX `source_run_one_active_idx`
  ON `source_run_checkpoints` (`capability_version_id`) WHERE `status` = 'RUNNING';

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
  UNIQUE (`run_id`,`page_number`),
  UNIQUE (`run_id`,`page_digest`)
);

CREATE TABLE `source_observation_payloads` (
  `observation_id` text PRIMARY KEY NOT NULL,
  `payload_json` text NOT NULL,
  `content_digest` text NOT NULL CHECK (length(`content_digest`) = 64),
  `created_at` text NOT NULL,
  FOREIGN KEY (`observation_id`) REFERENCES `source_observations`(`id`) ON DELETE CASCADE
);

CREATE TABLE `runner_target_capability_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `capability_id` text NOT NULL,
  `version` integer NOT NULL CHECK (`version` > 0),
  `predecessor_id` text,
  `target_kind` text NOT NULL CHECK (`target_kind` IN ('SYNTHETIC_LOCAL','REAL_TARGET')),
  `alias` text NOT NULL,
  `allowed_origin` text NOT NULL,
  `allowed_path_prefix` text NOT NULL,
  `form_version` text NOT NULL,
  `adapter_version` text NOT NULL,
  `approval_state` text NOT NULL CHECK (`approval_state` IN ('DRAFT','APPROVED','REVOKED','EXPIRED','SUPERSEDED')),
  `approval_reference` text,
  `approved_at` text,
  `policy_version` text NOT NULL,
  `policy_expires_at` text NOT NULL,
  `capability_expires_at` text NOT NULL,
  `configuration_digest` text NOT NULL CHECK (length(`configuration_digest`) = 64),
  `revoked_at` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`predecessor_id`) REFERENCES `runner_target_capability_versions`(`id`) ON DELETE RESTRICT,
  UNIQUE (`capability_id`,`version`),
  UNIQUE (`capability_id`,`configuration_digest`)
);
CREATE INDEX `runner_target_approval_state_idx`
  ON `runner_target_capability_versions` (`capability_id`,`approval_state`,`version`);

CREATE TABLE `runner_run_bindings` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL UNIQUE,
  `target_capability_version_id` text,
  `packet_id` text NOT NULL,
  `packet_digest` text NOT NULL CHECK (length(`packet_digest`) = 64),
  `job_version_id` text NOT NULL,
  `profile_version_id` text NOT NULL,
  `evaluation_version_id` text NOT NULL,
  `documents_digest` text NOT NULL CHECK (length(`documents_digest`) = 64),
  `answers_digest` text NOT NULL CHECK (length(`answers_digest`) = 64),
  `disclosures_digest` text NOT NULL CHECK (length(`disclosures_digest`) = 64),
  `target_origin` text NOT NULL,
  `target_path` text NOT NULL,
  `form_version` text NOT NULL,
  `adapter_version` text NOT NULL,
  `unresolved_count` integer NOT NULL CHECK (`unresolved_count` >= 0),
  `created_at` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `application_runs`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`target_capability_version_id`) REFERENCES `runner_target_capability_versions`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`packet_id`) REFERENCES `application_packets`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`job_version_id`) REFERENCES `job_versions`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`profile_version_id`) REFERENCES `candidate_profile_versions`(`id`) ON DELETE RESTRICT
);

CREATE TABLE `runner_recovery_events` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `sequence` integer NOT NULL CHECK (`sequence` >= 0),
  `decision` text NOT NULL CHECK (`decision` IN ('PAUSE','RESUME_REFUSED','RESUME_APPROVED','OWNER_CANCELLED','OUTCOME_UNKNOWN','TERMINAL')),
  `reason_code` text NOT NULL,
  `safe_metadata_json` text NOT NULL,
  `occurred_at` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `application_runs`(`id`) ON DELETE CASCADE,
  UNIQUE (`run_id`,`sequence`)
);

PRAGMA user_version = 7;
COMMIT;
PRAGMA foreign_keys = ON;
