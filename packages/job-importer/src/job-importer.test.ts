import { describe, expect, it } from "vitest";

import {
  canonicalizeJobUrl,
  classifyJobUrl,
  detectStructuredCredential,
  deriveJobIdentity,
  evaluateJobUrlPolicy,
  prepareJobImport,
  productionFetchAllowedCount,
  sanitizeImportContent,
} from "./index";
import { seekFixtureCases } from "../../../fixtures/seek/manifest";

const labelledJob = `Title: Service Assistant
Company: Fictional Harbour Co
Location: Sydney NSW 2000
Employment type: Part time
Description: Help customers and keep accurate service records.
Requirements:
- Clear communication
- Weekend availability`;

describe("real-world job importer", () => {
  it("prepares a deterministic source-neutral preview without candidate data", () => {
    const prepared = prepareJobImport(
      {
        inputType: "PASTED_SINGLE",
        acquisitionMethod: "USER_SUPPLIED_CONTENT",
        content: labelledJob,
      },
      {
        now: () => new Date("2026-09-05T00:00:00.000Z"),
        uuid: () => "9d974c7f-66f7-4358-9629-83731d8a1856",
      },
    );
    expect(prepared.document).toMatchObject({
      importId: "9d974c7f-66f7-4358-9629-83731d8a1856",
      acquisitionMethod: "USER_SUPPLIED_CONTENT",
      detectedSource: "UNKNOWN",
      detectedJobs: 1,
    });
    expect(prepared.records[0]?.fields).toMatchObject({
      title: "Service Assistant",
      company: "Fictional Harbour Co",
      location: "Sydney NSW 2000",
      employmentType: "PART_TIME",
    });
    expect(JSON.stringify(prepared)).not.toContain("candidateProfile");
  });

  it("detects origin from an explicitly supplied labelled URL without confusing acquisition", () => {
    const result = prepareJobImport({
      inputType: "PASTED_SINGLE",
      acquisitionMethod: "USER_SUPPLIED_CONTENT",
      content: `${labelledJob}\nURL: https://www.seek.com.au/job/12345678`,
    });
    expect(result.records[0]?.sourceDetection.source).toBe("SEEK");
    expect(result.document.acquisitionMethod).toBe("USER_SUPPLIED_CONTENT");
  });

  it("splits explicit multi-job input and requires review for inferred labelled boundaries", () => {
    const explicit = prepareJobImport({
      inputType: "PASTED_MULTI",
      acquisitionMethod: "USER_SUPPLIED_CONTENT",
      content: `${labelledJob}\n--- JOB ---\n${labelledJob.replace("Service Assistant", "Cafe Assistant")}`,
    });
    expect(explicit.records).toHaveLength(2);
    expect(explicit.splitStatus).toBe("CONFIDENT");

    const inferred = prepareJobImport({
      inputType: "PASTED_MULTI",
      acquisitionMethod: "USER_SUPPLIED_CONTENT",
      content: `${labelledJob}\n${labelledJob.replace("Service Assistant", "Cafe Assistant")}`,
    });
    expect(inferred.records).toHaveLength(2);
    expect(inferred.splitStatus).toBe("REVIEW_REQUIRED");
  });

  it("extracts schema.org JobPosting JSON-LD from inert HTML and ignores scripts", () => {
    const html = `<html><body><script>globalThis.compromised=true</script><script type="application/ld+json">${JSON.stringify(
      {
        "@type": "JobPosting",
        title: "Fictional Analyst",
        hiringOrganization: { name: "Example Systems" },
        jobLocation: { address: { addressLocality: "Melbourne", addressRegion: "VIC" } },
        description: "Review fictional operational information carefully.",
        url: "https://careers.example.test/jobs/analyst",
      },
    )}</script><img src="https://tracker.example.test/pixel"><p>Visible role text</p></body></html>`;
    const result = prepareJobImport({
      inputType: "PASTED_HTML",
      acquisitionMethod: "USER_SUPPLIED_CONTENT",
      content: html,
    });
    expect(result.records[0]?.fields.title).toBe("Fictional Analyst");
    expect(result.records[0]?.sourceDetection.source).toBe("GENERIC_COMPANY_SITE");
    expect(result.records[0]?.excerpt).not.toContain("compromised");
  });

  it("splits repeated inert HTML job cards with explicit structural evidence", () => {
    const card = (id: number) => `<article class="job-card" data-job-id="${id}">
      <h2>Fictional Card Role ${id}</h2><span class="company">Example Card Co ${id}</span>
      <span class="location">Sydney NSW</span><a href="https://careers.example.test/jobs/${id}">Details</a>
      <p>Support a fictional local team and keep records accurate.</p></article>`;
    const result = prepareJobImport({
      inputType: "PASTED_HTML",
      acquisitionMethod: "USER_SUPPLIED_CONTENT",
      content: `<main>${card(1)}${card(2)}</main>`,
    });
    expect(result.records).toHaveLength(2);
    expect(result.splitStatus).toBe("CONFIDENT");
    expect(result.records.map(({ fields }) => fields.title)).toEqual([
      "Fictional Card Role 1",
      "Fictional Card Role 2",
    ]);
  });

  it("reuses the validated Phase 2 SEEK parser when its preconditions are met", () => {
    const fixture = seekFixtureCases[0]!.record;
    const sourceUrl = "https://www.seek.com.au/job/12345678";
    const result = prepareJobImport({
      inputType: "PASTED_SINGLE",
      acquisitionMethod: "USER_SUPPLIED_CONTENT",
      content: JSON.stringify({ ...fixture, canonicalUrl: sourceUrl, sourcePageUrl: sourceUrl }),
    });
    expect(result.records[0]?.sourceDetection.source).toBe("SEEK");
    expect(result.records[0]?.extractionRuleIds).toContain("SEEK_PHASE_2_PARSER_REUSE");
    expect(result.document.acquisitionMethod).toBe("USER_SUPPLIED_CONTENT");
  });

  it("uses exact or dot-boundary vendor hosts and rejects lookalikes", () => {
    const recognized = [
      ["https://www.seek.com.au/job/123", "SEEK"],
      ["https://au.indeed.com/viewjob?jk=abc", "INDEED"],
      ["https://jobs.employmenthero.com/example/job/1", "EMPLOYMENT_HERO"],
      ["https://boards.greenhouse.io/example/jobs/1", "GREENHOUSE"],
      ["https://jobs.lever.co/example/abc", "LEVER"],
      ["https://tenant.myworkdayjobs.com/en-US/site/job/role", "WORKDAY"],
      ["https://careers.example.test/jobs/1", "GENERIC_COMPANY_SITE"],
    ] as const;
    for (const [url, source] of recognized) expect(classifyJobUrl(url)).toBe(source);
    for (const url of [
      "https://indeed.example-attacker.test/viewjob?jk=1",
      "https://boards.greenhouse.io.attacker.test/jobs/1",
      "https://lever.co.attacker.test/job/1",
    ]) {
      expect(classifyJobUrl(url)).toBe("GENERIC_COMPANY_SITE");
    }
    expect(classifyJobUrl("https://boards.greenhouse.io@attacker.test/jobs/1")).toBe("UNKNOWN");
  });

  it("keeps every production URL source fail-closed with zero fetch entries", () => {
    expect(productionFetchAllowedCount()).toBe(0);
    expect(evaluateJobUrlPolicy("https://www.seek.com.au/job/123").decision).toBe(
      "USER_CONTENT_REQUIRED",
    );
    expect(evaluateJobUrlPolicy("https://boards.greenhouse.io/example/jobs/1").decision).toBe(
      "REVIEW_REQUIRED",
    );
    for (const url of [
      "https://au.indeed.com/viewjob?jk=abc",
      "https://jobs.employmenthero.com/example/job/1",
      "https://jobs.lever.co/example/abc",
      "https://tenant.myworkdayjobs.com/en-US/site/job/role",
      "https://careers.example.test/jobs/1",
      "https://unknown.example.test/job/1",
    ]) {
      expect(evaluateJobUrlPolicy(url).decision).toBe("REVIEW_REQUIRED");
    }
    for (const url of [
      "http://example.test/job",
      "https://localhost/job",
      "https://127.0.0.1/job",
      "https://user:pass@example.test/job",
    ]) {
      expect(evaluateJobUrlPolicy(url).decision).toBe("UNSUPPORTED");
    }
  });

  it("rejects structured credentials but accepts normal job-ad security language", () => {
    expect(
      detectStructuredCredential("Authorization: Bearer abcdefghijklmnopqrstuvwxyz.123456"),
    ).toBe("AUTHORIZATION_BEARER_HEADER");
    expect(detectStructuredCredential("Cookie: session=abcdefghijklmnopqrstuvwxyz")).toBe(
      "COOKIE_HEADER",
    );
    expect(detectStructuredCredential('{"access_token":"abcdefghijklmnopqrstuvwxyz"}')).toBe(
      "CREDENTIAL_JSON",
    );
    expect(
      detectStructuredCredential(
        "Email recruiter@example.test. Maintain API token authentication and password policy documentation. Reference ID JOB-123.",
      ),
    ).toBeNull();
  });

  it("enforces upload, byte, UTF-8, binary, and prototype-key boundaries", () => {
    expect(() =>
      sanitizeImportContent({
        inputType: "FILE_UPLOAD",
        content: labelledJob,
        originalFilename: "job.pdf",
        declaredMimeType: "application/pdf",
      }),
    ).toThrowError(/UTF-8/);
    expect(() =>
      sanitizeImportContent({ inputType: "PASTED_SINGLE", content: new Uint8Array([0xff]) }),
    ).toThrowError(/UTF-8/);
    expect(() =>
      sanitizeImportContent({ inputType: "PASTED_SINGLE", content: "job\0body" }),
    ).toThrowError(/Binary/);
    expect(() =>
      sanitizeImportContent({ inputType: "PASTED_SINGLE", content: '{"constructor":{"x":1}}' }),
    ).toThrowError(/unsafe object key/);
    expect(() =>
      sanitizeImportContent({
        inputType: "FILE_UPLOAD",
        content: labelledJob,
        originalFilename: "folder/job.txt",
        declaredMimeType: "text/plain",
      }),
    ).toThrowError(/paths/);
    expect(() =>
      sanitizeImportContent({
        inputType: "FILE_UPLOAD",
        content: "<html><body>Job</body></html>",
        originalFilename: "job.txt",
        declaredMimeType: "text/plain",
      }),
    ).toThrowError(/do not agree/);
    expect(() =>
      sanitizeImportContent({
        inputType: "FILE_UPLOAD",
        content: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x61]),
        originalFilename: "job.txt",
        declaredMimeType: "text/plain",
      }),
    ).toThrowError(/packaged/);
  });

  it("canonicalizes only approved tracking parameters and derives ordered identities", () => {
    expect(canonicalizeJobUrl("https://Example.test:443/Job/A?utm_source=x&job=2#details")).toBe(
      "https://example.test/Job/A?job=2",
    );
    expect(
      deriveJobIdentity(
        "UNKNOWN",
        {
          externalId: null,
          sourceUrl: null,
          title: "Role",
          company: "Company",
          location: "Sydney",
          category: null,
          description: "A complete explicit description",
          salaryText: null,
          employmentType: "UNKNOWN",
          requirements: [],
          responsibilities: [],
          datePosted: null,
          coverLetterRequired: null,
        },
        "a".repeat(64),
      ).kind,
    ).toBe("LOCAL_FINGERPRINT");
  });

  it("accepts exactly 100 explicit records and rejects a 101-record batch", () => {
    const batch = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        labelledJob.replace("Service Assistant", `Service Assistant ${index + 1}`),
      ).join("\n--- JOB ---\n");
    expect(
      prepareJobImport({
        inputType: "PASTED_MULTI",
        acquisitionMethod: "USER_SUPPLIED_CONTENT",
        content: batch(100),
      }).records,
    ).toHaveLength(100);
    expect(() =>
      prepareJobImport({
        inputType: "PASTED_MULTI",
        acquisitionMethod: "USER_SUPPLIED_CONTENT",
        content: batch(101),
      }),
    ).toThrowError("TOO_MANY_JOBS");
  });
});
