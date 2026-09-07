import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fixtureJob, testProfile } from "../../../tests/fixture-data";
import {
  generateResumeDocument,
  renderResumeDocx,
  renderResumeHtml,
  resumeTemplateDesigns,
  resumeFileName,
  selectResumeTemplate,
  validateResumeTruth,
} from "./index";

describe("resume engine", () => {
  it("selects requested template categories deterministically", () => {
    expect(selectResumeTemplate(fixtureJob("job-retail-sales-assistant"))).toBe(
      "retail-customer-service",
    );
    expect(selectResumeTemplate(fixtureJob("job-robotics-internship"))).toBe(
      "robotics-mechatronics",
    );
    expect(selectResumeTemplate(fixtureJob("job-junior-receptionist"))).toBe("admin-reception");
  });

  it("generates only provenance-bound verified claims", () => {
    const document = generateResumeDocument(testProfile, fixtureJob("job-retail-sales-assistant"));
    expect(validateResumeTruth(document, testProfile)).toEqual({ valid: true, errors: [] });
    expect(document.skills.map(({ text }) => text)).toContain("Customer service");
    expect(JSON.stringify(document).toLowerCase()).not.toContain("pos experience");
    expect(JSON.stringify(document).toLowerCase()).not.toContain("retail experience");
  });

  it("renders an ATS-safe A4 black-text HTML foundation", () => {
    const html = renderResumeHtml(
      generateResumeDocument(testProfile, fixtureJob("job-retail-sales-assistant")),
    );
    expect(html).toContain("@page { size: A4");
    expect(html).toContain('font-family: "Times New Roman"');
    expect(html).toContain("font-size: 10.5pt");
    expect(html).toContain("color: black");
    expect(html).not.toMatch(/<(img|svg|canvas|table)\b/i);
    expect(html).toContain("<li>");
  });

  it("uses the candidate-specific filename template", () => {
    expect(resumeFileName(testProfile, "Northside Homewares")).toBe(
      "JORDAN CV (Northside Homewares).pdf",
    );
  });

  it("defines ten visibly differentiated, ATS-safe template designs", () => {
    const designs = Object.values(resumeTemplateDesigns);
    expect(designs).toHaveLength(10);
    expect(new Set(designs.map(({ id }) => id))).toHaveLength(10);
    expect(new Set(designs.map(({ profileHeading }) => profileHeading)).size).toBeGreaterThan(5);
  });

  it("rejects arbitrary text even when it cites a valid verified fact ID", () => {
    const document = generateResumeDocument(testProfile, fixtureJob("job-retail-sales-assistant"));
    document.summary = [
      {
        text: "Led a national team of 500 people and doubled revenue.",
        factReferences: [testProfile.skills[0]!.id],
      },
    ];
    const result = validateResumeTruth(document, testProfile);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("not semantically bound")]),
    );
  });

  it("writes a real DOCX only beneath an explicitly private root", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "applypilot-resume-"));
    const privateRoot = join(temporaryRoot, "private");
    const outputPath = join("generated", "safe-example.docx");
    try {
      await renderResumeDocx(
        generateResumeDocument(testProfile, fixtureJob("job-retail-sales-assistant")),
        outputPath,
        privateRoot,
      );
      const bytes = await readFile(join(privateRoot, outputPath));
      expect(bytes.subarray(0, 2).toString("ascii")).toBe("PK");
      await expect(
        renderResumeDocx(
          generateResumeDocument(testProfile, fixtureJob("job-retail-sales-assistant")),
          "../outside.docx",
          privateRoot,
        ),
      ).rejects.toThrow("UNSAFE_DOCUMENT_OUTPUT_NAME");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
