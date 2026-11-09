CREATE TABLE "view_hour" (
	"site_id" text NOT NULL,
	"hour" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "view_hour_site_id_hour_pk" PRIMARY KEY("site_id","hour")
);
--> statement-breakpoint
ALTER TABLE "view_hour" ADD CONSTRAINT "view_hour_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;