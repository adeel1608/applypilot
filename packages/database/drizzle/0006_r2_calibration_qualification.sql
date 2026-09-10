PRAGMA foreign_keys = ON;
BEGIN;

CREATE TABLE `r2_calibration_qualifications` (
  `run_id` text PRIMARY KEY NOT NULL,
  `evidence_version` text NOT NULL,
  `private_evidence_digest` text NOT NULL CHECK (length(`private_evidence_digest`) = 64),
  `source_label_count` integer NOT NULL CHECK (`source_label_count` >= 0),
  `compared_label_count` integer NOT NULL CHECK (`compared_label_count` >= 0),
  `source_pair_count` integer NOT NULL CHECK (`source_pair_count` >= 0),
  `compared_pair_count` integer NOT NULL CHECK (`compared_pair_count` >= 0),
  `label_agreement_basis_points` integer NOT NULL CHECK (`label_agreement_basis_points` BETWEEN 0 AND 10000),
  `pair_agreement_basis_points` integer NOT NULL CHECK (`pair_agreement_basis_points` BETWEEN 0 AND 10000),
  `performance_threshold_version` text,
  `safety_gate_version` text,
  `owner_approval_id` text,
  `owner_approved_at` text,
  `blocker_codes_json` text NOT NULL CHECK (
    json_valid(`blocker_codes_json`) AND json_type(`blocker_codes_json`) = 'array'
  ),
  `created_at` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `r2_calibration_runs`(`id`) ON DELETE RESTRICT,
  CHECK (`compared_label_count` <= `source_label_count`),
  CHECK (`compared_pair_count` <= `source_pair_count`),
  CHECK (
    (`owner_approval_id` IS NULL AND `owner_approved_at` IS NULL) OR
    (`owner_approval_id` IS NOT NULL AND `owner_approved_at` IS NOT NULL)
  )
);

PRAGMA user_version = 6;
COMMIT;
