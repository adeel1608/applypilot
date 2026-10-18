PRAGMA foreign_keys = ON;
BEGIN;

-- New owner intake only. Historical aggregate calibration rows are never backfilled.
CREATE TABLE r2_calibration_campaigns (
  id text PRIMARY KEY NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  engine_json text NOT NULL CHECK (json_valid(engine_json) AND json_type(engine_json) = 'object'),
  engine_digest text NOT NULL CHECK (length(engine_digest) = 64),
  profile_version_id text NOT NULL REFERENCES candidate_profile_versions(id) ON DELETE RESTRICT,
  profile_hash text NOT NULL CHECK (length(profile_hash) = 64),
  member_digest text NOT NULL CHECK (length(member_digest) = 64),
  corpus_version text NOT NULL,
  taxonomy_version text NOT NULL,
  thresholds_version text NOT NULL UNIQUE,
  thresholds_json text NOT NULL CHECK (json_valid(thresholds_json) AND json_type(thresholds_json) = 'object'),
  thresholds_digest text NOT NULL CHECK (length(thresholds_digest) = 64),
  create_request_json text NOT NULL CHECK (json_valid(create_request_json) AND json_type(create_request_json) = 'object'),
  provenance_json text NOT NULL CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  gate_digest text NOT NULL UNIQUE CHECK (length(gate_digest) = 64),
  campaign_digest text NOT NULL CHECK (length(campaign_digest) = 64),
  created_at text NOT NULL
);

