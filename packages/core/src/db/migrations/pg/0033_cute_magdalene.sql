CREATE TABLE "view_count" (
	"site_id" text NOT NULL,
	"day" text NOT NULL,
	"page" text NOT NULL,
	"referrer" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "view_count_site_id_day_page_referrer_pk" PRIMARY KEY("site_id","day","page","referrer")
);
--> statement-breakpoint
ALTER TABLE "view_count" ADD CONSTRAINT "view_count_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;