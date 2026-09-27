PRAGMA foreign_keys = ON;
BEGIN;

ALTER TABLE `job_normalization_coverage`
  ADD COLUMN `evidence_contract_version` text;
ALTER TABLE `job_normalization_coverage`
  ADD COLUMN `normalization_version` text;

-- Binds a local parser/normalizer rederivation to the exact provider
-- verification and immutable source observation it consumed. This never
-- creates a second provider verification or mutates historical rows.
CREATE TABLE `source_derivation_bindings` (
  `id` text PRIMARY KEY NOT NULL,
  `verification_id` text NOT NULL,
  `source_observation_id` text NOT NULL,
  `content_hash` text NOT NULL CHECK (length(`content_hash`) = 64),
  `parent_job_version_id` text NOT NULL,
  `derived_job_version_id` text NOT NULL,
  `parser_version` text NOT NULL,
  `normalization_version` text NOT NULL,
  `derivation_digest` text NOT NULL CHECK (length(`derivation_digest`) = 64),
  `created_at` text NOT NULL,
  FOREIGN KEY (`verification_id`) REFERENCES `source_record_verifications`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`source_observation_id`) REFERENCES `source_observations`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`parent_job_version_id`) REFERENCES `job_versions`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`derived_job_version_id`) REFERENCES `job_versions`(`id`) ON DELETE RESTRICT,
  UNIQUE (`verification_id`,`source_observation_id`,`parser_version`,`normalization_version`),
  UNIQUE (`derived_job_version_id`)
);

CREATE INDEX `source_derivation_bindings_observation_idx`
  ON `source_derivation_bindings` (`source_observation_id`,`content_hash`);

PRAGMA user_version = 11;
COMMIT;
