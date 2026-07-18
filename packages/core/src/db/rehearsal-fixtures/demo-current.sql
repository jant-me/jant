-- =============================================================================
-- Frozen migration rehearsal fixture for Jant (site-aware core)
-- Seed source: minimal current-schema content sample
-- Refresh flow: keep this fixture aligned with the latest schema baseline
-- =============================================================================

INSERT INTO "site" ("id", "key", "status", "created_at", "updated_at")
VALUES ('sit_01kme7j7j1f4m7s2k8r5c9t0qb', 'default', 'active', 1774200000, 1774200000);

INSERT INTO "site_setting" ("site_id", "key", "value", "updated_at") VALUES
  ('sit_01kme7j7j1f4m7s2k8r5c9t0qb', 'SITE_NAME', 'Rehearsal Demo', 1774200001),
  ('sit_01kme7j7j1f4m7s2k8r5c9t0qb', 'SITE_DESCRIPTION', 'Current-schema rehearsal fixture', 1774200002),
  ('sit_01kme7j7j1f4m7s2k8r5c9t0qb', 'SITE_LANGUAGE', 'en', 1774200003),
  ('sit_01kme7j7j1f4m7s2k8r5c9t0qb', 'TIME_ZONE', 'Asia/Shanghai', 1774200004);

INSERT INTO "collection" (
  "id",
  "site_id",
  "title",
  "description",
  "sort_order",
  "created_at",
  "updated_at"
) VALUES (
  'col_01kme7j8f9f4m7s2k8r5c9t0qc',
  'sit_01kme7j7j1f4m7s2k8r5c9t0qb',
  'Rehearsal Notes',
  'Fixture collection for migration rehearsal.',
  'newest',
  1774200010,
  1774200010
);

INSERT INTO "collection" (
  "id",
  "site_id",
  "title",
  "description",
  "sort_order",
  "created_at",
  "updated_at"
) VALUES (
  'col_01kme7j8f9f4m7s2k8r5c9t0qd',
  'sit_01kme7j7j1f4m7s2k8r5c9t0qb',
  'Child-only Notes',
  'Collection assigned only to a reply before the Thread migration.',
  'newest',
  1774200011,
  1774200011
);

INSERT INTO "nav_item" (
  "id",
  "site_id",
  "type",
  "system_key",
  "label",
  "url",
  "position",
  "created_at",
  "updated_at"
) VALUES (
  'nav_01kme7j8xfe4m7s2k8r5c9t0qa',
  'sit_01kme7j7j1f4m7s2k8r5c9t0qb',
  'system',
  'rss',
  '',
  '/rss',
  'a0',
  1774200011,
  1774200011
);

INSERT INTO "nav_item" (
  "id",
  "site_id",
  "type",
  "system_key",
  "label",
  "url",
  "position",
  "created_at",
  "updated_at"
) VALUES (
  'nav_01kme7j8xfe4m7s2k8r5c9t0qb',
  'sit_01kme7j7j1f4m7s2k8r5c9t0qb',
  'system',
  'settings',
  '',
  '/settings',
  'a1',
  1774200011,
  1774200011
);

INSERT INTO "nav_item" (
  "id",
  "site_id",
  "type",
  "system_key",
  "label",
  "url",
  "position",
  "created_at",
  "updated_at"
) VALUES (
  'nav_01kme7j8xfe4m7s2k8r5c9t0qd',
  'sit_01kme7j7j1f4m7s2k8r5c9t0qb',
  'system',
  'collections',
  '',
  '/collections',
  'a2',
  1774200011,
  1774200011
);

INSERT INTO "collection_directory_item" (
  "id",
  "site_id",
  "type",
  "collection_id",
  "label",
  "position",
  "created_at",
  "updated_at"
) VALUES (
  'cdi_01kme7j9bbf4m7s2k8r5c9t0qe',
  'sit_01kme7j7j1f4m7s2k8r5c9t0qb',
  'collection',
  'col_01kme7j8f9f4m7s2k8r5c9t0qc',
  NULL,
  'a0',
  1774200012,
  1774200012
);

