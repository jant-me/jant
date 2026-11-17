ALTER TABLE "view_count" ADD COLUMN "via" text DEFAULT 'page' NOT NULL;--> statement-breakpoint
ALTER TABLE "view_count" DROP CONSTRAINT "view_count_site_id_day_page_referrer_pk";--> statement-breakpoint
ALTER TABLE "view_count" ADD CONSTRAINT "view_count_site_id_day_page_referrer_via_pk" PRIMARY KEY("site_id","day","page","referrer","via");