/**
 * TipTap JSON → HTML Renderer
 *
 * Renders TipTap JSON using explicit node and mark renderers so Markdown,
 * stored editor content, and summary extraction all share the same HTML rules.
 */

import type { JSONContent } from "@tiptap/core";
import {
  getFootnoteLabelKey,
  normalizeFootnoteArtifacts,
  normalizeFootnoteLabel,
} from "./footnotes.js";
import { renderEmbedFromAttrs } from "./embed-render.js";
import { escapeHtml } from "./html.js";
import { renderPublishedImageFigure } from "./rich-image.js";
import { sanitizeRichTextHref } from "./url.js";

interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
}

interface RenderContext {
  footnotes: FootnotePlan;
  renderChildren(content?: TiptapNode[]): string;
  renderNode(node: TiptapNode): string;
  renderText(text: string, marks?: TiptapMark[]): string;
}

type MarkRenderer = (html: string, mark: TiptapMark) => string;
type NodeRenderer = (node: TiptapNode, context: RenderContext) => string;

export interface TiptapRenderOptions {
  /**
   * Stable namespace for fragment IDs when multiple rendered documents can
   * share a page. Persisted post HTML passes the immutable post TypeID.
   */
  namespace?: string;
}

export type TiptapRenderResult =
  { ok: true; html: string } | { ok: false; error: string };

interface FootnoteReferencePlan {
  definitionId: string;
  referenceId: string;
  number: number;
  occurrence: number;
  label: string;
  hasDefinition: boolean;
}

interface FootnoteGroup {
  definitionId: string;
  number: number;
  label: string;
  definition: TiptapNode | null;
  references: FootnoteReferencePlan[];
}

interface FootnotePlan {
  groups: FootnoteGroup[];
  referencesByNode: WeakMap<TiptapNode, FootnoteReferencePlan>;
}

function getStringAttr(
  attrs: Record<string, unknown> | undefined,
  name: string,
): string {
  const value = attrs?.[name];
  return typeof value === "string" ? value : "";
}

function getNumberAttr(
  attrs: Record<string, unknown> | undefined,
  name: string,
): number | null {
  const value = attrs?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function renderCodeBlockText(node: TiptapNode): string {
  switch (node.type) {
    case "text":
      return escapeHtml(node.text ?? "");
    case "hardBreak":
      return "\n";
    default:
      return (node.content ?? []).map(renderCodeBlockText).join("");
  }
}

function renderTableCell(
  tagName: "td" | "th",
  node: TiptapNode,
  context: RenderContext,
): string {
  const colspan = getNumberAttr(node.attrs, "colspan");
  const rowspan = getNumberAttr(node.attrs, "rowspan");
  const colspanAttr =
    colspan !== null && colspan !== 1 ? ` colspan="${colspan}"` : "";
  const rowspanAttr =
    rowspan !== null && rowspan !== 1 ? ` rowspan="${rowspan}"` : "";

  return `<${tagName}${colspanAttr}${rowspanAttr}>${context.renderChildren(node.content)}</${tagName}>`;
}

const FOOTNOTE_NAMESPACE_HASH_OFFSET = 0xcbf29ce484222325n;
const FOOTNOTE_NAMESPACE_HASH_PRIME = 0x100000001b3n;
const FOOTNOTE_NAMESPACE_HASH_MASK = 0xffffffffffffffffn;

function createFootnoteIdScope(namespace: string | undefined): string {
  const normalized = (namespace ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) return "";

  // Fragment IDs are public implementation details, not content IDs. Hash the
  // immutable entity namespace so HTML stays readable without embedding a full
  // 30-character TypeID. A 64-bit scope keeps collision risk negligible even
  // across a page containing thousands of independently rendered documents.
  let hash = FOOTNOTE_NAMESPACE_HASH_OFFSET;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= BigInt(normalized.charCodeAt(index));
    hash =
      (hash * FOOTNOTE_NAMESPACE_HASH_PRIME) & FOOTNOTE_NAMESPACE_HASH_MASK;
  }

  return hash.toString(36).padStart(13, "0");
}

