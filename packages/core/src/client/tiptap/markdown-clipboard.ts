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
  normalizeMarkdownDocument,
  serializeMarkdownDocument,
} from "../../lib/markdown-manager.js";

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

          /**
           * When pasting from a code editor, discard the HTML and re-insert
           * the plain text so it flows through `clipboardTextParser` below
           * and gets parsed as markdown.
           */
          handlePaste: (view, event) => {
            const clipboardData = event.clipboardData;
            if (!clipboardData || typeof clipboardData.getData !== "function") {
              return false;
            }

            const html = clipboardData.getData("text/html");
            if (!html || !isCodeEditorHtml(html)) return false;

            const text = clipboardData.getData("text/plain").trim();
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
