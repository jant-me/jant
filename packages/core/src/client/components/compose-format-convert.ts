/**
 * Compose format conversion
 *
 * When a post's format changes while editing (note / link / quote), each format
 * stores a different subset of structured fields. This module converts those
 * fields so nothing is silently lost:
 *
 * - **Fold** (when *leaving* a format): any field the target format can't hold is
 *   pushed into the body as a visible block (a blockquote, a heading, or a link
 *   paragraph) and the field is cleared. This never loses data.
 * - **Extract** (when *entering* a format): only `blockquote → quoteText` is
 *   recovered from the body front, which keeps the common `quote → note → quote`
 *   round-trip lossless. url/title are not auto-extracted — they stay visible in
 *   the body and the author re-fills the field if needed.
 *
 * Pure and DOM-free so it can be unit-tested in isolation. It deep-clones the
 * body it is given and never mutates its input.
 */

import type { JSONContent } from "@tiptap/core";

import type { ComposeFormat } from "./compose-types.js";

/** The subset of compose fields that participate in format conversion. */
export interface ComposeConvertFields {
  title: string;
  url: string;
  quoteText: string;
  quoteAuthor: string;
  showTitle: boolean;
  bodyJson: JSONContent | null;
}

/** Matches an attribution paragraph: `— Author` or `— Author https://source`. */
const ATTRIBUTION_RE = /^—\s*(.*?)(?:\s+(https?:\/\/\S+))?\s*$/;

function cloneDoc(doc: JSONContent | null): JSONContent | null {
  return doc ? (JSON.parse(JSON.stringify(doc)) as JSONContent) : null;
}

/** Concatenate all descendant text of a node. */
function nodeText(node: JSONContent | undefined): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map(nodeText).join("");
}

