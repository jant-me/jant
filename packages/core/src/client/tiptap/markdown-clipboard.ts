import {
  createNodeFromContent,
  Extension,
  getTextBetween,
  getTextSerializersFromSchema,
  type Editor,
} from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { AllSelection, Plugin } from "@tiptap/pm/state";
import {
  getFootnoteLabelKey,
  getFootnoteReferenceText,
  normalizeFootnoteLabel,
} from "../../lib/footnotes.js";
import {
  normalizeMarkdownDocument,
  serializeMarkdownDocument,
} from "../../lib/markdown-manager.js";

const OBSIDIAN_CLIPBOARD_MARKER = /<!--\s*obsidian\s*-->/i;
const FOOTNOTE_CONTAINER_SELECTOR =
  'section.footnotes, [data-footnotes], [role~="doc-endnotes"]';
const FOOTNOTE_BACKLINK_SELECTOR =
  'a.footnote-backref, a.footnote-back, a[data-footnote-backref], a[role~="doc-backlink"]';

interface HtmlFootnoteDefinition {
  container: globalThis.Element | null;
  element: globalThis.Element;
  label: string;
  targetId: string;
}

function toFragment(
  content: ReturnType<typeof createNodeFromContent>,
): Fragment {
  return content instanceof Fragment ? content : content.content;
}

function selectionCoversDocument(editor: Editor): boolean {
  const { doc, selection } = editor.state;

  return (
    selection instanceof AllSelection ||
    (selection.from === 0 && selection.to === doc.content.size)
  );
}

function serializeReadableSelection(editor: Editor): string {
  const { doc, schema, selection } = editor.state;
  const textSerializers = getTextSerializersFromSchema(schema);
  const sortedRanges = [...selection.ranges].sort(
    (left, right) => left.$from.pos - right.$from.pos,
  );

  return sortedRanges
    .map(({ $from, $to }) =>
      getTextBetween(
        doc,
        { from: $from.pos, to: $to.pos },
        { textSerializers },
      ),
    )
    .join("\n\n");
}

/**
 * Serializes clipboard plain text without changing the editor document.
 *
 * A complete document selection expresses an export-like intent, so it uses
 * Jant's canonical Markdown contract. Partial selections retain Tiptap's
 * readable plain-text behavior; rich HTML is serialized separately by
 * ProseMirror and is unaffected by this hook.
 *
 * @param editor - Active Tiptap editor
 * @returns Text to write to the clipboard's `text/plain` flavor
 */
function serializeClipboardText(editor: Editor): string {
  if (selectionCoversDocument(editor)) {
    return serializeMarkdownDocument(editor.getJSON()).trimEnd();
  }

  return serializeReadableSelection(editor);
}

/**
 * Detects whether pasted HTML originates from a code editor (VS Code,
 * JetBrains, etc.) rather than a rich-text source. These editors copy
 * syntax-highlighted HTML wrapped in `<pre>` / `<code>` blocks, which
 * ProseMirror would otherwise insert as a code block — losing the
 * markdown structure the user intended to paste.
 *
 * @param html - The `text/html` string from the clipboard
 * @returns `true` when the HTML looks like code-editor output
 */
export function isCodeEditorHtml(html: string): boolean {
  // VS Code / Cursor: often include a `data-vscode-` prefixed attribute.
  if (/data-vscode-/i.test(html)) return true;

  // Generic code-editor detection: a top-level <div> or <pre> whose inline
  // style combines a monospace font-family with white-space: pre — the
  // hallmark of syntax-highlighted editor output. Normal rich-text sources
  // (Notion, Google Docs, browsers) never produce this combination.
  const outerStyleMatch = html.match(
    /^[^<]*(?:<(?:meta|html|head|body)\b[^>]*>\s*)*<(?:div|pre)\b[^>]*style="([^"]*)"/i,
  );
  if (outerStyleMatch) {
    const style = outerStyleMatch[1] ?? "";
    const hasMonospace =
      /font-family:[^;"]*\b(?:monospace|Menlo|Monaco|Consolas|Courier|JetBrains Mono|Fira Code|Source Code Pro)\b/i.test(
        style,
      );
    const hasWhitespacePre = /white-space:\s*pre\b/i.test(style);
    if (hasMonospace && hasWhitespacePre) return true;
  }

  return false;
}

/**
 * Detects the marker emitted by Obsidian 1.12+ for editor-authored HTML.
 *
 * Obsidian writes the original Markdown to `text/plain` and `text/markdown`,
 * while this comment marks the rendered `text/html` flavor. The marker can be
 * preceded by browser- or OS-inserted metadata, so detection is not anchored.
 *
 * @param html - Clipboard HTML
 * @returns Whether the HTML carries Obsidian's editor clipboard marker
 */
