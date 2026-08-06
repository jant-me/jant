-- Split "last announced" from "last changed" for Threads.
--
-- Until now a quiet reply was implemented by *skipping* the recalculation of
-- post.last_activity_at, and the quietness itself was never stored. That made
-- the flag non-durable: the next recalculation (deleting any post in the
-- Thread, changing a published_at, republishing) recomputed
-- MAX(published_at) over the whole Thread, absorbed the quiet reply, and
-- bumped the Thread on Latest anyway.
--
-- post.quiet_reply now persists the author's choice, so both timestamps are
-- pure functions of the rows:
--   last_activity_at  = MAX(published_at) excluding quiet replies  (Latest)
--   thread_updated_at = MAX(published_at) including quiet replies  (archive)
--
-- Step 1 recovers the quiet decisions that are still visible in the data.
-- A published reply can only sit later than its root's recorded
-- last_activity_at if the recalculation was skipped for it — that is the
-- signature of a quiet reply. Decisions that were already absorbed by a later
-- recalculation are unrecoverable and stay false, which matches the ordering
-- those sites are already seeing.
--
-- Steps 2 and 3 then recompute both timestamps from scratch.
--
-- Idempotent: after step 3 a quiet reply is still later than the recomputed
-- last_activity_at (it is excluded from that MAX), so a rerun re-selects
-- exactly the same rows, and every non-quiet published reply is covered by
-- the MAX and can never be selected.

-- Step 1: recover still-detectable quiet replies.
UPDATE "post"
SET "quiet_reply" = TRUE
WHERE "post"."reply_to_id" IS NOT NULL
  AND "post"."published_at" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "post" AS root
    WHERE root."site_id" = "post"."site_id"
      AND root."id" = "post"."thread_id"
      AND root."last_activity_at" IS NOT NULL
      AND "post"."published_at" > root."last_activity_at"
  );

-- Step 2: thread_updated_at — newest published post in the Thread, quiet included.
UPDATE "post"
SET "thread_updated_at" = (
  SELECT MAX(member."published_at")
  FROM "post" AS member
  WHERE member."site_id" = "post"."site_id"
    AND member."thread_id" = "post"."id"
    AND member."status" = 'published'
)
WHERE "post"."reply_to_id" IS NULL;

-- Step 3: last_activity_at — newest announced post in the Thread.
-- Threads with nothing published (drafts) keep whatever they had.
UPDATE "post"
SET "last_activity_at" = COALESCE(
  (
    SELECT MAX(member."published_at")
    FROM "post" AS member
    WHERE member."site_id" = "post"."site_id"
      AND member."thread_id" = "post"."id"
      AND member."status" = 'published'
      AND member."quiet_reply" = FALSE
  ),
  "post"."last_activity_at"
)
WHERE "post"."reply_to_id" IS NULL;
