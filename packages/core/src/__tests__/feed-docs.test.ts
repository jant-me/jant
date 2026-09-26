/**
 * Every name Jant writes in its feed namespace is documented for consumers.
 *
 * `docs/feed-reading.md` is the public contract for the `https://jant.me/ns`
 * elements and attributes; `docs/feeds.md` covers `jant:discover`. Before the
 * handout was published, `jant:post`, `jant:thread`, `jant:truncated`, and
 * `jant:page` were described only in an internal document. A new name the
 * renderer starts writing fails this until the docs describe it.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CORE_DIR = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(CORE_DIR, "../..");
const RENDERERS = ["src/lib/feed.ts", "src/lib/discover.ts"];
const FEED_DOCS = ["docs/feed-reading.md", "docs/feeds.md"];

describe("feed docs", () => {
  it("document every jant: name the feed renderers write", () => {
    const written = new Set(
      RENDERERS.flatMap((path) => [
        ...readFileSync(join(CORE_DIR, path), "utf8").matchAll(
          /jant:([a-z]+)/g,
        ),
      ]).flatMap((match) => (match[1] ? [`jant:${match[1]}`] : [])),
    );
    const docs = FEED_DOCS.map((path) =>
      readFileSync(join(REPO_ROOT, path), "utf8"),
    ).join("\n");

    expect(written.size).toBeGreaterThan(0);
    expect([...written].filter((name) => !docs.includes(name))).toEqual([]);
  });
});
