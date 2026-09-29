import { describe, expect, it } from "vitest";

import { readLeverPostingV2FromPayload, SourceCapabilityV2Schema } from "../index";

describe("Lever v2 immutable payload reader section classification", () => {
  it("retains provider-neutral requirement and non-requirement section kinds with their headings", () => {
    const capability = SourceCapabilityV2Schema.parse({
      schemaVersion: 2,
      capabilityId: "fictional-lever-capability",
      version: 1,
      predecessorVersion: null,
      source: "LEVER",
      alias: "Fictional Source",
      tenant: "fictional-tenant",
      region: "GLOBAL",
      allowedHost: "api.lever.co",
      allowedPathPrefix: "/v0/postings/fictional-tenant",
      allowedOperations: ["LIST_JOBS"],
      approvalState: "DRAFT",
      approvalReference: null,
      approvedAt: null,
      policyVersion: "fictional-policy-v1",
      policyReviewedAt: "2026-09-01T00:00:00.000Z",
      policyExpiresAt: "2027-09-01T00:00:00.000Z",
      capabilityExpiresAt: "2027-09-01T00:00:00.000Z",
      requestBudget: 1,
      recordCap: 10,
      pageSizeCap: 5,
      responseByteLimit: 100_000,
      requestTimeoutMs: 1_000,
      runTimeoutMs: 5_000,
      maxRedirects: 0,
      maxRetries: 0,
      maxConcurrency: 1,
      parserVersion: "lever-v2:fictional",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      revokedAt: null,
      revocationReason: null,
    });
    const record = readLeverPostingV2FromPayload({
      capability,
      payload: {
        id: "fictional-posting",
        text: "Fictional Engineer",
        hostedUrl: "https://jobs.example.test/fictional",
        applyUrl: "https://jobs.example.test/fictional/apply",
        descriptionPlain: "Fictional posting description.",
        categories: { location: "Fictional City" },
        lists: [
          { text: "Requirements", content: "Fictional requirement content." },
          { text: "Preferred Qualifications", content: "Fictional preferred content." },
          { text: "Responsibilities", content: "Fictional responsibility content." },
          { text: "Benefits", content: "Fictional benefit content." },
          { text: "Additional Information", content: "Fictional other content." },
        ],
      },
    });

    expect(record.sections.map(({ heading, kind }) => ({ heading, kind }))).toEqual([
      { heading: "Requirements", kind: "REQUIREMENTS" },
      { heading: "Preferred Qualifications", kind: "REQUIREMENTS" },
      { heading: "Responsibilities", kind: "RESPONSIBILITIES" },
      { heading: "Benefits", kind: "BENEFITS" },
      { heading: "Additional Information", kind: "OTHER" },
    ]);
  });
});
