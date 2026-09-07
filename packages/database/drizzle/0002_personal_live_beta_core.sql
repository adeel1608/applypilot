PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE `source_observations` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text,
  `source_record_id` text,
  `source` text NOT NULL,
  `tenant` text,
  `external_id` text,
  `source_url` text,
  `acquisition_method` text NOT NULL,
  `content_hash` text NOT NULL CHECK (length(`content_hash`) = 64),
  `raw_snapshot_reference` text NOT NULL,
  `observed_at` text NOT NULL,
  `posted_at` text,
  `expires_at` text,
  `parser_version` text NOT NULL,
  `policy_version` text,
  `run_id` text,
  `supersedes_observation_id` text,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`source_record_id`) REFERENCES `job_source_records`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`supersedes_observation_id`) REFERENCES `source_observations`(`id`) ON DELETE SET NULL,
  UNIQUE (`source_record_id`,`content_hash`)
);
CREATE INDEX `source_observations_job_time_idx` ON `source_observations` (`job_id`,`observed_at`);
CREATE INDEX `source_observations_identity_idx` ON `source_observations` (`source`,`tenant`,`external_id`);

CREATE TABLE `job_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `version` integer NOT NULL CHECK (`version` > 0),
  `normalized_json` text NOT NULL,
  `content_digest` text,
  `source_observation_id` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`source_observation_id`) REFERENCES `source_observations`(`id`) ON DELETE SET NULL,
  UNIQUE (`job_id`,`version`)
);

CREATE TABLE `job_field_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `job_version_id` text NOT NULL,
  `field_name` text NOT NULL,
  `source_observation_id` text,
  `source_path` text NOT NULL,
  `original_text` text NOT NULL,
  `normalized_value_json` text NOT NULL,
  `certainty` text NOT NULL CHECK (`certainty` IN ('HIGH','MEDIUM','LOW')),
  `rule_id` text NOT NULL,
  `extractor_version` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`job_version_id`) REFERENCES `job_versions`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`source_observation_id`) REFERENCES `source_observations`(`id`) ON DELETE SET NULL
);
CREATE INDEX `job_field_evidence_version_field_idx` ON `job_field_evidence` (`job_version_id`,`field_name`);

CREATE TABLE `requirement_evidence` (
  `id` text PRIMARY KEY NOT NULL,
  `job_version_id` text NOT NULL,
  `source_observation_id` text,
  `source_path` text NOT NULL,
  `start_offset` integer NOT NULL CHECK (`start_offset` >= 0),
  `end_offset` integer NOT NULL CHECK (`end_offset` > `start_offset`),
  `original_text` text NOT NULL,
  `normalized_proposition` text NOT NULL,
  `modality` text NOT NULL CHECK (`modality` IN ('REQUIRED','PREFERRED','CONDITIONAL','UNKNOWN','NEGATED')),
  `kind` text NOT NULL,
  `condition_text` text,
  `certainty` text NOT NULL CHECK (`certainty` IN ('HIGH','MEDIUM','LOW')),
  `rule_id` text NOT NULL,
  `extractor_version` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`job_version_id`) REFERENCES `job_versions`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`source_observation_id`) REFERENCES `source_observations`(`id`) ON DELETE SET NULL
);
CREATE INDEX `requirement_evidence_version_modality_idx` ON `requirement_evidence` (`job_version_id`,`modality`,`kind`);

CREATE TABLE `job_corrections` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `from_job_version_id` text NOT NULL,
  `to_job_version_id` text NOT NULL,
  `actor` text NOT NULL CHECK (`actor` IN ('LOCAL_USER','SYSTEM')),
  `reason_code` text NOT NULL,
  `changed_fields_json` text NOT NULL,
  `before_digest` text NOT NULL,
  `after_digest` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`from_job_version_id`) REFERENCES `job_versions`(`id`),
  FOREIGN KEY (`to_job_version_id`) REFERENCES `job_versions`(`id`)
);

