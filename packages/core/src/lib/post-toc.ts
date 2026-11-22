import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];

/** Minimum number of headings required before showing the table of contents. */
export const MIN_TOC_HEADINGS = 3;

export type PostHeadingLevel = 1 | 2 | 3;
export type PostTocDepth = 0 | 1 | 2;

export interface PostTocEntry {
  id: string;
  label: string;
  level: PostHeadingLevel;
  depth: PostTocDepth;
}

export interface EnhancePostHeadingsOptions {
  /** Localized accessible label for a heading's copy-link anchor. */
  getAnchorLabel?: (heading: string) => string;
}

export interface PostHeadingsResult {
  bodyHtml: string;
  entries: PostTocEntry[];
  showToc: boolean;
}

const HEADING_LEVELS: Record<string, PostHeadingLevel> = {
  h1: 1,
  h2: 2,
  h3: 3,
};

const ANCHOR_TEMPLATE =
  '<a class="heading-anchor" data-heading-anchor><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="heading-anchor-hash" d="M6.5 2.5 4.8 13.5M11.2 2.5 9.5 13.5M2.75 6h10.5M2.25 10h10.5"/><path class="heading-anchor-check" d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg></a>';

function isElement(node: Node): node is Element {
  return "tagName" in node && "attrs" in node;
}

function hasClass(element: Element, className: string): boolean {
  return element.attrs.some(
    ({ name, value }) =>
      name === "class" && value.split(/\s+/).includes(className),
  );
}

function headingText(node: Node): string {
  if ("value" in node) return node.value;
  if (!isElement(node)) return "";
  if (node.tagName === "br") return " ";
  if (
    hasClass(node, "footnote-ref") ||
    hasClass(node, "heading-anchor") ||
    node.attrs.some(
      ({ name, value }) => name === "aria-hidden" && value === "true",
    )
  ) {
    return "";
  }

  return node.childNodes.map(headingText).join("");
}

function containsHeadingAnchor(element: Element): boolean {
  return element.childNodes.some(
    (child) =>
      isElement(child) &&
      (hasClass(child, "heading-anchor") || containsHeadingAnchor(child)),
  );
}

function createHeadingAnchor(id: string, ariaLabel: string): Element {
  const fragment = parseFragment(ANCHOR_TEMPLATE);
  const anchor = fragment.childNodes[0] as Element;
  anchor.attrs.push(
    { name: "href", value: `#${encodeURIComponent(id)}` },
    { name: "aria-label", value: ariaLabel },
  );
  return anchor;
}

/**
 * Add fragment IDs and hover copy-link anchors to top-level headings in a post,
 * and build normalized table-of-contents entries.
 *
 * @param bodyHtml - Trusted HTML from the post renderer
 * @param options - Optional label formatter for heading anchor links
 * @returns The enhanced body HTML, ordered heading entries, and whether to show a TOC
 * @example
 * enhancePostHeadings("<h2>Overview</h2><p>Body</p>").entries;
 */
export function enhancePostHeadings(
  bodyHtml: string,
  options?: EnhancePostHeadingsOptions,
): PostHeadingsResult {
  const fragment = parseFragment(bodyHtml);
  const ids = new Set<string>();
  const collectIds = (node: Node) => {
    if (!isElement(node)) return;
    const id = node.attrs.find(({ name }) => name === "id")?.value;
    if (id) ids.add(id);
    node.childNodes.forEach(collectIds);
  };
  fragment.childNodes.forEach(collectIds);

  const rawEntries: Array<{
    id: string;
    label: string;
    level: PostHeadingLevel;
  }> = [];

  for (const node of fragment.childNodes) {
    if (!isElement(node)) continue;
    const level = HEADING_LEVELS[node.tagName];
    if (!level) continue;

    const label = headingText(node).replace(/\s+/g, " ").trim();
    if (!label) continue;

    const idAttr = node.attrs.find(({ name }) => name === "id");
    let id = idAttr?.value;
    if (!id) {
      const slug = label
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "");
      const base = slug ? `section-${slug}` : "section";
      id = base;
      for (let suffix = 2; ids.has(id); suffix++) {
        id = `${base}-${suffix}`;
      }
      if (idAttr) idAttr.value = id;
      else node.attrs.push({ name: "id", value: id });
      ids.add(id);
    }

    if (!node.attrs.some(({ name }) => name === "tabindex")) {
      node.attrs.push({ name: "tabindex", value: "-1" });
    }
    if (!node.attrs.some(({ name }) => name === "data-post-heading")) {
      node.attrs.push({ name: "data-post-heading", value: "" });
    }
    if (!containsHeadingAnchor(node)) {
      const ariaLabel = options?.getAnchorLabel
        ? options.getAnchorLabel(label)
        : `Link to section: ${label}`;
      const anchor = createHeadingAnchor(id, ariaLabel);
      anchor.parentNode = node;
      node.childNodes.push(anchor);
    }

    rawEntries.push({ id, label, level });
  }

  if (rawEntries.length === 0) {
    return { bodyHtml, entries: [], showToc: false };
  }

  const minLevel = Math.min(...rawEntries.map((entry) => entry.level));
  const entries: PostTocEntry[] = rawEntries.map((entry) => ({
    ...entry,
    depth: Math.min(entry.level - minLevel, 2) as PostTocDepth,
  }));

  return {
    bodyHtml: serialize(fragment),
    entries,
    showToc: entries.length >= MIN_TOC_HEADINGS,
  };
}
