/**
 * The tables a content-lab export dumps, and the query that reads each one.
 *
 * Separate from `export-content-lab.mjs` so the catalog can be read without
 * running the export: that script resolves the remote site at module load, so
 * importing it would shell out to Wrangler. `scripts/check-site-tables.mjs`
 * checks this list against the schema and against the snapshot registry, and
 * needs to import it to do so.
 *
 * The order is an INSERT order — the dump is replayed top to bottom — so a
 * table follows everything it holds a foreign key into.
 */

/**
 * Build the ordered `[table, query]` pairs a content-lab export dumps.
 *
 * @param escapedSiteId - Site id, already escaped for a SQL string literal.
 * @returns Ordered pairs of table name and the SELECT that reads its rows.
 *
 * @example
 * ```js
 * for (const [table, query] of buildContentLabExportQueries(siteId)) {
 *   dumpTable(table, query);
 * }
 * ```
 */
export function buildContentLabExportQueries(escapedSiteId) {
  return [
    [
      "post",
      `SELECT * FROM post
     WHERE site_id = '${escapedSiteId}'
     ORDER BY CASE WHEN reply_to_id IS NULL THEN 0 ELSE 1 END, created_at, id`,
    ],
    [
      "collection",
      `SELECT * FROM collection
     WHERE site_id = '${escapedSiteId}'
     ORDER BY created_at, id`,
    ],
    [
      // After `collection`, because a smart collection may hold a foreign key
      // into one; before `nav_item` and `collection_directory_item`, which hold
      // keys into it.
      "smart_collection",
      `SELECT * FROM smart_collection
     WHERE site_id = '${escapedSiteId}'
     ORDER BY created_at, id`,
    ],
    [
      "nav_item",
      `SELECT * FROM nav_item
     WHERE site_id = '${escapedSiteId}'
     ORDER BY position, id`,
    ],
    [
      "collection_directory_item",
      `SELECT * FROM collection_directory_item
     WHERE site_id = '${escapedSiteId}'
     ORDER BY position, id`,
    ],
    [
      "thread_collection",
      `SELECT tc.* FROM thread_collection tc
     JOIN post p ON p.id = tc.thread_id
     WHERE tc.site_id = '${escapedSiteId}'
     ORDER BY tc.created_at, tc.collection_id, tc.thread_id`,
    ],
    [
      "path_registry",
      `SELECT pr.* FROM path_registry pr
     LEFT JOIN post p ON p.id = pr.post_id
     LEFT JOIN collection c ON c.id = pr.collection_id
     LEFT JOIN smart_collection sc ON sc.id = pr.smart_collection_id
     WHERE pr.site_id = '${escapedSiteId}'
       AND (
         pr.kind = 'redirect'
        -- Like a redirect, an archive path points at no row, so there is no
        -- dangling target to filter out. It is also the one kind nothing
        -- creates any more, which makes a snapshot the only place it survives.
        OR pr.kind = 'archive'
        OR (pr.post_id IS NOT NULL AND p.id IS NOT NULL)
        OR (pr.collection_id IS NOT NULL AND c.id IS NOT NULL)
        OR (pr.smart_collection_id IS NOT NULL AND sc.id IS NOT NULL)
       )
     ORDER BY pr.path, pr.id`,
    ],
    [
      "api_token",
      `SELECT * FROM api_token
     WHERE site_id = '${escapedSiteId}'
     ORDER BY created_at, id`,
    ],
    [
      "media",
      `SELECT m.* FROM media m
     WHERE m.site_id = '${escapedSiteId}'
     ORDER BY m.created_at, m.id`,
    ],
  ];
}
