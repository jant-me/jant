ALTER TABLE "post" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "post" ADD COLUMN "translation_group_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_post_site_translation_group_language" ON "post" USING btree ("site_id","translation_group_id","language") WHERE "post"."translation_group_id" IS NOT NULL;