function collectFootnoteReferences(
  node: TiptapNode,
  visit: (reference: TiptapNode) => void,
): void {
  if (node.type === "footnoteReference") {
    visit(node);
    return;
  }

  for (const child of node.content ?? []) {
    collectFootnoteReferences(child, visit);
  }
}

function createFootnotePlan(
  doc: TiptapNode,
  options: TiptapRenderOptions,
): FootnotePlan {
  const definitions = new Map<string, TiptapNode>();
  const bodyNodes = (doc.content ?? []).filter(
    (node) => node.type !== "footnoteDefinition",
  );

  for (const node of doc.content ?? []) {
    if (node.type !== "footnoteDefinition") continue;
    const key = getFootnoteLabelKey(getStringAttr(node.attrs, "label"));
    if (key && !definitions.has(key)) definitions.set(key, node);
  }

  const namespace = createFootnoteIdScope(options.namespace);
  const idScope = namespace ? `${namespace}-` : "";
  const groupsByKey = new Map<string, FootnoteGroup>();
  const groups: FootnoteGroup[] = [];
  const referencesByNode = new WeakMap<TiptapNode, FootnoteReferencePlan>();

  for (const owner of bodyNodes) {
    collectFootnoteReferences(owner, (reference) => {
      const normalizedLabel = normalizeFootnoteLabel(
        getStringAttr(reference.attrs, "label"),
      );
      const label = normalizedLabel || "footnote";
      const key = getFootnoteLabelKey(label);
      let group = groupsByKey.get(key);

      if (!group) {
        const number = groupsByKey.size + 1;
        group = {
          definitionId: `fn-${idScope}${number}`,
          number,
          label,
          definition: definitions.get(key) ?? null,
          references: [],
        };
        groupsByKey.set(key, group);
        groups.push(group);
      }

      const occurrence = group.references.length + 1;
      const referencePlan: FootnoteReferencePlan = {
        definitionId: group.definitionId,
        referenceId: `fnref-${idScope}${group.number}-${occurrence}`,
        number: group.number,
        occurrence,
        label: group.label,
        hasDefinition: group.definition !== null,
      };
      group.references.push(referencePlan);
      referencesByNode.set(reference, referencePlan);
    });
  }

  return { groups, referencesByNode };
}

function renderFootnoteReference(
  node: TiptapNode,
  context: RenderContext,
): string {
  const plan = context.footnotes.referencesByNode.get(node);
  const fallbackLabel =
    normalizeFootnoteLabel(getStringAttr(node.attrs, "label")) || "footnote";
  const label = plan?.label ?? fallbackLabel;
  const number = plan?.number ?? label;

  if (!plan?.hasDefinition) {
    return `<sup class="footnote-ref">${escapeHtml(String(number))}</sup>`;
  }

  return (
    `<sup class="footnote-ref">` +
    `<a id="${escapeHtml(plan.referenceId)}" href="#${escapeHtml(plan.definitionId)}" role="doc-noteref">` +
    `${plan.number}</a></sup>`
  );
}

function renderFootnoteGroup(
  group: FootnoteGroup,
  context: RenderContext,
  includeValue: boolean,
): string {
  if (!group.definition) return "";

  const definitionContent = group.definition.content ?? [];
  const backlinks = group.references
    .map((reference) => {
      const occurrence =
        group.references.length > 1 ? String(reference.occurrence) : "";
      return (
        `<a href="#${escapeHtml(reference.referenceId)}" class="footnote-backref" ` +
        `role="doc-backlink">↩︎${occurrence}</a>`
      );
    })
    .join(" ");
  const backlinksHtml = `<span class="footnote-backlinks">${backlinks}</span>`;
  const lastBlock = definitionContent.at(-1);
  let bodyHtml: string;

  if (lastBlock?.type === "paragraph") {
    const precedingBlocks = definitionContent.slice(0, -1);
    const lastParagraphHtml = context.renderChildren(lastBlock.content);
    const separator = lastParagraphHtml ? " " : "";
    bodyHtml =
      context.renderChildren(precedingBlocks) +
      `<p>${lastParagraphHtml}${separator}${backlinksHtml}</p>`;
  } else {
    bodyHtml =
      context.renderChildren(definitionContent) +
      `<p class="footnote-backlinks">${backlinks}</p>`;
  }

  const valueAttr = includeValue ? ` value="${group.number}"` : "";

  return (
    `<li id="${escapeHtml(group.definitionId)}" class="footnote"${valueAttr}>` +
    bodyHtml +
    `</li>`
  );
}

