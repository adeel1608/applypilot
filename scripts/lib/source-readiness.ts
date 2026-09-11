import {
  loadPrivateSourceAllowlistV2,
  sourceCapabilityReadiness,
  type SourceCapabilityReadiness,
} from "@applypilot/job-sources";

export interface OperationalSourceReadiness {
  state: "WAITING_FOR_APPROVED_TENANT" | "SOURCE_ALLOWLIST_V2_READY";
  configuredCapabilityCount: number;
  activeCapabilityCount: number;
  inactiveReasons: SourceCapabilityReadiness[];
}

export async function operationalSourceReadiness(
  repositoryRoot: string,
  now = new Date(),
  filename = process.env.APPLYPILOT_SOURCE_ALLOWLIST_FILENAME ?? "source-allowlist.json",
): Promise<OperationalSourceReadiness> {
  const source = await loadPrivateSourceAllowlistV2(repositoryRoot, filename);
  const readiness = source.capabilities.map((capability) =>
    sourceCapabilityReadiness(capability, now),
  );
  return {
    state: source.status,
    configuredCapabilityCount: source.capabilities.length,
    activeCapabilityCount: readiness.filter(({ status }) => status === "SOURCE_ENABLED").length,
    inactiveReasons: readiness.filter(({ status }) => status !== "SOURCE_ENABLED"),
  };
}
