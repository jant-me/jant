import {
  Extension,
  Node,
  type AnyExtension,
  type Extensions,
  type JSONContent,
} from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import CodeBlock from "@tiptap/extension-code-block";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import {
  Table,
  TableRow,
  TableCell,
  TableHeader,
} from "@tiptap/extension-table";
import {
  getFootnoteDefinitionLabelText,
  getFootnoteLabelKey,
  getFootnoteReferenceText,
  indentFootnoteMarkdown,
  normalizeFootnoteArtifacts,
  normalizeFootnoteLabel,
  parseFootnoteDefinition,
} from "./footnotes.js";
import { renderMarkdownImage, type RichImageAttrs } from "./rich-image.js";
import { sanitizeRichTextHref } from "./url.js";

export const MARKDOWN_MARKED_OPTIONS = {
  gfm: true,
  breaks: false,
} as const;

const MORE_BREAK_MARKER = "<!--more-->";
const MORE_BREAK_VISIBLE_LABELS = ["Read More ↓", "Read More"] as const;
const MORE_BREAK_TOKENIZER_REGEX =
  /^(?:<!--more-->|Read More ↓|Read More)[ \t]*(?:\n|$)/;

function chooseCodeFence(content: string): string {
  const maxInnerFence = Math.max(
    2,
    ...Array.from(content.matchAll(/`+/g), (match) => match[0].length),
  );
  return "`".repeat(Math.max(3, maxInnerFence + 1));
}

interface QueryableElement {
  getAttribute(name: string): string | null;
  querySelector(selector: string): QueryableElement | null;
  textContent: string | null;
}

function readImageAttributesFromElement(element: QueryableElement) {
  const img = element.querySelector("img");
  const figcaption = element.querySelector("figcaption");
  const link = element.querySelector("a");

  return {
    src: img?.getAttribute("src") ?? "",
    alt: img?.getAttribute("alt") ?? "",
    title: img?.getAttribute("title") ?? "",
    caption: figcaption?.textContent ?? "",
    href: link?.getAttribute("href") ?? "",
    layout: element.getAttribute("data-layout") ?? "regular",
  };
}

function getHtmlAttribute(source: string, name: string): string | null {
  const match = source.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match?.[1] ?? null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseImageFigureHtml(html: string): RichImageAttrs | null {
  const normalized = html.trim();
  const figureMatch = normalized.match(
    /^<figure\b([^>]*)data-jant-node="image"([^>]*)>([\s\S]*?)<\/figure>$/i,
  );
  if (!figureMatch) return null;

  const figureAttrs = `${figureMatch[1] ?? ""} ${figureMatch[2] ?? ""}`;
  const innerHtml = figureMatch[3] ?? "";
  const layout =
    getHtmlAttribute(figureAttrs, "data-jant-layout") ||
    getHtmlAttribute(figureAttrs, "data-layout") ||
    undefined;
  const anchorHref = innerHtml.match(/<a\b[^>]*href="([^"]*)"[^>]*>/i)?.[1];
  const imgMatch = innerHtml.match(/<img\b([^>]*)>/i);
  if (!imgMatch) return null;

  const imgAttrs = imgMatch[1] ?? "";
  const src = getHtmlAttribute(imgAttrs, "src");
  if (!src) return null;

  const captionMatch = innerHtml.match(/<figcaption>([\s\S]*?)<\/figcaption>/i);
  const rawCaption = captionMatch?.[1];
  const caption = rawCaption ? decodeHtml(rawCaption.trim()) : undefined;

  const attrs: RichImageAttrs = {
    src: decodeHtml(src),
  };
  const alt = getHtmlAttribute(imgAttrs, "alt");
  const title = getHtmlAttribute(imgAttrs, "title");
  if (alt) attrs.alt = decodeHtml(alt);
  if (title) attrs.title = decodeHtml(title);
  if (caption) attrs.caption = caption;
  if (anchorHref) attrs.href = decodeHtml(anchorHref);
  if (layout && layout !== "regular") attrs.layout = decodeHtml(layout);

  return attrs;
}
export { renderMarkdownImage as renderImageMarkdown } from "./rich-image.js";

export const MarkdownImageNode = Node.create({
  name: "image",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: "" },
      alt: { default: "" },
      title: { default: "" },
      caption: { default: "" },
      href: { default: "" },
      layout: { default: "regular" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-image]",
        getAttrs(dom) {
          return readImageAttributesFromElement(dom as QueryableElement);
        },
      },
      {
        tag: "figure",
        getAttrs(dom) {
          const element = dom as QueryableElement;
          if (!element.querySelector("img")) return false;
          return readImageAttributesFromElement(element);
        },
      },
      {
        tag: "img[src]",
        getAttrs(dom) {
          const element = dom as QueryableElement;
          return {
            src: element.getAttribute("src") ?? "",
            alt: element.getAttribute("alt") ?? "",
            title: element.getAttribute("title") ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const attrs: Record<string, string> = { "data-image": "" };
    if (node.attrs.layout && node.attrs.layout !== "regular") {
      attrs["data-layout"] = node.attrs.layout;
    }

    const imgAttrs: Record<string, string> = { src: node.attrs.src };
    if (node.attrs.alt) imgAttrs.alt = node.attrs.alt;
    if (node.attrs.title) imgAttrs.title = node.attrs.title;

    const imageNode: [string, Record<string, string>] = ["img", imgAttrs];
    const children: Array<
      | [string, Record<string, string>]
      | [string, Record<string, string>, ...unknown[]]
    > = [];

    if (node.attrs.href) {
      children.push(["a", { href: node.attrs.href }, imageNode]);
    } else {
      children.push(imageNode);
    }

    if (node.attrs.caption) {
      children.push(["figcaption", {}, node.attrs.caption]);
    }

    return ["figure", attrs, ...children];
  },

  parseMarkdown: (token, helpers) => {
    return helpers.createNode("image", {
      src: token.href,
      title: token.title ?? "",
      alt: token.text ?? "",
    });
  },

  renderMarkdown: (node) => {
    return renderMarkdownImage(node.attrs ?? {});
  },
});

const MarkdownCodeBlock = CodeBlock.extend({
  renderMarkdown(node, helpers) {
    const language = node.attrs?.language ? String(node.attrs.language) : "";
    const content = helpers.renderChildren(node.content ?? []);
    const fence = chooseCodeFence(content);

    return `${fence}${language}\n${content}\n${fence}`;
  },
});

const SemanticLink = Link.extend({
  clearable: false,
});

const MarkdownFigureImageSupport = Extension.create({
  name: "markdownFigureImageSupport",

  markdownTokenName: "imageFigure",

  parseMarkdown: (token, helpers) => {
    return helpers.createNode("image", token.attrs ?? {});
  },

  markdownTokenizer: {
    name: "imageFigure",
    level: "block",
    start(src: string) {
      return src.indexOf("<figure");
    },
    tokenize(src: string) {
      const match = src.match(
        /^<figure\b[^>]*data-jant-node="image"[\s\S]*?<\/figure>(?:\n|$)?/i,
      );
      if (!match) return undefined;

      const attrs = parseImageFigureHtml(match[0]);
      if (!attrs) return undefined;

      return {
        type: "imageFigure",
        raw: match[0],
        attrs,
      };
    },
  },
});

/**
 * Marked tokenizer for the `jant-embed` fenced block.
 *
 * Body is one URL on its own line, optionally followed by `key=value` lines
 * for caption/title overrides. We intentionally re-resolve provider attrs at
 * parse time (in the node's `parseMarkdown`) so old posts pick up new
 * orientation/sandbox/CSP rules without needing a republish.
 */
export function createEmbedMarkdownToken() {
  return {
    name: "embed",
    level: "block" as const,
    start(src: string) {
      return src.indexOf("```jant-embed");
    },
    tokenize(src: string) {
      const match = src.match(/^```jant-embed[ \t]*\n([\s\S]*?)\n?```(?:\n|$)/);
      if (!match) return undefined;
      const body = match[1] ?? "";
      const lines = body
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const url = lines[0] ?? "";
      const attrs: Record<string, string> = {};
      for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        if (key) attrs[key] = value;
      }
      return {
        type: "embed",
        raw: match[0],
        url,
        attrs,
      };
    },
  };
}

/**
 * Marked tokenizer for the `jant-html` fenced block. Body is raw HTML, kept
 * verbatim end-to-end; the node renders trusted HTML on the published page.
 */
export function createHtmlBlockMarkdownToken() {
  return {
    name: "htmlBlock",
    level: "block" as const,
    start(src: string) {
      return src.indexOf("```jant-html");
    },
    tokenize(src: string) {
      const match = src.match(/^```jant-html[ \t]*\n([\s\S]*?)\n?```(?:\n|$)/);
      if (!match) return undefined;
      return {
        type: "htmlBlock",
        raw: match[0],
        html: match[1] ?? "",
      };
    },
  };
}

export function createMoreBreakMarkdownToken() {
  return {
    name: "moreBreak",
    level: "block" as const,
    start(src: string) {
      const markerIndex = src.indexOf(MORE_BREAK_MARKER);
      let firstIndex = markerIndex;

      for (const label of MORE_BREAK_VISIBLE_LABELS) {
        const labelIndex = src.indexOf(label);
        if (labelIndex === -1) continue;
        firstIndex =
          firstIndex === -1 ? labelIndex : Math.min(firstIndex, labelIndex);
      }

      return firstIndex;
    },
    tokenize(src: string) {
      const match = src.match(MORE_BREAK_TOKENIZER_REGEX);
      if (!match) return undefined;

      return {
        type: "moreBreak",
        raw: match[0],
      };
    },
  };
}

export const MarkdownMoreBreak = Node.create({
  name: "moreBreak",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: "div[data-more-break]" }];
  },

  renderHTML() {
    return [
      "div",
      {
        "data-more-break": "",
        class: "tiptap-more-break",
      },
      "Read More ↓",
    ];
  },

  parseMarkdown: (_token, helpers) => helpers.createNode("moreBreak"),
  renderMarkdown: () => MORE_BREAK_MARKER,
  markdownTokenizer: createMoreBreakMarkdownToken(),
});