function renderFootnoteEndnotes(context: RenderContext): string {
  const groups = context.footnotes.groups.filter(
    (group) => group.definition !== null,
  );
  if (groups.length === 0) return "";

  const firstNumber = groups[0]?.number ?? 1;
  let expectedNumber = firstNumber;
  const items = groups
    .map((group) => {
      const includeValue = group.number !== expectedNumber;
      expectedNumber = group.number + 1;
      return renderFootnoteGroup(group, context, includeValue);
    })
    .join("");
  const startAttr = firstNumber === 1 ? "" : ` start="${firstNumber}"`;

  return (
    `<section class="footnote-endnotes" role="doc-endnotes">` +
    `<ol class="footnote-list"${startAttr}>${items}</ol>` +
    `</section>`
  );
}

function renderDocumentContent(
  node: TiptapNode,
  context: RenderContext,
): string {
  const bodyNodes = (node.content ?? []).filter(
    (child) => child.type !== "footnoteDefinition",
  );

  return (
    bodyNodes.map((bodyNode) => context.renderNode(bodyNode)).join("") +
    renderFootnoteEndnotes(context)
  );
}

const MARK_RENDERERS: Record<string, MarkRenderer> = {
  bold: (html) => `<strong>${html}</strong>`,
  italic: (html) => `<em>${html}</em>`,
  strike: (html) => `<s>${html}</s>`,
  code: (html) => `<code>${html}</code>`,
  link: (html, mark) => {
    const href = escapeHtml(
      sanitizeRichTextHref(getStringAttr(mark.attrs, "href")),
    );
    const target = getStringAttr(mark.attrs, "target");
    const targetAttr = target ? ` target="${escapeHtml(target)}"` : "";
    const relAttr = target ? ' rel="noopener noreferrer"' : "";

    return `<a href="${href}"${targetAttr}${relAttr}>${html}</a>`;
  },
};

const NODE_RENDERERS: Record<string, NodeRenderer> = {
  doc: (node, context) => renderDocumentContent(node, context),
  paragraph: (node, context) =>
    `<p>${context.renderChildren(node.content)}</p>`,
  heading: (node, context) => {
    const level = Math.min(
      Math.max(getNumberAttr(node.attrs, "level") ?? 1, 1),
      6,
    );
    return `<h${level}>${context.renderChildren(node.content)}</h${level}>`;
  },
  text: (node, context) => context.renderText(node.text ?? "", node.marks),
  bulletList: (node, context) =>
    `<ul>${context.renderChildren(node.content)}</ul>`,
  orderedList: (node, context) => {
    const start = getNumberAttr(node.attrs, "start");
    const startAttr = start !== null && start !== 1 ? ` start="${start}"` : "";
    return `<ol${startAttr}>${context.renderChildren(node.content)}</ol>`;
  },
  listItem: (node, context) =>
    `<li>${context.renderChildren(node.content)}</li>`,
  blockquote: (node, context) =>
    `<blockquote>${context.renderChildren(node.content)}</blockquote>`,
  codeBlock: (node) => {
    const language = getStringAttr(node.attrs, "language");
    const languageAttr = language
      ? ` class="language-${escapeHtml(language)}"`
      : "";
    return `<pre><code${languageAttr}>${renderCodeBlockText(node)}</code></pre>`;
  },
  table: (node, context) =>
    `<table>${context.renderChildren(node.content)}</table>`,
  tableRow: (node, context) =>
    `<tr>${context.renderChildren(node.content)}</tr>`,
  tableCell: (node, context) => renderTableCell("td", node, context),
  tableHeader: (node, context) => renderTableCell("th", node, context),
  horizontalRule: () => "<hr>",
  hardBreak: () => "<br>",
  image: (node) => renderPublishedImageFigure(node.attrs ?? {}),
  embed: (node) => renderEmbedFromAttrs(node.attrs),
  // htmlBlock: deliberately raw output. The author is the only writer in
  // Jant's single-author model, this node is admin-only via the editor UI,
  // and the value is round-tripped through markdown unchanged. This is a
  // documented exception to the "every dynamic string must be escaped" rule
  // in CLAUDE.md — see also `dangerouslySetInnerHTML` for `customCSS`.
  htmlBlock: (node) => {
    const html = getStringAttr(node.attrs, "html");
    if (!html) return "";
    return `<div class="tiptap-html-block">${html}</div>`;
  },
  moreBreak: () => "<!--more-->",
  footnoteReference: (node, context) => renderFootnoteReference(node, context),
  footnoteDefinition: () => "",
};

