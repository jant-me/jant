// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { createMarkdownContentExtensions } from "../../../lib/markdown-manager.js";
import { LinkInputRules } from "../link-input-rules.js";

const editors: Editor[] = [];

function createEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);

  const editor = new Editor({
    element,
    extensions: [...createMarkdownContentExtensions(), LinkInputRules],
    content: "<p></p>",
  });

  editors.push(editor);
  return editor;
}

function type(editor: Editor, text: string): void {
  const view = editor.view;
  for (const character of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (handler) =>
      handler(view, from, to, character, () =>
        view.state.tr.insertText(character, from, to),
      ),
    );
    if (!handled) {
      view.dispatch(view.state.tr.insertText(character, from, to));
    }
  }
}

afterEach(() => {
  while (editors.length > 0) {
    editors.pop()?.destroy();
  }
  document.body.innerHTML = "";
});

describe("LinkInputRules", () => {
  it("converts a typed sms Markdown link into a link mark", () => {
    const editor = createEditor();

    type(editor, "[xxx](sms:xxxxx@xx.com)");

    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "xxx",
          marks: [
            {
              type: "link",
              attrs: {
                href: "sms:xxxxx@xx.com",
              },
            },
          ],
        },
      ],
    });
  });

  it.each(["tel:+15551234567", "sms:+15551234567"])(
    "auto-links a bare %s action URL",
    (href) => {
      const editor = createEditor();

      type(editor, `${href} `);

      expect(editor.getJSON().content?.[0]?.content?.[0]).toMatchObject({
        type: "text",
        text: href,
        marks: [
          {
            type: "link",
            attrs: { href },
          },
        ],
      });
    },
  );

  it("leaves executable Markdown links as typed text", () => {
    const editor = createEditor();

    type(editor, "[unsafe](javascript:alert(1))");

    expect(editor.state.doc.textContent).toBe("[unsafe](javascript:alert(1))");
    expect(JSON.stringify(editor.getJSON())).not.toContain('"type":"link"');
  });

  it("uses the same action-link policy for TipTap link commands", () => {
    const editor = createEditor();
    editor.commands.insertContent("Message");
    editor.commands.setTextSelection({ from: 1, to: 8 });

    expect(editor.commands.setLink({ href: "sms:xxxxx@xx.com" })).toBe(true);
    expect(editor.getJSON().content?.[0]?.content?.[0]).toMatchObject({
      marks: [
        {
          type: "link",
          attrs: { href: "sms:xxxxx@xx.com" },
        },
      ],
    });

    editor.commands.unsetLink();
    expect(editor.commands.setLink({ href: "javascript:alert(1)" })).toBe(
      false,
    );
    expect(JSON.stringify(editor.getJSON())).not.toContain("javascript:");
  });
});
