import {
  Extension,
  Node,
  getSchema,
  type AnyExtension,
  type Extensions,
  type JSONContent,
} from "@tiptap/core";
import { Fragment, type Schema } from "@tiptap/pm/model";
import { MarkdownManager } from "@tiptap/markdown";
import CodeBlock from "@tiptap/extension-code-block";
import { OrderedList } from "@tiptap/extension-list";
import HardBreak from "@tiptap/extension-hard-break";
import Paragraph from "@tiptap/extension-paragraph";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Strike from "@tiptap/extension-strike";
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

const LINE_START_BLOCK_SYNTAX: ReadonlyArray<[RegExp, string]> = [
  // `1986. A good year`, `2) Second`: an ordered-list marker
  [/^([ \t]{0,3})(\d{1,9})([.)])(?=[ \t]|$)/, "$1$2\\$3"],
  // `- note`, `+ note`: a bullet-list marker (`*` is escaped inline already)
  [/^([ \t]{0,3})([-+])(?=[ \t]|$)/, "$1\\$2"],
  // `# note`: an ATX heading
  [/^([ \t]{0,3})(#{1,6})(?=[ \t]|$)/, "$1\\$2"],
  // `---`, `===`: a thematic break or a setext underline for the line above
  [/^([ \t]{0,3})([-=])(?=[-= \t]*$)/, "$1\\$2"],
];

/**
 * Backslash-escape block syntax that a paragraph line happens to open with.
 *
 * Text nodes only get inline escaping, so a paragraph reading `1. Pony`, or a
 * hard break followed by `- note`, came back from the Markdown as a list.
 *
 * @param markdown - A paragraph's rendered Markdown
 * @returns The same Markdown with each line's leading block syntax escaped
 * @example
 * escapeLineStartBlockSyntax("Update:  \n1. Pony"); // "Update:  \n1\\. Pony"
 */
function escapeLineStartBlockSyntax(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) =>
      LINE_START_BLOCK_SYNTAX.reduce(
        (escaped, [pattern, replacement]) =>
          escaped.replace(pattern, replacement),
        line,
      ),
    )
    .join("\n");
}

/** The HTML tag each emphasis mark falls back to. */
const HTML_EMPHASIS_TAGS = {
  bold: "strong",
  italic: "em",
  strike: "s",
} as const;

type EmphasisMarkType = keyof typeof HTML_EMPHASIS_TAGS;

const EMPHASIS_MARK_TYPES = Object.keys(
  HTML_EMPHASIS_TAGS,
) as EmphasisMarkType[];

/** Marks that write their own delimiter characters around the text. */
const DELIMITED_MARK_TYPES = new Set<string>([
  ...EMPHASIS_MARK_TYPES,
  "code",
  "link",
]);

/**
 * Serialization-only mark attribute: write this run with HTML tags. It is
 * set by `markEmphasisDelimiters` on a copy of the document and never stored.
 */
const HTML_EMPHASIS_ATTR = "markdownAsHtml";

type FlankingClass = "space" | "punctuation" | "other";

function classifyFlankingChar(char: string | undefined): FlankingClass {
  if (char === undefined || /\s/u.test(char)) return "space";
  return /[\p{P}\p{S}]/u.test(char) ? "punctuation" : "other";
}

function hasMark(node: JSONContent | undefined, type: string): boolean {
  return node?.marks?.some((mark) => mark.type === type) ?? false;
}

/**
 * Whether a `**`, `*`, or `~~` at one end of a run can open or close it.
 *
 * CommonMark's flanking rule, which GFM strikethrough shares: the character
 * on the text side must not be whitespace, and when it is punctuation, the
 * character on the outside must be whitespace or punctuation too. The rule is
 * symmetric, so one check covers the opening and the closing delimiter.
 *
 * @param nodes - The inline nodes of one block
 * @param index - The run's first node (`side: "start"`) or last (`"end"`)
 * @param side - Which end of the run
 * @param markType - The run's mark
 * @returns True when Markdown delimiters work at this end
 */
function delimiterFlanks(
  nodes: JSONContent[],
  index: number,
  side: "start" | "end",
  markType: string,
): boolean {
  const node = nodes[index];
  const neighbor = nodes[side === "start" ? index - 1 : index + 1];
  const chars = [...(node?.text ?? "")];
  const edge = side === "start" ? chars : chars.slice().reverse();
  const innerChar = edge.find((char) => !/\s/u.test(char));

  // Another mark opening or closing at the same edge writes its delimiter
  // between ours and the text; it counts as punctuation.
  const sharesEdge =
    node?.marks?.some(
      (mark) =>
        mark.type !== markType &&
        DELIMITED_MARK_TYPES.has(mark.type) &&
        !hasMark(neighbor, mark.type),
    ) ?? false;
  const inner = sharesEdge ? "punctuation" : classifyFlankingChar(innerChar);

  // The serializer moves whitespace at a run's edge outside the delimiter.
  let outer: FlankingClass;
  if (edge[0] !== undefined && /\s/u.test(edge[0])) outer = "space";
  else if (!neighbor || neighbor.type === "hardBreak") outer = "space";
  else if (neighbor.type === "text") {
    const neighborChars = [...(neighbor.text ?? "")];
    outer = classifyFlankingChar(
      side === "start" ? neighborChars.at(-1) : neighborChars[0],
    );
  } else outer = "punctuation"; // `![…](…)`, `[^1]`

  return inner !== "space" && (inner !== "punctuation" || outer !== "other");
}

