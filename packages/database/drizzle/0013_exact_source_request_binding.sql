-- Additive only. Historical schema12 capabilities keep their original digest and no binding.
CREATE TABLE source_capability_request_bindings (
  capability_version_id text PRIMARY KEY NOT NULL,
  request_json text NOT NULL CHECK (json_valid(request_json) AND length(request_json) <= 2000),
  request_digest text NOT NULL CHECK (length(request_digest) = 64),
  FOREIGN KEY (capability_version_id) REFERENCES source_capability_versions(id) ON DELETE RESTRICT
);
PRAGMA user_version = 13;
