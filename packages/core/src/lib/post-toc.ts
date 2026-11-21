import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["childNode"];

export interface PostTocEntry {
  id: string;
  label: string;
  level: 2 | 3;
}

function headingText(node: Node): string {
  if ("value" in node) return node.value;
  if (!("childNodes" in node)) return "";
  if (node.tagName === "br") return " ";
  if (
    node.attrs.some(
      ({ name, value }) =>
        (name === "class" && value.split(/\s+/).includes("footnote-ref")) ||
        (name === "aria-hidden" && value === "true"),
    )
  )
    return "";

  return node.childNodes.map(headingText).join("");
}

/**
 * Add fragment targets to the top-level section headings of a rendered post.
 *
 * @param bodyHtml - Trusted HTML from the post renderer
 * @returns The body with heading IDs and its ordered directory entries
 * @example
 * buildPostToc("<h2>Getting started</h2>").entries;
 */
export function buildPostToc(bodyHtml: string): {
  bodyHtml: string;
  entries: PostTocEntry[];
} {
  const fragment = parseFragment(bodyHtml);
  const ids = new Set<string>();
  const collectIds = (node: Node) => {
    if (!("childNodes" in node)) return;
    const id = node.attrs.find(({ name }) => name === "id")?.value;
    if (id) ids.add(id);
    node.childNodes.forEach(collectIds);
  };
  fragment.childNodes.forEach(collectIds);

  const entries: PostTocEntry[] = [];
  for (const node of fragment.childNodes) {
    if (
      !("tagName" in node) ||
      (node.tagName !== "h2" && node.tagName !== "h3")
    ) {
      continue;
    }
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
      for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
      if (idAttr) idAttr.value = id;
      else node.attrs.push({ name: "id", value: id });
      ids.add(id);
    }
    if (!node.attrs.some(({ name }) => name === "tabindex")) {
      node.attrs.push({ name: "tabindex", value: "-1" });
    }
    node.attrs.push({ name: "data-post-toc-heading", value: "" });
    entries.push({ id, label, level: node.tagName === "h2" ? 2 : 3 });
  }
  return { bodyHtml: entries.length ? serialize(fragment) : bodyHtml, entries };
}
