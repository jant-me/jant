/**
 * Every response object the API documents carries exactly the fields its
 * table in docs/API.md lists, and every route the API serves is documented.
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
 *
 * A route outside `/api/internal/*` is either named in docs/API.md as
 * `` `METHOD /path` `` or declared undocumented in `helpers/public-surface.ts`,
 * which keeps it out of the public surface manifest.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  listApiRoutes,
  readApiResponseFields,
  UNDOCUMENTED_API_ROUTES,
} from "./helpers/public-surface.js";

const API_DOC = readFileSync(
  resolve(import.meta.dirname, "../../../../docs/API.md"),
  "utf8",
);

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

const RESPONSE_FIELDS = readApiResponseFields();

/** The line in docs/API.md that introduces each response's table. */
const RESPONSE_TABLES = {
  post: "Post responses include these fields:",
  publicPost: "Public post responses include these fields:",
  thread: "Thread responses include these fields:",
  media: "Media responses",
  collection: "Collection responses include these fields:",
  directoryItem: "Directory item responses include these fields:",
  smartCollection: "Smart collection responses include these fields:",
  navItem: "Nav item responses include these fields:",
  customUrl: "Custom URL responses include these fields:",
  searchResult: "Result objects include these fields:",
} as const;

/** Every `` `METHOD /api/…` `` docs/API.md names, query strings left out. */
function documentedEndpoints(): Set<string> {
  return new Set(
    [
      ...API_DOC.matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/api\/[^`?\s]*)/g),
    ].map((match) => `${match[1]} ${match[2]}`),
  );
}

describe("API docs", () => {
  it.each(Object.entries(RESPONSE_TABLES))(
    "list every field of a %s response",
    (name, intro) => {
      expect(RESPONSE_FIELDS[name as keyof typeof RESPONSE_TABLES]).toEqual(
        documentedFields(intro),
      );
    },
  );

  it("name every route outside /api/internal/* not declared undocumented", () => {
    const documented = documentedEndpoints();
    const undocumented = new Set(UNDOCUMENTED_API_ROUTES);
    const routes = listApiRoutes();

    expect(
      routes.filter(
        (route) => !documented.has(route) && !undocumented.has(route),
      ),
    ).toEqual([]);
    expect(
      [...documented].filter(
        (route) =>
          !route.includes(" /api/internal/") && !routes.includes(route),
      ),
    ).toEqual([]);
    // A declared route that is gone, or that the docs now name, leaves the list.
    expect(
      UNDOCUMENTED_API_ROUTES.filter(
        (route) => !routes.includes(route) || documented.has(route),
      ),
    ).toEqual([]);
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
  const attachment = RESPONSE_FIELDS.attachment;
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
