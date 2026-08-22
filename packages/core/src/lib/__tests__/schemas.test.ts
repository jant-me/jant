import { describe, it, expect } from "vitest";
import { createEntityId } from "../ids.js";
import {
  FormatSchema,
  StatusSchema,
  RedirectTypeSchema,
  CreateCollectionSchema,
  CreatePostSchema,
  CreatePostApiSchema,
  UpdatePostSchema,
  UpdatePostApiSchema,
  SetupSchema,
  SigninSchema,
  UpdateSiteSettingsSchema,
  normalizeEmail,
  parseFormData,
  PostFilterSelectionSchema,
  parseFormDataOptional,
  validateAttachmentCount,
} from "../schemas.js";
import { z } from "zod";
import {
  FORMATS,
  STATUSES,
  MAX_MEDIA_ATTACHMENTS,
  MAX_COLLECTION_SLUG_LENGTH,
  MAX_COLLECTION_TITLE_LENGTH,
  MAX_SITE_FOOTER_LENGTH,
} from "../../types.js";

describe("FormatSchema", () => {
  it("accepts all valid formats", () => {
    for (const format of FORMATS) {
      expect(FormatSchema.parse(format)).toBe(format);
    }
  });

  it("rejects invalid formats", () => {
    expect(() => FormatSchema.parse("invalid")).toThrow();
    expect(() => FormatSchema.parse("")).toThrow();
    expect(() => FormatSchema.parse(123)).toThrow();
  });
});

describe("StatusSchema", () => {
  it("accepts all valid statuses", () => {
    for (const status of STATUSES) {
      expect(StatusSchema.parse(status)).toBe(status);
    }
  });

  it("rejects invalid statuses", () => {
    expect(() => StatusSchema.parse("public")).toThrow();
    expect(() => StatusSchema.parse("private")).toThrow();
  });
});

describe("RedirectTypeSchema", () => {
  it("accepts 301 and 302 as strings", () => {
    expect(RedirectTypeSchema.parse("301")).toBe("301");
    expect(RedirectTypeSchema.parse("302")).toBe("302");
  });

  it("rejects other values", () => {
    expect(() => RedirectTypeSchema.parse("200")).toThrow();
    expect(() => RedirectTypeSchema.parse("404")).toThrow();
    expect(() => RedirectTypeSchema.parse(301)).toThrow();
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases email addresses", () => {
    expect(normalizeEmail("  User.Name+tag@Example.COM ")).toBe(
      "user.name+tag@example.com",
    );
  });
});

describe("SetupSchema", () => {
  it("normalizes email before returning parsed data", () => {
    const result = SetupSchema.parse({
      siteName: "Jant",
      email: "  Admin@Example.COM ",
      password: "password123",
    });

    expect(result.email).toBe("admin@example.com");
  });
});

describe("SigninSchema", () => {
  it("normalizes email before returning parsed data", () => {
    const result = SigninSchema.parse({
      email: "  Admin@Example.COM ",
      password: "password123",
    });

    expect(result.email).toBe("admin@example.com");
  });

  it("rejects invalid email after normalization", () => {
    expect(() =>
      SigninSchema.parse({
        email: "  not-an-email  ",
        password: "password123",
      }),
    ).toThrow();
  });
});

describe("CreateCollectionSchema", () => {
  it("accepts a valid collection payload", () => {
    const result = CreateCollectionSchema.parse({
      slug: "reading-notes",
      title: "Reading Notes",
      description: "Lines worth keeping.",
    });

    expect(result).toEqual({
      slug: "reading-notes",
      title: "Reading Notes",
      description: "Lines worth keeping.",
    });
  });

  it("rejects slugs longer than the maximum length", () => {
    expect(() =>
      CreateCollectionSchema.parse({
        slug: "a".repeat(MAX_COLLECTION_SLUG_LENGTH + 1),
        title: "Too Long",
      }),
    ).toThrow();
  });

  it("rejects titles longer than the maximum length", () => {
    expect(() =>
      CreateCollectionSchema.parse({
        slug: "reading-notes",
        title: "a".repeat(MAX_COLLECTION_TITLE_LENGTH + 1),
      }),
    ).toThrow();
  });

  it("rejects plus-delimited aggregate syntax as a collection slug", () => {
    expect(() =>
      CreateCollectionSchema.parse({
        slug: "smart+movies",
        title: "Smart Movies",
      }),
    ).toThrow("Use lowercase letters, numbers, and hyphens only.");
  });

  it("rejects top-level reserved collection slugs", () => {
    expect(() =>
      CreateCollectionSchema.parse({
        slug: "collections",
        title: "Collections",
      }),
    ).toThrow("This link is reserved. Choose something else.");
  });
});

