PRAGMA foreign_keys = OFF;
BEGIN;

CREATE TABLE `green_banner_parent_grants` (
  `id` text PRIMARY KEY NOT NULL,
  `grant_type` text NOT NULL CHECK (`grant_type` = 'GREEN_BANNER_SESSION_GRANT_V1'),
  `grant_digest` text NOT NULL CHECK (length(`grant_digest`) = 64),
  `allowed_operations_json` text NOT NULL CHECK (
    json_valid(`allowed_operations_json`)
    AND json_type(`allowed_operations_json`) = 'array'
    AND json_array_length(`allowed_operations_json`) BETWEEN 1 AND 7
    AND instr(upper(`allowed_operations_json`), 'SUBMIT') = 0
  ),
  `scope_json` text NOT NULL CHECK (json_valid(`scope_json`) AND json_type(`scope_json`) = 'object'),
  `main_sha` text NOT NULL CHECK (length(`main_sha`) = 40),
  `created_at` text NOT NULL,
  UNIQUE (`grant_digest`)
);

CREATE TABLE `green_banner_parent_grant_events` (
  `id` text PRIMARY KEY NOT NULL,
  `parent_grant_id` text NOT NULL,
  `sequence` integer NOT NULL CHECK (`sequence` >= 0),
  `state` text NOT NULL CHECK (`state` IN ('ACTIVE','REVOKED','COMPLETED')),
  `safe_metadata_json` text NOT NULL CHECK (json_valid(`safe_metadata_json`) AND json_type(`safe_metadata_json`) = 'object'),
  `occurred_at` text NOT NULL,
  FOREIGN KEY (`parent_grant_id`) REFERENCES `green_banner_parent_grants`(`id`) ON DELETE RESTRICT,
  UNIQUE (`parent_grant_id`,`sequence`)
);

CREATE TABLE `green_banner_child_capabilities` (
  `id` text PRIMARY KEY NOT NULL,
  `parent_grant_id` text NOT NULL,
  `parent_grant_digest` text NOT NULL CHECK (length(`parent_grant_digest`) = 64),
  `child_digest` text NOT NULL CHECK (length(`child_digest`) = 64),
  `child_type` text NOT NULL CHECK (`child_type` IN ('SOURCE','TARGET')),
  `operation` text NOT NULL CHECK (`operation` IN ('SOURCE_LIST_JOBS','OPEN_AND_INSPECT_ONLY','MAP_FOR_FILL','FILL','UPLOAD','VERIFY','FILL_PREVIEW')),
  `scope_json` text NOT NULL CHECK (json_valid(`scope_json`) AND json_type(`scope_json`) = 'object'),
  `main_sha` text NOT NULL CHECK (length(`main_sha`) = 40),
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  FOREIGN KEY (`parent_grant_id`) REFERENCES `green_banner_parent_grants`(`id`) ON DELETE RESTRICT,
  UNIQUE (`child_digest`)
);

CREATE TABLE `green_banner_child_events` (
  `id` text PRIMARY KEY NOT NULL,
  `child_capability_id` text NOT NULL,
  `sequence` integer NOT NULL CHECK (`sequence` >= 0),
  `state` text NOT NULL CHECK (`state` IN ('ACTIVE','CONSUMED','REVOKED','EXPIRED')),
  `safe_metadata_json` text NOT NULL CHECK (json_valid(`safe_metadata_json`) AND json_type(`safe_metadata_json`) = 'object'),
  `occurred_at` text NOT NULL,
  FOREIGN KEY (`child_capability_id`) REFERENCES `green_banner_child_capabilities`(`id`) ON DELETE RESTRICT,
  UNIQUE (`child_capability_id`,`sequence`)
);

CREATE INDEX `green_banner_parent_event_idx`
  ON `green_banner_parent_grant_events` (`parent_grant_id`,`sequence`);
CREATE INDEX `green_banner_child_event_idx`
  ON `green_banner_child_events` (`child_capability_id`,`sequence`);

PRAGMA user_version = 9;
COMMIT;
PRAGMA foreign_keys = ON;
