import { expect, request, test } from "@playwright/test";

test("serves fictional draft PDF preview/download and DOCX download only to a local session", async ({
  page,
}) => {
  await page.goto("/import");
  const preview = await page.request.get("/documents/document:e2e-pdf?disposition=inline");
  expect(preview.status()).toBe(200);
  expect(preview.headers()["content-type"]).toBe("application/pdf");
  expect(preview.headers()["content-disposition"]).toBe('inline; filename="Fictional Preview.pdf"');
  expect(preview.headers()["cache-control"]).toBe("no-store");
  expect(preview.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await preview.body()).subarray(0, 5).toString("ascii")).toBe("%PDF-");

  const pdfDownload = await page.request.get("/documents/document:e2e-pdf?disposition=attachment");
  expect(pdfDownload.headers()["content-disposition"]).toContain("attachment;");

  const docxDownload = await page.request.get("/documents/document:e2e-docx");
  expect(docxDownload.status()).toBe(200);
  expect(docxDownload.headers()["content-type"]).toBe(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  expect(docxDownload.headers()["content-disposition"]).toContain("attachment;");
  expect((await docxDownload.body()).subarray(0, 2).toString("ascii")).toBe("PK");

  const withoutSession = await request.newContext({ baseURL: "http://127.0.0.1:3100" });
  try {
    expect((await withoutSession.get("/documents/document:e2e-pdf")).status()).toBe(401);
    expect(
      (
        await withoutSession.get("/documents/document:e2e-pdf", {
          headers: { host: "attacker.example.test" },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await withoutSession.dispose();
  }
});
