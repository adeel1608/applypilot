PRAGMA foreign_keys = OFF;
BEGIN IMMEDIATE;

CREATE TABLE `job_field_evidence_v2` (
  `id` text PRIMARY KEY NOT NULL,
  `job_version_id` text NOT NULL,
  `source_observation_id` text,
  `family` text NOT NULL CHECK (`family` IN ('IDENTITY','GEOGRAPHY','EMPLOYMENT','HOURS','SCHEDULE','COMPENSATION','DATES','SKILLS','EXPERIENCE','EDUCATION','LICENCES','CERTIFICATIONS','WORK_RIGHTS','VEHICLE','PHYSICAL_REQUIREMENTS','TRAINING','DOCUMENTS')),
  `canonical_field` text NOT NULL,
  `evidence_state` text NOT NULL CHECK (`evidence_state` IN ('SOURCE_STATED','OWNER_CORRECTED','DERIVED','UNKNOWN','CONDITIONAL','CONFLICTING')),
  `modality` text CHECK (`modality` IS NULL OR `modality` IN ('REQUIRED','PREFERRED','CONDITIONAL','NEGATED','UNKNOWN')),
  `source_path` text NOT NULL,
  `start_offset` integer NOT NULL CHECK (`start_offset` >= 0),
  `end_offset` integer NOT NULL CHECK (`end_offset` >= `start_offset`),
  `source_length` integer NOT NULL CHECK (`source_length` >= `end_offset`),
  `excerpt` text NOT NULL,
  `excerpt_hash` text NOT NULL CHECK (length(`excerpt_hash`) = 64),
  `normalized_value_json` text NOT NULL,
  `extractor_version` text NOT NULL,
  `rule_id` text NOT NULL,
  `owner_correction_id` text,
  `conflict_set_id` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`job_version_id`) REFERENCES `job_versions`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`source_observation_id`) REFERENCES `source_observations`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`owner_correction_id`) REFERENCES `job_corrections`(`id`) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK ((`evidence_state` = 'OWNER_CORRECTED' AND `owner_correction_id` IS NOT NULL) OR (`evidence_state` <> 'OWNER_CORRECTED')),
  CHECK ((`evidence_state` = 'CONFLICTING' AND `conflict_set_id` IS NOT NULL) OR (`evidence_state` <> 'CONFLICTING')),
  UNIQUE (`job_version_id`,`id`)
);
CREATE INDEX `job_field_evidence_v2_version_family_idx` ON `job_field_evidence_v2` (`job_version_id`,`family`,`canonical_field`);
CREATE INDEX `job_field_evidence_v2_observation_idx` ON `job_field_evidence_v2` (`source_observation_id`,`evidence_state`);
CREATE INDEX `job_field_evidence_v2_conflict_idx` ON `job_field_evidence_v2` (`conflict_set_id`) WHERE `conflict_set_id` IS NOT NULL;

CREATE TABLE `requirement_evidence_v2` (
  `id` text PRIMARY KEY NOT NULL,
  `job_version_id` text NOT NULL,
  `source_observation_id` text,
  `family` text NOT NULL CHECK (`family` IN ('IDENTITY','GEOGRAPHY','EMPLOYMENT','HOURS','SCHEDULE','COMPENSATION','DATES','SKILLS','EXPERIENCE','EDUCATION','LICENCES','CERTIFICATIONS','WORK_RIGHTS','VEHICLE','PHYSICAL_REQUIREMENTS','TRAINING','DOCUMENTS')),
  `canonical_kind` text NOT NULL,
  `evidence_state` text NOT NULL CHECK (`evidence_state` IN ('SOURCE_STATED','OWNER_CORRECTED','DERIVED','UNKNOWN','CONDITIONAL','CONFLICTING')),
  `modality` text NOT NULL CHECK (`modality` IN ('REQUIRED','PREFERRED','CONDITIONAL','NEGATED','UNKNOWN')),
  `condition_text` text,
  `source_path` text NOT NULL,
  `start_offset` integer NOT NULL CHECK (`start_offset` >= 0),
  `end_offset` integer NOT NULL CHECK (`end_offset` >= `start_offset`),
  `source_length` integer NOT NULL CHECK (`source_length` >= `end_offset`),
  `excerpt` text NOT NULL,
  `excerpt_hash` text NOT NULL CHECK (length(`excerpt_hash`) = 64),
  `normalized_value_json` text NOT NULL,
  `extractor_version` text NOT NULL,
  `rule_id` text NOT NULL,
  `owner_correction_id` text,
  `conflict_set_id` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`job_version_id`) REFERENCES `job_versions`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`source_observation_id`) REFERENCES `source_observations`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`owner_correction_id`) REFERENCES `job_corrections`(`id`) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK ((`evidence_state` = 'OWNER_CORRECTED' AND `owner_correction_id` IS NOT NULL) OR (`evidence_state` <> 'OWNER_CORRECTED')),
  CHECK ((`evidence_state` = 'CONFLICTING' AND `conflict_set_id` IS NOT NULL) OR (`evidence_state` <> 'CONFLICTING')),
  UNIQUE (`job_version_id`,`id`)
);
CREATE INDEX `requirement_evidence_v2_version_family_idx` ON `requirement_evidence_v2` (`job_version_id`,`family`,`canonical_kind`,`modality`);
CREATE INDEX `requirement_evidence_v2_observation_idx` ON `requirement_evidence_v2` (`source_observation_id`,`evidence_state`);

