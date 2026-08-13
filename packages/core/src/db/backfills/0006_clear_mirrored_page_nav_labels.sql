-- Clear page and collection nav labels that merely mirror their target's title.
-- Previously these items stored a snapshot of the post or collection title taken
-- when the item was added, so renaming the target left the nav entry behind. Now
-- an empty label means "follow the target" and any non-empty value is a label the
-- author typed, which wins in every language view.
--
-- Rows whose stored label differs from the current title were customized and are
-- left alone. Idempotent: rerunning matches nothing once the labels are empty.
UPDATE "nav_item"
SET "label" = ''
WHERE "type" = 'page'
  AND "post_id" IS NOT NULL
  AND "label" <> ''
  AND "label" = (
    SELECT trim("post"."title")
    FROM "post"
    WHERE "post"."id" = "nav_item"."post_id"
      AND "post"."site_id" = "nav_item"."site_id"
  );

UPDATE "nav_item"
SET "label" = ''
WHERE "type" = 'collection'
  AND "collection_id" IS NOT NULL
  AND "label" <> ''
  AND "label" = (
    SELECT trim("collection"."title")
    FROM "collection"
    WHERE "collection"."id" = "nav_item"."collection_id"
      AND "collection"."site_id" = "nav_item"."site_id"
  );
