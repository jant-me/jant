import { describe, it, expect } from "vitest";
import type { JSONContent } from "@tiptap/core";

import {
  convertComposeFormat,
  type ComposeConvertFields,
} from "../compose-format-convert.js";

const EMPTY: ComposeConvertFields = {
  title: "",
  url: "",
  quoteText: "",
  quoteAuthor: "",
  bodyJson: null,
};

function fields(
  overrides: Partial<ComposeConvertFields>,
): ComposeConvertFields {
  return { ...EMPTY, ...overrides };
}

function doc(...content: JSONContent[]): JSONContent {
  return { type: "doc", content };
}

function paragraph(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function linkParagraph(url: string, text = url): JSONContent {
  return {
    type: "paragraph",
    content: [
      { type: "text", text, marks: [{ type: "link", attrs: { href: url } }] },
    ],
  };
}

/** First block of the resulting body. */
function firstBlock(result: ComposeConvertFields): JSONContent | undefined {
  return result.bodyJson?.content?.[0];
}

describe("convertComposeFormat", () => {
  it("returns input unchanged when from === to", () => {
    const input = fields({ quoteText: "x" });
    expect(convertComposeFormat("quote", "quote", input)).toBe(input);
  });

  it("note → quote folds a title into a leading heading", () => {
    const result = convertComposeFormat(
      "note",
      "quote",
      fields({
        title: "My thoughts",
        bodyJson: doc(paragraph("body")),
      }),
    );
    expect(result.title).toBe("");
    expect(firstBlock(result)).toEqual({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "My thoughts" }],
    });
    expect(result.bodyJson?.content?.[1]).toEqual(paragraph("body"));
  });

  it("quote → note folds the quote into a leading blockquote with attribution", () => {
    const result = convertComposeFormat(
      "quote",
      "note",
      fields({ quoteText: "Stay hungry", quoteAuthor: "Jobs" }),
    );
    expect(result.quoteText).toBe("");
    expect(result.quoteAuthor).toBe("");
    const bq = firstBlock(result);
    expect(bq?.type).toBe("blockquote");
    expect(bq?.content?.[0]).toEqual(paragraph("Stay hungry"));
    expect(bq?.content?.[1]).toEqual(paragraph("— Jobs"));
  });

  it("quote → note links the author to the source url and clears url", () => {
    const result = convertComposeFormat(
      "quote",
      "note",
      fields({
        quoteText: "Be water",
        quoteAuthor: "Lee",
        url: "https://example.com",
      }),
    );
    expect(result.url).toBe("");
    const bq = firstBlock(result);
    expect(bq?.content?.[1]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "— " },
        {
          type: "text",
          text: "Lee",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        },
      ],
    });
  });

  it("quote → note with a url but no author links the url itself", () => {
    const result = convertComposeFormat(
      "quote",
      "note",
      fields({ quoteText: "Anon", url: "https://example.com" }),
    );
    const bq = firstBlock(result);
    expect(bq?.content?.[1]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "— " },
        {
          type: "text",
          text: "https://example.com",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        },
      ],
    });
  });

  it("note → quote recovers a url-only attribution without a phantom author", () => {
    const note = convertComposeFormat(
      "quote",
      "note",
      fields({ quoteText: "Anon", url: "https://example.com" }),
    );
    const back = convertComposeFormat("note", "quote", note);
    expect(back.quoteText).toBe("Anon");
    expect(back.quoteAuthor).toBe("");
    expect(back.url).toBe("https://example.com");
  });

  it("note → quote still parses the legacy plain-text attribution form", () => {
    const result = convertComposeFormat(
      "note",
      "quote",
      fields({
        bodyJson: doc({
          type: "blockquote",
          content: [
            paragraph("Be water"),
            paragraph("— Lee https://example.com"),
          ],
        }),
      }),
    );
    expect(result.quoteText).toBe("Be water");
    expect(result.quoteAuthor).toBe("Lee");
    expect(result.url).toBe("https://example.com");
  });

  it("quote → note → quote round-trips quote text and author", () => {
    const start = fields({ quoteText: "Stay hungry", quoteAuthor: "Jobs" });
    const note = convertComposeFormat("quote", "note", start);
    const back = convertComposeFormat("note", "quote", note);
    expect(back.quoteText).toBe("Stay hungry");
    expect(back.quoteAuthor).toBe("Jobs");
    expect(back.bodyJson).toBeNull();
  });

  it("quote → note → quote round-trips the source url too", () => {
    const start = fields({
      quoteText: "Be water",
      quoteAuthor: "Lee",
      url: "https://example.com",
    });
    const note = convertComposeFormat("quote", "note", start);
    const back = convertComposeFormat("note", "quote", note);
    expect(back.quoteText).toBe("Be water");
    expect(back.quoteAuthor).toBe("Lee");
    expect(back.url).toBe("https://example.com");
  });

  it("link → quote preserves the url and folds a title into a heading", () => {
    const result = convertComposeFormat(
      "link",
      "quote",
      fields({ title: "Cool link", url: "https://example.com" }),
    );
    expect(result.url).toBe("https://example.com");
    expect(result.title).toBe("");
    expect(firstBlock(result)?.type).toBe("heading");
    expect(result.quoteText).toBe("");
  });

  it("quote → link preserves the url and folds the quote, leaving no title", () => {
    const result = convertComposeFormat(
      "quote",
      "link",
      fields({
        quoteText: "Quoted",
        quoteAuthor: "Author",
        url: "https://example.com",
      }),
    );
    expect(result.url).toBe("https://example.com");
    expect(result.title).toBe("");
    expect(result.quoteText).toBe("");
    const bq = firstBlock(result);
    expect(bq?.type).toBe("blockquote");
    expect(bq?.content?.[1]).toEqual(paragraph("— Author"));
  });

  it("note → link preserves the title and leaves the url empty", () => {
    const result = convertComposeFormat(
      "note",
      "link",
      fields({
        title: "Keep me",
        bodyJson: doc(paragraph("body")),
      }),
    );
    expect(result.title).toBe("Keep me");
    expect(result.url).toBe("");
    expect(result.bodyJson).toEqual(doc(paragraph("body")));
  });

  it("link → note preserves the title and folds the url into a link paragraph", () => {
    const result = convertComposeFormat(
      "link",
      "note",
      fields({
        title: "Keep me",
        url: "https://example.com",
        bodyJson: doc(paragraph("body")),
      }),
    );
    expect(result.title).toBe("Keep me");
    expect(result.url).toBe("");
    expect(firstBlock(result)).toEqual({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "https://example.com",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        },
      ],
    });
  });

  it("note → link extracts a leading bare-link paragraph into the url", () => {
    const result = convertComposeFormat(
      "note",
      "link",
      fields({
        title: "T",
        bodyJson: doc(linkParagraph("https://example.com"), paragraph("body")),
      }),
    );
    expect(result.url).toBe("https://example.com");
    expect(result.bodyJson).toEqual(doc(paragraph("body")));
  });

  it("link → note → link round-trips the url, title, and body", () => {
    const start = fields({
      title: "Keep me",
      url: "https://example.com",
      bodyJson: doc(paragraph("body")),
    });
    const note = convertComposeFormat("link", "note", start);
    const back = convertComposeFormat("note", "link", note);
    expect(back.title).toBe("Keep me");
    expect(back.url).toBe("https://example.com");
    expect(back.bodyJson).toEqual(doc(paragraph("body")));
  });

  it("note → link leaves a labeled-link first line in the body", () => {
    const result = convertComposeFormat(
      "note",
      "link",
      fields({
        title: "T",
        bodyJson: doc(
          linkParagraph("https://example.com", "Read this"),
          paragraph("body"),
        ),
      }),
    );
    // A labeled link isn't a bare url — keep it in the body, leave url empty.
    expect(result.url).toBe("");
    expect(result.bodyJson).toEqual(
      doc(linkParagraph("https://example.com", "Read this"), paragraph("body")),
    );
  });

  it("note → quote with an empty body and no fields yields a null body", () => {
    const result = convertComposeFormat("note", "quote", fields({}));
    expect(result.bodyJson).toBeNull();
    expect(result.quoteText).toBe("");
    expect(result.title).toBe("");
  });

  it("note → quote extracts a body that is only a blockquote, leaving the body null", () => {
    const result = convertComposeFormat(
      "note",
      "quote",
      fields({
        bodyJson: doc({
          type: "blockquote",
          content: [paragraph("Quoted line")],
        }),
      }),
    );
    expect(result.quoteText).toBe("Quoted line");
    expect(result.bodyJson).toBeNull();
  });

  it("treats a non-attribution last line as part of the quote text", () => {
    const result = convertComposeFormat(
      "note",
      "quote",
      fields({
        bodyJson: doc({
          type: "blockquote",
          content: [paragraph("Line one"), paragraph("Line two")],
        }),
      }),
    );
    expect(result.quoteText).toBe("Line one\nLine two");
    expect(result.quoteAuthor).toBe("");
  });

  it("does not mutate the input bodyJson", () => {
    const bodyJson = doc(paragraph("body"));
    const snapshot = JSON.stringify(bodyJson);
    convertComposeFormat("quote", "note", fields({ quoteText: "q", bodyJson }));
    expect(JSON.stringify(bodyJson)).toBe(snapshot);
  });
});
