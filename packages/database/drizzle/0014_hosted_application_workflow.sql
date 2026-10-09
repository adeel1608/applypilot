CREATE TABLE hosted_capability_versions (
  id TEXT PRIMARY KEY NOT NULL,
  capability_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  mode TEXT NOT NULL CHECK(mode IN ('REAL','FICTIONAL')),
  scope TEXT NOT NULL CHECK(scope IN ('PASSIVE_INSPECTION','APPLICATION')),
  capability_json TEXT NOT NULL CHECK(json_valid(capability_json) AND length(capability_json)<=50000),
  capability_digest TEXT NOT NULL CHECK(length(capability_digest)=64),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(capability_id,version)
);
CREATE TABLE hosted_owner_consents (
  id TEXT PRIMARY KEY NOT NULL,
  capability_version_id TEXT NOT NULL REFERENCES hosted_capability_versions(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('INSPECT','DISCLOSE','SUBMIT')),
  action_binding TEXT NOT NULL,
  nonce_digest TEXT NOT NULL UNIQUE CHECK(length(nonce_digest)=64),
  proof_json TEXT NOT NULL CHECK(json_valid(proof_json) AND length(proof_json)<=3000),
  consumed_at TEXT NOT NULL
);
CREATE TABLE hosted_question_discoveries (
  id TEXT PRIMARY KEY NOT NULL,
  subject_digest TEXT NOT NULL CHECK(length(subject_digest)=64),
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  job_version_id TEXT NOT NULL REFERENCES job_versions(id) ON DELETE RESTRICT,
  profile_version_id TEXT NOT NULL REFERENCES candidate_profile_versions(id) ON DELETE RESTRICT,
  verification_id TEXT NOT NULL REFERENCES source_record_verifications(id) ON DELETE RESTRICT,
  source_run_id TEXT NOT NULL REFERENCES source_run_checkpoints(id) ON DELETE RESTRICT,
  subject_json TEXT NOT NULL CHECK(json_valid(subject_json)),
  discovery_json TEXT NOT NULL CHECK(json_valid(discovery_json) AND length(discovery_json)<=250000),
  discovery_digest TEXT NOT NULL CHECK(length(discovery_digest)=64),
  created_at TEXT NOT NULL,
  UNIQUE(subject_digest,discovery_digest)
);
CREATE TABLE hosted_browser_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  capability_version_id TEXT NOT NULL REFERENCES hosted_capability_versions(id) ON DELETE RESTRICT,
  inspection_consent_id TEXT NOT NULL UNIQUE REFERENCES hosted_owner_consents(id) ON DELETE RESTRICT,
  disclosure_consent_id TEXT UNIQUE REFERENCES hosted_owner_consents(id) ON DELETE RESTRICT,
  runtime_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('INSPECTING','INSPECTED','MAPPED','FILLED','UPLOADED','VERIFIED','REVIEW_READY','CONFIRMED_SUBMITTED','CONFIRMED_NOT_SUBMITTED','OUTCOME_UNKNOWN','STOPPED')),
  form_json TEXT CHECK(form_json IS NULL OR json_valid(form_json)),
  discovery_id TEXT REFERENCES hosted_question_discoveries(id) ON DELETE RESTRICT,
  mapping_json TEXT NOT NULL CHECK(json_valid(mapping_json)),
  proofs_json TEXT NOT NULL CHECK(json_valid(proofs_json)),
  preview_json TEXT CHECK(preview_json IS NULL OR json_valid(preview_json)),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK(request_count>=0),
  safe_stop_code TEXT,
  confirmation_digest TEXT CHECK(confirmation_digest IS NULL OR length(confirmation_digest)=64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE hosted_question_review_receipts (
  nonce_digest TEXT PRIMARY KEY NOT NULL CHECK(length(nonce_digest)=64),
  subject_digest TEXT NOT NULL CHECK(length(subject_digest)=64),
  discovery_digest TEXT NOT NULL CHECK(length(discovery_digest)=64),
  proof_json TEXT NOT NULL CHECK(json_valid(proof_json) AND length(proof_json)<=3000),
  consumed_at TEXT NOT NULL
);
CREATE TABLE hosted_question_choices (
  id TEXT PRIMARY KEY NOT NULL,
  subject_digest TEXT NOT NULL CHECK(length(subject_digest)=64),
  discovery_digest TEXT NOT NULL CHECK(length(discovery_digest)=64),
  question_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('TERMS','DATA_PROCESSING')),
  value INTEGER NOT NULL CHECK(value IN (0,1)),
  nonce_digest TEXT NOT NULL REFERENCES hosted_question_review_receipts(nonce_digest) ON DELETE RESTRICT CHECK(length(nonce_digest)=64),
  proof_json TEXT NOT NULL CHECK(json_valid(proof_json) AND length(proof_json)<=3000),
  created_at TEXT NOT NULL,
  UNIQUE(nonce_digest,question_id)
);
CREATE TABLE hosted_operation_claims (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES hosted_browser_sessions(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK(operation IN ('OPEN_AND_INSPECT_ONLY','MAP_FOR_FILL','FILL','UPLOAD','VERIFY','FILL_PREVIEW','SUBMIT')),
  state TEXT NOT NULL CHECK(state IN ('CLAIMED','COMPLETE','STOPPED','OUTCOME_UNKNOWN')),
  capability_digest TEXT NOT NULL CHECK(length(capability_digest)=64),
  runtime_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(session_id,operation)
);
CREATE TABLE hosted_packet_answer_choices (
  question_id TEXT PRIMARY KEY NOT NULL REFERENCES application_questions(id) ON DELETE RESTRICT,
  choice_receipt_id TEXT NOT NULL REFERENCES hosted_question_choices(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX hosted_one_active_operation ON hosted_operation_claims(session_id) WHERE state='CLAIMED';
CREATE TABLE hosted_final_consents (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL UNIQUE REFERENCES hosted_browser_sessions(id) ON DELETE RESTRICT,
  owner_consent_id TEXT NOT NULL UNIQUE REFERENCES hosted_owner_consents(id) ON DELETE RESTRICT,
  preview_digest TEXT NOT NULL CHECK(length(preview_digest)=64),
  binding_digest TEXT NOT NULL CHECK(length(binding_digest)=64),
  expires_at TEXT NOT NULL,
  consumed_at TEXT NOT NULL
);
CREATE TABLE hosted_submit_guards (
  mode TEXT NOT NULL CHECK(mode IN ('REAL','FICTIONAL')),
  provider TEXT NOT NULL CHECK(provider IN ('GREENHOUSE','LEVER')),
  region TEXT NOT NULL CHECK(region IN ('GLOBAL','EU')),
  tenant TEXT NOT NULL,
  external_id TEXT NOT NULL,
  session_id TEXT NOT NULL UNIQUE REFERENCES hosted_browser_sessions(id) ON DELETE RESTRICT,
  claim_id TEXT NOT NULL UNIQUE REFERENCES hosted_operation_claims(id) ON DELETE RESTRICT,
  activated_at TEXT NOT NULL,
  PRIMARY KEY(mode,provider,region,tenant,external_id)
);
PRAGMA user_version = 14;
