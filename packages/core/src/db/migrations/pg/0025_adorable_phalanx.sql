CREATE TABLE "site_notice" (
	"site_id" text NOT NULL,
	"key" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"action_label" text,
	"action_url" text,
	"expires_at" integer,
	"updated_at" integer NOT NULL,
	CONSTRAINT "site_notice_site_id_key_pk" PRIMARY KEY("site_id","key"),
	CONSTRAINT "chk_site_notice_severity" CHECK ("site_notice"."severity" IN ('info', 'warn', 'urgent'))
);
--> statement-breakpoint
ALTER TABLE "site_notice" ADD CONSTRAINT "site_notice_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_site_notice_site_id" ON "site_notice" USING btree ("site_id");