function makeHeading(text: string, level = 2): JSONContent {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

function makeParagraph(text: string): JSONContent {
  return text
    ? { type: "paragraph", content: [{ type: "text", text }] }
    : { type: "paragraph" };
}

function makeLinkParagraph(url: string): JSONContent {
  return {
    type: "paragraph",
    content: [
      {
        type: "text",
        text: url,
        marks: [{ type: "link", attrs: { href: url } }],
      },
    ],
  };
}

function parseAttribution(text: string): {
  author: string;
  url: string | null;
} {
  const match = ATTRIBUTION_RE.exec(text.trim());
  if (!match) return { author: "", url: null };
  return { author: match[1].trim(), url: match[2] ?? null };
}

/** First link href found anywhere within a node (depth-first), or null. */
function findLinkHref(node: JSONContent | undefined): string | null {
  if (!node) return null;
  if (Array.isArray(node.marks)) {
    const href = node.marks.find((mark) => mark.type === "link")?.attrs?.href;
    if (typeof href === "string" && href) return href;
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const found = findLinkHref(child);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Build the `— Author` attribution paragraph for a folded quote. The author name
 * is linked to the source url so the body stays clean (no raw url) while the
 * `note → quote` round-trip can still recover the url from the link mark. When
 * there is no author, the url itself becomes the link text. Null if neither.
 */
function makeAttributionParagraph(
  author: string,
  url: string | null,
): JSONContent | null {
  const name = author.trim();
  const href = url?.trim() ?? "";
  if (!name && !href) return null;

  const linked = (text: string): JSONContent => ({
    type: "text",
    text,
    marks: [{ type: "link", attrs: { href } }],
  });
  if (name && href) {
    return {
      type: "paragraph",
      content: [{ type: "text", text: "— " }, linked(name)],
    };
  }
  if (name) {
    return {
      type: "paragraph",
      content: [{ type: "text", text: `— ${name}` }],
    };
  }
  return {
    type: "paragraph",
    content: [{ type: "text", text: "— " }, linked(href)],
  };
}

function makeBlockquote(
  quoteText: string,
  attribution: JSONContent | null,
): JSONContent {
  const paragraphs = quoteText.split("\n").map((line) => makeParagraph(line));
  if (attribution) paragraphs.push(attribution);
  return { type: "blockquote", content: paragraphs };
}

/**
 * Convert compose fields from one post format to another.
 *
 * @param from - the current format
 * @param to - the target format
 * @param fields - the current field values (not mutated)
 * @returns new field values appropriate for the target format
 * @example
 * // quote → note: the quote becomes a leading blockquote in the body
 * convertComposeFormat("quote", "note", {
 *   title: "", url: "", quoteText: "Stay hungry", quoteAuthor: "Jobs",
 *   showTitle: false, bodyJson: null,
 * });
 */
export function convertComposeFormat(
  from: ComposeFormat,
  to: ComposeFormat,
  fields: ComposeConvertFields,
): ComposeConvertFields {
  if (from === to) return fields;

  const out: ComposeConvertFields = { ...fields };
  const body = cloneDoc(fields.bodyJson);
  const content: JSONContent[] = Array.isArray(body?.content)
    ? [...body.content]
    : [];

  // ── Extract: leading bare-link paragraph → url (reverses the link→note
  //    fold so link↔note round-trips). Only a "bare" link (text === href) is
  //    pulled out, so a labeled link line keeps its label instead of silently
  //    losing it. ─────────────────────────────────────────────────────────
  if (to === "link" && out.url === "") {
    const first = content[0];
    const href = findLinkHref(first);
    if (
      href &&
      first?.type === "paragraph" &&
      Array.isArray(first.content) &&
      first.content.length === 1 &&
      nodeText(first) === href
    ) {
      out.url = href;
      content.shift();
    }
  }

  // ── Extract (focused: blockquote → quoteText only) ──────────────────
  if (
    to === "quote" &&
    out.quoteText === "" &&
    content[0]?.type === "blockquote"
  ) {
    const paragraphs = Array.isArray(content[0].content)
      ? [...content[0].content]
      : [];
    const last = paragraphs[paragraphs.length - 1];
    const lastText = nodeText(last);
    if (paragraphs.length > 0 && /^—/.test(lastText.trim())) {
      const parsed = parseAttribution(lastText);
      // Prefer the link mark's href (the linked-author form) over a url parsed
      // from plain text (legacy `— Author https://…`).
      const url = findLinkHref(last) ?? parsed.url;
      // When the attribution is url-only, the link text is the url itself —
      // don't mistake it for an author.
      const author = parsed.author === url ? "" : parsed.author;
      if (author) out.quoteAuthor = out.quoteAuthor || author;
      if (url && out.url === "") out.url = url;
      paragraphs.pop();
    }
    out.quoteText = paragraphs.map(nodeText).join("\n").trim();
    content.shift();
  }

  // ── Harvest (fold fields the target can't hold into the body) ───────
  const prepend: JSONContent[] = [];

  // Title → heading (only quote can't hold a title)
  if (to === "quote" && out.title.trim() !== "") {
    prepend.push(makeHeading(out.title.trim()));
    out.title = "";
  }

  // quoteText → blockquote (note and link can't hold a quote)
  if (to !== "quote" && out.quoteText.trim() !== "") {
    // For a note, the source url has no home either, so fold it into the
    // attribution. For a link, url maps to link.url and is preserved.
    const foldUrl = to === "note" ? out.url : null;
    prepend.push(
      makeBlockquote(
        out.quoteText,
        makeAttributionParagraph(out.quoteAuthor, foldUrl),
      ),
    );
    out.quoteText = "";
    out.quoteAuthor = "";
    if (to === "note") out.url = "";
  } else if (to === "note" && out.url.trim() !== "") {
    // Source was a link (no quote text): notes can't hold a url, so fold it.
    prepend.push(makeLinkParagraph(out.url.trim()));
    out.url = "";
  }

  if (prepend.length) content.unshift(...prepend);

  out.bodyJson = content.length ? { type: "doc", content } : null;
  // A title carried in from another format has nowhere to show unless the note's
  // title field is open, so opening it is the only way not to drop it. The
  // toggle is otherwise left alone, so note → link → note keeps the user's
  // choice instead of resetting it.
  if (to === "note" && out.title.trim().length > 0) out.showTitle = true;

  return out;
}
