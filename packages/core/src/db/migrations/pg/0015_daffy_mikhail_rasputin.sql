CREATE TABLE "github_app_installation" (
	"installation_id" text NOT NULL,
	"site_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"account_avatar_url" text DEFAULT '' NOT NULL,
	"added_at" integer NOT NULL,
	CONSTRAINT "github_app_installation_installation_id_site_id_pk" PRIMARY KEY("installation_id","site_id"),
	CONSTRAINT "chk_github_app_installation_account_type" CHECK ("github_app_installation"."account_type" IN ('User', 'Organization'))
);
--> statement-breakpoint
ALTER TABLE "github_app_installation" ADD CONSTRAINT "github_app_installation_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_app_installation_by_installation" ON "github_app_installation" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "github_app_installation_by_site" ON "github_app_installation" USING btree ("site_id");