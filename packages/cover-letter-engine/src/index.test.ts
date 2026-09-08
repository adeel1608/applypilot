import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import JSZip from "jszip";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import { fixtureJob, testProfile } from "../../../tests/fixture-data";
import {
  coverLetterEssentialContent,
  coverLetterFileName,
  coverLetterRequirementStatus,
  generateBasicCoverLetter,
  renderCoverLetterDocx,
  renderCoverLetterPdf,
  validateCoverLetterTruth,
} from "./index";

describe("cover-letter foundation", () => {
  it("uses the actual employer, role and verified claim references", () => {
    const job = fixtureJob("job-junior-receptionist");
    const letter = generateBasicCoverLetter(testProfile, job);
    expect(letter.employer).toBe(job.company);
    expect(letter.roleTitle).toBe(job.title);
    expect(letter.paragraphs.join(" ")).toContain(job.company);
    expect(
      letter.claims.every(({ profileFactReferences }) => profileFactReferences.length > 0),
    ).toBe(true);
    expect(letter.requiresHumanReview).toBe(true);
    expect(validateCoverLetterTruth(letter, testProfile)).toEqual({ valid: true, errors: [] });
  });

  it("uses the safe naming convention", () => {
    expect(coverLetterFileName(testProfile, "Merri Allied Health")).toBe(
      "JORDAN COVER LETTER (Merri Allied Health).pdf",
    );
  });

  it("preserves UNKNOWN requirements and changes tone without changing evidence", () => {
    const job = fixtureJob("job-retail-sales-assistant");
    expect(coverLetterRequirementStatus(job)).toBe("UNKNOWN");
    const warmProfile = {
      ...testProfile,
      candidatePreferences: {
        ...testProfile.candidatePreferences,
        coverLetterTone: "WARM" as const,
      },
    };
    const letter = generateBasicCoverLetter(warmProfile, job);
    expect(letter.tone).toBe("WARM");
    expect(letter.paragraphs[0]).toContain("pleased to apply");
    expect(
      letter.claims.every(({ profileFactReferences }) => profileFactReferences.length > 0),
    ).toBe(true);
  });

  it("rejects arbitrary prose attached to a verified skill ID", () => {
    const letter = generateBasicCoverLetter(testProfile, fixtureJob("job-retail-sales-assistant"));
    letter.claims[0] = {
      text: "I managed a global sales division.",
      profileFactReferences: [testProfile.skills[0]!.id],
    };
    expect(validateCoverLetterTruth(letter, testProfile).valid).toBe(false);
  });

  it("creates one-page PDF and structured DOCX artifacts with essential-text parity", async () => {
    const root = await mkdtemp(join(tmpdir(), "applypilot-letter-"));
    const privateRoot = join(root, "private");
    const letter = generateBasicCoverLetter(testProfile, fixtureJob("job-junior-receptionist"));
    try {
      await renderCoverLetterPdf(letter, "letters/fixture.pdf", privateRoot);
      await renderCoverLetterDocx(letter, "letters/fixture.docx", privateRoot);
      const pdfBytes = await readFile(join(privateRoot, "letters", "fixture.pdf"));
      const pdf = await getDocument({ data: new Uint8Array(pdfBytes) }).promise;
      const pdfContent = await (await pdf.getPage(1)).getTextContent();
      const pdfText = pdfContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      expect(pdf.numPages).toBe(1);
      const archive = await JSZip.loadAsync(
        await readFile(join(privateRoot, "letters", "fixture.docx")),
      );
      const documentXml = await archive.file("word/document.xml")!.async("string");
      const docxText = documentXml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      for (const content of coverLetterEssentialContent(letter)) {
        expect(pdfText).toContain(content);
        expect(docxText).toContain(content);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});
