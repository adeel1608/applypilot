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
