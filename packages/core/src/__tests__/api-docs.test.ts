/**
 * Every response object the API documents carries exactly the fields its
 * table in docs/API.md lists.
 *
 * The author API once built its responses by spreading database rows, so a
 * new column reached a frozen surface without anyone deciding it should, and
 * internals such as `siteId` and storage keys went out with it. Each response
 * is now built field by field in `lib/api-*.ts`; this test holds those
 * builders and the tables to each other. A field added to one fails until the
 * other lists it too.
 *
 * The JSON examples are held to the same tables: an example object may leave
 * fields out, but every field it shows must be one its table lists. Examples
 * once kept a renamed field (`sort` for `sortOrder`) and a media ID as
 * `nextCursor` long after the API changed.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  toApiCollection,
  toApiDirectoryItem,
  toApiSmartCollection,
} from "../lib/api-collections.js";
import { toApiCustomUrl } from "../lib/api-custom-urls.js";
import { toApiMedia } from "../lib/api-media.js";
import { toApiNavItem } from "../lib/api-nav-items.js";
import { toApiAttachment, toApiPost } from "../lib/api-posts.js";
import { toPublicPost } from "../lib/api-public-posts.js";
import { toSearchApiResult } from "../lib/api-search.js";
import { toApiThreadResponse } from "../lib/api-threads.js";
import type { AppConfig } from "../types/config.js";
import type { Post } from "../types.js";
import {
  makeCollection,
  makeMedia,
  makePost,
} from "./helpers/export-fixtures.js";

const API_DOC = readFileSync(
  resolve(import.meta.dirname, "../../../../docs/API.md"),
  "utf8",
);

const APP_CONFIG = {
  r2PublicUrl: "",
  s3PublicUrl: "",
  localPublicUrl: "",
  imageTransformUrl: "",
  sitePathPrefix: "",
  storageDriver: "r2",
} as unknown as AppConfig;

/**
 * The field names in the table that follows `intro` in docs/API.md: the
 * backticked first cell of each row.
 */
function documentedFields(intro: string): string[] {
  const start = API_DOC.indexOf(intro);
  expect(start, `docs/API.md has no "${intro}"`).toBeGreaterThan(-1);
  const fields: string[] = [];
  let inTable = false;
  for (const line of API_DOC.slice(start + intro.length).split("\n")) {
    if (line.startsWith("|")) {
      inTable = true;
      const name = /^\| `([A-Za-z]+)`/.exec(line)?.[1];
      if (name) fields.push(name);
    } else if (inTable) {
      break;
    }
  }
  return fields.sort();
}

/** Every key any of the variants carries. */
function keysOf(...variants: object[]): string[] {
  return [
    ...new Set(variants.flatMap((variant) => Object.keys(variant))),
  ].sort();
}

function post(over: Partial<Post> = {}): Post {
  return makePost({
    language: "en",
    translationGroupId: null,
    quietReply: false,
    threadUpdatedAt: 1773014400,
    ...over,
  });
}

const textMedia = makeMedia({
  id: "med-text",
  mimeType: "text/markdown; charset=utf-8",
  mediaKind: "text",
  storageKey: "media/med-text.md",
  summary: "Notes",
  chars: 120,
});

