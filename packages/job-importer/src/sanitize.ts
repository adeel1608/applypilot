import { parse } from "parse5";

import { sha256 } from "./identity";
import { IMPORT_LIMITS } from "./limits";
import type { ImportWarning, SanitizedImportContent } from "./types";

export class ImportValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ImportValidationError";
  }
}

type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  value?: string;
  childNodes?: HtmlNode[];
  attrs?: Array<{ name: string; value: string }>;
};

const discardedElements = new Set([
  "style",
  "noscript",
  "template",
  "iframe",
  "frame",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "link",
  "meta",
  "base",
  "img",
  "picture",
  "audio",
  "video",
  "source",
  "track",
  "svg",
  "math",
  "canvas",
]);

const credentialKeys = new Set([
  "access_token",
  "refresh_token",
  "session_token",
  "auth_token",
  "client_secret",
  "password",
  "cookie",
  "cookies",
]);

function looksLikeToken(value: string): boolean {
  return value.length >= 16 && /^[A-Za-z0-9._~+/=-]+$/.test(value) && !value.includes(" ");
}

function hasCredentialJson(value: unknown, depth = 0, inStorage = false): boolean {
  if (depth > 32 || !value || typeof value !== "object") return false;
  if (Array.isArray(value))
    return value.some((item) => hasCredentialJson(item, depth + 1, inStorage));
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    const storage =
      inStorage || ["localstorage", "sessionstorage", "session", "auth"].includes(normalized);
    if (
      typeof item === "string" &&
      (credentialKeys.has(normalized) ||
        (storage && /(?:token|cookie|secret)/i.test(normalized))) &&
      looksLikeToken(item)
    ) {
      return true;
    }
    if (hasCredentialJson(item, depth + 1, storage)) return true;
  }
  return false;
}

export function detectStructuredCredential(content: string): string | null {
  if (/^\s*Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{16,}\s*$/im.test(content)) {
    return "AUTHORIZATION_BEARER_HEADER";
  }
  if (/^\s*(?:Cookie|Set-Cookie)\s*:\s*[^=;\s]+=[^;\r\n]{8,}/im.test(content)) {
    return "COOKIE_HEADER";
  }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
    return "PEM_PRIVATE_KEY";
  }
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      if (hasCredentialJson(JSON.parse(trimmed))) return "CREDENTIAL_JSON";
    } catch {
      // Malformed JSON is handled by the selected content parser, not credential detection.
    }
  }
  return null;
}

function assertDepth(value: unknown, limit: number, depth = 0): void {
  if (depth > limit) {
    throw new ImportValidationError(
      "STRUCTURE_TOO_DEEP",
      "The supplied content is too deeply nested.",
    );
  }
  if (!value || typeof value !== "object") return;
  for (const item of Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>)) {
    assertDepth(item, limit, depth + 1);
  }
}

function copySafeJson(value: unknown, depth = 0): unknown {
  if (depth > IMPORT_LIMITS.maximumJsonDepth) {
    throw new ImportValidationError("JSON_TOO_DEEP", "The supplied JSON is too deeply nested.");
  }
  if (Array.isArray(value)) return value.map((item) => copySafeJson(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) {
      throw new ImportValidationError(
        "UNSAFE_JSON_KEY",
        "The supplied JSON contains an unsafe object key.",
      );
    }
    output[key] = copySafeJson(item, depth + 1);
  }
  return output;
}

function collectStructuredRecords(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStructuredRecords(item));
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record["@graph"])) return collectStructuredRecords(record["@graph"]);
  return [record];
}

function attribute(node: HtmlNode, name: string): string | null {
  return node.attrs?.find((item) => item.name.toLowerCase() === name)?.value ?? null;
}

function textContent(node: HtmlNode): string {
  if (node.nodeName === "#text") return node.value ?? "";
  return (node.childNodes ?? []).map(textContent).join("");
}

function visibleTextContent(node: HtmlNode): string {
  const tag = node.tagName?.toLowerCase();
  if (tag === "script" || (tag && discardedElements.has(tag))) return "";
  if (node.nodeName === "#text") return node.value ?? "";
  return (node.childNodes ?? []).map(visibleTextContent).join(" ");
}

function findDescendant(
  node: HtmlNode,
  predicate: (candidate: HtmlNode) => boolean,
): HtmlNode | null {
  for (const child of node.childNodes ?? []) {
    if (predicate(child)) return child;
    const nested = findDescendant(child, predicate);
    if (nested) return nested;
  }
  return null;
}