describe("UpdateSiteSettingsSchema", () => {
  it("trims and preserves valid site settings values", () => {
    const result = UpdateSiteSettingsSchema.parse({
      siteName: "  My Blog  ",
      siteDescription: "  Notes and links  ",
      siteFooter: "  [RSS](/feed)  ",
    });

    expect(result).toEqual({
      siteName: "My Blog",
      siteDescription: "Notes and links",
      siteFooter: "[RSS](/feed)",
    });
  });

  it("rejects site footer values beyond the maximum length", () => {
    expect(() =>
      UpdateSiteSettingsSchema.parse({
        siteName: "My Blog",
        siteDescription: "",
        siteFooter: "x".repeat(MAX_SITE_FOOTER_LENGTH + 1),
      }),
    ).toThrow();
  });
});

describe("CreatePostSchema", () => {
  const validPost = {
    format: "note",
    body: "Hello world",
    status: "published",
  };

  it("accepts a valid post with required fields", () => {
    const result = CreatePostSchema.parse(validPost);
    expect(result.format).toBe("note");
    expect(result.body).toBe("Hello world");
    expect(result.status).toBe("published");
  });

  it("accepts all formats", () => {
    expect(() =>
      CreatePostSchema.parse({ ...validPost, format: "note" }),
    ).not.toThrow();
    expect(() =>
      CreatePostSchema.parse({
        ...validPost,
        format: "link",
        title: "A link",
        url: "https://example.com",
      }),
    ).not.toThrow();
    expect(() =>
      CreatePostSchema.parse({
        ...validPost,
        format: "quote",
        quoteText: "A wise person once said...",
      }),
    ).not.toThrow();
  });

  it("accepts optional title", () => {
    const result = CreatePostSchema.parse({
      ...validPost,
      title: "My Post",
    });
    expect(result.title).toBe("My Post");
  });

  it("accepts valid slug format", () => {
    const result = CreatePostSchema.parse({
      ...validPost,
      slug: "my-post-slug",
    });
    expect(result.slug).toBe("my-post-slug");
  });

  it("accepts single-character slug", () => {
    const result = CreatePostSchema.parse({
      ...validPost,
      slug: "a",
    });
    expect(result.slug).toBe("a");
  });

  it("accepts empty slug (transforms to undefined)", () => {
    const result = CreatePostSchema.parse({ ...validPost, slug: "" });
    expect(result.slug).toBeUndefined();
  });

  it("normalizes uppercase slug", () => {
    const result = CreatePostSchema.parse({ ...validPost, slug: "MyPost" });
    expect(result.slug).toBe("mypost");
  });

  it("normalizes special chars in slug", () => {
    const result = CreatePostSchema.parse({
      ...validPost,
      slug: "my post!",
    });
    expect(result.slug).toBe("my-post");
  });

  it("normalizes leading hyphen in slug", () => {
    const result = CreatePostSchema.parse({
      ...validPost,
      slug: "-my-post",
    });
    expect(result.slug).toBe("my-post");
  });

  it("normalizes trailing hyphen in slug", () => {
    const result = CreatePostSchema.parse({
      ...validPost,
      slug: "my-post-",
    });
    expect(result.slug).toBe("my-post");
  });

  it("normalizes slashes in slug", () => {
    const result = CreatePostSchema.parse({
      ...validPost,
      slug: "my/post",
    });
    expect(result.slug).toBe("my-post");
  });

  it("accepts valid url", () => {
    const result = CreatePostSchema.parse({
      ...validPost,
      format: "link",
      title: "A link",
      url: "https://example.com",
    });
    expect(result.url).toBe("https://example.com");
  });

  it("accepts empty url", () => {
    const result = CreatePostSchema.parse({ ...validPost, url: "" });
    expect(result.url).toBe("");
  });

  it("rejects invalid url", () => {
    expect(() =>
      CreatePostSchema.parse({ ...validPost, url: "not-a-url" }),
    ).toThrow();
  });

  it("accepts optional publishedAt as positive integer", () => {
    const result = CreatePostSchema.parse({
      ...validPost,
      publishedAt: 1706745600,
    });
    expect(result.publishedAt).toBe(1706745600);
  });

  it("rejects negative publishedAt", () => {
    expect(() =>
      CreatePostSchema.parse({ ...validPost, publishedAt: -1 }),
    ).toThrow();
  });

  it("rejects non-integer publishedAt", () => {
    expect(() =>
      CreatePostSchema.parse({ ...validPost, publishedAt: 1.5 }),
    ).toThrow();
  });

  it("accepts valid mediaIds", () => {
    const mediaIds = [createEntityId("media"), createEntityId("media")];
    const result = CreatePostSchema.parse({
      ...validPost,
      mediaIds,
    });
    expect(result.mediaIds).toEqual(mediaIds);
  });

  it("accepts empty mediaIds array", () => {
    const result = CreatePostSchema.parse({
      ...validPost,
      mediaIds: [],
    });
    expect(result.mediaIds).toEqual([]);
  });

  it("accepts omitted mediaIds", () => {
    const result = CreatePostSchema.parse(validPost);
    expect(result.mediaIds).toBeUndefined();
  });

  it("rejects mediaIds over MAX_MEDIA_ATTACHMENTS", () => {
    const tooMany = Array.from({ length: MAX_MEDIA_ATTACHMENTS + 1 }, () =>
      createEntityId("media"),
    );
    expect(() =>
      CreatePostSchema.parse({ ...validPost, mediaIds: tooMany }),
    ).toThrow();
  });

  it("accepts visibility values", () => {
    for (const v of ["public", "latest_hidden", "private"]) {
      const result = CreatePostSchema.parse({ ...validPost, visibility: v });
      expect(result.visibility).toBe(v);
    }
  });

  it("accepts featured as boolean", () => {
    const result = CreatePostSchema.parse({ ...validPost, featured: true });
    expect(result.featured).toBe(true);
  });

  it("rejects featured as non-boolean (other than 'on')", () => {
    expect(() =>
      CreatePostSchema.parse({ ...validPost, featured: "invalid" }),
    ).toThrow();
  });

  it("rejects invalid visibility", () => {
    expect(() =>
      CreatePostSchema.parse({ ...validPost, visibility: "hidden" }),
    ).toThrow();
  });

  it("accepts pinned as boolean", () => {
    const result = CreatePostSchema.parse({ ...validPost, pinned: true });
    expect(result.pinned).toBe(true);
  });

  it("accepts pinned as 'on' (transforms to true)", () => {
    const result = CreatePostSchema.parse({ ...validPost, pinned: "on" });
    expect(result.pinned).toBe(true);
  });

  it("accepts optional quoteText for quote posts", () => {
    const result = CreatePostSchema.parse({
      ...validPost,
      format: "quote",
      quoteText: "A wise person once said...",
    });
    expect(result.quoteText).toBe("A wise person once said...");
  });

  it("accepts sourceName and sourceUrl for quote posts", () => {
    const result = CreatePostSchema.parse({
      ...validPost,
      format: "quote",
      quoteText: "A wise person once said...",
      sourceName: "Marcus Aurelius",
      sourceUrl: "https://example.com/meditations",
    });

    expect(result.sourceName).toBe("Marcus Aurelius");
    expect(result.sourceUrl).toBe("https://example.com/meditations");
  });

  it("rejects note posts with a URL", () => {
    expect(() =>
      CreatePostSchema.parse({
        ...validPost,
        url: "https://example.com",
      }),
    ).toThrow("Notes can't include a URL.");
  });

  it("rejects note posts with quoted text", () => {
    expect(() =>
      CreatePostSchema.parse({
        ...validPost,
        quoteText: "A wise person once said...",
      }),
    ).toThrow("Notes can't include quoted text.");
  });

  it("rejects link posts without a URL", () => {
    expect(() =>
      CreatePostSchema.parse({
        ...validPost,
        format: "link",
        title: "A link",
      }),
    ).toThrow("Link posts need a URL.");
  });

  it("rejects link posts without a title", () => {
    expect(() =>
      CreatePostSchema.parse({
        ...validPost,
        format: "link",
        url: "https://example.com",
      }),
    ).toThrow("Link posts need a title.");
  });

  it("rejects link posts with quoted text", () => {
    expect(() =>
      CreatePostSchema.parse({
        ...validPost,
        format: "link",
        title: "A link",
        url: "https://example.com",
        quoteText: "A wise person once said...",
      }),
    ).toThrow("Link posts can't include quoted text.");
  });

  it("rejects quote posts without quoted text", () => {
    expect(() =>
      CreatePostSchema.parse({
        ...validPost,
        format: "quote",
      }),
    ).toThrow("Quote posts need quoted text.");
  });

  it("rejects quote posts with legacy title", () => {
    expect(() =>
      CreatePostSchema.parse({
        ...validPost,
        format: "quote",
        title: "Marcus Aurelius",
        quoteText: "A wise person once said...",
      }),
    ).toThrow("Quote posts use sourceName instead of title.");
  });

  it("rejects quote posts with legacy url", () => {
    expect(() =>
      CreatePostSchema.parse({
        ...validPost,
        format: "quote",
        url: "https://example.com/meditations",
        quoteText: "A wise person once said...",
      }),
    ).toThrow("Quote posts use sourceUrl instead of url.");
  });

  it("accepts optional rating (1-5)", () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      const result = CreatePostSchema.parse({ ...validPost, rating });
      expect(result.rating).toBe(rating);
    }
  });

  it("rejects rating outside 0-5 range", () => {
    expect(() =>
      CreatePostSchema.parse({ ...validPost, rating: -1 }),
    ).toThrow();
    expect(() => CreatePostSchema.parse({ ...validPost, rating: 6 })).toThrow();
  });

  it("accepts rating 0 (transforms to undefined)", () => {
    const result = CreatePostSchema.parse({ ...validPost, rating: 0 });
    expect(result.rating).toBeUndefined();
  });

  it("accepts empty string rating (transforms to undefined)", () => {
    const result = CreatePostSchema.parse({ ...validPost, rating: "" });
    expect(result.rating).toBeUndefined();
  });

  it("accepts optional collectionIds as array of non-empty strings", () => {
    const collectionIds = [
      createEntityId("collection"),
      createEntityId("collection"),
      createEntityId("collection"),
    ];
    const result = CreatePostSchema.parse({
      ...validPost,
      collectionIds,
    });
    expect(result.collectionIds).toEqual(collectionIds);
  });

  it("rejects collectionIds with empty strings", () => {
    expect(() =>
      CreatePostSchema.parse({ ...validPost, collectionIds: [""] }),
    ).toThrow();
  });

  it("accepts empty string collectionIds (transforms to undefined)", () => {
    const result = CreatePostSchema.parse({
      ...validPost,
      collectionIds: "",
    });
    expect(result.collectionIds).toBeUndefined();
  });

  it("accepts optional replyToId", () => {
    const replyToId = createEntityId("post");
    const result = CreatePostSchema.parse({
      ...validPost,
      replyToId,
    });
    expect(result.replyToId).toBe(replyToId);
  });

  it("only requires format field", () => {
    const result = CreatePostSchema.parse({ format: "note" });
    expect(result.format).toBe("note");
  });

  it("rejects missing format", () => {
    expect(() => CreatePostSchema.parse({})).toThrow();
    expect(() => CreatePostSchema.parse({ body: "hello" })).toThrow();
  });

  it("accepts bodyMarkdown", () => {
    const result = CreatePostSchema.parse({
      format: "note",
      bodyMarkdown: "Hello **world**",
    });
    expect(result.bodyMarkdown).toBe("Hello **world**");
  });

  it("rejects both body and bodyMarkdown", () => {
    expect(() =>
      CreatePostSchema.parse({
        format: "note",
        body: '{"type":"doc","content":[]}',
        bodyMarkdown: "Hello",
      }),
    ).toThrow("Provide either body or bodyMarkdown, not both");
  });
});