/**
 * Server-side schema for the `embed` node. Persisted attrs hold the resolved
 * iframe `src` so old posts keep rendering even if a provider entry is later
 * removed from the registry. `parseMarkdown` re-runs the provider lookup so
 * attrs stay fresh on every parse.
 */
export const MarkdownEmbedNode = Node.create({
  name: "embed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: { default: "" },
      provider: { default: "" },
      providerName: { default: "" },
      src: { default: "" },
      orientation: { default: "landscape" },
      heightPx: { default: null },
      sandbox: { default: "" },
      allow: { default: "" },
      caption: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-jant-node="embed"]',
        getAttrs(dom) {
          const element = dom as QueryableElement;
          const provider = element.getAttribute("data-provider") ?? "";
          const url =
            element.getAttribute("data-url") ??
            element.querySelector("a")?.getAttribute("href") ??
            "";
          return {
            url,
            provider,
            providerName: element.getAttribute("data-provider-name") ?? "",
            src: element.getAttribute("data-src") ?? "",
            orientation:
              element.getAttribute("data-orientation") ?? "landscape",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const attrs: Record<string, string> = {
      "data-jant-node": "embed",
    };
    if (node.attrs.provider)
      attrs["data-provider"] = String(node.attrs.provider);
    if (node.attrs.providerName)
      attrs["data-provider-name"] = String(node.attrs.providerName);
    if (node.attrs.url) attrs["data-url"] = String(node.attrs.url);
    if (node.attrs.src) attrs["data-src"] = String(node.attrs.src);
    if (node.attrs.orientation)
      attrs["data-orientation"] = String(node.attrs.orientation);
    return ["figure", attrs];
  },

  parseMarkdown: (token, helpers) => {
    const url = typeof token.url === "string" ? token.url : "";
    const tokenAttrs =
      token.attrs && typeof token.attrs === "object"
        ? (token.attrs as Record<string, string>)
        : {};
    return helpers.createNode("embed", {
      url,
      caption: tokenAttrs.caption ?? "",
    });
  },

  renderMarkdown: (node) => {
    const attrs = (node.attrs ?? {}) as Record<string, unknown>;
    const url = typeof attrs.url === "string" ? attrs.url.trim() : "";
    if (!url) return "";
    const lines = [url];
    const caption =
      typeof attrs.caption === "string" ? attrs.caption.trim() : "";
    if (caption) lines.push(`caption=${caption}`);
    return ["```jant-embed", ...lines, "```"].join("\n");
  },

  markdownTokenizer: createEmbedMarkdownToken(),
});

