PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE `_r2_evaluation_versions_v5` (
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
  `calibration_context_version` text NOT NULL,
  `calibration_run_id` text,
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
  FOREIGN KEY (`calibration_run_id`) REFERENCES `r2_calibration_runs`(`id`) ON DELETE RESTRICT,
  CHECK (`recommended` = 0 OR (
    `eligibility_status` = 'ELIGIBLE' AND
    `coverage_percent` >= 60 AND
    `unresolved_unknown_count` = 0 AND
    `unresolved_condition_count` = 0 AND
    `unresolved_conflict_count` = 0
  )),
  UNIQUE (
    `job_version_id`,
    `profile_version_id`,
    `evidence_contract_version`,
    `normalization_version`,
    `coverage_version`,
    `eligibility_engine_version`,
    `fit_scorer_version`,
    `weight_version`,
    `calibration_context_version`
  )
);

INSERT INTO `_r2_evaluation_versions_v5` (
  `id`,`job_id`,`job_version_id`,`profile_version_id`,`evidence_contract_version`,
  `normalization_version`,`coverage_version`,`eligibility_status`,`eligibility_reasons_json`,
  `fit_score`,`fit_contributions_json`,`eligibility_engine_version`,`fit_scorer_version`,
  `weight_version`,`calibration_state`,`calibration_context_version`,`calibration_run_id`,
  `recommended`,`coverage_percent`,`unresolved_unknown_count`,`unresolved_condition_count`,
  `unresolved_conflict_count`,`stale`,`evaluated_at`
)
SELECT
  `id`,`job_id`,`job_version_id`,`profile_version_id`,`evidence_contract_version`,
  `normalization_version`,`coverage_version`,`eligibility_status`,`eligibility_reasons_json`,
  `fit_score`,`fit_contributions_json`,`eligibility_engine_version`,`fit_scorer_version`,
  `weight_version`,`calibration_state`,
  'legacy-v4:' || lower(`calibration_state`),NULL,
  `recommended`,`coverage_percent`,`unresolved_unknown_count`,`unresolved_condition_count`,
  `unresolved_conflict_count`,`stale`,`evaluated_at`
FROM `r2_evaluation_versions`;

CREATE TEMP TABLE `_r2_evaluation_migration_guard` (
  `valid` integer NOT NULL CHECK (`valid` = 1)
);
INSERT INTO `_r2_evaluation_migration_guard`
SELECT CASE WHEN
  (SELECT count(*) FROM `_r2_evaluation_versions_v5`) =
  (SELECT count(*) FROM `r2_evaluation_versions`)
THEN 1 ELSE 0 END;
DROP TABLE `_r2_evaluation_migration_guard`;

DROP TABLE `r2_evaluation_versions`;
ALTER TABLE `_r2_evaluation_versions_v5` RENAME TO `r2_evaluation_versions`;
CREATE INDEX `r2_evaluation_current_job_idx`
  ON `r2_evaluation_versions` (`job_id`,`stale`,`evaluated_at`);

PRAGMA user_version = 5;
COMMIT;
PRAGMA foreign_keys = ON;