CREATE TABLE `duplicate_clusters` (
  `id` text PRIMARY KEY NOT NULL,
  `canonical_job_id` text,
  `state` text NOT NULL CHECK (`state` IN ('SUGGESTED','LINKED','REJECTED','SPLIT')),
  `reason_codes_json` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`canonical_job_id`) REFERENCES `jobs`(`id`) ON DELETE SET NULL
);
CREATE TABLE `duplicate_cluster_members` (
  `cluster_id` text NOT NULL,
  `source_observation_id` text NOT NULL,
  `decision` text NOT NULL,
  `added_at` text NOT NULL,
  PRIMARY KEY (`cluster_id`,`source_observation_id`),
  FOREIGN KEY (`cluster_id`) REFERENCES `duplicate_clusters`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`source_observation_id`) REFERENCES `source_observations`(`id`) ON DELETE CASCADE
);

CREATE TABLE `evaluation_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `job_version_id` text,
  `profile_version_id` text NOT NULL,
  `evaluation_context` text NOT NULL CHECK (`evaluation_context` IN ('PRIVATE_LOCAL_PROFILE','DEMO_PROFILE','UNKNOWN')),
  `eligibility_status` text NOT NULL,
  `eligibility_reasons_json` text NOT NULL,
  `fit_score` integer NOT NULL CHECK (`fit_score` BETWEEN 0 AND 100),
  `fit_contributions_json` text NOT NULL,
  `coverage_json` text NOT NULL,
  `eligibility_engine_version` text NOT NULL,
  `fit_engine_version` text NOT NULL,
  `weight_version` text NOT NULL,
  `stale` integer NOT NULL DEFAULT 0 CHECK (`stale` IN (0,1)),
  `evaluated_at` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`job_version_id`) REFERENCES `job_versions`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`profile_version_id`) REFERENCES `candidate_profile_versions`(`id`)
);
CREATE INDEX `evaluation_versions_job_time_idx` ON `evaluation_versions` (`job_id`,`evaluated_at`);

CREATE TABLE `calibration_labels` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `label` text NOT NULL CHECK (`label` IN ('GOOD_MATCH','POOR_MATCH','AMBIGUOUS')),
  `reason_codes_json` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE
);
CREATE TABLE `calibration_pairs` (
  `id` text PRIMARY KEY NOT NULL,
  `preferred_job_id` text NOT NULL,
  `other_job_id` text NOT NULL,
  `reason_codes_json` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`preferred_job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`other_job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  CHECK (`preferred_job_id` <> `other_job_id`)
);

CREATE TABLE `job_queue_entries` (
  `job_id` text PRIMARY KEY NOT NULL,
  `state` text NOT NULL CHECK (`state` IN ('REVIEWING','SHORTLISTED','SKIPPED','PREPARING')),
  `evaluation_version_id` text,
  `reason_code` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`evaluation_version_id`) REFERENCES `evaluation_versions`(`id`) ON DELETE SET NULL
);

CREATE TABLE `document_artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `job_version_id` text,
  `profile_version_id` text NOT NULL,
  `type` text NOT NULL CHECK (`type` IN ('CV','COVER_LETTER')),
  `template` text NOT NULL,
  `format` text NOT NULL CHECK (`format` IN ('PDF','DOCX')),
  `file_name` text NOT NULL,
  `local_path` text NOT NULL,
  `content_digest` text NOT NULL,
  `claim_evidence_json` text NOT NULL,
  `layout_result_json` text NOT NULL,
  `version` integer NOT NULL CHECK (`version` > 0),
  `stale` integer NOT NULL DEFAULT 0 CHECK (`stale` IN (0,1)),
  `created_at` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`job_version_id`) REFERENCES `job_versions`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`profile_version_id`) REFERENCES `candidate_profile_versions`(`id`),
  UNIQUE (`job_id`,`type`,`format`,`version`)
);
CREATE TABLE `document_approvals` (
  `id` text PRIMARY KEY NOT NULL,
  `document_artifact_id` text NOT NULL,
  `content_digest` text NOT NULL,
  `approved_by` text NOT NULL CHECK (`approved_by` = 'LOCAL_USER'),
  `approved_at` text NOT NULL,
  `invalidated_at` text,
  `invalidation_reason` text,
  FOREIGN KEY (`document_artifact_id`) REFERENCES `document_artifacts`(`id`) ON DELETE CASCADE
);