/**
 * Server-side schema for the `htmlBlock` node — author-trusted raw HTML.
 * Round-trips through markdown verbatim.
 */
export const MarkdownHtmlBlockNode = Node.create({
  name: "htmlBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      html: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-jant-node="html-block"]',
        getAttrs(dom) {
          const element = dom as QueryableElement;
          return {
            html: element.textContent ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    return [
      "div",
      { "data-jant-node": "html-block" },
      String(node.attrs.html ?? ""),
    ];
  },

  parseMarkdown: (token, helpers) => {
    const html = typeof token.html === "string" ? token.html : "";
    return helpers.createNode("htmlBlock", { html });
  },

  renderMarkdown: (node) => {
    const html =
      typeof node.attrs?.html === "string" ? (node.attrs.html as string) : "";
    return ["```jant-html", html, "```"].join("\n");
  },

  markdownTokenizer: createHtmlBlockMarkdownToken(),
});

function createFootnoteReferenceMarkdownToken() {
  return {
    name: "footnoteReference",
    level: "inline" as const,
    start(src: string) {
      return src.indexOf("[^");
    },
    tokenize(src: string) {
      const match = src.match(/^\[\^([^\]\n]+)\]/);
      const label = normalizeFootnoteLabel(match?.[1]);
      if (!match || !label) return undefined;

      return {
        type: "footnoteReference",
        raw: match[0],
        label,
      };
    },
  };
}