function htmlCardRecord(node: HtmlNode): Record<string, unknown> | null {
  const tag = node.tagName?.toLowerCase();
  const marker = `${attribute(node, "class") ?? ""} ${attribute(node, "id") ?? ""}`;
  const itemType = attribute(node, "itemtype") ?? "";
  const marked =
    /(?:^|[\s_-])job[\s_-]?(?:card|result|listing|item)(?:$|[\s_-])/i.test(marker) ||
    /JobPosting$/i.test(itemType) ||
    Boolean(attribute(node, "data-job-id"));
  if (!tag || !["article", "div", "section", "li"].includes(tag) || !marked) return null;
  const heading = findDescendant(node, (child) =>
    ["h1", "h2", "h3"].includes(child.tagName?.toLowerCase() ?? ""),
  );
  const companyNode = findDescendant(node, (child) =>
    /(?:company|employer|organisation|organization)/i.test(
      `${attribute(child, "class") ?? ""} ${attribute(child, "itemprop") ?? ""}`,
    ),
  );
  const locationNode = findDescendant(node, (child) =>
    /location/i.test(`${attribute(child, "class") ?? ""} ${attribute(child, "itemprop") ?? ""}`),
  );
  const linkNode = findDescendant(
    node,
    (child) =>
      child.tagName?.toLowerCase() === "a" &&
      Boolean(attribute(child, "href")?.startsWith("https://")),
  );
  const title = heading ? normalizeText(visibleTextContent(heading)) : "";
  const company = companyNode ? normalizeText(visibleTextContent(companyNode)) : "";
  const location = locationNode ? normalizeText(visibleTextContent(locationNode)) : "";
  const url = linkNode ? attribute(linkNode, "href") : null;
  if (!title || (!company && !url)) return null;
  return {
    "@type": "HTMLJobCard",
    title,
    company: company || undefined,
    location: location || undefined,
    description: normalizeText(visibleTextContent(node)),
    url,
    externalId: attribute(node, "data-job-id"),
  };
}

function extractHtml(root: HtmlNode): {
  text: string;
  structuredRecords: Array<Record<string, unknown>>;
  links: string[];
} {
  const textParts: string[] = [];
  const structuredRecords: Array<Record<string, unknown>> = [];
  const links: string[] = [];
  const walk = (node: HtmlNode, depth: number): void => {
    if (depth > IMPORT_LIMITS.maximumHtmlDepth) {
      throw new ImportValidationError("HTML_TOO_DEEP", "The supplied HTML is too deeply nested.");
    }
    const tag = node.tagName?.toLowerCase();
    if (tag === "script") {
      if ((attribute(node, "type") ?? "").toLowerCase() === "application/ld+json") {
        try {
          const parsed = copySafeJson(JSON.parse(textContent(node)));
          structuredRecords.push(...collectStructuredRecords(parsed));
        } catch (error) {
          if (error instanceof ImportValidationError) throw error;
        }
      }
      return;
    }
    if (tag && discardedElements.has(tag)) return;
    const card = htmlCardRecord(node);
    if (card) structuredRecords.push(card);
    if (tag === "a") {
      const href = attribute(node, "href");
      if (href?.startsWith("https://")) links.push(href);
    }
    if (node.nodeName === "#text" && node.value) textParts.push(node.value);
    for (const child of node.childNodes ?? []) walk(child, depth + 1);
    if (tag && ["p", "div", "li", "article", "section", "h1", "h2", "h3", "br"].includes(tag)) {
      textParts.push("\n");
    }
  };
  walk(root, 0);
  const uniqueRecords = [
    ...new Map(structuredRecords.map((record) => [JSON.stringify(record), record])).values(),
  ];
  return { text: textParts.join(""), structuredRecords: uniqueRecords, links };
}

export function extractInertHtmlText(value: string): string {
  return normalizeText(extractHtml(parse(value) as HtmlNode).text);
}

