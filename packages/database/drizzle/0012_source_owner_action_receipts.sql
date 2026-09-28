PRAGMA foreign_keys = ON;
BEGIN;

CREATE TABLE `source_owner_action_receipts` (
  `id` text PRIMARY KEY NOT NULL,
  `action` text NOT NULL CHECK (`action` IN ('APPROVE','START')),
  `capability_version_id` text NOT NULL,
  `capability_id` text NOT NULL,
  `capability_version` integer NOT NULL CHECK (`capability_version` > 0),
  `capability_digest` text NOT NULL CHECK (length(`capability_digest`) = 64),
  `approval_reference` text NOT NULL CHECK (length(`approval_reference`) > 0),
  `source` text NOT NULL,
  `tenant` text NOT NULL,
  `operation` text CHECK (`operation` IS NULL OR `operation` IN ('LIST_JOBS','GET_JOB')),
  `policy_version` text NOT NULL,
  `policy_expires_at` text NOT NULL,
  `capability_expires_at` text NOT NULL,
  `receipt_expires_at` text,
  `confirmation_digest` text NOT NULL CHECK (length(`confirmation_digest`) = 64),
  `nonce_action` text NOT NULL CHECK (`nonce_action` IN ('SOURCE_CAPABILITY_APPROVE','SOURCE_RUN_START')),
  `gate_consumed_at` text NOT NULL,
  `loopback_validated` integer NOT NULL CHECK (`loopback_validated` = 1),
  `local_session_validated` integer NOT NULL CHECK (`local_session_validated` = 1),
  `nonce_consumed` integer NOT NULL CHECK (`nonce_consumed` = 1),
  `owner_confirmed` integer NOT NULL CHECK (`owner_confirmed` = 1),
  `predecessor_receipt_id` text,
  `state` text NOT NULL CHECK (`state` IN ('ACTIVE','CONSUMED','REVOKED','EXPIRED','FAILED')),
  `consumed_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`capability_version_id`) REFERENCES `source_capability_versions`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`predecessor_receipt_id`) REFERENCES `source_owner_action_receipts`(`id`) ON DELETE RESTRICT,
  CHECK (
    (`action` = 'APPROVE' AND `operation` IS NULL AND `receipt_expires_at` IS NULL
      AND `nonce_action` = 'SOURCE_CAPABILITY_APPROVE' AND `predecessor_receipt_id` IS NULL)
    OR
    (`action` = 'START' AND `operation` IS NOT NULL AND `receipt_expires_at` IS NOT NULL
      AND `nonce_action` = 'SOURCE_RUN_START' AND `predecessor_receipt_id` IS NOT NULL)
  ),
  CHECK ((`state` = 'CONSUMED') = (`consumed_at` IS NOT NULL)),
  CHECK (
    julianday(`gate_consumed_at`) IS NOT NULL
    AND julianday(`created_at`) >= julianday(`gate_consumed_at`)
  )
);

CREATE UNIQUE INDEX `source_owner_action_receipts_predecessor_idx`
  ON `source_owner_action_receipts` (`predecessor_receipt_id`);
CREATE INDEX `source_owner_action_receipts_capability_idx`
  ON `source_owner_action_receipts` (`capability_id`,`capability_version`,`action`,`created_at`);

CREATE TABLE `source_run_owner_bindings` (
  `run_id` text PRIMARY KEY NOT NULL,
  `approval_receipt_id` text NOT NULL,
  `start_receipt_id` text NOT NULL,
  `capability_digest` text NOT NULL CHECK (length(`capability_digest`) = 64),
  `operation` text NOT NULL CHECK (`operation` IN ('LIST_JOBS','GET_JOB')),
  `created_at` text NOT NULL,
  FOREIGN KEY (`run_id`) REFERENCES `source_run_checkpoints`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`approval_receipt_id`) REFERENCES `source_owner_action_receipts`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`start_receipt_id`) REFERENCES `source_owner_action_receipts`(`id`) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX `source_run_owner_bindings_start_idx`
  ON `source_run_owner_bindings` (`start_receipt_id`);
CREATE UNIQUE INDEX `source_run_owner_bindings_approval_idx`
  ON `source_run_owner_bindings` (`approval_receipt_id`);

PRAGMA user_version = 12;
COMMIT;
