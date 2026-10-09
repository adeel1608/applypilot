import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { HostedVerifiedArtifact } from "./hosted-contract";

/** Approved PDF bytes are read once and then carried as an immutable admission result. */
export async function admitHostedPdf(input: {
  documentId: string;
  path: string;
  approvedRoot: string;
  expectedDigest: string;
  fileName: string;
}): Promise<HostedVerifiedArtifact> {
  try {
    const root = await realpath(input.approvedRoot);
    if (root !== resolve(input.approvedRoot) || (await lstat(input.approvedRoot)).isSymbolicLink())
      throw new Error();
    const path = resolve(input.path);
    const confined = relative(root, path);
    if (
      !confined ||
      confined === ".." ||
      confined.startsWith(`..${sep}`) ||
      isAbsolute(confined) ||
      basename(input.fileName) !== input.fileName ||
      !input.fileName.toLowerCase().endsWith(".pdf")
    )
      throw new Error();
    let ancestor = path;
    while (true) {
      if ((await lstat(ancestor)).isSymbolicLink()) throw new Error();
      if (ancestor === root) break;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new Error();
      ancestor = parent;
    }
    if ((await realpath(path)) !== path || (await realpath(input.approvedRoot)) !== root)
      throw new Error();
    const before = await lstat(path);
    if (!before.isFile() || before.size < 5 || before.size > 5_000_000) throw new Error();
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      const opened = await file.stat();
      if (!opened.isFile() || opened.ino !== before.ino || opened.size !== before.size)
        throw new Error();
      const buffer = Buffer.alloc(before.size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const result = await file.read(buffer, offset, buffer.length - offset, offset);
        if (!result.bytesRead) break;
        offset += result.bytesRead;
      }
      if (offset !== before.size) throw new Error();
      bytes = buffer.subarray(0, offset);
    } finally {
      await file.close();
    }
    const after = await lstat(path);
    if (
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.length !== before.size ||
      !bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) ||
      createHash("sha256").update(bytes).digest("hex") !== input.expectedDigest
    )
      throw new Error();
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      useSystemFonts: false,
      disableAutoFetch: true,
      verbosity: 0,
    });
    try {
      const pdf = await loading.promise;
      if (pdf.numPages < 1 || pdf.numPages > 6) throw new Error();
      let textLength = 0;
      for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex++) {
        const page = await pdf.getPage(pageIndex);
        const content = await page.getTextContent();
        textLength += content.items.reduce(
          (sum, item) => sum + ("str" in item ? item.str.length : 0),
          0,
        );
      }
      if (!textLength || textLength > 200_000) throw new Error();
    } finally {
      await loading.destroy();
    }
    return {
      documentId: input.documentId,
      digest: input.expectedDigest,
      fileName: input.fileName,
      mimeType: "application/pdf",
      bytes: new Uint8Array(bytes),
    };
  } catch {
    throw new Error("HOSTED_APPROVED_ARTIFACT_ADMISSION_FAILED");
  }
}
