/**
 * Shared Footnote Helpers
 *
 * Keeps footnote label normalization, DOM ID generation, and Markdown
 * definition parsing consistent across the markdown parser, HTML renderer,
 * and editor schema.
 */

import type { JSONContent } from "@tiptap/core";

const FOOTNOTE_LABEL_FALLBACK = "footnote";
const FOOTNOTE_CONTINUATION_PREFIX = /^(?: {4}|\t)/;
const FOOTNOTE_DEFINITION_PREFIX = /^\[\^([^\]\n]+)\]:(.*)(?:\n|$)/;

export interface FootnoteDefinitionTokenData {
  label: string;
  raw: string;
  contentMarkdown: string;
}

export interface LegacyFootnoteUpgradeResult {
  doc: JSONContent;
  upgraded: boolean;
}

interface LegacyFootnoteReference {
  label: string;
  node: JSONContent;
}

export function normalizeFootnoteLabel(label: unknown): string {
  if (typeof label !== "string") return "";
  return label.trim().replace(/\s+/g, " ");
}

export function getFootnoteLabelKey(label: unknown): string {
  return normalizeFootnoteLabel(label).toLowerCase();
}

export function getFootnoteReferenceText(label: unknown): string {
  const normalized = normalizeFootnoteLabel(label);
  return `[^${normalized || FOOTNOTE_LABEL_FALLBACK}]`;
}

export function getFootnoteDefinitionLabelText(label: unknown): string {
  return `${getFootnoteReferenceText(label)}:`;
}

export function getFootnoteDomId(label: unknown): string {
  const normalized = getFootnoteLabelKey(label);
  const slug = normalized.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");

  return slug || FOOTNOTE_LABEL_FALLBACK;
}

export function indentFootnoteMarkdown(content: string): string {
  return content
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function isEmptyParagraphNode(node: JSONContent | undefined): boolean {
  return (
    node?.type === "paragraph" && (!node.content || node.content.length === 0)
  );
}

/**
 * Removes editor-only empty paragraphs that can be left behind after inserting
 * footnote definitions. They are not meaningful document content.
 */
export function normalizeFootnoteArtifacts(doc: JSONContent): JSONContent {
  if (
    doc.type !== "doc" ||
    !Array.isArray(doc.content) ||
    doc.content.length < 2
  ) {
    return doc;
  }

  const content = [...doc.content];

  while (
    content.length >= 2 &&
    isEmptyParagraphNode(content[content.length - 1]) &&
    content[content.length - 2]?.type === "footnoteDefinition"
  ) {
    content.pop();
  }

  return content.length === doc.content.length ? doc : { ...doc, content };
}

function getLinkHref(node: JSONContent): string {
  const linkMarks = (node.marks ?? []).filter((mark) => mark.type === "link");
  if (linkMarks.length !== 1) return "";

  const href = linkMarks[0]?.attrs?.href;
  return typeof href === "string" ? href.trim() : "";
}

function decodeHashTarget(href: string): string {
  if (!href.startsWith("#")) return "";

  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return href.slice(1);
  }
}

function normalizeLegacyTargetId(value: string): string {
  return value.replace(/^user-content-/i, "").toLowerCase();
}

function getLegacyReferenceLabel(node: JSONContent): string {
  if (node.type !== "text" || typeof node.text !== "string") return "";

  const text = node.text.trim();
  const displayMatch = text.match(/^\[\^?([^\]\n]+)\]$/);
  const label = normalizeFootnoteLabel(displayMatch?.[1] ?? text);
  if (!label) return "";

  const targetId = normalizeLegacyTargetId(decodeHashTarget(getLinkHref(node)));
  const expectedTargetId = `fn-${getFootnoteDomId(label)}`.toLowerCase();
  return targetId === expectedTargetId ? label : "";
}

function collectLegacyReferences(
  node: JSONContent,
  references: LegacyFootnoteReference[],
): void {
  const label = getLegacyReferenceLabel(node);
  if (label) {
    references.push({ label, node });
    return;
  }

  for (const child of node.content ?? []) {
    collectLegacyReferences(child, references);
  }
}