function markEmphasisRuns(nodes: JSONContent[]): JSONContent[] {
  const result = nodes.map((node) => ({ ...node }));

  for (const markType of EMPHASIS_MARK_TYPES) {
    let start = 0;
    while (start < result.length) {
      if (result[start]?.type !== "text" || !hasMark(result[start], markType)) {
        start += 1;
        continue;
      }

      // The serializer closes marks around any non-text node, so a run is
      // consecutive text nodes.
      let end = start;
      while (
        result[end + 1]?.type === "text" &&
        hasMark(result[end + 1], markType)
      ) {
        end += 1;
      }

      if (
        !delimiterFlanks(result, start, "start", markType) ||
        !delimiterFlanks(result, end, "end", markType)
      ) {
        for (let index = start; index <= end; index += 1) {
          const node = result[index] as JSONContent;
          node.marks = node.marks?.map((mark) =>
            mark.type === markType
              ? {
                  ...mark,
                  attrs: { ...mark.attrs, [HTML_EMPHASIS_ATTR]: true },
                }
              : mark,
          );
        }
      }

      start = end + 1;
    }
  }

  return result;
}

/**
 * Flag the emphasis runs whose Markdown delimiters a CommonMark parser would
 * leave as literal characters, so they serialize as HTML tags instead.
 *
 * Chinese and Japanese put no space around punctuation, so `**说话。**来的人`
 * is common, and neither Hugo (goldmark) nor Jant's own parser reads the
 * closing `**` after `。` followed by `来`. `<strong>…</strong>` reads the
 * same in both, and the rest of the Markdown stays as it was.
 *
 * @param node - A TipTap document or descendant
 * @returns A copy with unflankable runs flagged
 * @example
 * markEmphasisDelimiters(doc); // bold "说话。" before "来" gets the flag
 */
function markEmphasisDelimiters(node: JSONContent): JSONContent {
  if (!node.content || node.type === "codeBlock") return node;

  const content = node.content.map(markEmphasisDelimiters);
  const hasInline = content.some(
    (child) => child.type === "text" || child.type === "hardBreak",
  );
  return { ...node, content: hasInline ? markEmphasisRuns(content) : content };
}

function renderEmphasis(
  node: JSONContent,
  content: string,
  markType: EmphasisMarkType,
  delimiter: string,
): string {
  if (!node.attrs?.[HTML_EMPHASIS_ATTR]) {
    return `${delimiter}${content}${delimiter}`;
  }
  const tag = HTML_EMPHASIS_TAGS[markType];
  return `<${tag}>${content}</${tag}>`;
}

const MarkdownBold = Bold.extend({
  renderMarkdown(node, helpers) {
    return renderEmphasis(node, helpers.renderChildren(node), "bold", "**");
  },
});

const MarkdownItalic = Italic.extend({
  renderMarkdown(node, helpers) {
    return renderEmphasis(node, helpers.renderChildren(node), "italic", "*");
  },
});

const MarkdownStrike = Strike.extend({
  renderMarkdown(node, helpers) {
    return renderEmphasis(node, helpers.renderChildren(node), "strike", "~~");
  },
});

/** Marked token for each HTML emphasis tag the parser accepts. */
const HTML_EMPHASIS_TOKEN_TYPES: Record<string, "strong" | "em" | "del"> = {
  strong: "strong",
  b: "strong",
  em: "em",
  i: "em",
  s: "del",
  del: "del",
};

const HTML_EMPHASIS_OPEN_PATTERN = /<(?:strong|b|em|i|s|del)>/i;
const HTML_EMPHASIS_PATTERN = /^<(strong|b|em|i|s|del)>([\s\S]*?)<\/\1>/i;

/**
 * Reads the HTML tags `markEmphasisDelimiters` writes back as marks.
 *
 * Only bare tags: `<strong onclick=…>` and every other tag stay text, as
 * inline HTML always has. The content between the tags is Markdown.
 */
const MarkdownHtmlEmphasis = Extension.create({
  name: "markdownHtmlEmphasis",

  markdownTokenizer: {
    name: "htmlEmphasis",
    level: "inline",
    start(src: string) {
      return src.search(HTML_EMPHASIS_OPEN_PATTERN);
    },
    tokenize(src: string, _tokens, helpers) {
      const match = HTML_EMPHASIS_PATTERN.exec(src);
      if (!match) return undefined;

      const [raw, tag = "", text = ""] = match;
      const type = HTML_EMPHASIS_TOKEN_TYPES[tag.toLowerCase()];
      if (!type) return undefined;
      return { type, raw, text, tokens: helpers.inlineTokens(text) };
    },
  },
});

