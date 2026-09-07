// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ImageNode } from "../image-node.js";
import {
  adoptPendingInlineImageUploads,
  rehostInlineImage,
  resolveInlineImageUrls,
  hasPendingInlineImagePlaceholders,
  uploadAndInsertInlineImage,
} from "../inline-image-upload.js";

const editors: Editor[] = [];

function createEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: false },
      }),
      ImageNode,
    ],
    content: "<p></p>",
  });
  editors.push(editor);
  return editor;
}

function imageSrcs(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") out.push(node.attrs.src as string);
  });
  return out;
}

function jsonImageSrcs(node: JSONContent | null): string[] {
  if (!node) return [];
  const out: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === "image" && typeof n.attrs?.src === "string") {
      out.push(n.attrs.src);
    }
    for (const child of n.content ?? []) walk(child);
  };
  walk(node);
  return out;
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("rehostInlineImage", () => {
  it("swaps the node src on a successful rehost", async () => {
    const editor = createEditor();
    const src = "https://ext.example/keep1.png";
    editor.commands.setImage({ src });

    await rehostInlineImage(
      editor,
      src,
      async () => "https://cdn.local/keep1.webp",
    );

    expect(imageSrcs(editor)).toEqual(["https://cdn.local/keep1.webp"]);
  });

  it("keeps a remote node's original src when the rehost fails", async () => {
    const editor = createEditor();
    const src = "https://ext.example/fail1.png";
    editor.commands.setImage({ src });

    await rehostInlineImage(editor, src, async () => {
      throw new Error("boom");
    });

    expect(imageSrcs(editor)).toEqual([src]);
  });

  it("replaces every node sharing a deduped remote src", async () => {
    const editor = createEditor();
    const src = "https://ext.example/dupe.png";
    editor.commands.setImage({ src });
    editor.commands.setImage({ src });

    await rehostInlineImage(
      editor,
      src,
      async () => "https://cdn.local/dupe.webp",
    );

    expect(imageSrcs(editor)).toEqual([
      "https://cdn.local/dupe.webp",
      "https://cdn.local/dupe.webp",
    ]);
  });
});

describe("resolveInlineImageUrls + hasPendingInlineImagePlaceholders", () => {
  it("tracks an in-flight rehost and resolves its placeholder to the stored URL", async () => {
    const editor = createEditor();
    const src = "https://ext.example/pending.png";
    editor.commands.setImage({ src });

    let release!: (url: string) => void;
    const deferred = new Promise<string>((resolve) => {
      release = resolve;
    });
    const rehostDone = rehostInlineImage(editor, src, () => deferred);

    const json = editor.getJSON();
    expect(hasPendingInlineImagePlaceholders(json)).toBe(true);

    const resolvePromise = resolveInlineImageUrls(json);
    release("https://cdn.local/pending.webp");
    const resolved = await resolvePromise;
    await rehostDone;

    expect(jsonImageSrcs(resolved)).toEqual(["https://cdn.local/pending.webp"]);
  });

  it("is a no-op for content with no pending placeholders", async () => {
    const json: JSONContent = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "https://cdn.local/already-stored.webp" },
        },
      ],
    };

    expect(hasPendingInlineImagePlaceholders(json)).toBe(false);
    const resolved = await resolveInlineImageUrls(json);
    expect(resolved).toBe(json);
  });
});

describe("adoptPendingInlineImageUploads", () => {
  it("hands an in-flight upload on through a second adoption", async () => {
    const first = createEditor();
    let finishUpload: (value: { url: string }) => void = () => {};
    const insert = uploadAndInsertInlineImage(
      first,
      new File(["image"], "shot.png", { type: "image/png" }),
      () =>
        new Promise((resolve) => {
          finishUpload = resolve;
        }),
    );
    expect(imageSrcs(first)[0]?.startsWith("blob:")).toBe(true);

    // Content can move more than once — fullscreen hands it to compose, and a
    // format switch then rebuilds compose's editor under it.
    const second = createEditor();
    second.commands.setContent(first.getJSON());
    adoptPendingInlineImageUploads(second);

    const third = createEditor();
    third.commands.setContent(second.getJSON());
    const adopted = adoptPendingInlineImageUploads(third);
    expect(adopted).toHaveLength(1);
    // Submitting from here still knows the image is on its way.
    expect(hasPendingInlineImagePlaceholders(third.getJSON())).toBe(true);

    finishUpload({ url: "https://cdn.test/shot.webp" });
    await insert;
    await Promise.all(adopted);

    expect(imageSrcs(third)).toEqual(["https://cdn.test/shot.webp"]);
  });
});
