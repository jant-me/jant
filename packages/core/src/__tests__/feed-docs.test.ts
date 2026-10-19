/**
 * The feed docs describe the feeds a site actually serves.
 *
 * `docs/feed-reading.md` is the public contract for the `https://jant.me/ns`
 * elements and attributes; `docs/feeds.md` covers `jant:discover` and every
 * feed address. Scanning the renderer's source for `jant:` found element names
 * but not the attributes on them, and nothing checked that an address in the
 * docs resolved at all. These render a site with every kind of content a feed
 * writes something for (`helpers/rich-sites.ts`), and request every address
 * the docs name.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readFeedNames } from "./helpers/public-surface.js";
import {
  createRichFeedSite,
  RICH_FEED_SITE_ORIGIN,
} from "./helpers/rich-sites.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");

function readDoc(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

/**
 * Every name a feed writes in the jant namespace, and every attribute on an
 * element in the jant or Media RSS namespace.
 */
function collectFeedNames(xml: string) {
  const { elements: all } = readFeedNames(xml);
  const elements = new Map(
    [...all].filter(([name]) => /^(jant|media):/.test(name)),
  );
  const jantAttributes = new Set(
    [...all.values()].flatMap((attrs) =>
      [...attrs].filter((attr) => attr.startsWith("jant:")),
    ),
  );
  return { elements, jantAttributes };
}

/** Backticked site paths a doc names, placeholders left out. */
function documentedPaths(doc: string): string[] {
  return [
    ...new Set(
      [...doc.matchAll(/`(\/[^`\s]*)`/g)]
        .map((match) => match[1] ?? "")
        .filter((path) => !path.includes("{")),
    ),
  ];
}

describe("feed docs", () => {
  it("document every element and attribute a served feed writes", async () => {
    const { request } = await createRichFeedSite();
    const res = await request("/latest/feed");
    expect(res.status).toBe(200);
    const xml = await res.text();
    const { elements, jantAttributes } = collectFeedNames(xml);

    // The fixture has to reach what it claims to, or the rest passes empty.
    expect([...elements.keys()]).toEqual(
      expect.arrayContaining([
        "jant:discover",
        "jant:id",
        "jant:format",
        "jant:thread",
        "jant:post",
        "jant:truncated",
        "media:content",
        "media:thumbnail",
      ]),
    );
    expect(elements.get("jant:thread")).toEqual(
      new Set(["posts", "hidden", "gap", "latest"]),
    );
    expect([...(elements.get("jant:post") ?? [])]).toEqual(
      expect.arrayContaining(["url", "thumbnail", "folded", "truncated"]),
    );
    expect([...jantAttributes].sort()).toEqual(["jant:page", "jant:post"]);

    const docs = [
      readDoc("docs/feed-reading.md"),
      readDoc("docs/feeds.md"),
    ].join("\n");
    const missing: string[] = [];
    for (const [name, attrs] of elements) {
      if (name.startsWith("jant:") && !docs.includes(name)) missing.push(name);
      for (const attr of attrs) {
        if (!docs.includes(`\`${attr}\``) && !docs.includes(`@${attr}`)) {
          missing.push(`${name}/@${attr}`);
        }
      }
    }
    for (const attr of jantAttributes) {
      if (!docs.includes(attr)) missing.push(`@${attr}`);
    }
    expect(missing).toEqual([]);
  });

  it("carry every jant: name from the feed guide into its translation", () => {
    const names = (doc: string) =>
      new Set([...doc.matchAll(/jant:[a-z]+/g)].map((match) => match[0]));
    const english = names(readDoc("docs/feeds.md"));
    const chinese = names(readDoc("docs/zh-Hans/feeds.md"));

    expect(english.size).toBeGreaterThan(0);
    expect([...english].filter((name) => !chinese.has(name))).toEqual([]);
  });

  it("resolve every address the feed guide names", async () => {
    const { request } = await createRichFeedSite();
    const english = readDoc("docs/feeds.md");
    const paths = new Set([
      ...documentedPaths(english),
      ...documentedPaths(readDoc("docs/zh-Hans/feeds.md")),
    ]);
    expect(paths).toContain("/ja/reading/feed");
    expect(paths).toContain("/collections/reading+cooking/feed");

    const broken: string[] = [];
    for (const path of paths) {
      let res = await request(path);
      for (
        let hops = 0;
        hops < 3 && res.status >= 300 && res.status < 400;
        hops++
      ) {
        const next = new URL(
          res.headers.get("location") ?? "",
          RICH_FEED_SITE_ORIGIN,
        );
        res = await request(next.pathname + next.search);
      }
      const isFeed = /\/feed(\?|$)/.test(path);
      const type = res.headers.get("content-type") ?? "";
      if (res.status !== 200 || (isFeed && !type.includes("atom+xml"))) {
        broken.push(`${path} → ${res.status} ${type}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("redirect every older address to the one the guide names", async () => {
    const { request } = await createRichFeedSite();
    const rows = [
      ...readDoc("docs/feeds.md").matchAll(
        /^\| `(\/[^`]+)` +\| `(\/[^`]+)` +\|$/gm,
      ),
    ];
    expect(rows.length).toBeGreaterThan(5);

    const wrong: string[] = [];
    for (const [, from = "", to = ""] of rows) {
      const res = await request(from);
      const location = res.headers.get("location");
      const target = location
        ? new URL(location, RICH_FEED_SITE_ORIGIN).pathname
        : null;
      if (![301, 308].includes(res.status) || target !== to) {
        wrong.push(`${from} → ${res.status} ${target ?? ""}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
