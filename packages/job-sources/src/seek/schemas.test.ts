import { describe, expect, it } from "vitest";

import {
  canonicalizeSeekQuery,
  decodeSeekCursor,
  encodeSeekCursor,
  hashSeekQuery,
  parseUserSuppliedSeekContent,
  SeekAdapterError,
  SeekDiscoveryQuerySchema,
  validateSeekCheckpoint,
} from "./index";

describe("SEEK boundary contracts", () => {
  it("validates the expanded discovery query and canonicalizes set-like inputs", () => {
    const query = canonicalizeSeekQuery({
      keywords: [" Retail  Assistant ", "retail assistant", "Casual"],
      locations: ["Preston", "preston"],
      location: { postcode: "3072", radiusKm: 25 },
      employmentTypes: ["CASUAL", "CASUAL"],
      sortOrder: "DATE_POSTED",
    });
    expect(query.keywords).toEqual(["Casual", "retail assistant"]);
    expect(query.locations).toEqual(["preston"]);
    expect(query.employmentTypes).toEqual(["CASUAL"]);
    expect(() =>
      SeekDiscoveryQuerySchema.parse({
        keywords: [],
        locations: [],
        location: { radiusKm: 10 },
      }),
    ).toThrow("A radius requires");
  });

  it("binds opaque cursors to mode and canonical query identity", () => {
    const queryHash = hashSeekQuery({ keywords: ["retail"], locations: [] });
    const encoded = encodeSeekCursor({
      schemaVersion: 1,
      source: "SEEK",
      mode: "FIXTURE_ONLY",
      queryHash,
      pageNumber: 1,
      sourceCursor: "2",
      previousPageHash: "a".repeat(64),
    });
    expect(decodeSeekCursor(encoded, { queryHash, mode: "FIXTURE_ONLY" }).sourceCursor).toBe("2");
    expect(() =>
      decodeSeekCursor(encoded, { queryHash: "b".repeat(64), mode: "FIXTURE_ONLY" }),
    ).toThrowError(SeekAdapterError);
  });

  it("rejects stale checkpoints", () => {
    expect(() =>
      validateSeekCheckpoint(
        {
          schemaVersion: 1,
          runId: "3b57ce65-85fb-4265-9296-b55043c17891",
          source: "SEEK",
          mode: "FIXTURE_ONLY",
          queryHash: "a".repeat(64),
          nextCursor: null,
          lastSuccessfulFetchAt: "2026-09-05T00:00:00.000Z",
          lastCommittedPage: 1,
          processedPageHashes: [],
          counts: { discovered: 1, added: 1, updated: 0, duplicates: 0, failed: 0 },
          expiresAt: "2026-09-05T01:00:00.000Z",
        },
        {
          queryHash: "a".repeat(64),
          mode: "FIXTURE_ONLY",
          now: new Date("2026-09-06T00:00:00.000Z"),
        },
      ),
    ).toThrowError(/stale, invalid, or belongs/);
  });

  it("parses user-supplied JSON-LD locally and rejects URL-only input", () => {
    const context = {
      sourceUrl: "https://seek.example.test/job/pasted-1?utm_source=test",
      discoveredAt: "2026-09-05T00:00:00.000Z",
      fetchedAt: "2026-09-05T00:01:00.000Z",
    };
    const record = parseUserSuppliedSeekContent(
      `<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        identifier: { value: "pasted-1" },
        title: "Pasted Fixture Role",
        hiringOrganization: { name: "Pasted Example Group" },
        industry: "Administration & Office Support",
        description: "<p>Explicitly supplied content.</p>",
        employmentType: "FULL_TIME",
        datePosted: "2026-09-04",
        jobLocation: {
          address: {
            addressLocality: "Preston",
            addressRegion: "VIC",
            postalCode: "3072",
            addressCountry: "Australia",
          },
        },
      })}</script>`,
      context,
    );
    expect(record.accessMode).toBe("USER_SUPPLIED_CONTENT");
    expect(record.canonicalUrl).toBe("https://seek.example.test/job/pasted-1");
    expect(record.title).toBe("Pasted Fixture Role");
    expect(() => parseUserSuppliedSeekContent("https://seek.example.test/job/1", context)).toThrow(
      /never fetches a URL/,
    );
    expect(() =>
      parseUserSuppliedSeekContent("Authorization: Bearer secret-token-value", context),
    ).toThrowError(/authentication or session material/);
  });

  it("derives a stable external ID only when user content has a validated canonical URL", () => {
    const context = {
      sourceUrl: "https://seek.example.test/job/no-identifier?tracking=value",
      discoveredAt: "2026-09-05T00:00:00.000Z",
      fetchedAt: "2026-09-05T00:01:00.000Z",
    };
    const content = {
      "@type": "JobPosting",
      title: "No Identifier Fixture",
      hiringOrganization: { name: "Canonical Example Group" },
      industry: "Administration & Office Support",
      description: "Content with a deliberately absent identifier.",
      jobLocation: {
        address: {
          addressLocality: "Preston",
          addressRegion: "VIC",
          postalCode: "3072",
          addressCountry: "Australia",
        },
      },
    };
    const first = parseUserSuppliedSeekContent(content, context);
    const second = parseUserSuppliedSeekContent(content, context);
    expect(first.externalId).toBe(second.externalId);
    expect(first.canonicalUrl).toBe("https://seek.example.test/job/no-identifier");
  });
});
