-- `updated` was a fourth smart collection order until `newest` came to mean the
-- same thing. The narrowed CHECK below is validated against existing rows, so
-- any row still naming it has to be moved first.
UPDATE "smart_collection" SET "sort" = 'newest' WHERE "sort" = 'updated';--> statement-breakpoint
ALTER TABLE "smart_collection" DROP CONSTRAINT "chk_smart_collection_sort";--> statement-breakpoint
ALTER TABLE "smart_collection" ADD CONSTRAINT "chk_smart_collection_sort" CHECK ("smart_collection"."sort" IN ('newest', 'oldest', 'rating_desc'));