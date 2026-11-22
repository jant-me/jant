CREATE TABLE "oauth_client" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_code" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scope" text NOT NULL,
	"expires_at" integer NOT NULL,
	"used_at" integer,
	"created_at" integer NOT NULL,
	CONSTRAINT "oauth_code_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_code" ADD CONSTRAINT "oauth_code_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_code" ADD CONSTRAINT "oauth_code_client_id_oauth_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_code" ADD CONSTRAINT "oauth_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_oauth_client_site_id" ON "oauth_client" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_code_site_id" ON "oauth_code" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "idx_oauth_code_client_id" ON "oauth_code" USING btree ("client_id");