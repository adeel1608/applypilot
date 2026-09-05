import { describe, expect, it } from "vitest";

import { fixtureJob, testProfile } from "../../../tests/fixture-data";
import {
  generateResumeDocument,
  renderResumeHtml,
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
});
