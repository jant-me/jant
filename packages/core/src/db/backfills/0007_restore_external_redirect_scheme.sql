-- Restore the "//" after the scheme of redirects to another site.
-- A custom URL's redirect target went through the path normalizer, which folds
-- repeated slashes, so `https://example.com/page` was stored as
-- `https:/example.com/page`, and the redirect sent readers to a path on this
-- site instead. The normalizer also lowercased the target, which can't be
-- undone; the address works again, in lowercase.
--
-- Idempotent: a restored row starts with `https://` or `http://` and matches
-- nothing on a rerun.
UPDATE "path_registry"
SET "redirect_to_path" = 'https://' || substr("redirect_to_path", 8)
WHERE "kind" = 'redirect'
  AND "redirect_to_path" LIKE 'https:/%'
  AND "redirect_to_path" NOT LIKE 'https://%';

UPDATE "path_registry"
SET "redirect_to_path" = 'http://' || substr("redirect_to_path", 7)
WHERE "kind" = 'redirect'
  AND "redirect_to_path" LIKE 'http:/%'
  AND "redirect_to_path" NOT LIKE 'http://%';
