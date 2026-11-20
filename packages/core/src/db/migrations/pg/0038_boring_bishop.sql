ALTER TABLE "smart_collection" DROP CONSTRAINT "chk_smart_collection_format";--> statement-breakpoint
ALTER TABLE "smart_collection" DROP CONSTRAINT "chk_smart_collection_visibility";--> statement-breakpoint
ALTER TABLE "smart_collection" DROP CONSTRAINT "chk_smart_collection_year";--> statement-breakpoint
ALTER TABLE "smart_collection" ALTER COLUMN "year" SET DATA TYPE text USING "year"::text;--> statement-breakpoint
ALTER TABLE "smart_collection" ADD COLUMN "match_mode" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "smart_collection" ADD CONSTRAINT "chk_smart_collection_match_mode" CHECK ("smart_collection"."match_mode" IN ('all', 'any'));--> statement-breakpoint
ALTER TABLE "smart_collection" ADD CONSTRAINT "chk_smart_collection_format" CHECK ("smart_collection"."format" IS NULL OR "smart_collection"."format" IN ('note', 'link', 'note,link', 'quote', 'note,quote', 'link,quote', 'note,link,quote'));--> statement-breakpoint
ALTER TABLE "smart_collection" ADD CONSTRAINT "chk_smart_collection_visibility" CHECK ("smart_collection"."visibility" IS NULL OR "smart_collection"."visibility" IN ('public', 'featured', 'public,featured', 'latest_hidden', 'public,latest_hidden', 'featured,latest_hidden', 'public,featured,latest_hidden'));--> statement-breakpoint
ALTER TABLE "smart_collection" ADD CONSTRAINT "chk_smart_collection_year" CHECK ("smart_collection"."year" IS NULL OR btrim("smart_collection"."year") <> '');
