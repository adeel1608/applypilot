PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE `r2_evaluation_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `job_version_id` text NOT NULL,
  `profile_version_id` text NOT NULL,
  `evidence_contract_version` text NOT NULL,
  `normalization_version` text NOT NULL,
  `coverage_version` text NOT NULL,
  `eligibility_status` text NOT NULL CHECK (`eligibility_status` IN ('ELIGIBLE','REVIEW_REQUIRED','INELIGIBLE')),
  `eligibility_reasons_json` text NOT NULL,
  `fit_score` integer NOT NULL CHECK (`fit_score` BETWEEN 0 AND 100),
  `fit_contributions_json` text NOT NULL,
  `eligibility_engine_version` text NOT NULL,
  `fit_scorer_version` text NOT NULL,
  `weight_version` text NOT NULL,
  `calibration_state` text NOT NULL CHECK (`calibration_state` IN ('UNCALIBRATED','CALIBRATION_PENDING','CALIBRATED')),
  `recommended` integer NOT NULL CHECK (`recommended` IN (0,1)),
  `coverage_percent` integer NOT NULL CHECK (`coverage_percent` BETWEEN 0 AND 100),
  `unresolved_unknown_count` integer NOT NULL CHECK (`unresolved_unknown_count` >= 0),
  `unresolved_condition_count` integer NOT NULL CHECK (`unresolved_condition_count` >= 0),
  `unresolved_conflict_count` integer NOT NULL CHECK (`unresolved_conflict_count` >= 0),
  `stale` integer NOT NULL DEFAULT 0 CHECK (`stale` IN (0,1)),
  `evaluated_at` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`job_version_id`) REFERENCES `job_versions`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`profile_version_id`) REFERENCES `candidate_profile_versions`(`id`) ON DELETE RESTRICT,
  UNIQUE (`job_version_id`,`profile_version_id`,`evidence_contract_version`,`fit_scorer_version`,`weight_version`)
);
CREATE INDEX `r2_evaluation_current_job_idx` ON `r2_evaluation_versions` (`job_id`,`stale`,`evaluated_at`);

CREATE TABLE `r2_duplicate_candidates` (
  `id` text PRIMARY KEY NOT NULL,
  `left_observation_id` text NOT NULL,
  `right_observation_id` text NOT NULL,
  `detector_version` text NOT NULL,
  `state` text NOT NULL CHECK (`state` IN ('SUGGESTED','LINKED','REJECTED','SPLIT')),
  `matched_signals_json` text NOT NULL,
  `conflicting_signals_json` text NOT NULL,
  `evidence_digest` text NOT NULL CHECK (length(`evidence_digest`) = 64),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`left_observation_id`) REFERENCES `source_observations`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`right_observation_id`) REFERENCES `source_observations`(`id`) ON DELETE RESTRICT,
  CHECK (`left_observation_id` < `right_observation_id`),
  UNIQUE (`left_observation_id`,`right_observation_id`,`detector_version`)
);
CREATE INDEX `r2_duplicate_candidate_state_idx` ON `r2_duplicate_candidates` (`state`,`updated_at`);

CREATE TABLE `r2_duplicate_decision_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `candidate_id` text NOT NULL,
  `version` integer NOT NULL CHECK (`version` > 0),
  `decision` text NOT NULL CHECK (`decision` IN ('LINKED','REJECTED','SPLIT')),
  `actor` text NOT NULL CHECK (`actor` = 'OWNER'),
  `reason_code` text NOT NULL,
  `evidence_version` text NOT NULL,
  `supersedes_decision_id` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`candidate_id`) REFERENCES `r2_duplicate_candidates`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`supersedes_decision_id`) REFERENCES `r2_duplicate_decision_versions`(`id`) ON DELETE RESTRICT,
  UNIQUE (`candidate_id`,`version`)
);

CREATE TABLE `r2_queue_decision_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `job_id` text NOT NULL,
  `version` integer NOT NULL CHECK (`version` > 0),
  `state` text NOT NULL CHECK (`state` IN ('REVIEWING','SHORTLISTED','SKIPPED','PREPARING')),
  `freshness` text NOT NULL CHECK (`freshness` IN ('CURRENT','STALE')),
  `job_version_id` text NOT NULL,
  `profile_version_id` text NOT NULL,
  `r2_evaluation_id` text NOT NULL,
  `evidence_contract_version` text NOT NULL,
  `duplicate_resolution_version` text NOT NULL,
  `coverage_version` text NOT NULL,
  `actor` text NOT NULL CHECK (`actor` IN ('OWNER','SYSTEM')),
  `reason_code` text NOT NULL,
  `supersedes_decision_id` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`job_version_id`) REFERENCES `job_versions`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`profile_version_id`) REFERENCES `candidate_profile_versions`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`r2_evaluation_id`) REFERENCES `r2_evaluation_versions`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`supersedes_decision_id`) REFERENCES `r2_queue_decision_versions`(`id`) ON DELETE RESTRICT,
  UNIQUE (`job_id`,`version`)
);
CREATE INDEX `r2_queue_current_job_idx` ON `r2_queue_decision_versions` (`job_id`,`freshness`,`version`);

CREATE TABLE `r2_correction_overlay_bindings` (
  `id` text PRIMARY KEY NOT NULL,
  `correction_id` text NOT NULL,
  `target_kind` text NOT NULL CHECK (`target_kind` IN ('FIELD','REQUIREMENT')),
  `target_key` text NOT NULL,
  `source_observation_id` text NOT NULL,
  `source_value_digest` text NOT NULL CHECK (length(`source_value_digest`) = 64),
  `corrected_value_json` text NOT NULL,
  `applicability_rule_version` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`correction_id`) REFERENCES `job_corrections`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`source_observation_id`) REFERENCES `source_observations`(`id`) ON DELETE RESTRICT,
  UNIQUE (`correction_id`,`target_kind`,`target_key`)
);

CREATE TABLE `r2_calibration_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `scorer_version` text NOT NULL,
  `weight_version` text NOT NULL,
  `corpus_version` text NOT NULL,
  `fictional_case_count` integer NOT NULL CHECK (`fictional_case_count` >= 0),
  `private_reviewed_count` integer NOT NULL CHECK (`private_reviewed_count` >= 0),
  `role_family_count` integer NOT NULL CHECK (`role_family_count` >= 0),
  `status_count` integer NOT NULL CHECK (`status_count` >= 0),
  `ordinal_agreement_basis_points` integer NOT NULL CHECK (`ordinal_agreement_basis_points` BETWEEN 0 AND 10000),
  `top_k` integer NOT NULL CHECK (`top_k` >= 0),
  `top_k_utility_basis_points` integer NOT NULL CHECK (`top_k_utility_basis_points` BETWEEN 0 AND 10000),
  `state` text NOT NULL CHECK (`state` IN ('UNCALIBRATED','CALIBRATION_PENDING','CALIBRATED')),
  `created_at` text NOT NULL
);

CREATE TABLE `r2_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `event_type` text NOT NULL,
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `safe_metadata_json` text NOT NULL,
  `occurred_at` text NOT NULL
);
CREATE INDEX `r2_audit_entity_time_idx` ON `r2_audit_events` (`entity_type`,`entity_id`,`occurred_at`);

PRAGMA user_version = 4;
COMMIT;
PRAGMA foreign_keys = ON;