CREATE TABLE `evidence_derivations` (
  `id` text PRIMARY KEY NOT NULL,
  `derived_field_evidence_id` text NOT NULL,
  `input_field_evidence_id` text NOT NULL,
  `rule_id` text NOT NULL,
  `rule_version` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`derived_field_evidence_id`) REFERENCES `job_field_evidence_v2`(`id`) ON DELETE RESTRICT,
  FOREIGN KEY (`input_field_evidence_id`) REFERENCES `job_field_evidence_v2`(`id`) ON DELETE RESTRICT,
  CHECK (`derived_field_evidence_id` <> `input_field_evidence_id`),
  UNIQUE (`derived_field_evidence_id`,`input_field_evidence_id`)
);
CREATE INDEX `evidence_derivations_input_idx` ON `evidence_derivations` (`input_field_evidence_id`);

CREATE TABLE `job_normalization_coverage` (
  `id` text PRIMARY KEY NOT NULL,
  `job_version_id` text NOT NULL,
  `family` text NOT NULL CHECK (`family` IN ('IDENTITY','GEOGRAPHY','EMPLOYMENT','HOURS','SCHEDULE','COMPENSATION','DATES','SKILLS','EXPERIENCE','EDUCATION','LICENCES','CERTIFICATIONS','WORK_RIGHTS','VEHICLE','PHYSICAL_REQUIREMENTS','TRAINING','DOCUMENTS')),
  `coverage_state` text NOT NULL CHECK (`coverage_state` IN ('COMPLETE','PARTIAL','UNKNOWN')),
  `evidence_count` integer NOT NULL CHECK (`evidence_count` >= 0),
  `evidence_ids_json` text NOT NULL,
  `unparsed_spans_json` text NOT NULL,
  `parser_version` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`job_version_id`) REFERENCES `job_versions`(`id`) ON DELETE RESTRICT,
  UNIQUE (`job_version_id`,`family`)
);
CREATE INDEX `job_normalization_coverage_state_idx` ON `job_normalization_coverage` (`job_version_id`,`coverage_state`,`family`);

INSERT INTO `job_field_evidence_v2`
  (`id`,`job_version_id`,`source_observation_id`,`family`,`canonical_field`,`evidence_state`,`modality`,
   `source_path`,`start_offset`,`end_offset`,`source_length`,`excerpt`,`excerpt_hash`,
   `normalized_value_json`,`extractor_version`,`rule_id`,`owner_correction_id`,`conflict_set_id`,`created_at`)
SELECT
  'legacy-field-' || `id`, `job_version_id`, `source_observation_id`, 'IDENTITY', `field_name`, 'UNKNOWN', NULL,
  `source_path`, 0, 0, 0, '', printf('%064d', 0),
  json_object('kind','UNKNOWN','value',NULL), '3.0.0', 'R2A_LEGACY_FIELD_UNKNOWN', NULL, NULL, `created_at`
FROM `job_field_evidence`;

INSERT INTO `requirement_evidence_v2`
  (`id`,`job_version_id`,`source_observation_id`,`family`,`canonical_kind`,`evidence_state`,`modality`,`condition_text`,
   `source_path`,`start_offset`,`end_offset`,`source_length`,`excerpt`,`excerpt_hash`,
   `normalized_value_json`,`extractor_version`,`rule_id`,`owner_correction_id`,`conflict_set_id`,`created_at`)
SELECT
  'legacy-requirement-' || `id`, `job_version_id`, `source_observation_id`,
  CASE `kind`
    WHEN 'WORK_RIGHTS' THEN 'WORK_RIGHTS' WHEN 'LEGAL_HOURS' THEN 'HOURS' WHEN 'CANDIDATE_HOURS' THEN 'HOURS'
    WHEN 'QUALIFICATION' THEN 'EDUCATION' WHEN 'LICENCE' THEN 'LICENCES' WHEN 'CERTIFICATION' THEN 'CERTIFICATIONS'
    WHEN 'VEHICLE' THEN 'VEHICLE' WHEN 'AVAILABILITY' THEN 'SCHEDULE' WHEN 'LOCATION' THEN 'GEOGRAPHY'
    WHEN 'EXPERIENCE' THEN 'EXPERIENCE' WHEN 'SKILL' THEN 'SKILLS' WHEN 'PHYSICAL' THEN 'PHYSICAL_REQUIREMENTS'
    WHEN 'AGE' THEN 'PHYSICAL_REQUIREMENTS' WHEN 'DOCUMENT' THEN 'DOCUMENTS' ELSE 'SKILLS' END,
  `kind`, 'UNKNOWN', `modality`, `condition_text`, `source_path`, `start_offset`, `end_offset`, `end_offset`,
  `original_text`, printf('%064d', 0), json_object('kind','UNKNOWN','value',NULL),
  '3.0.0', 'R2A_LEGACY_REQUIREMENT_UNKNOWN', NULL, NULL, `created_at`
FROM `requirement_evidence`;

WITH `families`(`family`) AS (
  VALUES ('IDENTITY'),('GEOGRAPHY'),('EMPLOYMENT'),('HOURS'),('SCHEDULE'),('COMPENSATION'),
         ('DATES'),('SKILLS'),('EXPERIENCE'),('EDUCATION'),('LICENCES'),('CERTIFICATIONS'),
         ('WORK_RIGHTS'),('VEHICLE'),('PHYSICAL_REQUIREMENTS'),('TRAINING'),('DOCUMENTS')
)
INSERT INTO `job_normalization_coverage`
  (`id`,`job_version_id`,`family`,`coverage_state`,`evidence_count`,`evidence_ids_json`,`unparsed_spans_json`,`parser_version`,`created_at`)
SELECT 'legacy-coverage-' || `job_versions`.`id` || '-' || families.`family`, `job_versions`.`id`, families.`family`,
       'UNKNOWN', 0, '[]', '[]', '3.0.0', `job_versions`.`created_at`
FROM `job_versions` CROSS JOIN families;

PRAGMA user_version = 3;
COMMIT;
PRAGMA foreign_keys = ON;