const INLINE_FOOTNOTE_CONTENT_ATTR = "__jantInlineFootnoteContent";

function parseInlineFootnoteSource(
  src: string,
): { content: string; raw: string } | null {
  if (!src.startsWith("^[")) return null;

  let bracketDepth = 1;
  let codeDelimiterLength = 0;

  for (let index = 2; index < src.length; index += 1) {
    const character = src[index];

    if (character === "\n" || character === "\r") return null;

    if (character === "\\" && codeDelimiterLength === 0) {
      index += 1;
      continue;
    }

    if (character === "`") {
      let delimiterLength = 1;
      while (src[index + delimiterLength] === "`") {
        delimiterLength += 1;
      }

      if (codeDelimiterLength === 0) {
        codeDelimiterLength = delimiterLength;
      } else if (codeDelimiterLength === delimiterLength) {
        codeDelimiterLength = 0;
      }

      index += delimiterLength - 1;
      continue;
    }

    if (codeDelimiterLength > 0) continue;

    if (character === "[") {
      bracketDepth += 1;
      continue;
    }

    if (character !== "]") continue;
    bracketDepth -= 1;
    if (bracketDepth !== 0) continue;

    const content = src.slice(2, index);
    if (!content.trim()) return null;

    return {
      content,
      raw: src.slice(0, index + 1),
    };
  }

  return null;
}

const MarkdownInlineFootnote = Extension.create({
  name: "inlineFootnote",

  parseMarkdown: (token, helpers) =>
    helpers.createNode("footnoteReference", {
      [INLINE_FOOTNOTE_CONTENT_ATTR]: Array.isArray(token.tokens)
        ? helpers.parseInline(token.tokens)
        : [],
    }),

  markdownTokenizer: {
    name: "inlineFootnote",
    level: "inline",
    start(src: string) {
      return src.indexOf("^[");
    },
    tokenize(src: string, _tokens: unknown[], helpers) {
      const inlineFootnote = parseInlineFootnoteSource(src);
      if (!inlineFootnote) return undefined;

      return {
        type: "inlineFootnote",
        raw: inlineFootnote.raw,
        tokens: helpers.inlineTokens(inlineFootnote.content),
      };
    },
  },
});

function normalizeFootnoteDataLabel(label: unknown): string {
  const normalized = normalizeFootnoteLabel(label);
  const legacyDisplayLabel = normalized.match(/^\[\^([^\]]+)\]:?$/)?.[1];
  return normalizeFootnoteLabel(legacyDisplayLabel ?? normalized);
}

export const MarkdownFootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      label: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "sup[data-footnote-reference]",
        getAttrs(dom) {
          const element = dom as QueryableElement;
          return {
            label: normalizeFootnoteDataLabel(
              element.getAttribute("data-footnote-label"),
            ),
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const label = normalizeFootnoteLabel(node.attrs.label);

    return [
      "sup",
      {
        "data-footnote-reference": "",
        "data-footnote-label": label,
        class: "tiptap-footnote-reference",
      },
      getFootnoteReferenceText(label),
    ];
  },

  parseMarkdown: (token, helpers) =>
    helpers.createNode("footnoteReference", {
      label: normalizeFootnoteLabel(token.label),
    }),

  renderMarkdown: (node) => getFootnoteReferenceText(node.attrs?.label),

  markdownTokenizer: createFootnoteReferenceMarkdownToken(),
});

