import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { readLeverPostingV2FromPayload, SourceCapabilityV2Schema } from "../index";
import { extractInertLeverSections } from "./inert-text";

const descriptionCapability = SourceCapabilityV2Schema.parse({
  schemaVersion: 2,
  capabilityId: "fictional-description-capability",
  version: 1,
  predecessorVersion: null,
  source: "LEVER",
  alias: "Fictional Description Source",
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

function readDescription(
  description: string,
  descriptionPlain?: string,
  extra: Record<string, unknown> = {},
) {
  return readLeverPostingV2FromPayload({
    capability: descriptionCapability,
    payload: {
      id: "fictional-description-posting",
      text: "Fictional Engineer",
      hostedUrl: "https://jobs.example.test/fictional-description",
      applyUrl: "https://jobs.example.test/fictional-description/apply",
      categories: { location: "Fictional City" },
      description,
      ...(descriptionPlain === undefined ? {} : { descriptionPlain }),
      lists: [],
      ...extra,
    },
  });
}

describe("Lever description-only section boundaries", () => {
  it("retains explicit HTML criteria and preference headings without provider lists", () => {
    const record = readDescription(
      "<div><b>About You</b></div><ul><li>C++ development.</li></ul><p><strong>Nice to have:</strong></p><ul><li>Python programming.</li></ul><p><b>Why this role matters</b></p><p>Support fictional colleagues.</p><h2>Benefits</h2><p>TypeScript training.</p>",
    );
    expect(record.sections.map(({ heading, kind }) => ({ heading, kind }))).toEqual([
      { heading: "About You", kind: "REQUIREMENTS" },
      { heading: "Nice to have:", kind: "REQUIREMENTS" },
      { heading: "Why this role matters", kind: "OTHER" },
      { heading: "Benefits", kind: "BENEFITS" },
    ]);
    expect(record.sections[0]?.content).toBe("C++ development.");
    expect(record.rawPayload.lists).toEqual([]);
  });

  it("uses agreeing HTML context and keeps conflicting plaintext as the selected evidence", () => {
    const html = "<h2>Requirements</h2><ul><li>Python programming.</li></ul>";
    expect(readDescription(html, "Requirements\n\nPython programming.").sections).toEqual([
      { heading: "Requirements", content: "Python programming.", kind: "REQUIREMENTS" },
    ]);
    const conflicting = readDescription(html, "Python is optional in this fictional role.");
    expect(conflicting.sections).toEqual([]);
    expect(conflicting.description).toBe("Python is optional in this fictional role.");
    const unheaded = readDescription("<p>Fictional unheaded overview.</p>");
    expect(unheaded.sections).toEqual([]);
    expect(unheaded.description).toBe("Fictional unheaded overview.");
  });

  it("keeps inline and list emphasis within its existing scope", () => {
    const record = readDescription(
      "<p><span><strong>Requirements</strong></span></p><ul><li><b>C++</b> programming.</li><li><strong>Python programming</strong></li></ul><p>Experience in <b>software testing</b> is required.</p><h2>Benefits</h2><p>Enjoy <b>Python</b> training.</p>",
    );
    expect(record.sections.map(({ heading, kind }) => ({ heading, kind }))).toEqual([
      { heading: "Requirements", kind: "REQUIREMENTS" },
      { heading: "Benefits", kind: "BENEFITS" },
    ]);
    expect(record.sections[0]?.content).toBe(
      "C++ programming.\nPython programming\n\nExperience in software testing is required.",
    );
    expect(readDescription("<h2>Required<br>Skills</h2><p>Python.</p>").sections).toEqual([
      { heading: "Required Skills", content: "Python.", kind: "REQUIREMENTS" },
    ]);
  });

  it("keeps generic overview headings on the flat path beside complete explicit lists", () => {
    const record = readDescription(
      "<h2>About our fictional company</h2><p>Fictional company overview.</p><h2>The Role</h2><p>Support fictional colleagues.</p>",
      undefined,
      {
        lists: [{ text: "Requirements", content: "<p>Python programming.</p>" }],
      },
    );
    expect(record.sections).toEqual([
      { heading: "Requirements", content: "Python programming.", kind: "REQUIREMENTS" },
    ]);
    expect(record.description).toContain("Fictional company overview.");
  });

  it("preserves ambiguous emphasized clauses and resets criteria at unknown headings", () => {
    const record = readDescription(
      "<h2>About You</h2><p>Python programming.</p><p><b>Communication skills</b></p><p>Help fictional colleagues.</p><h2>Requirements and benefits</h2><p>TypeScript knowledge.</p>",
    );
    expect(record.sections.map(({ kind }) => kind)).toEqual(["REQUIREMENTS", "OTHER", "OTHER"]);
    expect(record.sections[1]?.content).toBe("Communication skills\nHelp fictional colleagues.");
    expect(record.sections[2]?.content).toContain("TypeScript knowledge.");
  });

  it("discards active markup and keeps additional HTML and explicit lists immutable", () => {
    const record = readDescription(
      "<script><h2>Requirements</h2>Unsafe claim</script><form><b>Requirements</b><p>Unsafe form text</p></form><h2>About You</h2><p>Python &amp; C++.</p>",
      undefined,
      {
        lists: [{ text: "Responsibilities", content: "<p>Support fictional systems.</p>" }],
        additional: "<h3>Strongly regarded</h3><p>Software testing experience.</p>",
        additionalPlain: "Strongly regarded\nSoftware testing experience.",
      },
    );
    expect(record.sections.map(({ kind }) => kind)).toEqual([
      "REQUIREMENTS",
      "RESPONSIBILITIES",
      "REQUIREMENTS",
    ]);
    expect(JSON.stringify(record.sections)).not.toMatch(/Unsafe|<h|<p|<script|<form/);
    expect(record.description.match(/Support fictional systems\./g)).toHaveLength(1);
    expect(record.contentDigest).toBe(
      createHash("sha256").update(JSON.stringify(record.rawPayload)).digest("hex"),
    );
    expect(Object.isFrozen(record.rawPayload)).toBe(true);
    expect(Object.isFrozen(record.rawPayload.lists)).toBe(true);
    expect(Object.isFrozen(record.sections)).toBe(true);
    expect(record.sections.every(Object.isFrozen)).toBe(true);
    expect(readDescription("<h2>Requirements</h2><p>Python.</p>").sections).toEqual(
      readDescription("<h2>Requirements</h2><p>Python.</p>").sections,
    );
  });

  it("fails closed on oversized, excessively deep or excessive section structure", () => {
    expect(extractInertLeverSections("x".repeat(128 * 1_024 + 1))).toEqual([]);
    expect(
      extractInertLeverSections(
        "<div>".repeat(65) + "<h2>Requirements</h2>Python" + "</div>".repeat(65),
      ),
    ).toEqual([]);
    expect(extractInertLeverSections("<h2>Requirements</h2><p>Python.</p>".repeat(129))).toEqual(
      [],
    );
    expect(extractInertLeverSections("<h2>Requirements</h2><p>Python.</p>")).toEqual([
      { heading: "Requirements", content: "Python." },
    ]);
  });
});

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
          { text: " What We Are Looking For ", content: "Python programming." },
          { text: "What We're Looking For", content: "Software testing experience." },
          { text: "What We’re Looking For", content: "Embedded systems knowledge." },
          { text: "What We Are Looking For - Some of the following", content: "Python." },
          { text: "Not Required But Highly Regarded", content: "Fictional optional skill." },
          { text: "Nice to have, but not essential traits and experience", content: "Python." },
          { text: "What You’ll Be Doing", content: "Develop fictional software." },
          { text: "Benefits and skills training", content: "Learn fictional skills." },
          { text: "Requirements and benefits", content: "Python programming." },
          { text: "What we are looking forward to", content: "Fictional future plans." },
        ],
      },
    });

    expect(record.sections.map(({ heading, kind }) => ({ heading, kind }))).toEqual([
      { heading: "Requirements", kind: "REQUIREMENTS" },
      { heading: "Preferred Qualifications", kind: "REQUIREMENTS" },
      { heading: "Responsibilities", kind: "RESPONSIBILITIES" },
      { heading: "Benefits", kind: "BENEFITS" },
      { heading: "Additional Information", kind: "OTHER" },
      { heading: "What We Are Looking For", kind: "REQUIREMENTS" },
      { heading: "What We're Looking For", kind: "REQUIREMENTS" },
      { heading: "What We’re Looking For", kind: "REQUIREMENTS" },
      { heading: "What We Are Looking For - Some of the following", kind: "REQUIREMENTS" },
      { heading: "Not Required But Highly Regarded", kind: "REQUIREMENTS" },
      { heading: "Nice to have, but not essential traits and experience", kind: "REQUIREMENTS" },
      { heading: "What You’ll Be Doing", kind: "RESPONSIBILITIES" },
      { heading: "Benefits and skills training", kind: "BENEFITS" },
      { heading: "Requirements and benefits", kind: "REQUIREMENTS" },
      { heading: "What we are looking forward to", kind: "OTHER" },
    ]);
  });
});