CREATE TABLE `application_packets` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `job_version_id` text,
  `profile_version_id` text NOT NULL,
  `evaluation_version_id` text,
  `target_url` text,
  `target_host` text,
  `status` text NOT NULL CHECK (`status` IN ('PREPARING','REVIEW_REQUIRED','READY_TO_APPLY','INVALIDATED')),
  `readiness_json` text NOT NULL,
  `version` integer NOT NULL CHECK (`version` > 0),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`job_version_id`) REFERENCES `job_versions`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`profile_version_id`) REFERENCES `candidate_profile_versions`(`id`),
  FOREIGN KEY (`evaluation_version_id`) REFERENCES `evaluation_versions`(`id`) ON DELETE SET NULL,
  UNIQUE (`job_id`,`version`)
);
CREATE TABLE `application_packet_documents` (
  `packet_id` text NOT NULL,
  `document_artifact_id` text NOT NULL,
  `required` integer NOT NULL CHECK (`required` IN (0,1)),
  PRIMARY KEY (`packet_id`,`document_artifact_id`),
  FOREIGN KEY (`packet_id`) REFERENCES `application_packets`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`document_artifact_id`) REFERENCES `document_artifacts`(`id`)
);
CREATE TABLE `application_questions` (
  `id` text PRIMARY KEY NOT NULL,
  `packet_id` text NOT NULL,
  `question_key` text NOT NULL,
  `question_text` text NOT NULL,
  `options_json` text NOT NULL,
  `required` integer NOT NULL CHECK (`required` IN (0,1)),
  `sensitive` integer NOT NULL CHECK (`sensitive` IN (0,1)),
  `version` integer NOT NULL CHECK (`version` > 0),
  `created_at` text NOT NULL,
  FOREIGN KEY (`packet_id`) REFERENCES `application_packets`(`id`) ON DELETE CASCADE,
  UNIQUE (`packet_id`,`question_key`,`version`)
);
CREATE TABLE `application_answer_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `question_id` text NOT NULL,
  `answer_json` text,
  `certainty` text NOT NULL CHECK (`certainty` IN ('VERIFIED_ANSWER','USER_CONFIRMATION_REQUIRED','UNKNOWN')),
  `fact_references_json` text NOT NULL,
  `disclosure_state` text NOT NULL CHECK (`disclosure_state` IN ('APPROVED','NOT_APPROVED','UNKNOWN')),
  `version` integer NOT NULL CHECK (`version` > 0),
  `created_at` text NOT NULL,
  FOREIGN KEY (`question_id`) REFERENCES `application_questions`(`id`) ON DELETE CASCADE,
  UNIQUE (`question_id`,`version`)
);

CREATE TABLE `application_events_v2` (
  `id` text PRIMARY KEY NOT NULL,
  `application_id` text,
  `packet_id` text,
  `from_status` text,
  `to_status` text NOT NULL,
  `event_type` text NOT NULL,
  `actor` text NOT NULL CHECK (`actor` IN ('LOCAL_USER','SYSTEM','SOURCE','RUNNER')),
  `idempotency_key` text NOT NULL UNIQUE,
  `metadata_json` text NOT NULL,
  `occurred_at` text NOT NULL,
  FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`packet_id`) REFERENCES `application_packets`(`id`) ON DELETE SET NULL
);
CREATE INDEX `application_events_v2_application_time_idx` ON `application_events_v2` (`application_id`,`occurred_at`);

CREATE TABLE `application_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `packet_id` text NOT NULL,
  `target_kind` text NOT NULL CHECK (`target_kind` IN ('SYNTHETIC_LOCAL','REAL_TARGET')),
  `target_host` text NOT NULL,
  `form_version` text NOT NULL,
  `state` text NOT NULL,
  `stop_reason` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`packet_id`) REFERENCES `application_packets`(`id`) ON DELETE CASCADE
);
CREATE TABLE `runner_checkpoints` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `sequence` integer NOT NULL CHECK (`sequence` >= 0),
  `state` text NOT NULL,
  `safe_metadata_json` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `application_runs`(`id`) ON DELETE CASCADE,
  UNIQUE (`run_id`,`sequence`)
);
CREATE TABLE `final_action_consents` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `packet_digest` text NOT NULL,
  `target_host` text NOT NULL,
  `form_version` text NOT NULL,
  `token_hash` text NOT NULL,
  `expires_at` text NOT NULL,
  `used_at` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `application_runs`(`id`) ON DELETE CASCADE
);