export const MarkdownFootnoteDefinition = Node.create({
  name: "footnoteDefinition",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      label: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-footnote-definition]",
        getAttrs(dom) {
          const element = dom as QueryableElement;
          return {
            label: normalizeFootnoteDataLabel(
              element.getAttribute("data-footnote-label"),
            ),
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const label = normalizeFootnoteLabel(node.attrs.label);

    return [
      "div",
      {
        "data-footnote-definition": "",
        "data-footnote-label": label,
        class: "tiptap-footnote-definition",
      },
      0,
    ];
  },

  parseMarkdown: (token, helpers) => {
    const content =
      Array.isArray(token.tokens) &&
      typeof helpers.parseBlockChildren === "function"
        ? helpers.parseBlockChildren(token.tokens)
        : [];

    return helpers.createNode(
      "footnoteDefinition",
      {
        label: normalizeFootnoteLabel(token.label),
      },
      content.length > 0 ? content : [helpers.createNode("paragraph")],
    );
  },

  renderMarkdown: (node, helpers) => {
    const label = normalizeFootnoteLabel(node.attrs?.label);
    const content = Array.isArray(node.content) ? node.content : [];
    const labelText = getFootnoteDefinitionLabelText(label);

    if (content.length === 0) {
      return labelText;
    }

    const renderedBlocks = content.map((child, index) =>
      typeof helpers.renderChild === "function"
        ? helpers.renderChild(child, index)
        : "",
    );
    const simpleParagraph =
      content.length === 1 &&
      content[0]?.type === "paragraph" &&
      !renderedBlocks[0]?.includes("\n");

    if (simpleParagraph) {
      return renderedBlocks[0]
        ? `${labelText} ${renderedBlocks[0]}`
        : labelText;
    }

    const indentedBlocks = renderedBlocks
      .map((block) => indentFootnoteMarkdown(block))
      .join("\n\n");

    return `${labelText}\n${indentedBlocks}`;
  },

  markdownTokenizer: {
    name: "footnoteDefinition",
    level: "block",
    start(src: string) {
      return src.indexOf("[^");
    },
    tokenize(src: string, _tokens: unknown[], helpers) {
      const definition = parseFootnoteDefinition(src);
      if (!definition) return undefined;

      return {
        type: "footnoteDefinition",
        raw: definition.raw,
        label: definition.label,
        tokens: definition.contentMarkdown
          ? helpers.blockTokens(definition.contentMarkdown)
          : [],
      };
    },
  },
});

interface MarkdownContentExtensionOptions {
  imageExtension?: AnyExtension;
  moreBreakExtension?: AnyExtension;
  embedExtension?: AnyExtension;
  htmlBlockExtension?: AnyExtension;
}

export function createMarkdownContentExtensions(
  options: MarkdownContentExtensionOptions = {},
): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      codeBlock: false,
      trailingNode: { notAfter: ["footnoteDefinition"] },
    }),
    SemanticLink.configure({
      openOnClick: false,
      autolink: false,
      isAllowedUri: (url) => sanitizeRichTextHref(url) !== "",
    }),
    MarkdownCodeBlock,
    Table.configure({
      resizable: false,
      HTMLAttributes: { class: "tiptap-table" },
    }),
    TableRow,
    TableCell,
    TableHeader,
    MarkdownFigureImageSupport,
    options.imageExtension ?? MarkdownImageNode,
    options.moreBreakExtension ?? MarkdownMoreBreak,
    options.embedExtension ?? MarkdownEmbedNode,
    options.htmlBlockExtension ?? MarkdownHtmlBlockNode,
    MarkdownInlineFootnote,
    MarkdownFootnoteReference,
    MarkdownFootnoteDefinition,
  ];
}

function isJsonContent(value: unknown): value is JSONContent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function collectUsedFootnoteLabels(
  node: JSONContent,
  usedLabels: Set<string>,
): void {
  if (node.type === "footnoteReference" || node.type === "footnoteDefinition") {
    const label = normalizeFootnoteLabel(node.attrs?.label);
    if (label) usedLabels.add(getFootnoteLabelKey(label));
  }

  for (const child of node.content ?? []) {
    collectUsedFootnoteLabels(child, usedLabels);
  }
}