describe("UpdatePostSchema", () => {
  it("accepts empty object (all fields optional)", () => {
    const result = UpdatePostSchema.parse({});
    expect(result).toEqual({});
  });

  it("accepts partial updates", () => {
    const result = UpdatePostSchema.parse({ title: "New Title" });
    expect(result.title).toBe("New Title");
  });

  it("accepts only format", () => {
    const result = UpdatePostSchema.parse({ format: "link" });
    expect(result.format).toBe("link");
  });

  it("still validates field types", () => {
    expect(() => UpdatePostSchema.parse({ format: "invalid" })).toThrow();
  });

  it("normalizes blank sourceName to null so quote attribution can be cleared", () => {
    const result = UpdatePostSchema.parse({ sourceName: "   " });
    expect(result.sourceName).toBeNull();
  });
});

describe("CreatePostApiSchema", () => {
  const validPost = {
    format: "note",
    bodyMarkdown: "Hello world",
    status: "published",
  };

  it("accepts ordered attachment inputs", () => {
    const mediaId = createEntityId("media");
    const result = CreatePostApiSchema.parse({
      ...validPost,
      attachments: [
        { type: "media", mediaId, alt: "" },
        {
          type: "text",
          contentFormat: "markdown",
          content: "# Attached",
          summary: "Attached",
        },
      ],
    });

    expect(result.attachments).toEqual([
      { type: "media", mediaId, alt: "" },
      {
        type: "text",
        contentFormat: "markdown",
        content: "# Attached",
        summary: "Attached",
      },
    ]);
  });

  it("rejects legacy mediaIds in API requests", () => {
    expect(() =>
      CreatePostApiSchema.parse({
        ...validPost,
        mediaIds: ["media-1"],
      }),
    ).toThrow();
  });

  it("rejects text attachments without content", () => {
    expect(() =>
      CreatePostApiSchema.parse({
        ...validPost,
        attachments: [
          {
            type: "text",
            contentFormat: "markdown",
            content: "   ",
          },
        ],
      }),
    ).toThrow("Text attachments need content.");
  });

  it("accepts sourceName and sourceUrl for quote API requests", () => {
    const result = CreatePostApiSchema.parse({
      format: "quote",
      quoteText: "What stands in the way becomes the way.",
      sourceName: "Marcus Aurelius",
      sourceUrl: "https://example.com/meditations",
    });

    expect(result.sourceName).toBe("Marcus Aurelius");
    expect(result.sourceUrl).toBe("https://example.com/meditations");
  });

  it("rejects link API requests without a title", () => {
    expect(() =>
      CreatePostApiSchema.parse({
        format: "link",
        url: "https://example.com",
      }),
    ).toThrow("Link posts need a title.");
  });

  it("rejects legacy title and url for quote API requests", () => {
    expect(() =>
      CreatePostApiSchema.parse({
        format: "quote",
        quoteText: "What stands in the way becomes the way.",
        title: "Marcus Aurelius",
      }),
    ).toThrow("Quote posts use sourceName instead of title.");

    expect(() =>
      CreatePostApiSchema.parse({
        format: "quote",
        quoteText: "What stands in the way becomes the way.",
        url: "https://example.com/meditations",
      }),
    ).toThrow("Quote posts use sourceUrl instead of url.");
  });
});