export function isObsidianHtml(html: string): boolean {
  return OBSIDIAN_CLIPBOARD_MARKER.test(html);
}

function isBareObsidianSpacer(element: globalThis.Element): boolean {
  return (
    element.tagName === "P" &&
    element.attributes.length === 0 &&
    Array.from(element.childNodes).every(
      (child) =>
        child.nodeType === globalThis.Node.TEXT_NODE &&
        /^[\t\n\f\r ]*$/.test(child.textContent ?? ""),
    )
  );
}

function isClipboardMetadataElement(element: globalThis.Element): boolean {
  return element.matches("meta, link, style, title");
}

/**
 * Removes bare top-level spacer paragraphs emitted by Obsidian's HTML flavor.
 *
 * Markdown blank lines separate blocks; they are not authored empty
 * paragraphs. Obsidian's clipboard HTML can materialize those separators as
 * bare `<p></p>` siblings, which ProseMirror would otherwise preserve. The
 * cleanup is deliberately marker-gated and narrow: attributed, nested,
 * media-bearing, `<br>`, non-breaking-space, and edge paragraphs are retained.
 *
 * @param html - Clipboard HTML fragment
 * @returns Normalized HTML, or the original string when no artifact was found
 */
export function normalizeObsidianClipboardArtifacts(html: string): string {
  if (
    !html.trim() ||
    !isObsidianHtml(html) ||
    typeof document === "undefined"
  ) {
    return html;
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  const elements = Array.from(template.content.children);
  const spacers = new Set(elements.filter(isBareObsidianSpacer));
  if (spacers.size === 0) return html;

  const contentElements = elements.filter(
    (element) => !spacers.has(element) && !isClipboardMetadataElement(element),
  );
  const contentIndexes = contentElements.map((element) =>
    elements.indexOf(element),
  );
  let changed = false;

  for (const spacer of spacers) {
    const index = elements.indexOf(spacer);
    const hasContentBefore = contentIndexes.some(
      (contentIndex) => contentIndex < index,
    );
    const hasContentAfter = contentIndexes.some(
      (contentIndex) => contentIndex > index,
    );

    if (hasContentBefore && hasContentAfter) {
      spacer.remove();
      changed = true;
    }
  }

  return changed ? template.innerHTML : html;
}

function getMarkdownClipboardText(clipboardData: DataTransfer): string | null {
  const html = clipboardData.getData("text/html");
  const markdown = clipboardData.getData("text/markdown");
  if (markdown.trim()) return markdown;

  const plain = clipboardData.getData("text/plain");
  if (!plain.trim()) return null;

  return isObsidianHtml(html) || isCodeEditorHtml(html) ? plain : null;
}

function hasRole(element: globalThis.Element, role: string): boolean {
  return (element.getAttribute("role") ?? "").split(/\s+/).includes(role);
}

function getHashTarget(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute("href") ?? "";
  if (!href.startsWith("#") || href.length === 1) return null;

  const target = href.slice(1);
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

function getDefinitionTargetId(element: globalThis.Element): string {
  return (
    element.getAttribute("id") ?? element.getAttribute("data-footnote-id") ?? ""
  );
}

function isNestedList(
  list: globalThis.Element,
  container: globalThis.Element,
): boolean {
  let ancestor = list.parentElement;

  while (ancestor && ancestor !== container) {
    if (ancestor.tagName === "LI") return true;
    ancestor = ancestor.parentElement;
  }

  return false;
}

function collectContainerDefinitionElements(
  container: globalThis.Element,
): globalThis.Element[] {
  const definitions: globalThis.Element[] = [];

  for (const list of container.querySelectorAll("ol, ul")) {
    if (
      list.closest(FOOTNOTE_CONTAINER_SELECTOR) !== container ||
      isNestedList(list, container)
    ) {
      continue;
    }

    for (const child of list.children) {
      if (child.tagName === "LI") definitions.push(child);
    }
  }

  return definitions;
}

function isFootnoteReferenceAnchor(anchor: HTMLAnchorElement): boolean {
  if (anchor.matches(FOOTNOTE_BACKLINK_SELECTOR)) return false;

  return (
    anchor.hasAttribute("data-footnote-ref") ||
    anchor.classList.contains("footnote-ref") ||
    hasRole(anchor, "doc-noteref") ||
    anchor.closest("sup.footnote-ref") !== null
  );
}

function deriveLabelFromReference(anchor: HTMLAnchorElement): string {
  const sourceLabel =
    anchor.getAttribute("data-footref") ??
    anchor.getAttribute("data-footnote-label");
  if (normalizeFootnoteLabel(sourceLabel)) {
    return normalizeFootnoteLabel(sourceLabel);
  }

  return normalizeFootnoteLabel(anchor.textContent)
    .replace(/^\[\^?/, "")
    .replace(/\]$/, "");
}

function deriveLabelFromTargetId(targetId: string): string {
  const footnoteSuffix = targetId.match(/(?:^|[-_:])fn[-_:]?(.+)$/i)?.[1];
  return normalizeFootnoteLabel(footnoteSuffix ?? targetId);
}

function allocateUniqueFootnoteLabel(
  candidate: string,
  fallbackIndex: number,
  usedLabels: Set<string>,
): string {
  const base = normalizeFootnoteLabel(candidate) || String(fallbackIndex + 1);
  let label = base;
  let suffix = 2;

  while (usedLabels.has(getFootnoteLabelKey(label))) {
    label = `${base}-${suffix}`;
    suffix += 1;
  }

  usedLabels.add(getFootnoteLabelKey(label));
  return label;
}

function createCanonicalFootnoteReference(
  ownerDocument: globalThis.Document,
  label: string,
): HTMLElement {
  const reference = ownerDocument.createElement("sup");
  reference.setAttribute("data-footnote-reference", "");
  reference.setAttribute("data-footnote-label", label);
  reference.className = "tiptap-footnote-reference";
  reference.textContent = getFootnoteReferenceText(label);
  return reference;
}

function createCanonicalFootnoteDefinition(
  definition: HtmlFootnoteDefinition,
): HTMLElement {
  const ownerDocument = definition.element.ownerDocument;
  const source = definition.element.cloneNode(true) as globalThis.Element;

  for (const backlink of source.querySelectorAll(FOOTNOTE_BACKLINK_SELECTOR)) {
    backlink.remove();
  }

  for (const wrapper of Array.from(
    source.querySelectorAll("p, span"),
  ).reverse()) {
    if (
      !wrapper.textContent?.trim() &&
      !wrapper.querySelector(
        "img, video, audio, iframe, svg, math, br, hr, input, table",
      )
    ) {
      wrapper.remove();
    }
  }

  const canonical = ownerDocument.createElement("div");
  canonical.setAttribute("data-footnote-definition", "");
  canonical.setAttribute("data-footnote-label", definition.label);
  canonical.className = "tiptap-footnote-definition";

  while (source.firstChild) {
    canonical.appendChild(source.firstChild);
  }

  if (!canonical.hasChildNodes()) {
    canonical.appendChild(ownerDocument.createElement("p"));
  }

  return canonical;
}

/**
 * Normalizes common rendered-footnote HTML into Jant's structural editor DOM.
 *
 * Supported inputs include Obsidian/markdown-it (`.footnote-ref` and
 * `.footnotes`), GitHub/unified (`data-footnote-*`), and DPUB-ARIA
 * (`doc-noteref`, `doc-footnote`, and `doc-endnotes`). Conversion requires a
 * recognized definition container or role, so ordinary superscript links and
 * ordered lists are left untouched.
 *
 * @param html - Clipboard HTML fragment
 * @returns The normalized fragment, or the original string when no footnotes
 *   were recognized
 */
export function normalizePastedFootnoteHtml(html: string): string {
  if (!html.trim() || typeof document === "undefined") return html;

  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  const containers = Array.from(
    root.querySelectorAll(FOOTNOTE_CONTAINER_SELECTOR),
  ).filter(
    (container) =>
      !container.parentElement?.closest(FOOTNOTE_CONTAINER_SELECTOR),
  );
  const containerDefinitions = new Map<
    globalThis.Element,
    globalThis.Element[]
  >();
  const rawDefinitions: Array<{
    container: globalThis.Element | null;
    element: globalThis.Element;
    targetId: string;
  }> = [];

  for (const container of containers) {
    const elements = collectContainerDefinitionElements(container);
    if (elements.length === 0) continue;

    containerDefinitions.set(container, elements);
    for (const element of elements) {
      rawDefinitions.push({
        container,
        element,
        targetId: getDefinitionTargetId(element),
      });
    }
  }

  for (const element of root.querySelectorAll('[role~="doc-footnote"]')) {
    if (element.closest(FOOTNOTE_CONTAINER_SELECTOR)) continue;
    rawDefinitions.push({
      container: null,
      element,
      targetId: getDefinitionTargetId(element),
    });
  }

  if (rawDefinitions.length === 0) return html;

  const definitionsByTarget = new Map<
    string,
    (typeof rawDefinitions)[number]
  >();
  for (const definition of rawDefinitions) {
    if (definition.targetId && !definitionsByTarget.has(definition.targetId)) {
      definitionsByTarget.set(definition.targetId, definition);
    }
  }

  const referencesByTarget = new Map<string, HTMLAnchorElement[]>();
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (!isFootnoteReferenceAnchor(anchor)) continue;
    const targetId = getHashTarget(anchor);
    if (!targetId || !definitionsByTarget.has(targetId)) continue;

    const references = referencesByTarget.get(targetId) ?? [];
    references.push(anchor);
    referencesByTarget.set(targetId, references);
  }

  const usedLabels = new Set<string>();
  const definitions: HtmlFootnoteDefinition[] = rawDefinitions.map(
    (definition, index) => {
      const reference = definition.targetId
        ? referencesByTarget.get(definition.targetId)?.[0]
        : undefined;
      const candidate = reference
        ? deriveLabelFromReference(reference)
        : deriveLabelFromTargetId(definition.targetId);

      return {
        ...definition,
        label: allocateUniqueFootnoteLabel(candidate, index, usedLabels),
      };
    },
  );
  const labelsByTarget = new Map(
    definitions
      .filter((definition) => definition.targetId)
      .map((definition) => [definition.targetId, definition.label] as const),
  );

  let changed = false;
  for (const [targetId, anchors] of referencesByTarget) {
    const label = labelsByTarget.get(targetId);
    if (!label) continue;

    for (const anchor of anchors) {
      const wrapper = anchor.closest("sup");
      const replaceTarget = wrapper?.contains(anchor) ? wrapper : anchor;
      if (!replaceTarget.parentNode) continue;

      replaceTarget.replaceWith(
        createCanonicalFootnoteReference(anchor.ownerDocument, label),
      );
      changed = true;
    }
  }

  const normalizedByElement = new Map(
    definitions.map(
      (definition) =>
        [
          definition.element,
          createCanonicalFootnoteDefinition(definition),
        ] as const,
    ),
  );

  for (const [container, elements] of containerDefinitions) {
    if (!container.parentNode) continue;

    const replacement = container.ownerDocument.createDocumentFragment();
    for (const element of elements) {
      const definition = normalizedByElement.get(element);
      if (definition) replacement.appendChild(definition);
    }

    const separator = container.previousElementSibling;
    if (separator?.matches("hr.footnotes-sep, hr[data-footnotes-separator]")) {
      separator.remove();
    }

    container.replaceWith(replacement);
    changed = true;
  }

  for (const definition of definitions) {
    if (definition.container || !definition.element.parentNode) continue;
    const normalized = normalizedByElement.get(definition.element);
    if (!normalized) continue;

    definition.element.replaceWith(normalized);
    changed = true;
  }

  return changed ? template.innerHTML : html;
}

function normalizePastedHtml(html: string): string {
  return normalizePastedFootnoteHtml(normalizeObsidianClipboardArtifacts(html));
}

export const MarkdownClipboard = Extension.create({
  name: "markdownClipboard",

  // Run before Tiptap's built-in plain-text serializer. Paste handling is also
  // intentionally resolved before generic clipboard parsing.
  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          clipboardTextSerializer: () => serializeClipboardText(this.editor),

          transformPastedHTML: normalizePastedHtml,

          /**
           * Prefer an explicit Markdown flavor. Marked Obsidian and detected
           * code-editor HTML use their plain flavor as Markdown; other rich-text
           * producers keep the normal HTML path.
           */
          handlePaste: (view, event) => {
            const clipboardData = event.clipboardData;
            if (!clipboardData || typeof clipboardData.getData !== "function") {
              return false;
            }

            const text = getMarkdownClipboardText(clipboardData);
            if (!text || !this.editor.markdown) return false;

            const parsed = normalizeMarkdownDocument(
              this.editor.markdown.parse(text),
            );
            if (parsed.type !== "doc" || !parsed.content) return false;

            const content = createNodeFromContent(parsed, view.state.schema, {
              slice: false,
            });
            const slice = Slice.maxOpen(toFragment(content));

            event.preventDefault();
            view.dispatch(
              view.state.tr.replaceSelection(slice).scrollIntoView(),
            );
            return true;
          },

          clipboardTextParser: (text, _context, _plainText, view) => {
            if (!text.trim() || !this.editor.markdown) {
              return Slice.empty;
            }

            const parsed = normalizeMarkdownDocument(
              this.editor.markdown.parse(text),
            );
            if (parsed.type !== "doc" || !parsed.content) {
              return Slice.empty;
            }

            if (
              parsed.content.length === 1 &&
              parsed.content[0]?.type === "paragraph"
            ) {
              const paragraph = parsed.content[0];
              if (!paragraph?.content) {
                return Slice.empty;
              }

              const content = createNodeFromContent(
                paragraph.content,
                view.state.schema,
                {
                  slice: true,
                },
              );

              return Slice.maxOpen(toFragment(content));
            }

            const content = createNodeFromContent(parsed, view.state.schema, {
              slice: false,
            });

            return Slice.maxOpen(toFragment(content));
          },
        },
      }),
    ];
  },
});