describe("API docs", () => {
  it("list every field of a post in the author API", () => {
    const extras = { threadPostCount: 1, attachments: [], collectionIds: [] };
    expect(
      keysOf(
        toApiPost(post(), extras),
        toApiPost(post({ format: "quote" }), extras),
        toApiPost(post(), extras, { content: "markdown" }),
      ),
    ).toEqual(documentedFields("Post responses include these fields:"));
  });

  it("list every field of a public post", () => {
    const related = { media: [], collections: [], threadPostCount: 1 };
    expect(
      keysOf(
        toPublicPost(post(), related, APP_CONFIG),
        toPublicPost(post({ format: "quote" }), related, APP_CONFIG),
        toPublicPost(post(), related, APP_CONFIG, { content: "markdown" }),
      ),
    ).toEqual(documentedFields("Public post responses include these fields:"));
  });

  it("list every field of a Thread", () => {
    const root = post();
    const respond = (item: Post) => ({ id: item.id });
    expect(
      keysOf(
        toApiThreadResponse(
          {
            root,
            postCount: 2,
            fold: {
              leadingReplies: [],
              trailingReplies: [],
              latestReply: root,
              firstHiddenReply: null,
              hiddenCount: 0,
            },
          },
          respond,
          respond,
        ),
      ),
    ).toEqual(documentedFields("Thread responses include these fields:"));
  });

  it("list every field of a media item", () => {
    expect(
      keysOf(
        toApiMedia(makeMedia(), APP_CONFIG),
        toApiMedia(textMedia, APP_CONFIG),
      ),
    ).toEqual(documentedFields("Media responses"));
  });

  it("list every field of a collection", () => {
    expect(
      keysOf(
        toApiCollection({
          ...makeCollection(),
          threadCount: 1,
          recentActivityAt: 1773014400,
        }),
      ),
    ).toEqual(documentedFields("Collection responses include these fields:"));
  });

  it("list every field of a directory item", () => {
    expect(
      keysOf(
        toApiDirectoryItem({
          id: "cdi-1",
          siteId: "site-test",
          type: "link",
          collectionId: null,
          smartCollectionId: null,
          label: "Elsewhere",
          url: "https://example.com",
          description: null,
          position: "a0",
          createdAt: 1773014400,
          updatedAt: 1773014400,
        }),
      ),
    ).toEqual(
      documentedFields("Directory item responses include these fields:"),
    );
  });

  it("list every field of a smart collection", () => {
    expect(
      keysOf(
        toApiSmartCollection({
          id: "smc-1",
          siteId: "site-test",
          slug: "reading",
          title: "Reading",
          description: null,
          selection: {},
          sort: "newest",
          layout: null,
          createdAt: 1773014400,
          updatedAt: 1773014400,
          threadCount: 1,
          recentActivityAt: 1773014400,
        }),
      ),
    ).toEqual(
      documentedFields("Smart collection responses include these fields:"),
    );
  });

  it("list every field of a nav item", () => {
    const base = {
      id: "nav-1",
      siteId: "site-test",
      label: "",
      url: "/ideas",
      placement: "header" as const,
      position: "a0",
      createdAt: 1773014400,
      updatedAt: 1773014400,
    };
    expect(
      keysOf(
        toApiNavItem({ ...base, type: "system", systemKey: "archive" }),
        toApiNavItem({
          ...base,
          type: "collection",
          collectionId: "col-1",
          targetTitle: "Ideas",
        }),
        toApiNavItem({
          ...base,
          type: "smart_collection",
          smartCollectionId: "smc-1",
        }),
        toApiNavItem({ ...base, type: "page", postId: "pst-1" }),
      ),
    ).toEqual(documentedFields("Nav item responses include these fields:"));
  });

  it("list every field of a custom URL", () => {
    expect(
      keysOf(
        toApiCustomUrl({
          id: "pth-1",
          path: "old-post",
          targetType: "redirect",
          targetId: null,
          toPath: "/new-post",
          redirectType: 301,
          archiveQuery: null,
          createdAt: 1773014400,
        }),
      ),
    ).toEqual(documentedFields("Custom URL responses include these fields:"));
  });

  it("list every field of a search result", () => {
    expect(
      keysOf(
        toSearchApiResult(post(), "snippet"),
        toSearchApiResult(post({ format: "quote" }), "snippet"),
      ),
    ).toEqual(documentedFields("Result objects include these fields:"));
  });
});

/** The text of each `## ` section of docs/API.md, by heading. */
function apiDocSections(): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = API_DOC.split(/^## /m).slice(1);
  for (const part of parts) {
    const newline = part.indexOf("\n");
    sections.set(part.slice(0, newline).trim(), part.slice(newline + 1));
  }
  return sections;
}

/** Every JSON example in a section, parsed. */
function jsonExamples(section: string): unknown[] {
  return [...section.matchAll(/^```json\n([\s\S]*?)^```/gm)].map((match) => {
    const source = match[1] ?? "";
    try {
      return JSON.parse(source) as unknown;
    } catch {
      throw new Error(
        `docs/API.md has a JSON example that doesn't parse:\n${source}`,
      );
    }
  });
}