describe("UpdatePostApiSchema", () => {
  it("accepts omitted attachments", () => {
    const result = UpdatePostApiSchema.parse({ bodyMarkdown: "Updated" });
    expect(result.attachments).toBeUndefined();
  });

  it("accepts empty attachments array", () => {
    const result = UpdatePostApiSchema.parse({ attachments: [] });
    expect(result.attachments).toEqual([]);
  });

  it("accepts quote attribution updates via sourceName and sourceUrl", () => {
    const result = UpdatePostApiSchema.parse({
      sourceName: "Epictetus",
      sourceUrl: "https://example.com/discourses",
    });

    expect(result.sourceName).toBe("Epictetus");
    expect(result.sourceUrl).toBe("https://example.com/discourses");
  });

  it("normalizes blank update fields to null when they clear existing values", () => {
    const result = UpdatePostApiSchema.parse({
      sourceName: "   ",
      sourceUrl: "",
      rating: 0,
    });

    expect(result.sourceName).toBeNull();
    expect(result.sourceUrl).toBeNull();
    expect(result.rating).toBeNull();
  });
});

describe("parseFormData", () => {
  it("parses a valid form field", () => {
    const form = new FormData();
    form.set("name", "hello");
    expect(parseFormData(form, "name", z.string())).toBe("hello");
  });

  it("throws for missing required field", () => {
    const form = new FormData();
    expect(() => parseFormData(form, "missing", z.string())).toThrow(
      "Missing required field: missing",
    );
  });

  it("throws for invalid value", () => {
    const form = new FormData();
    form.set("format", "invalid-format");
    expect(() => parseFormData(form, "format", FormatSchema)).toThrow();
  });
});

