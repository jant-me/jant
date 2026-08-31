/**
 * Path resolution.
 *
 * `resolve` answers a request — a redirect there has to stay a redirect, so
 * the router can emit it. `resolveTarget` answers a person holding an address,
 * where the only useful answer is the thing at the end of the hops.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";
import { createPathService } from "../path.js";
import { createPostService } from "../post.js";
import type { Database } from "../../db/index.js";

describe("PathService.resolveTarget", () => {
  let db: Database;
  let paths: ReturnType<typeof createPathService>;
  let postService: ReturnType<typeof createPostService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    paths = createPathService(db, DEFAULT_TEST_SITE_ID);
    postService = createPostService(
      db,
      { slugIdLength: 5 },
      DEFAULT_TEST_SITE_ID,
      paths,
    );
  });

  async function createPost(slug: string) {
    return postService.create({
      format: "note",
      title: slug,
      slug,
      body: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph" }],
      }),
    });
  }

  it("resolves a plain slug to its post", async () => {
    const post = await createPost("hello");

    expect(await paths.resolveTarget("hello")).toEqual(
      expect.objectContaining({ targetType: "post", postId: post.id }),
    );
  });

  it("follows a redirect to the post it points at", async () => {
    const post = await createPost("new-name");
    await paths.create({
      path: "old-name",
      kind: "redirect",
      redirectToPath: "new-name",
      redirectType: 301,
    });

    expect(await paths.resolve("old-name")).toEqual(
      expect.objectContaining({ targetType: "redirect" }),
    );
    expect(await paths.resolveTarget("old-name")).toEqual(
      expect.objectContaining({ targetType: "post", postId: post.id }),
    );
  });

  it("follows a chain of redirects", async () => {
    const post = await createPost("third");
    await paths.create({
      path: "first",
      kind: "redirect",
      redirectToPath: "second",
      redirectType: 301,
    });
    await paths.create({
      path: "second",
      kind: "redirect",
      redirectToPath: "third",
      redirectType: 301,
    });

    expect(await paths.resolveTarget("first")).toEqual(
      expect.objectContaining({ targetType: "post", postId: post.id }),
    );
  });

  it("gives up on a redirect loop rather than spinning", async () => {
    await paths.create({
      path: "ping",
      kind: "redirect",
      redirectToPath: "pong",
      redirectType: 302,
    });
    await paths.create({
      path: "pong",
      kind: "redirect",
      redirectToPath: "ping",
      redirectType: 302,
    });

    expect(await paths.resolveTarget("ping")).toBeNull();
  });

  it("returns null for an address nothing is registered at", async () => {
    expect(await paths.resolveTarget("nothing-here")).toBeNull();
  });
});

/**
 * `aliases[0]` becomes a Post's permalink, and therefore its Atom `<id>` and
 * its sitemap `<loc>`. Feed readers and the Discover crawler both key entries
 * on that id, so which alias comes first is an identity decision, not a
 * presentation one — it must come from the query, never from the storage
 * engine's row order.
 */
describe("PathService.getPostAliases", () => {
  let db: Database;
  let paths: ReturnType<typeof createPathService>;
  let postService: ReturnType<typeof createPostService>;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db as unknown as Database;
    paths = createPathService(db, DEFAULT_TEST_SITE_ID);
    postService = createPostService(
      db,
      { slugIdLength: 5 },
      DEFAULT_TEST_SITE_ID,
      paths,
    );
  });

  async function createAlias(postId: string, path: string, createdAt: number) {
    const record = await paths.create({ path, kind: "alias", postId });
    await db.run(
      sql`UPDATE path_registry SET created_at = ${createdAt} WHERE id = ${record.id}`,
    );
    return record;
  }

  it("returns aliases oldest first, whatever order they were inserted in", async () => {
    const post = await postService.create({
      format: "note",
      title: "Aliased",
      slug: "aliased",
      body: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
    });

    // Inserted newest-first, so insertion order is the opposite of the answer.
    await createAlias(post.id, "second-address", 2_000);
    await createAlias(post.id, "first-address", 1_000);

    const aliases = await paths.getPostAliases([post.id]);

    expect(aliases.get(post.id)).toEqual(["/first-address", "/second-address"]);
  });

  it("keeps a second custom URL from taking over the permalink", async () => {
    const post = await postService.create({
      format: "note",
      title: "Renamed",
      slug: "renamed",
      body: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
    });

    await createAlias(post.id, "original", 1_000);
    const before = await paths.getPostAliases([post.id]);
    await createAlias(post.id, "added-later", 2_000);
    const after = await paths.getPostAliases([post.id]);

    expect(before.get(post.id)?.[0]).toBe("/original");
    expect(after.get(post.id)?.[0]).toBe("/original");
  });
});