CREATE TABLE r2_calibration_comparisons (
  id text PRIMARY KEY NOT NULL,
  campaign_id text NOT NULL REFERENCES r2_calibration_campaigns(id) ON DELETE RESTRICT,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  job_version_id text NOT NULL REFERENCES job_versions(id) ON DELETE RESTRICT,
  source_observation_id text NOT NULL REFERENCES source_observations(id) ON DELETE RESTRICT,
  original_identity text NOT NULL,
  snapshot_json text NOT NULL CHECK (json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'),
  snapshot_digest text NOT NULL CHECK (length(snapshot_digest) = 64),
  created_at text NOT NULL,
  UNIQUE (campaign_id, job_id),
  UNIQUE (campaign_id, original_identity)
);

CREATE TABLE r2_calibration_label_events (
  id text PRIMARY KEY NOT NULL,
  campaign_id text NOT NULL REFERENCES r2_calibration_campaigns(id) ON DELETE RESTRICT,
  comparison_id text NOT NULL REFERENCES r2_calibration_comparisons(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  supersedes_id text UNIQUE REFERENCES r2_calibration_label_events(id) ON DELETE RESTRICT,
  label text NOT NULL CHECK (label IN ('GOOD_MATCH','POOR_MATCH','AMBIGUOUS')),
  occupational_family text NOT NULL CHECK (occupational_family IN (
    'RETAIL_CUSTOMER_SERVICE','HOSPITALITY_FOOD','ADMINISTRATION_OFFICE','LOGISTICS_WAREHOUSE',
    'SOFTWARE_INFORMATION_TECHNOLOGY','ENGINEERING_TECHNICAL','TRADES_MAINTENANCE','HEALTH_CARE',
    'EDUCATION_TRAINING','BUSINESS_FINANCE','SALES_MARKETING','CREATIVE_COMMUNICATIONS','UNKNOWN'
  )),
  request_json text NOT NULL CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
  provenance_json text NOT NULL CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  gate_digest text NOT NULL UNIQUE CHECK (length(gate_digest) = 64),
  event_digest text NOT NULL CHECK (length(event_digest) = 64),
  created_at text NOT NULL,
  UNIQUE (comparison_id, revision)
);

CREATE TABLE r2_calibration_pair_events (
  id text PRIMARY KEY NOT NULL,
  campaign_id text NOT NULL REFERENCES r2_calibration_campaigns(id) ON DELETE RESTRICT,
  left_comparison_id text NOT NULL REFERENCES r2_calibration_comparisons(id) ON DELETE RESTRICT,
  right_comparison_id text NOT NULL REFERENCES r2_calibration_comparisons(id) ON DELETE RESTRICT,
  preferred_comparison_id text NOT NULL REFERENCES r2_calibration_comparisons(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  supersedes_id text UNIQUE REFERENCES r2_calibration_pair_events(id) ON DELETE RESTRICT,
  request_json text NOT NULL CHECK (json_valid(request_json) AND json_type(request_json) = 'object'),
  provenance_json text NOT NULL CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  gate_digest text NOT NULL UNIQUE CHECK (length(gate_digest) = 64),
  event_digest text NOT NULL CHECK (length(event_digest) = 64),
  created_at text NOT NULL,
  CHECK (left_comparison_id < right_comparison_id),
  CHECK (preferred_comparison_id IN (left_comparison_id,right_comparison_id)),
  UNIQUE (campaign_id, left_comparison_id, right_comparison_id, revision)
);

CREATE TABLE r2_calibration_intake_qualifications (
  run_id text PRIMARY KEY NOT NULL REFERENCES r2_calibration_runs(id) ON DELETE RESTRICT,
  campaign_id text NOT NULL REFERENCES r2_calibration_campaigns(id) ON DELETE RESTRICT,
  assessment_digest text NOT NULL CHECK (length(assessment_digest) = 64),
  snapshot_json text NOT NULL CHECK (json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'),
  snapshot_digest text NOT NULL CHECK (length(snapshot_digest) = 64),
  safety_bundle_digest text NOT NULL CHECK (length(safety_bundle_digest) = 64),
  approval_id text NOT NULL UNIQUE,
  provenance_json text NOT NULL CHECK (json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  gate_digest text NOT NULL UNIQUE CHECK (length(gate_digest) = 64),
  created_at text NOT NULL,
  UNIQUE (campaign_id, assessment_digest)
);

-- Intake is an immutable event log. Revisions append; changing or deleting history is prohibited.
CREATE TRIGGER r2_cal_campaign_no_update BEFORE UPDATE ON r2_calibration_campaigns BEGIN SELECT RAISE(ABORT,'R2_CALIBRATION_IMMUTABLE'); END;
CREATE TRIGGER r2_cal_campaign_no_delete BEFORE DELETE ON r2_calibration_campaigns BEGIN SELECT RAISE(ABORT,'R2_CALIBRATION_IMMUTABLE'); END;
CREATE TRIGGER r2_cal_comparison_no_update BEFORE UPDATE ON r2_calibration_comparisons BEGIN SELECT RAISE(ABORT,'R2_CALIBRATION_IMMUTABLE'); END;
CREATE TRIGGER r2_cal_comparison_no_delete BEFORE DELETE ON r2_calibration_comparisons BEGIN SELECT RAISE(ABORT,'R2_CALIBRATION_IMMUTABLE'); END;
CREATE TRIGGER r2_cal_label_no_update BEFORE UPDATE ON r2_calibration_label_events BEGIN SELECT RAISE(ABORT,'R2_CALIBRATION_IMMUTABLE'); END;
CREATE TRIGGER r2_cal_label_no_delete BEFORE DELETE ON r2_calibration_label_events BEGIN SELECT RAISE(ABORT,'R2_CALIBRATION_IMMUTABLE'); END;
CREATE TRIGGER r2_cal_pair_no_update BEFORE UPDATE ON r2_calibration_pair_events BEGIN SELECT RAISE(ABORT,'R2_CALIBRATION_IMMUTABLE'); END;
CREATE TRIGGER r2_cal_pair_no_delete BEFORE DELETE ON r2_calibration_pair_events BEGIN SELECT RAISE(ABORT,'R2_CALIBRATION_IMMUTABLE'); END;
CREATE TRIGGER r2_cal_qualification_no_update BEFORE UPDATE ON r2_calibration_intake_qualifications BEGIN SELECT RAISE(ABORT,'R2_CALIBRATION_IMMUTABLE'); END;
CREATE TRIGGER r2_cal_qualification_no_delete BEFORE DELETE ON r2_calibration_intake_qualifications BEGIN SELECT RAISE(ABORT,'R2_CALIBRATION_IMMUTABLE'); END;

PRAGMA user_version = 15;
COMMIT;