describe("parseFormDataOptional", () => {
  it("returns parsed value when present", () => {
    const form = new FormData();
    form.set("name", "hello");
    expect(parseFormDataOptional(form, "name", z.string())).toBe("hello");
  });

  it("returns undefined when field is missing", () => {
    const form = new FormData();
    expect(parseFormDataOptional(form, "missing", z.string())).toBeUndefined();
  });

  it("returns undefined when field is empty string", () => {
    const form = new FormData();
    form.set("name", "");
    expect(parseFormDataOptional(form, "name", z.string())).toBeUndefined();
  });

  it("throws for invalid value", () => {
    const form = new FormData();
    form.set("format", "invalid");
    expect(() => parseFormDataOptional(form, "format", FormatSchema)).toThrow();
  });
});

describe("validateAttachmentCount", () => {
  it("returns null for empty attachment array", () => {
    expect(validateAttachmentCount([])).toBeNull();
  });

  it("returns null for attachments within limit", () => {
    const attachments = Array.from({ length: 5 }, (_, i) => `id-${i}`);
    expect(validateAttachmentCount(attachments)).toBeNull();
  });

  it("returns null for exactly MAX_MEDIA_ATTACHMENTS", () => {
    const attachments = Array.from(
      { length: MAX_MEDIA_ATTACHMENTS },
      (_, i) => `id-${i}`,
    );
    expect(validateAttachmentCount(attachments)).toBeNull();
  });

  it("returns error when exceeding MAX_MEDIA_ATTACHMENTS", () => {
    const tooMany = Array.from(
      { length: MAX_MEDIA_ATTACHMENTS + 1 },
      (_, i) => `id-${i}`,
    );
    const error = validateAttachmentCount(tooMany);
    expect(error).toBe(
      `Posts allow at most ${MAX_MEDIA_ATTACHMENTS} attachments`,
    );
  });
});

describe("PostFilterSelectionSchema", () => {
  it("accepts a selection a smart collection may store", () => {
    const result = PostFilterSelectionSchema.safeParse({
      format: "note",
      media: "any",
      visibility: "featured",
      collection: ["col_01m0f291t3fzvte3vj2g8d611z"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts the empty selection, which means every post", () => {
    expect(PostFilterSelectionSchema.safeParse({}).success).toBe(true);
  });

  it("refuses the private visibility a smart collection can never name", () => {
    expect(
      PostFilterSelectionSchema.safeParse({ visibility: "private" }).success,
    ).toBe(false);
  });

  it("refuses a key that is not a dimension", () => {
    expect(
      PostFilterSelectionSchema.safeParse({ language: "en" }).success,
    ).toBe(false);
  });

  it("names the condition it rejected", () => {
    const result = PostFilterSelectionSchema.safeParse({ year: 1970 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["year"]);
    expect(result.error.issues[0]?.message).toBe(
      "Invalid value for the year condition",
    );
  });
});