INSERT INTO "post" (
  "id",
  "site_id",
  "format",
  "status",
  "visibility",
  "title",
  "body",
  "body_html",
  "body_text",
  "thread_id",
  "published_at",
  "last_activity_at",
  "created_at",
  "updated_at"
) VALUES (
  'pst_01kme7ja2mf4m7s2k8r5c9t0qf',
  'sit_01kme7j7j1f4m7s2k8r5c9t0qb',
  'note',
  'published',
  'public',
  'Rehearsal post',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Migration rehearsal content."}]}]}',
  '<p>Migration rehearsal content.</p>',
  'Migration rehearsal content.',
  'pst_01kme7ja2mf4m7s2k8r5c9t0qf',
  1774200020,
  1774200020,
  1774200020,
  1774200020
);

INSERT INTO "post" (
  "id",
  "site_id",
  "format",
  "status",
  "visibility",
  "title",
  "body",
  "body_html",
  "body_text",
  "reply_to_id",
  "thread_id",
  "published_at",
  "last_activity_at",
  "created_at",
  "updated_at"
) VALUES (
  'pst_01kme7ja2mf4m7s2k8r5c9t0qh',
  'sit_01kme7j7j1f4m7s2k8r5c9t0qb',
  'note',
  'published',
  NULL,
  'First rehearsal reply',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"First migration rehearsal reply."}]}]}',
  '<p>First migration rehearsal reply.</p>',
  'First migration rehearsal reply.',
  'pst_01kme7ja2mf4m7s2k8r5c9t0qf',
  'pst_01kme7ja2mf4m7s2k8r5c9t0qf',
  1774200030,
  1774200030,
  1774200030,
  1774200030
);

INSERT INTO "post" (
  "id",
  "site_id",
  "format",
  "status",
  "visibility",
  "title",
  "body",
  "body_html",
  "body_text",
  "reply_to_id",
  "thread_id",
  "published_at",
  "last_activity_at",
  "created_at",
  "updated_at"
) VALUES (
  'pst_01kme7ja2mf4m7s2k8r5c9t0qi',
  'sit_01kme7j7j1f4m7s2k8r5c9t0qb',
  'note',
  'published',
  NULL,
  'Second rehearsal reply',
  '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Second migration rehearsal reply."}]}]}',
  '<p>Second migration rehearsal reply.</p>',
  'Second migration rehearsal reply.',
  'pst_01kme7ja2mf4m7s2k8r5c9t0qh',
  'pst_01kme7ja2mf4m7s2k8r5c9t0qf',
  1774200040,
  1774200040,
  1774200040,
  1774200040
);

INSERT INTO "post_collection" (
  "site_id",
  "post_id",
  "collection_id",
  "created_at",
  "position",
  "pinned_at"
) VALUES
  (
    'sit_01kme7j7j1f4m7s2k8r5c9t0qb',
    'pst_01kme7ja2mf4m7s2k8r5c9t0qf',
    'col_01kme7j8f9f4m7s2k8r5c9t0qc',
    1774200021,
    7,
    1774200300
  ),
  (
    'sit_01kme7j7j1f4m7s2k8r5c9t0qb',
    'pst_01kme7ja2mf4m7s2k8r5c9t0qh',
    'col_01kme7j8f9f4m7s2k8r5c9t0qc',
    1774200040,
    5,
    NULL
  ),
  (
    'sit_01kme7j7j1f4m7s2k8r5c9t0qb',
    'pst_01kme7ja2mf4m7s2k8r5c9t0qi',
    'col_01kme7j8f9f4m7s2k8r5c9t0qc',
    1774200030,
    1,
    1774200500
  ),
  (
    'sit_01kme7j7j1f4m7s2k8r5c9t0qb',
    'pst_01kme7ja2mf4m7s2k8r5c9t0qh',
    'col_01kme7j8f9f4m7s2k8r5c9t0qd',
    1774200060,
    4,
    1774200600
  );

INSERT INTO "path_registry" (
  "id",
  "site_id",
  "path",
  "kind",
  "post_id",
  "collection_id",
  "redirect_to_path",
  "redirect_type",
  "created_at",
  "updated_at"
) VALUES (
  'pth_01kme7jannf4m7s2k8r5c9t0qg',
  'sit_01kme7j7j1f4m7s2k8r5c9t0qb',
  'rehearsal-post',
  'slug',
  'pst_01kme7ja2mf4m7s2k8r5c9t0qf',
  NULL,
  NULL,
  NULL,
  1774200022,
  1774200022
);