/**
 * Hard breaks as two trailing spaces, except where that line would be blank.
 *
 * A break at the start of a paragraph, or right after another break, puts
 * the spaces on a line of their own. A line of spaces is blank in Markdown:
 * it ended the paragraph, and `-   ` left a list item empty with the text
 * after it outside the list. The backslash form keeps something on the line.
 */
const MarkdownHardBreak = HardBreak.extend({
  renderMarkdown(_node, _helpers, context) {
    const previous = context?.previousNode;
    return !previous || previous.type === "hardBreak" ? "\\\n" : "  \n";
  },
});

const renderParagraphMarkdown = Paragraph.config.renderMarkdown;

const MarkdownParagraph = Paragraph.extend({
  renderMarkdown(node, helpers, context) {
    const rendered =
      renderParagraphMarkdown?.call(this, node, helpers, context) ?? "";
    return escapeLineStartBlockSyntax(rendered);
  },
});

/**
 * Ordered lists with CommonMark markers: digits only.
 *
 * Tiptap's ordered list also reads letters and roman numerals as markers
 * (`a.`, `IV.`, anything of one or two letters), so a line such as
 * `PS. 补充一句` or `Mr. Smith went` became a list item and lost its first
 * word. Its tokenizer also measured a marker's width without the `.`, which
 * left one stray space on every line of a code block inside a list item.
 *
 * Jant's Markdown is CommonMark plus GFM (docs/internal/markdown-contract.md),
 * the same dialect Hugo reads in an export, so list tokenizing goes back to
 * marked: a tokenizer that never matches leaves the built-in one in charge,
 * and marked's list items go to `listItem` the way bullet lists' do. Tiptap's
 * plain-text paste plugin goes too; it applied the same markers, and the
 * editors already parse pasted plain text as Markdown (`MarkdownClipboard`).
 */
const CommonMarkOrderedList = OrderedList.extend({
  markdownTokenizer: {
    name: "orderedList",
    level: "block",
    start: () => -1,
    tokenize: () => undefined,
  },

  parseMarkdown: (token, helpers) => {
    if (token.type !== "list" || !token.ordered) return [];
    const start = typeof token.start === "number" ? token.start : 1;
    return {
      type: "orderedList",
      ...(start === 1 ? {} : { attrs: { start } }),
      content: token.items ? helpers.parseChildren(token.items) : [],
    };
  },

  addProseMirrorPlugins() {
    return [];
  },
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
      orderedList: false,
      paragraph: false,
      hardBreak: false,
      bold: false,
      italic: false,
      strike: false,
      trailingNode: { notAfter: ["footnoteDefinition"] },
    }),
    MarkdownParagraph,
    MarkdownHardBreak,
    MarkdownBold,
    MarkdownItalic,
    MarkdownStrike,
    MarkdownHtmlEmphasis,
    CommonMarkOrderedList,
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

let sharedContentSchema: Schema | null = null;

function getContentSchema(): Schema {
  sharedContentSchema ??= getSchema(createMarkdownContentExtensions());
  return sharedContentSchema;
}

/**
 * Fill in the children a node's schema requires but the document left out.
 *
 * A list item must hold a paragraph, a blockquote a block, a doc a block.
 * Documents that skipped one (an empty `1. ` item from an older Markdown
 * parser, or JSON posted through the API) made the Markdown serializer throw.
 * Each empty node that cannot be empty gets what `createAndFill` would give it.
 *
 * @param node - A TipTap document or descendant
 * @returns A copy whose empty required containers are filled
 * @example
 * fillRequiredContent({ type: "listItem", content: [] });
 * // { type: "listItem", content: [{ type: "paragraph" }] }
 */
export function fillRequiredContent(node: JSONContent): JSONContent {
  const nodeType = node.type ? getContentSchema().nodes[node.type] : undefined;
  if (!nodeType || nodeType.isLeaf) return node;

  const content = node.content?.map(fillRequiredContent);
  if ((content?.length ?? 0) === 0 && !nodeType.contentMatch.validEnd) {
    const filled = nodeType.contentMatch.fillBefore(Fragment.empty, true);
    if (filled) {
      return { ...node, content: filled.toJSON() as JSONContent[] };
    }
  }

  return content ? { ...node, content } : node;
}

export function parseMarkdownDocument(markdown: string): JSONContent {
  return fillRequiredContent(
    normalizeMarkdownDocument(getMarkdownManager().parse(markdown)),
  );
}

export function serializeMarkdownDocument(doc: JSONContent): string {
  return expandCodeBlockFences(
    getMarkdownManager().serialize(
      normalizeFootnoteArtifacts(
        markEmphasisDelimiters(fillRequiredContent(doc)),
      ),
    ),
  );
}
