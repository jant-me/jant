import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import {
  createTestDatabase,
  DEFAULT_TEST_SITE_ID,
} from "../../__tests__/helpers/db.js";

/**
 * The three tables a smart collection can be placed in, checked by inserting
 * real rows.
 *
 * Reading a CHECK constraint and believing it is not the same as running it.
 * The last time these constraints were written by hand, a test shaped exactly
 * like this one found three bugs in a single pass: a branch that forgot to
 * require its own foreign key, a branch that allowed two of them at once, and a
 * unique index whose partial predicate never matched.
 *
 * Each case states the row it inserts and what the schema promises about it, so
 * a failure names the rule rather than the constraint.
 */

const SITE = DEFAULT_TEST_SITE_ID;
const NOW = 1_700_000_000;

function ids(prefix: string, n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `${prefix}_0000000000000000000000000${i}`,
  );
}

describe("smart collection placement constraints", () => {
  let sqlite: Database.Database;
  let smartA: string;
  let smartB: string;
  let collectionA: string;
  let postA: string;

  beforeEach(() => {
    ({ sqlite } = createTestDatabase());
    [smartA, smartB] = ids("smc", 2) as [string, string];
    [collectionA] = ids("col", 1) as [string];
    [postA] = ids("pst", 1) as [string];

    sqlite
      .prepare(
        `INSERT INTO collection (id, site_id, title, sort_order, created_at, updated_at)
         VALUES (?, ?, 'Books', 'newest', ?, ?)`,
      )
      .run(collectionA, SITE, NOW, NOW);

    for (const id of [smartA, smartB]) {
      sqlite
        .prepare(
          `INSERT INTO smart_collection (id, site_id, title, sort, created_at, updated_at)
           VALUES (?, ?, 'Quotes', 'newest', ?, ?)`,
        )
        .run(id, SITE, NOW, NOW);
    }

    sqlite
      .prepare(
        `INSERT INTO post (
           id, site_id, thread_id, format, status, visibility,
           body_html, body_text, created_at, updated_at
         ) VALUES (?, ?, ?, 'note', 'published', 'public', '', '', ?, ?)`,
      )
      .run(postA, SITE, postA, NOW, NOW);
  });

  function insertPath(values: Record<string, unknown>) {
    const row = {
      id: `pth_${Math.random().toString(36).slice(2, 12)}`,
      site_id: SITE,
      path: `p-${Math.random().toString(36).slice(2, 8)}`,
      kind: "slug",
      post_id: null,
      collection_id: null,
      smart_collection_id: null,
      redirect_to_path: null,
      redirect_type: null,
      archive_query: null,
      created_at: NOW,
      updated_at: NOW,
      ...values,
    };
    const keys = Object.keys(row);
    sqlite
      .prepare(
        `INSERT INTO path_registry (${keys.join(", ")})
         VALUES (${keys.map(() => "?").join(", ")})`,
      )
      .run(...keys.map((key) => row[key]));
  }

  function insertDirectoryItem(values: Record<string, unknown>) {
    const row = {
      id: `cdi_${Math.random().toString(36).slice(2, 12)}`,
      site_id: SITE,
      type: "smart_collection",
      collection_id: null,
      smart_collection_id: null,
      label: null,
      url: null,
      description: null,
      position: `a${Math.random().toString(36).slice(2, 8)}`,
      created_at: NOW,
      updated_at: NOW,
      ...values,
    };
    const keys = Object.keys(row);
    sqlite
      .prepare(
        `INSERT INTO collection_directory_item (${keys.join(", ")})
         VALUES (${keys.map(() => "?").join(", ")})`,
      )
      .run(...keys.map((key) => row[key]));
  }

  function insertNavItem(values: Record<string, unknown>) {
    const row = {
      id: `nav_${Math.random().toString(36).slice(2, 12)}`,
      site_id: SITE,
      type: "smart_collection",
      system_key: null,
      collection_id: null,
      smart_collection_id: null,
      post_id: null,
      label: "",
      url: "/quotes",
      placement: "header",
      position: `a${Math.random().toString(36).slice(2, 8)}`,
      created_at: NOW,
      updated_at: NOW,
      ...values,
    };
    const keys = Object.keys(row);
    sqlite
      .prepare(
        `INSERT INTO nav_item (${keys.join(", ")})
         VALUES (${keys.map(() => "?").join(", ")})`,
      )
      .run(...keys.map((key) => row[key]));
  }

  describe("path_registry", () => {
    it("accepts a slug pointing at a smart collection", () => {
      expect(() =>
        insertPath({ smart_collection_id: smartA, path: "quotes" }),
      ).not.toThrow();
    });

    it("accepts an alias pointing at a smart collection", () => {
      expect(() =>
        insertPath({
          kind: "alias",
          smart_collection_id: smartA,
          path: "old-quotes",
        }),
      ).not.toThrow();
    });

    it("refuses a slug that points at two things at once", () => {
      expect(() =>
        insertPath({ smart_collection_id: smartA, collection_id: collectionA }),
      ).toThrow();
      expect(() =>
        insertPath({ smart_collection_id: smartA, post_id: postA }),
      ).toThrow();
    });

    it("refuses a redirect or archive row that names a smart collection", () => {
      expect(() =>
        insertPath({
          kind: "redirect",
          smart_collection_id: smartA,
          redirect_to_path: "quotes",
          redirect_type: 301,
        }),
      ).toThrow();
      expect(() =>
        insertPath({
          kind: "archive",
          smart_collection_id: smartA,
          archive_query: "format=quote",
        }),
      ).toThrow();
    });

    it("allows only one slug per smart collection", () => {
      insertPath({ smart_collection_id: smartA, path: "quotes" });
      expect(() =>
        insertPath({ smart_collection_id: smartA, path: "quotes-2" }),
      ).toThrow();

      // An alias is not a second slug, so it is still allowed.
      expect(() =>
        insertPath({
          kind: "alias",
          smart_collection_id: smartA,
          path: "old-quotes",
        }),
      ).not.toThrow();
    });

    it("keeps smart collections in the same address space as everything else", () => {
      insertPath({ smart_collection_id: smartA, path: "quotes" });
      expect(() =>
        insertPath({ collection_id: collectionA, path: "quotes" }),
      ).toThrow();
      expect(() => insertPath({ post_id: postA, path: "quotes" })).toThrow();
    });
  });

  describe("collection_directory_item", () => {
    it("accepts a smart collection row", () => {
      expect(() =>
        insertDirectoryItem({ smart_collection_id: smartA }),
      ).not.toThrow();
    });

    it("refuses a smart collection row with no target", () => {
      expect(() => insertDirectoryItem({})).toThrow();
    });

    it("refuses a smart collection row carrying a label or url", () => {
      expect(() =>
        insertDirectoryItem({ smart_collection_id: smartA, label: "Quotes" }),
      ).toThrow();
      expect(() =>
        insertDirectoryItem({ smart_collection_id: smartA, url: "/quotes" }),
      ).toThrow();
    });

    it("refuses every other row type carrying a smart collection", () => {
      expect(() =>
        insertDirectoryItem({
          type: "collection",
          collection_id: collectionA,
          smart_collection_id: smartA,
        }),
      ).toThrow();
      expect(() =>
        insertDirectoryItem({ type: "divider", smart_collection_id: smartA }),
      ).toThrow();
      expect(() =>
        insertDirectoryItem({
          type: "link",
          label: "Elsewhere",
          url: "https://example.com",
          smart_collection_id: smartA,
        }),
      ).toThrow();
    });

    it("places a smart collection at most once", () => {
      insertDirectoryItem({ smart_collection_id: smartA });
      expect(() =>
        insertDirectoryItem({ smart_collection_id: smartA }),
      ).toThrow();
      expect(() =>
        insertDirectoryItem({ smart_collection_id: smartB }),
      ).not.toThrow();
    });
  });

  describe("nav_item", () => {
    it("accepts a smart collection nav item", () => {
      expect(() =>
        insertNavItem({ smart_collection_id: smartA }),
      ).not.toThrow();
    });

    it("refuses a smart collection nav item with no target", () => {
      expect(() => insertNavItem({})).toThrow();
    });

    it("refuses every other nav type carrying a smart collection", () => {
      expect(() =>
        insertNavItem({
          type: "link",
          smart_collection_id: smartA,
          label: "Elsewhere",
        }),
      ).toThrow();
      expect(() =>
        insertNavItem({
          type: "system",
          system_key: "latest",
          smart_collection_id: smartA,
        }),
      ).toThrow();
      expect(() =>
        insertNavItem({
          type: "collection",
          collection_id: collectionA,
          smart_collection_id: smartA,
        }),
      ).toThrow();
      expect(() =>
        insertNavItem({
          type: "page",
          post_id: postA,
          smart_collection_id: smartA,
        }),
      ).toThrow();
    });

    it("adds a smart collection to navigation at most once", () => {
      insertNavItem({ smart_collection_id: smartA });
      expect(() => insertNavItem({ smart_collection_id: smartA })).toThrow();
      expect(() =>
        insertNavItem({ smart_collection_id: smartB }),
      ).not.toThrow();
    });
  });

  describe("smart_collection", () => {
    it("refuses a private visibility condition", () => {
      // The one value a published page can never name. Enforced in the column,
      // not only in Zod, so no import path or backfill can slip one in.
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO smart_collection (id, site_id, title, visibility, sort, created_at, updated_at)
             VALUES (?, ?, 'Private', 'private', 'newest', ?, ?)`,
          )
          .run(`smc_private0000000000000000000`, SITE, NOW, NOW),
      ).toThrow();
    });

    it("refuses a sort or layout it cannot render", () => {
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO smart_collection (id, site_id, title, sort, created_at, updated_at)
             VALUES (?, ?, 'Bad sort', 'rating_asc', ?, ?)`,
          )
          .run(`smc_badsort00000000000000000000`, SITE, NOW, NOW),
      ).toThrow();
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO smart_collection (id, site_id, title, sort, layout, created_at, updated_at)
             VALUES (?, ?, 'Bad layout', 'newest', 'carousel', ?, ?)`,
          )
          .run(`smc_badlayout00000000000000000`, SITE, NOW, NOW),
      ).toThrow();
    });

    it("leaves a deleted collection's id in place rather than widening", () => {
      sqlite
        .prepare(`UPDATE smart_collection SET collection_id = ? WHERE id = ?`)
        .run(collectionA, smartA);

      // No foreign key on this column, alone in the schema. RESTRICT would fail
      // anonymously and make every bulk delete an ordering rule; SET NULL would
      // turn a curated page into the whole archive. The refusal an author sees
      // is `smartCollections.assertCollectionUnused()`, and what is left if
      // something reaches around it is a condition naming a collection that no
      // longer exists — which matches nothing.
      expect(() =>
        sqlite.prepare(`DELETE FROM collection WHERE id = ?`).run(collectionA),
      ).not.toThrow();

      const row = sqlite
        .prepare(`SELECT collection_id FROM smart_collection WHERE id = ?`)
        .get(smartA) as { collection_id: string | null };
      expect(row.collection_id).toBe(collectionA);
    });

    it("refuses a year no timestamp could carry", () => {
      // `Date.UTC` returns NaN past year 275760, and a NaN bound is a
      // comparison every row fails with nothing to report.
      for (const year of [1970, 10000]) {
        expect(() =>
          sqlite
            .prepare(
              `INSERT INTO smart_collection (id, site_id, title, year, sort, created_at, updated_at)
               VALUES (?, ?, 'Bad year', ?, 'newest', ?, ?)`,
            )
            .run(
              `smc_year${year}000000000000000000`.slice(0, 30),
              SITE,
              year,
              NOW,
              NOW,
            ),
        ).toThrow();
      }

      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO smart_collection (id, site_id, title, year, sort, created_at, updated_at)
             VALUES (?, ?, 'Edge years', 9999, 'newest', ?, ?)`,
          )
          .run(`smc_year9999000000000000000000`.slice(0, 30), SITE, NOW, NOW),
      ).not.toThrow();
    });
  });
});