function decodeUtf8(content: string | Uint8Array): { bytes: Uint8Array; text: string } {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  if (bytes.byteLength === 0)
    throw new ImportValidationError("EMPTY_INPUT", "Supply job content to import.");
  if (bytes.byteLength > IMPORT_LIMITS.maximumBytes) {
    throw new ImportValidationError("INPUT_TOO_LARGE", "Job content must be 1 MiB or smaller.");
  }
  const prefix = Buffer.from(bytes.slice(0, 16));
  if (
    prefix.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    prefix.subarray(0, 4).toString("ascii") === "%PDF" ||
    prefix.subarray(0, 2).toString("ascii") === "MZ" ||
    prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    prefix.toString("ascii").startsWith("SQLite format 3")
  ) {
    throw new ImportValidationError(
      "BINARY_CONTENT",
      "Binary or packaged content is not supported.",
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ImportValidationError("INVALID_UTF8", "Job content must use valid UTF-8 text.");
  }
  if (text.includes("\0") || /[\u0001-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
    throw new ImportValidationError(
      "BINARY_CONTENT",
      "Binary or control-character content is not supported.",
    );
  }
  if (text.split(/\r?\n/).length > IMPORT_LIMITS.maximumLines) {
    throw new ImportValidationError("TOO_MANY_LINES", "Job content contains too many lines.");
  }
  const credentialCode = detectStructuredCredential(text);
  if (credentialCode) {
    throw new ImportValidationError(
      credentialCode,
      "Credential or session material cannot be imported.",
    );
  }
  return { bytes, text };
}

function normalizeText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function assertUpload(filename: string | null, mime: string | null): void {
  if (!filename || filename.length > IMPORT_LIMITS.maximumFilenameLength) {
    throw new ImportValidationError("INVALID_FILENAME", "Choose a file with a valid filename.");
  }
  if (/[\\/\0\r\n]/.test(filename)) {
    throw new ImportValidationError(
      "INVALID_FILENAME",
      "File paths and control characters are not allowed.",
    );
  }
  const extension = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  const allowed: Record<string, Set<string>> = {
    ".txt": new Set(["text/plain"]),
    ".md": new Set(["text/markdown", "text/plain"]),
    ".html": new Set(["text/html"]),
    ".htm": new Set(["text/html"]),
    ".json": new Set(["application/json", "text/json"]),
  };
  if (!extension || !allowed[extension] || !mime || !allowed[extension].has(mime.toLowerCase())) {
    throw new ImportValidationError(
      "UNSUPPORTED_FILE_TYPE",
      "Use a UTF-8 .txt, .md, .html, .htm, or .json file.",
    );
  }
}

export function sanitizeImportContent(input: {
  content: string | Uint8Array;
  inputType: string;
  originalFilename?: string | null;
  declaredMimeType?: string | null;
}): SanitizedImportContent & { rawText: string; contentHash: string; contentLength: number } {
  if (input.inputType === "FILE_UPLOAD") {
    assertUpload(input.originalFilename ?? null, input.declaredMimeType ?? null);
  }
  const { bytes, text: rawText } = decodeUtf8(input.content);
  const trimmed = rawText.trimStart();
  const mime = input.declaredMimeType?.toLowerCase();
  const looksHtml = /^<!doctype\s+html|^<html|^<(?:article|section|div|main|h1)\b/i.test(trimmed);
  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  let parsedJson: unknown;
  let validJson = false;
  if (looksJson) {
    try {
      parsedJson = JSON.parse(rawText);
      validJson = true;
    } catch {
      if (mime === "application/json" || mime === "text/json") {
        throw new ImportValidationError("INVALID_JSON", "The supplied JSON could not be parsed.");
      }
    }
  }
  if (input.inputType === "FILE_UPLOAD") {
    const extension = input.originalFilename?.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
    if (
      (looksHtml && ![".html", ".htm"].includes(extension ?? "")) ||
      (validJson && extension !== ".json")
    ) {
      throw new ImportValidationError(
        "FILE_CONTENT_MISMATCH",
        "The file extension, MIME type, and detected content do not agree.",
      );
    }
  }
  const warnings: ImportWarning[] = [];
  if (
    mime === "application/json" ||
    mime === "text/json" ||
    (input.inputType !== "PASTED_HTML" && validJson)
  ) {
    assertDepth(parsedJson, IMPORT_LIMITS.maximumJsonDepth);
    const safe = copySafeJson(parsedJson);
    const structuredRecords = collectStructuredRecords(safe);
    return {
      kind: "JSON",
      text: normalizeText(structuredRecords.map((record) => JSON.stringify(record)).join("\n")),
      structuredRecords,
      links: [],
      warnings,
      rawText,
      contentHash: sha256(bytes),
      contentLength: bytes.byteLength,
    };
  }
  if (mime === "text/html" || input.inputType === "PASTED_HTML" || looksHtml) {
    const extracted = extractHtml(parse(rawText) as HtmlNode);
    return {
      kind: "HTML",
      text: normalizeText(extracted.text),
      structuredRecords: extracted.structuredRecords,
      links: [...new Set(extracted.links)],
      warnings,
      rawText,
      contentHash: sha256(bytes),
      contentLength: bytes.byteLength,
    };
  }
  return {
    kind: "TEXT",
    text: normalizeText(rawText),
    structuredRecords: [],
    links: [],
    warnings,
    rawText,
    contentHash: sha256(bytes),
    contentLength: bytes.byteLength,
  };
}
