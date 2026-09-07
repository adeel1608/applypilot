import { describe, expect, it } from "vitest";

import { compareCrossSourceObservations, type ObservationIdentity } from "./index";

function observation(overrides: Partial<ObservationIdentity> = {}): ObservationIdentity {
  return {
    observationId: "observation:left",
    source: "GREENHOUSE",
    tenant: "fictional-company",
    externalId: "role-123",
    applicationUrl: "https://careers.example.test/jobs/role-123",
    requisitionId: "REQ-123",
    company: "Fictional Company",
    title: "Service Assistant",
    location: "Preston VIC",
    employmentType: "PART_TIME",
    datePosted: "2026-09-01T00:00:00.000Z",
    description: "Provide careful customer service.",
    ...overrides,
  };
}

describe("cross-source observation deduplication", () => {
  it("recognizes only same-source tenant identity as the same observation", () => {
    const result = compareCrossSourceObservations(
      observation(),
      observation({ observationId: "observation:right" }),
    );
    expect(result).toMatchObject({
      decision: "SAME_OBSERVATION",
      confidence: "HIGH",
      requiresHumanReview: false,
    });
  });

  it("suggests but never automatically links a corroborated cross-source role", () => {
    const result = compareCrossSourceObservations(
      observation(),
      observation({
        observationId: "observation:right",
        source: "LEVER",
        tenant: "fictional-lever",
        externalId: "lever-456",
      }),
    );
    expect(result).toMatchObject({
      decision: "SUGGEST_LINK",
      confidence: "HIGH",
      requiresHumanReview: true,
    });
  });

  it("keeps similar titles and cross-tenant ID collisions separate", () => {
    const similarTitle = compareCrossSourceObservations(
      observation(),
      observation({
        observationId: "observation:right",
        source: "LEVER",
        tenant: "other-company",
        externalId: "other-456",
        applicationUrl: "https://jobs.example.test/jobs/other-456",
        requisitionId: "REQ-456",
        company: "Other Company",
        location: "Sydney NSW",
        description: "A different job.",
      }),
    );
    expect(similarTitle.decision).toBe("KEEP_SEPARATE");

    const tenantCollision = compareCrossSourceObservations(
      observation(),
      observation({ observationId: "observation:right", tenant: "other-company" }),
    );
    expect(tenantCollision.decision).toBe("KEEP_SEPARATE");
    expect(tenantCollision.conflictingSignals).toContain("tenant_external_id_collision");
  });
});