function expandInlineFootnotes(doc: JSONContent): JSONContent {
  if (doc.type !== "doc") return doc;

  const usedLabels = new Set<string>();
  collectUsedFootnoteLabels(doc, usedLabels);
  const definitions: JSONContent[] = [];
  let nextNumericLabel = 1;

  const allocateLabel = (): string => {
    while (usedLabels.has(getFootnoteLabelKey(String(nextNumericLabel)))) {
      nextNumericLabel += 1;
    }

    const label = String(nextNumericLabel);
    usedLabels.add(getFootnoteLabelKey(label));
    nextNumericLabel += 1;
    return label;
  };

  const expandNode = (node: JSONContent): JSONContent => {
    const inlineContent = node.attrs?.[INLINE_FOOTNOTE_CONTENT_ATTR];

    if (node.type === "footnoteReference" && Array.isArray(inlineContent)) {
      const label = allocateLabel();
      const attrs: Record<string, unknown> = { ...(node.attrs ?? {}), label };
      delete attrs[INLINE_FOOTNOTE_CONTENT_ATTR];
      const content = inlineContent
        .filter(isJsonContent)
        .map((child) => expandNode(normalizeMarkdownDocument(child)));

      definitions.push({
        type: "footnoteDefinition",
        attrs: { label },
        content: [
          content.length > 0
            ? { type: "paragraph", content }
            : { type: "paragraph" },
        ],
      });

      return { ...node, attrs };
    }

    return node.content
      ? { ...node, content: node.content.map(expandNode) }
      : node;
  };

  const expanded = expandNode(doc);
  if (definitions.length === 0) return expanded;

  return {
    ...expanded,
    content: [...(expanded.content ?? []), ...definitions],
  };
}

/**
 * Normalizes Markdown parser output before it enters the editor schema.
 *
 * @param node - Parsed Tiptap document or descendant node
 * @returns A normalized copy safe to load into an editor
 * @example
 * const normalized = normalizeMarkdownDocument(markdownManager.parse(source));
 */
export function normalizeMarkdownDocument(node: JSONContent): JSONContent {
  const normalized: JSONContent = { ...node };

  if (normalized.content) {
    normalized.content = normalized.content.map(normalizeMarkdownDocument);
  }

  if (normalized.marks) {
    normalized.marks = normalized.marks.map((mark) => {
      if (!mark || typeof mark !== "object") return mark;

      const nextMark = {
        ...mark,
        attrs:
          mark.type === "link"
            ? {
                ...(mark.attrs ?? {}),
                target:
                  typeof mark.attrs?.target === "string"
                    ? mark.attrs.target
                    : "_blank",
              }
            : mark.attrs,
      };

      if (
        nextMark.attrs &&
        Object.keys(nextMark.attrs as Record<string, unknown>).length === 0
      ) {
        delete nextMark.attrs;
      }

      return nextMark;
    });
  }

  if (normalized.attrs && typeof normalized.attrs === "object") {
    const attrs = { ...normalized.attrs };

    if (normalized.type === "codeBlock" && attrs.language == null) {
      delete attrs.language;
    }

    if (Object.keys(attrs).length > 0) {
      normalized.attrs = attrs;
    } else {
      delete normalized.attrs;
    }
  }

  if (
    normalized.type === "doc" &&
    (!normalized.content || normalized.content.length === 0)
  ) {
    normalized.content = [{ type: "paragraph" }];
  }

  if (normalized.type === "paragraph" && normalized.content) {
    const nextContent: JSONContent[] = [];

    for (let index = 0; index < normalized.content.length; index += 1) {
      const child = normalized.content[index];
      const nextChild = normalized.content[index + 1];

      if (
        child?.type === "text" &&
        typeof child.text === "string" &&
        nextChild?.type === "footnoteReference" &&
        /\n[ \t]*$/.test(child.text)
      ) {
        const trimmedText = child.text.replace(/\n[ \t]*$/, "");
        if (trimmedText) {
          nextContent.push({
            ...child,
            text: trimmedText,
          });
        }
        continue;
      }

      if (child) {
        nextContent.push(child);
      }
    }

    normalized.content = nextContent;
  }

  return normalized.type === "doc"
    ? expandInlineFootnotes(normalized)
    : normalized;
}

function expandCodeBlockFences(markdown: string): string {
  return markdown;
}

export function createMarkdownManager(
  extensions: Extensions = createMarkdownContentExtensions(),
): MarkdownManager {
  return new MarkdownManager({
    extensions,
    markedOptions: MARKDOWN_MARKED_OPTIONS,
  });
}

let sharedMarkdownManager: MarkdownManager | null = null;

export function getMarkdownManager(): MarkdownManager {
  sharedMarkdownManager ??= createMarkdownManager();
  return sharedMarkdownManager;
}

export function parseMarkdownDocument(markdown: string): JSONContent {
  return normalizeMarkdownDocument(getMarkdownManager().parse(markdown));
}

export function serializeMarkdownDocument(doc: JSONContent): string {
  return expandCodeBlockFences(
    getMarkdownManager().serialize(normalizeFootnoteArtifacts(doc)),
  );
}
