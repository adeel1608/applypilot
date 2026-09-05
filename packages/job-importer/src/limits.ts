export const IMPORT_LIMITS = {
  maximumBytes: 1024 * 1024,
  maximumUrlLength: 2048,
  maximumJobs: 100,
  maximumCandidateBytes: 128 * 1024,
  maximumLines: 25_000,
  maximumJsonDepth: 256,
  maximumHtmlDepth: 256,
  maximumFilenameLength: 255,
  maximumFieldLength: 128 * 1024,
} as const;

export const IMPORT_PARSER_VERSION = "job-importer-v1";
export const SOURCE_RULES_VERSION = "job-source-detection-v1";
export const URL_POLICY_VERSION = "job-url-policy-v1";
