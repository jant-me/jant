import { Extension, InputRule } from "@tiptap/core";
import { sanitizeRichTextHref } from "../../lib/url.js";

// The URL group uses [^()\s] (single char) instead of [^()\s]+ to avoid
// catastrophic backtracking from nested quantifiers when the regex fails
// to match (e.g. "[text](url) " — trailing space makes \)$ fail and the
// engine explores 2^n partitions of the URL characters).
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/;
const MARKDOWN_LINK_INPUT_REGEX = new RegExp(
  MARKDOWN_LINK_PATTERN.source + "$",
);
// Space-triggered variant: fires when user types a space after a pasted or
// pre-existing markdown link that the primary rule missed (because the
// closing ")" wasn't typed — e.g. the whole text was pasted).
const MARKDOWN_LINK_SPACE_REGEX = new RegExp(
  MARKDOWN_LINK_PATTERN.source + "\\s$",
);
const BARE_URL_INPUT_REGEX = /((?:https?:\/\/|mailto:|tel:|sms:)[^\s<]+)\s$/i;

export const LinkInputRules = Extension.create({
  name: "linkInputRules",

  addInputRules() {
    const linkType = this.editor.schema.marks.link;

    if (!linkType) return [];

    function handleMarkdownLink(
      state: Parameters<
        ConstructorParameters<typeof InputRule>[0]["handler"]
      >[0]["state"],
      range: Parameters<
        ConstructorParameters<typeof InputRule>[0]["handler"]
      >[0]["range"],
      match: RegExpMatchArray,
      trailingChar: string,
    ) {
      const label = match[1]?.trim();
      const href = sanitizeRichTextHref(match[2] ?? "");

      if (!label || !href) {
        return null;
      }

      const text = trailingChar ? label + trailingChar : label;
      state.tr.insertText(text, range.from, range.to);
      state.tr.addMark(
        range.from,
        range.from + label.length,
        linkType.create({ href }),
      );
      state.tr.removeStoredMark(linkType);
    }

    return [
      new InputRule({
        find: BARE_URL_INPUT_REGEX,
        handler: ({ state, range, match }) => {
          const href = sanitizeRichTextHref(match[1] ?? "");

          if (!href) {
            return null;
          }

          const textEnd = range.from + href.length;
          if (state.doc.rangeHasMark(range.from, textEnd, linkType)) {
            return null;
          }

          state.tr.addMark(range.from, textEnd, linkType.create({ href }));
          state.tr.removeStoredMark(linkType);
        },
      }),
      new InputRule({
        find: MARKDOWN_LINK_INPUT_REGEX,
        handler: ({ state, range, match }) => {
          handleMarkdownLink(state, range, match, "");
        },
      }),
      // Space after a markdown link — handles pasted [label](url) text
      // where the closing ")" wasn't typed so the primary rule didn't fire.
      new InputRule({
        find: MARKDOWN_LINK_SPACE_REGEX,
        handler: ({ state, range, match }) => {
          handleMarkdownLink(state, range, match, " ");
        },
      }),
    ];
  },
});