function renderText(text: string, marks: TiptapMark[] = []): string {
  let html = escapeHtml(text);

  for (const mark of marks) {
    const renderMark = MARK_RENDERERS[mark.type];
    if (renderMark) {
      html = renderMark(html, mark);
    }
  }

  return html;
}

function renderUnknownNode(node: TiptapNode, context: RenderContext): string {
  return node.content ? context.renderChildren(node.content) : "";
}

function createRenderContext(footnotes: FootnotePlan): RenderContext {
  const context: RenderContext = {
    footnotes,
    renderChildren(content: TiptapNode[] = []) {
      return content.map((node) => context.renderNode(node)).join("");
    },
    renderNode(node) {
      const renderNodeType = NODE_RENDERERS[node.type] ?? renderUnknownNode;
      return renderNodeType(node, context);
    },
    renderText,
  };

  return context;
}

/**
 * Renders a parsed TipTap document to HTML.
 *
 * @param doc - Parsed TipTap document
 * @param options - Rendering options, including a stable footnote ID namespace
 * @returns HTML string
 */
export function renderTiptapDocument(
  doc: JSONContent,
  options: TiptapRenderOptions = {},
): string {
  if (doc.type !== "doc") return "";
  const normalized = normalizeFootnoteArtifacts(doc) as TiptapNode;
  const context = createRenderContext(createFootnotePlan(normalized, options));
  return context.renderNode(normalized);
}

export interface TiptapBoundaryRenderResult {
  beforeHtml: string;
  afterHtml: string;
}

/**
 * Render a document as two byte-compatible segments around a top-level source
 * boundary.
 *
 * The full document is planned before either segment is rendered, so a
 * footnote before the boundary still includes backlinks to repeated references
 * after it. Joining the two strings is therefore identical to a normal render.
 *
 * @param doc - Parsed TipTap document
 * @param boundaryIndex - Index in the original `doc.content` array
 * @param options - Rendering options, including a stable footnote ID namespace
 * @returns The rendered segments, or null for an invalid root or boundary
 * @example
 * ```ts
 * renderTiptapDocumentAroundBoundary(
 *   { type: "doc", content: [{ type: "paragraph" }] },
 *   1,
 * );
 * // { beforeHtml: "<p></p>", afterHtml: "" }
 * ```
 */
