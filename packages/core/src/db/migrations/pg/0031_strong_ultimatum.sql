CREATE TABLE "smart_collection" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"format" text,
	"year" integer,
	"collection_id" text,
	"media" text,
	"has_title" boolean,
	"has_replies" boolean,
	"visibility" text,
	"sort" text DEFAULT 'newest' NOT NULL,
	"layout" text,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL,
	CONSTRAINT "chk_smart_collection_format" CHECK ("smart_collection"."format" IS NULL OR "smart_collection"."format" IN ('note', 'link', 'quote')),
	CONSTRAINT "chk_smart_collection_visibility" CHECK ("smart_collection"."visibility" IS NULL OR "smart_collection"."visibility" IN ('public', 'featured', 'latest_hidden')),
	CONSTRAINT "chk_smart_collection_sort" CHECK ("smart_collection"."sort" IN ('newest', 'oldest', 'updated', 'rating_desc')),
	CONSTRAINT "chk_smart_collection_layout" CHECK ("smart_collection"."layout" IS NULL OR "smart_collection"."layout" IN ('list', 'grid')),
	CONSTRAINT "chk_smart_collection_year" CHECK ("smart_collection"."year" IS NULL OR "smart_collection"."year" BETWEEN 1971 AND 9999)
);
--> statement-breakpoint
ALTER TABLE "collection_directory_item" DROP CONSTRAINT "chk_collection_directory_item_type";--> statement-breakpoint
ALTER TABLE "collection_directory_item" DROP CONSTRAINT "chk_collection_directory_item_shape";--> statement-breakpoint
ALTER TABLE "collection_directory_item" DROP CONSTRAINT "chk_collection_directory_item_label";--> statement-breakpoint
ALTER TABLE "nav_item" DROP CONSTRAINT "chk_nav_item_type";--> statement-breakpoint
ALTER TABLE "nav_item" DROP CONSTRAINT "chk_nav_item_shape";--> statement-breakpoint
ALTER TABLE "path_registry" DROP CONSTRAINT "chk_path_registry_shape";--> statement-breakpoint
ALTER TABLE "collection_directory_item" ADD COLUMN "smart_collection_id" text;--> statement-breakpoint
ALTER TABLE "nav_item" ADD COLUMN "smart_collection_id" text;--> statement-breakpoint
ALTER TABLE "path_registry" ADD COLUMN "smart_collection_id" text;--> statement-breakpoint
ALTER TABLE "smart_collection" ADD CONSTRAINT "smart_collection_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_smart_collection_site_created_at" ON "smart_collection" USING btree ("site_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_smart_collection_site_collection_id" ON "smart_collection" USING btree ("site_id","collection_id");--> statement-breakpoint
ALTER TABLE "collection_directory_item" ADD CONSTRAINT "collection_directory_item_smart_collection_id_smart_collection_id_fk" FOREIGN KEY ("smart_collection_id") REFERENCES "public"."smart_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_item" ADD CONSTRAINT "nav_item_smart_collection_id_smart_collection_id_fk" FOREIGN KEY ("smart_collection_id") REFERENCES "public"."smart_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "path_registry" ADD CONSTRAINT "path_registry_smart_collection_id_smart_collection_id_fk" FOREIGN KEY ("smart_collection_id") REFERENCES "public"."smart_collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_collection_directory_item_site_smart_collection_id" ON "collection_directory_item" USING btree ("site_id","smart_collection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_collection_directory_item_site_smart_collection_once" ON "collection_directory_item" USING btree ("site_id","smart_collection_id") WHERE "collection_directory_item"."type" = 'smart_collection' AND "collection_directory_item"."smart_collection_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_nav_item_site_smart_collection_id" ON "nav_item" USING btree ("site_id","smart_collection_id") WHERE "nav_item"."smart_collection_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_path_registry_site_smart_collection_slug" ON "path_registry" USING btree ("site_id","smart_collection_id") WHERE "path_registry"."kind" = 'slug' AND "path_registry"."smart_collection_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_path_registry_site_smart_collection_id" ON "path_registry" USING btree ("site_id","smart_collection_id");--> statement-breakpoint
ALTER TABLE "collection_directory_item" ADD CONSTRAINT "chk_collection_directory_item_type" CHECK ("collection_directory_item"."type" IN ('collection', 'smart_collection', 'divider', 'link'));--> statement-breakpoint
ALTER TABLE "collection_directory_item" ADD CONSTRAINT "chk_collection_directory_item_shape" CHECK ((
        "collection_directory_item"."type" = 'collection'
        AND "collection_directory_item"."collection_id" IS NOT NULL
        AND "collection_directory_item"."smart_collection_id" IS NULL
        AND "collection_directory_item"."label" IS NULL
        AND "collection_directory_item"."url" IS NULL
      ) OR (
        "collection_directory_item"."type" = 'smart_collection'
        AND "collection_directory_item"."collection_id" IS NULL
        AND "collection_directory_item"."smart_collection_id" IS NOT NULL
        AND "collection_directory_item"."label" IS NULL
        AND "collection_directory_item"."url" IS NULL
      ) OR (
        "collection_directory_item"."type" = 'divider'
        AND "collection_directory_item"."collection_id" IS NULL
        AND "collection_directory_item"."smart_collection_id" IS NULL
        AND "collection_directory_item"."url" IS NULL
      ) OR (
        "collection_directory_item"."type" = 'link'
        AND "collection_directory_item"."collection_id" IS NULL
        AND "collection_directory_item"."smart_collection_id" IS NULL
        AND "collection_directory_item"."label" IS NOT NULL
        AND "collection_directory_item"."url" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "collection_directory_item" ADD CONSTRAINT "chk_collection_directory_item_label" CHECK ("collection_directory_item"."type" NOT IN ('collection', 'smart_collection') OR "collection_directory_item"."label" IS NULL);--> statement-breakpoint
ALTER TABLE "nav_item" ADD CONSTRAINT "chk_nav_item_type" CHECK ("nav_item"."type" IN ('link', 'system', 'collection', 'smart_collection', 'page'));--> statement-breakpoint
ALTER TABLE "nav_item" ADD CONSTRAINT "chk_nav_item_shape" CHECK ((
        "nav_item"."type" = 'link'
        AND "nav_item"."system_key" IS NULL
        AND "nav_item"."collection_id" IS NULL
        AND "nav_item"."smart_collection_id" IS NULL
        AND "nav_item"."post_id" IS NULL
      ) OR (
        "nav_item"."type" = 'system'
        AND "nav_item"."system_key" IS NOT NULL
        AND "nav_item"."collection_id" IS NULL
        AND "nav_item"."smart_collection_id" IS NULL
        AND "nav_item"."post_id" IS NULL
      ) OR (
        "nav_item"."type" = 'collection'
        AND "nav_item"."system_key" IS NULL
        AND "nav_item"."collection_id" IS NOT NULL
        AND "nav_item"."smart_collection_id" IS NULL
        AND "nav_item"."post_id" IS NULL
      ) OR (
        "nav_item"."type" = 'smart_collection'
        AND "nav_item"."system_key" IS NULL
        AND "nav_item"."collection_id" IS NULL
        AND "nav_item"."smart_collection_id" IS NOT NULL
        AND "nav_item"."post_id" IS NULL
      ) OR (
        "nav_item"."type" = 'page'
        AND "nav_item"."system_key" IS NULL
        AND "nav_item"."collection_id" IS NULL
        AND "nav_item"."smart_collection_id" IS NULL
        AND "nav_item"."post_id" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "path_registry" ADD CONSTRAINT "chk_path_registry_shape" CHECK ((
        "path_registry"."kind" IN ('slug', 'alias')
        AND (
          ("path_registry"."post_id" IS NOT NULL AND "path_registry"."collection_id" IS NULL AND "path_registry"."smart_collection_id" IS NULL)
          OR ("path_registry"."post_id" IS NULL AND "path_registry"."collection_id" IS NOT NULL AND "path_registry"."smart_collection_id" IS NULL)
          OR ("path_registry"."post_id" IS NULL AND "path_registry"."collection_id" IS NULL AND "path_registry"."smart_collection_id" IS NOT NULL)
        )
        AND "path_registry"."redirect_to_path" IS NULL
        AND "path_registry"."redirect_type" IS NULL
        AND "path_registry"."archive_query" IS NULL
      ) OR (
        "path_registry"."kind" = 'redirect'
        AND "path_registry"."post_id" IS NULL
        AND "path_registry"."collection_id" IS NULL
        AND "path_registry"."smart_collection_id" IS NULL
        AND "path_registry"."redirect_to_path" IS NOT NULL
        AND "path_registry"."redirect_type" IN (301, 302)
        AND "path_registry"."archive_query" IS NULL
      ) OR (
        "path_registry"."kind" = 'archive'
        AND "path_registry"."post_id" IS NULL
        AND "path_registry"."collection_id" IS NULL
        AND "path_registry"."smart_collection_id" IS NULL
        AND "path_registry"."redirect_to_path" IS NULL
        AND "path_registry"."redirect_type" IS NULL
        AND "path_registry"."archive_query" IS NOT NULL
      ));