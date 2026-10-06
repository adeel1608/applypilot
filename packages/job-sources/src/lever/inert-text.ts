import { parseFragment } from "parse5";

type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  value?: string;
  childNodes?: HtmlNode[];
};

const discardedElements = new Set([
  "script",
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

const lineBreakElements = new Set([
  "article",
  "br",
  "dd",
  "div",
  "dl",
  "dt",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "p",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

function normalizeText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Converts source-supplied HTML/plain text to non-rendered text only. */
export function extractInertLeverText(value: string): string {
  const root = parseFragment(value) as HtmlNode;
  const parts: string[] = [];
  const walk = (node: HtmlNode, depth: number): void => {
    if (depth > 64) return;
    const tag = node.tagName?.toLowerCase();
    if (tag && discardedElements.has(tag)) return;
    if (node.nodeName === "#text" && node.value) parts.push(node.value);
    if (tag === "br") parts.push("\n");
    for (const child of node.childNodes ?? []) walk(child, depth + 1);
    if (tag && tag !== "br" && lineBreakElements.has(tag)) parts.push("\n");
  };
  walk(root, 0);
  return normalizeText(parts.join(""));
}

export interface InertLeverSection {
  heading: string;
  content: string;
}

/** Retains structural headings as data; no source HTML is returned or executed. */
export function extractInertLeverSections(value: string): InertLeverSection[] {
  if (value.length > 128 * 1_024) return [];
  const root = parseFragment(value) as HtmlNode;
  const sections: InertLeverSection[] = [];
  const textCache = new WeakMap<HtmlNode, string>();
  let heading = "";
  let parts: string[] = [];
  let visited = 0;
  let limitReached = false;
  const checkBounds = (node: HtmlNode, depth: number): void => {
    if (limitReached || (node.tagName && discardedElements.has(node.tagName))) return;
    visited += 1;
    if (depth > 64 || visited > 50_000) {
      limitReached = true;
      return;
    }
    for (const child of node.childNodes ?? []) checkBounds(child, depth + 1);
  };
  checkBounds(root, 0);
  if (limitReached) return [];
  const text = (node: HtmlNode, depth: number): string => {
    if (depth > 64 || (node.tagName && discardedElements.has(node.tagName))) return "";
    const cached = textCache.get(node);
    if (cached !== undefined) return cached;
    const value =
      node.nodeName === "#text"
        ? (node.value ?? "")
        : node.tagName === "br"
          ? "\n"
          : (node.childNodes ?? []).map((child) => text(child, depth + 1)).join("");
    textCache.set(node, value);
    return value;
  };
  const flush = (): void => {
    const content = normalizeText(parts.join(""));
    if (heading || content) sections.push({ heading, content });
    parts = [];
    if (sections.length > 128) limitReached = true;
  };
  const walk = (node: HtmlNode, ancestors: readonly HtmlNode[], depth: number): void => {
    if (depth > 64 || limitReached) return;
    const tag = node.tagName?.toLowerCase();
    if (tag && discardedElements.has(tag)) return;
    const isHeading = /^h[1-6]$/.test(tag ?? "");
    const isEmphasis = tag === "b" || tag === "strong";
    const label =
      isHeading || isEmphasis ? normalizeText(text(node, depth)).replace(/\s+/g, " ").trim() : "";
    let parentIndex = ancestors.length - 1;
    while (
      parentIndex >= 0 &&
      !["p", "div", "section", "article"].includes(ancestors[parentIndex]?.tagName ?? "")
    )
      parentIndex -= 1;
    const parent = ancestors[parentIndex];
    const standaloneEmphasis =
      isEmphasis &&
      parent &&
      !ancestors.some((ancestor) =>
        ["li", "table", "blockquote"].includes(ancestor.tagName ?? ""),
      ) &&
      normalizeText(text(parent, parentIndex)).replace(/\s+/g, " ").trim() === label;
    const headingLabel =
      /^(?:requirements?|qualifications?|skills?|experience|responsibilities|duties|benefits?|perks?|desirable|preferred|essential)\s*:?$/i.test(
        label,
      ) ||
      (/^[\p{L}\s&'’?:-]+$/u.test(label) &&
        label.split(/\s+/).length >= 2 &&
        label.split(/\s+/).length <= 12);
    if (label && (isHeading || (standaloneEmphasis && label.length <= 100 && headingLabel))) {
      flush();
      heading = label.length <= 100 ? label : "";
      if (!heading) parts.push(label, "\n");
      return;
    }
    if (node.nodeName === "#text" && node.value) parts.push(node.value);
    if (tag === "br") parts.push("\n");
    for (const child of node.childNodes ?? []) walk(child, [...ancestors, node], depth + 1);
    if (tag && tag !== "br" && lineBreakElements.has(tag)) parts.push("\n");
  };
  walk(root, [], 0);
  flush();
  return limitReached ? [] : sections;
}
