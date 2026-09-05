import { expect, test } from "@playwright/test";

import { generateResumeDocument, renderResumeHtml } from "@applypilot/resume-engine";
import { fixtureJob, testProfile } from "../fixture-data";

test("resume renders as one selectable A4 page with black text and safe font sizes", async ({
  page,
}) => {
  const html = renderResumeHtml(
    generateResumeDocument(testProfile, fixtureJob("job-retail-sales-assistant")),
  );
  await page.setContent(html);

  const text = await page.locator("body").innerText();
  expect(text).toContain("Jordan Example");
  expect(text).toContain("PROFESSIONAL PROFILE");
  expect(text.toLowerCase()).not.toContain("retail experience");

  const visualRules = await page.locator("body, body *").evaluateAll((elements) =>
    elements
      .filter((element) => element instanceof HTMLElement && element.innerText.trim().length > 0)
      .map((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, fontSize: Number.parseFloat(style.fontSize) };
      }),
  );
  expect(visualRules.every(({ color }) => color === "rgb(0, 0, 0)")).toBe(true);
  expect(visualRules.every(({ fontSize }) => fontSize >= 13.3)).toBe(true);

  const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, tagged: true });
  const rawPdf = pdf.toString("latin1");
  expect(rawPdf.startsWith("%PDF-")).toBe(true);
  expect(rawPdf.match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
  expect(rawPdf).toContain("/MediaBox [0 0 594.95996 841.91998]");
});