function isBacklinkText(value: string | undefined): boolean {
  return /^(?:↩(?:︎)?|↵)(?:\s*\d+)?$/.test(value?.trim() ?? "");
}

function getLegacyBacklinkLabel(
  node: JSONContent,
  labels: readonly string[],
): string {
  if (node.type !== "text" || !isBacklinkText(node.text)) return "";

  const targetId = normalizeLegacyTargetId(decodeHashTarget(getLinkHref(node)));
  if (!targetId.startsWith("fnref-")) return "";

  for (const label of labels) {
    const base = `fnref-${getFootnoteDomId(label)}`.toLowerCase();
    const occurrence = targetId.startsWith(`${base}-`)
      ? targetId.slice(base.length + 1)
      : "";
    if (targetId === base || /^\d+$/.test(occurrence)) {
      return label;
    }
  }

  return "";
}

function collectLegacyBacklinkLabels(
  node: JSONContent,
  labels: readonly string[],
  found: Set<string>,
): void {
  const label = getLegacyBacklinkLabel(node, labels);
  if (label) {
    found.add(getFootnoteLabelKey(label));
    return;
  }

  for (const child of node.content ?? []) {
    collectLegacyBacklinkLabels(child, labels, found);
  }
}

function removeLegacyBacklinks(
  node: JSONContent,
  label: string,
): JSONContent | null {
  if (
    getFootnoteLabelKey(getLegacyBacklinkLabel(node, [label])) ===
    getFootnoteLabelKey(label)
  ) {
    return null;
  }

  if (!node.content) return node;

  const content = node.content.flatMap((child) => {
    const normalized = removeLegacyBacklinks(child, label);
    return normalized ? [normalized] : [];
  });

  if (content.length === node.content.length) {
    const unchanged = content.every(
      (child, index) => child === node.content?.[index],
    );
    if (unchanged) return node;
  }

  return content.length > 0 ? { ...node, content } : { ...node, content: [] };
}

function replaceLegacyReferences(
  node: JSONContent,
  labelsByNode: Map<JSONContent, string>,
): JSONContent {
  const label = labelsByNode.get(node);
  if (label) {
    return { type: "footnoteReference", attrs: { label } };
  }

  if (!node.content) return node;

  const content = node.content.map((child) =>
    replaceLegacyReferences(child, labelsByNode),
  );
  const unchanged = content.every(
    (child, index) => child === node.content?.[index],
  );
  return unchanged ? node : { ...node, content };
}

function hasCanonicalFootnoteNode(node: JSONContent): boolean {
  if (node.type === "footnoteReference" || node.type === "footnoteDefinition") {
    return true;
  }

  return (node.content ?? []).some(hasCanonicalFootnoteNode);
}

/**
 * Upgrades the historical footnote shape that old rich-text pastes stored as
 * ordinary fragment links plus a trailing ordered list.
 *
 * Conversion is deliberately all-or-nothing. The document must end in an
 * `hr` and ordered list, every definition item must contain a matching
 * `#fnref-*` backlink, and every `#fn-*` reference must have exactly one
 * definition label. This keeps normal fragment links and numbered lists
 * untouched.
 *
 * @param doc - Parsed TipTap document
 * @returns The canonical document and whether a legacy footnote set changed
 * @example
 * ```ts
 * const result = upgradeLegacyFootnotes({
 *   type: "doc",
 *   content: [],
 * });
 * // { doc: { type: "doc", content: [] }, upgraded: false }
 * ```
 */