CREATE TABLE `capability_configs` (
  `id` text PRIMARY KEY NOT NULL,
  `source` text NOT NULL,
  `tenant` text NOT NULL,
  `region` text,
  `allowed_host` text NOT NULL,
  `allowed_path_prefix` text NOT NULL,
  `policy_version` text NOT NULL,
  `approved` integer NOT NULL CHECK (`approved` IN (0,1)),
  `expires_at` text NOT NULL,
  `request_budget` integer NOT NULL CHECK (`request_budget` BETWEEN 1 AND 30),
  `record_budget` integer NOT NULL CHECK (`record_budget` BETWEEN 1 AND 500),
  `created_at` text NOT NULL,
  UNIQUE (`source`,`tenant`,`region`)
);
CREATE TABLE `discovery_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `capability_config_id` text NOT NULL,
  `status` text NOT NULL,
  `cursor_json` text,
  `request_count` integer NOT NULL DEFAULT 0,
  `record_count` integer NOT NULL DEFAULT 0,
  `safe_error_code` text,
  `started_at` text NOT NULL,
  `completed_at` text,
  FOREIGN KEY (`capability_config_id`) REFERENCES `capability_configs`(`id`)
);

INSERT INTO `source_observations`
  (`id`,`job_id`,`source_record_id`,`source`,`tenant`,`external_id`,`source_url`,`acquisition_method`,`content_hash`,`raw_snapshot_reference`,`observed_at`,`posted_at`,`expires_at`,`parser_version`,`policy_version`,`run_id`)
SELECT
  'legacy-observation-' || r.id,
  r.job_id,
  r.id,
  s.name,
  NULL,
  r.external_id,
  r.source_url,
  r.acquisition_method,
  r.payload_hash,
  'job_source_records:' || r.id,
  r.discovered_at,
  j.date_posted,
  NULL,
  'legacy-0001',
  NULL,
  NULL
FROM `job_source_records` r
JOIN `job_sources` s ON s.id = r.source_id
JOIN `jobs` j ON j.id = r.job_id;

INSERT INTO `job_versions`
  (`id`,`job_id`,`version`,`normalized_json`,`content_digest`,`source_observation_id`,`created_at`)
SELECT
  'legacy-job-version-' || j.id,
  j.id,
  1,
  j.normalized_json,
  (SELECT r.payload_hash FROM job_source_records r WHERE r.job_id = j.id ORDER BY r.discovered_at DESC, r.id DESC LIMIT 1),
  (SELECT 'legacy-observation-' || r.id FROM job_source_records r WHERE r.job_id = j.id ORDER BY r.discovered_at DESC, r.id DESC LIMIT 1),
  j.created_at
FROM `jobs` j;

PRAGMA user_version = 2;
COMMIT;
PRAGMA foreign_keys = ON;
