PRAGMA foreign_keys = OFF;
BEGIN;

ALTER TABLE `runner_target_capability_versions`
  ADD COLUMN `allowed_operations_json` text NOT NULL
  DEFAULT '["MAP_FOR_FILL","FILL","UPLOAD","SUBMIT"]'
  CHECK (
    json_valid(`allowed_operations_json`)
    AND json_type(`allowed_operations_json`) = 'array'
    AND json_array_length(`allowed_operations_json`) BETWEEN 1 AND 5
  );

CREATE TABLE `runner_inspection_bindings` (
  `id` text PRIMARY KEY NOT NULL,
  `target_capability_version_id` text NOT NULL,
  `operation` text NOT NULL CHECK (`operation` = 'OPEN_AND_INSPECT_ONLY'),
  `packet_id` text NOT NULL,
  `packet_digest` text NOT NULL CHECK (length(`packet_digest`) = 64),
  `job_version_id` text NOT NULL,
  `profile_version_id` text NOT NULL,
  `evaluation_version_id` text NOT NULL,
  `documents_digest` text NOT NULL CHECK (length(`documents_digest`) = 64),
  `answers_digest` text NOT NULL CHECK (length(`answers_digest`) = 64),
  `disclosures_digest` text NOT NULL CHECK (length(`disclosures_digest`) = 64),
  `target_url` text NOT NULL,
  `target_origin` text NOT NULL,
  `target_path` text NOT NULL,
  `allowed_path_prefix` text NOT NULL,
  `form_version` text NOT NULL,
  `adapter_version` text NOT NULL,
  `unresolved_count` integer NOT NULL CHECK (`unresolved_count` >= 0),
  `state` text NOT NULL CHECK (`state` IN ('BOUND','OPENED','COMPLETED','STOPPED')),
  `safe_stop_reason` text CHECK (
    `safe_stop_reason` IS NULL OR `safe_stop_reason` IN (
      'CAPTCHA','MFA','AUTHENTICATION_REQUIRED','BOT_DETECTION','RATE_LIMIT',
      'ACCESS_CONTROL','WEBSITE_RESTRICTION','PAGE_CHANGED','FORM_CHANGED',
      'DESTINATION_CHANGED','UNSUPPORTED_CONTROL','TARGET_APPROVAL_REQUIRED'
    )
  ),
  `field_count` integer NOT NULL DEFAULT 0 CHECK (`field_count` BETWEEN 0 AND 200),
  `classification_summary_json` text NOT NULL DEFAULT '{}'
    CHECK (json_valid(`classification_summary_json`) AND json_type(`classification_summary_json`) = 'object'),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`target_capability_version_id`) REFERENCES `runner_target_capability_versions`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`packet_id`) REFERENCES `application_packets`(`id`) ON DELETE RESTRICT,
  UNIQUE (`target_capability_version_id`,`packet_digest`,`operation`)
);

CREATE INDEX `runner_inspection_state_idx`
  ON `runner_inspection_bindings` (`state`,`updated_at`);

PRAGMA user_version = 8;
COMMIT;
PRAGMA foreign_keys = ON;