export function upgradeLegacyFootnotes(
  doc: JSONContent,
): LegacyFootnoteUpgradeResult {
  if (
    doc.type !== "doc" ||
    !Array.isArray(doc.content) ||
    doc.content.length < 3 ||
    hasCanonicalFootnoteNode(doc)
  ) {
    return { doc, upgraded: false };
  }

  const definitionList = doc.content.at(-1);
  const separator = doc.content.at(-2);
  if (
    definitionList?.type !== "orderedList" ||
    separator?.type !== "horizontalRule" ||
    !Array.isArray(definitionList.content) ||
    definitionList.content.length === 0 ||
    definitionList.content.some((item) => item.type !== "listItem")
  ) {
    return { doc, upgraded: false };
  }

  const bodyNodes = doc.content.slice(0, -2);
  const references: LegacyFootnoteReference[] = [];
  for (const node of bodyNodes) collectLegacyReferences(node, references);
  if (references.length === 0) return { doc, upgraded: false };

  const labelsByKey = new Map<string, string>();
  for (const reference of references) {
    const key = getFootnoteLabelKey(reference.label);
    if (!labelsByKey.has(key)) labelsByKey.set(key, reference.label);
  }
  const labels = [...labelsByKey.values()].sort(
    (left, right) =>
      getFootnoteDomId(right).length - getFootnoteDomId(left).length,
  );
  if (labels.length !== definitionList.content.length) {
    return { doc, upgraded: false };
  }

  const definitions: JSONContent[] = [];
  const definedLabels = new Set<string>();
  for (const item of definitionList.content) {
    const backlinkLabels = new Set<string>();
    collectLegacyBacklinkLabels(item, labels, backlinkLabels);
    if (backlinkLabels.size !== 1) return { doc, upgraded: false };

    const key = [...backlinkLabels][0];
    if (!key) return { doc, upgraded: false };
    const label = labelsByKey.get(key);
    if (!label || definedLabels.has(key)) return { doc, upgraded: false };

    definedLabels.add(key);
    const content = (item.content ?? []).flatMap((child) => {
      const normalized = removeLegacyBacklinks(child, label);
      return normalized ? [normalized] : [];
    });
    definitions.push({
      type: "footnoteDefinition",
      attrs: { label },
      content: content.length > 0 ? content : [{ type: "paragraph" }],
    });
  }

  if (definedLabels.size !== labelsByKey.size) {
    return { doc, upgraded: false };
  }

  const labelsByNode = new Map(
    references.map((reference) => [reference.node, reference.label] as const),
  );
  return {
    doc: {
      ...doc,
      content: [
        ...bodyNodes.map((node) => replaceLegacyReferences(node, labelsByNode)),
        ...definitions,
      ],
    },
    upgraded: true,
  };
}

/**
 * Parses one Markdown footnote definition from the start of `src`.
 *
 * Supports:
 * - `[^1]: inline body`
 * - `[^1]:` followed by indented continuation blocks
 * - blank lines inside the definition when followed by indented content
 */
export function parseFootnoteDefinition(
  src: string,
): FootnoteDefinitionTokenData | null {
  const startMatch = src.match(FOOTNOTE_DEFINITION_PREFIX);
  if (!startMatch) return null;

  const label = normalizeFootnoteLabel(startMatch[1]);
  if (!label) return null;

  const bodyLines: string[] = [];
  const firstLineContent = (startMatch[2] ?? "").replace(/^ /, "");
  if (firstLineContent) {
    bodyLines.push(firstLineContent);
  }

  let raw = startMatch[0];
  let offset = raw.length;

  while (offset < src.length) {
    const rest = src.slice(offset);
    const lineMatch = rest.match(/^(.*)(\n|$)/);
    if (!lineMatch) break;

    const line = lineMatch[1] ?? "";
    const consumed = lineMatch[0];

    if (FOOTNOTE_CONTINUATION_PREFIX.test(line)) {
      bodyLines.push(line.replace(FOOTNOTE_CONTINUATION_PREFIX, ""));
      raw += consumed;
      offset += consumed.length;
      continue;
    }

    if (line.trim() === "") {
      const afterBlank = src.slice(offset + consumed.length);
      const nextLine = afterBlank.match(/^(.*)(?:\n|$)/)?.[1] ?? "";

      if (FOOTNOTE_CONTINUATION_PREFIX.test(nextLine)) {
        bodyLines.push("");
        raw += consumed;
        offset += consumed.length;
        continue;
      }
    }

    break;
  }

  return {
    label,
    raw,
    contentMarkdown: bodyLines.join("\n"),
  };
}