export function renderTiptapDocumentAroundBoundary(
  doc: JSONContent,
  boundaryIndex: number,
  options: TiptapRenderOptions = {},
): TiptapBoundaryRenderResult | null {
  const originalContent = doc.content ?? [];
  if (
    doc.type !== "doc" ||
    !Array.isArray(doc.content) ||
    !Number.isInteger(boundaryIndex) ||
    boundaryIndex < 0 ||
    boundaryIndex > originalContent.length
  ) {
    return null;
  }

  const normalized = normalizeFootnoteArtifacts(doc) as TiptapNode;
  const context = createRenderContext(createFootnotePlan(normalized, options));
  const normalizedBoundaryIndex = Math.min(
    boundaryIndex,
    normalized.content?.length ?? 0,
  );
  let beforeBodyHtml = "";
  let afterBodyHtml = "";

  for (const [index, node] of (normalized.content ?? []).entries()) {
    if (node.type === "footnoteDefinition") continue;
    const html = context.renderNode(node);
    if (index < normalizedBoundaryIndex) {
      beforeBodyHtml += html;
    } else {
      afterBodyHtml += html;
    }
  }

  return {
    beforeHtml: beforeBodyHtml,
    afterHtml: afterBodyHtml + renderFootnoteEndnotes(context),
  };
}

/**
 * Strictly parses and renders a TipTap JSON document.
 *
 * Unlike `renderTiptapJson`, this distinguishes invalid canonical JSON from a
 * valid empty document. Projection rebuilds use it so malformed historical
 * content is reported and never marked as current.
 *
 * @param json - TipTap JSON string
 * @param options - Rendering options
 * @returns A discriminated render result
 */
export function tryRenderTiptapJson(
  json: string,
  options: TiptapRenderOptions = {},
): TiptapRenderResult {
  try {
    const doc = JSON.parse(json) as JSONContent;
    if (doc.type !== "doc") {
      return { ok: false, error: "TipTap body root must be a doc node." };
    }
    return { ok: true, html: renderTiptapDocument(doc, options) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid TipTap JSON.",
    };
  }
}

/**
 * Renders a Tiptap JSON document to an HTML string.
 *
 * @param json - Tiptap JSON string or parsed document object
 * @param options - Rendering options, including a stable footnote ID namespace
 * @returns HTML string
 *
 * @example
 * ```ts
 * const html = renderTiptapJson('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}');
 * // "<p>Hello</p>"
 * ```
 */
export function renderTiptapJson(
  json: string,
  options: TiptapRenderOptions = {},
): string {
  const result = tryRenderTiptapJson(json, options);
  return result.ok ? result.html : "";
}

/**
 * Returns true if a TipTap node is an empty block — a paragraph (or heading)
 * with no meaningful content (no text, no images, no other inline nodes).
 * Whitespace-only text nodes are treated as empty.
 */
function isEmptyBlock(node: JSONContent): boolean {
  if (node.type !== "paragraph" && node.type !== "heading") return false;
  if (!node.content || node.content.length === 0) return true;
  return node.content.every(
    (child) =>
      child.type === "text" && (!child.text || child.text.trim() === ""),
  );
}

/**
 * Strips leading and trailing empty paragraphs/headings from a TipTap JSON
 * document string. Returns `null` if the entire document becomes empty after
 * trimming.
 *
 * @param json - TipTap JSON string
 * @returns Trimmed JSON string, or `null` if nothing remains
 *
 * @example
 * ```ts
 * // Removes trailing empty paragraphs
 * trimTiptapBody('{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]},{"type":"paragraph"}]}');
 * // '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}'
 * ```
 */
export function trimTiptapBody(json: string): string | null {
  let doc: JSONContent;
  try {
    doc = JSON.parse(json) as JSONContent;
  } catch {
    return json;
  }
  if (doc.type !== "doc" || !doc.content) return json;

  let start = 0;
  let end = doc.content.length;
  const content = doc.content;
  while (start < end && isEmptyBlock(content[start] as JSONContent)) start++;
  while (end > start && isEmptyBlock(content[end - 1] as JSONContent)) end--;

  if (start >= end) return null;
  if (start === 0 && end === doc.content.length) return json;

  return JSON.stringify({ ...doc, content: doc.content.slice(start, end) });
}