/** An object in an example, and the key it sits under in its parent. */
interface ExampleObject {
  value: Record<string, unknown>;
  parentKey: string | null;
}

function exampleObjects(
  value: unknown,
  parentKey: string | null = null,
): ExampleObject[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => exampleObjects(item, parentKey));
  }
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  return [
    { value: record, parentKey },
    ...Object.entries(record).flatMap(([key, child]) =>
      exampleObjects(child, key),
    ),
  ];
}

/** The fields an example object may carry, or null when no table covers it. */
type ExampleRule = (object: ExampleObject) => string[] | null;

function idPrefix(object: ExampleObject): string | null {
  const id = object.value.id;
  return typeof id === "string" ? (id.split("_")[0] ?? null) : null;
}

describe("API doc examples", () => {
  const authorPost = documentedFields("Post responses include these fields:");
  const publicPost = documentedFields(
    "Public post responses include these fields:",
  );
  const media = documentedFields("Media responses");
  const attachment = keysOf(
    toApiAttachment(makeMedia(), APP_CONFIG),
    toApiAttachment(textMedia, APP_CONFIG),
  );
  const collection = documentedFields(
    "Collection responses include these fields:",
  );
  const directoryItem = documentedFields(
    "Directory item responses include these fields:",
  );
  const smartCollection = documentedFields(
    "Smart collection responses include these fields:",
  );
  // The response fields, plus `threadPosition`, which only the single read
  // carries and the prose beside it names.
  const singlePost = [...authorPost, "threadPosition"];

  const rules: Record<string, ExampleRule> = {
    Posts: (object) => {
      switch (idPrefix(object)) {
        case "med":
          // A text attachment's content is its own response, documented by
          // its example alone.
          return "content" in object.value ? null : attachment;
        case "pst":
          return singlePost;
        default:
          return null;
      }
    },
    "Public posts": (object) =>
      idPrefix(object) === "pst" ? publicPost : null,
    Threads: (object) => {
      if (object.parentKey === "gap")
        return ["id", "slug", "permalink", "cursor"];
      if ("postCount" in object.value) {
        return documentedFields("Thread responses include these fields:");
      }
      return idPrefix(object) === "pst" ? publicPost : null;
    },
    Media: (object) => (idPrefix(object) === "med" ? media : null),
    Collections: (object) => {
      switch (idPrefix(object)) {
        case "col":
          return collection;
        case "cdi":
          return directoryItem;
        case "smc":
          return smartCollection;
        default:
          return null;
      }
    },
    "Smart Collections": (object) =>
      idPrefix(object) === "smc" ? smartCollection : null,
    "Navigation Items": (object) =>
      idPrefix(object) === "nav"
        ? documentedFields("Nav item responses include these fields:")
        : null,
    "Custom URLs": (object) =>
      idPrefix(object) === "pth"
        ? documentedFields("Custom URL responses include these fields:")
        : null,
    Search: (object) =>
      idPrefix(object) === "pst"
        ? documentedFields("Result objects include these fields:")
        : null,
  };

  const sections = apiDocSections();

  it("parse", () => {
    for (const section of sections.values()) {
      expect(() => jsonExamples(section)).not.toThrow();
    }
  });

  it.each(Object.keys(rules))(
    "in %s carry only fields their table lists",
    (heading) => {
      const section = sections.get(heading);
      expect(section, `docs/API.md has no "## ${heading}"`).toBeDefined();
      const rule = rules[heading];
      if (!section || !rule) return;
      for (const example of jsonExamples(section)) {
        for (const object of exampleObjects(example)) {
          const allowed = rule(object);
          if (!allowed) continue;
          // `"…": "…"` stands for the fields an example leaves out.
          const extra = Object.keys(object.value).filter(
            (key) => key !== "…" && !allowed.includes(key),
          );
          expect(extra, JSON.stringify(object.value)).toEqual([]);
        }
      }
    },
  );
});
