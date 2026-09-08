import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import JSZip from "jszip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import { fixtureJob, testProfile } from "../../../tests/fixture-data";
import {
  assertPrivatePdfOutputPath,
  generateResumeDocument,
  renderResumeDocx,
  renderResumeHtml,
  renderResumePdf,
  resumeFileName,
  resumeEssentialContent,
  resumeTemplateDesigns,
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

  it("accepts only an explicit supported template override", () => {
    const job = fixtureJob("job-retail-sales-assistant");
    expect(generateResumeDocument(testProfile, job, "technical-casual").template).toBe(
      "technical-casual",
    );
    expect(() =>
      generateResumeDocument(testProfile, job, "unreviewed-template" as "technical-casual"),
    ).toThrow("INVALID_RESUME_TEMPLATE");
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

  it("preserves every essential content item in both HTML and DOCX artifacts", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "applypilot-resume-parity-"));
    const privateRoot = join(temporaryRoot, "private");
    const outputPath = join("generated", "parity.docx");
    const document = generateResumeDocument(testProfile, fixtureJob("job-robotics-internship"));
    try {
      await renderResumeDocx(document, outputPath, privateRoot);
      const archive = await JSZip.loadAsync(await readFile(join(privateRoot, outputPath)));
      const documentXml = await archive.file("word/document.xml")!.async("string");
      const html = renderResumeHtml(document);
      const normalize = (value: string) =>
        value
          .replace(/<[^>]+>/g, " ")
          .replaceAll("&amp;", "&")
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">")
          .replace(/\s+/g, " ")
          .trim();
      const htmlText = normalize(html);
      const docxText = normalize(documentXml);
      for (const item of resumeEssentialContent(document)) {
        expect(htmlText).toContain(item);
        expect(docxText).toContain(item);
      }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("confines PDF output and creates a new A4 PDF without overwrite", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "applypilot-resume-pdf-"));
    const privateRoot = join(temporaryRoot, "private");
    const outputPath = join("generated", "safe-example.pdf");
    const document = generateResumeDocument(testProfile, fixtureJob("job-retail-sales-assistant"));
    try {
      await renderResumePdf(document, outputPath, privateRoot);
      const bytes = await readFile(join(privateRoot, outputPath));
      expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(bytes.toString("latin1").match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
      const pdf = await getDocument({ data: new Uint8Array(bytes) }).promise;
      const text = (
        await Promise.all(
          Array.from({ length: pdf.numPages }, async (_, index) => {
            const page = await pdf.getPage(index + 1);
            const content = await page.getTextContent();
            return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
          }),
        )
      ).join(" ");
      for (const item of resumeEssentialContent(document)) {
        expect(text.toLocaleLowerCase("en-AU")).toContain(item.toLocaleLowerCase("en-AU"));
      }
      await expect(renderResumePdf(document, outputPath, privateRoot)).rejects.toMatchObject({
        code: "EEXIST",
      });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 20_000);

  it("drops whole lower-priority evidence deterministically before page overflow", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "applypilot-resume-fit-"));
    const privateRoot = join(temporaryRoot, "private");
    const document = generateResumeDocument(testProfile, fixtureJob("job-retail-sales-assistant"));
    const originalClaim = document.employment[0]!.claims[0]!;
    document.employment[0]!.claims = Array.from({ length: 80 }, () => ({ ...originalClaim }));
    try {
      const fitted = await renderResumePdf(document, "generated/fitted.pdf", privateRoot);
      expect(fitted.employment[0]!.claims.length).toBeLessThan(80);
      const bytes = await readFile(join(privateRoot, "generated", "fitted.pdf"));
      expect(bytes.toString("latin1").match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
      expect(fitted.skills.length).toBeGreaterThan(0);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 20_000);

  it.each([
    "../outside.pdf",
    "C:\\outside.pdf",
    "\\\\server\\share\\outside.pdf",
    "generated/file.pdf:stream",
    "generated/CON.pdf",
    "generated/trailing.pdf ",
    "generated/wrong.docx",
  ])("rejects unsafe PDF output %s", (outputPath) => {
    expect(() => assertPrivatePdfOutputPath(outputPath, "C:\\fixture\\private")).toThrow();
  });

  it("rejects a PDF output directory junction that escapes the private root", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "applypilot-resume-junction-"));
    const privateRoot = join(temporaryRoot, "private");
    const outside = join(temporaryRoot, "outside");
    await mkdir(privateRoot);
    await mkdir(outside);
    await symlink(outside, join(privateRoot, "escaped"), "junction");
    try {
      await expect(
        renderResumePdf(
          generateResumeDocument(testProfile, fixtureJob("job-retail-sales-assistant")),
          join("escaped", "resume.pdf"),
          privateRoot,
        ),
      ).rejects.toThrow("DOCUMENT_OUTPUT_SYMLINK_ESCAPE");
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
