/**
 * Services
 *
 * Business logic layer
 */

import type { Database } from "../db/index.js";
import { createSettingsService, type SettingsService } from "./settings.js";
import { createPostService, type PostService } from "./post.js";
import { createRedirectService, type RedirectService } from "./redirect.js";
import { createMediaService, type MediaService } from "./media.js";
import { createCollectionService, type CollectionService } from "./collection.js";
import { createSearchService, type SearchService } from "./search.js";

export interface Services {
  settings: SettingsService;
  posts: PostService;
  redirects: RedirectService;
  media: MediaService;
  collections: CollectionService;
  search: SearchService;
}

export function createServices(db: Database, d1: D1Database): Services {
  return {
    settings: createSettingsService(db),
    posts: createPostService(db),
    redirects: createRedirectService(db),
    media: createMediaService(db),
    collections: createCollectionService(db),
    search: createSearchService(d1),
  };
}

export type { SettingsService } from "./settings.js";
export type { PostService, PostFilters } from "./post.js";
export type { RedirectService } from "./redirect.js";
export type { MediaService } from "./media.js";
export type { CollectionService } from "./collection.js";
export type { SearchService, SearchResult, SearchOptions } from "./search.js";
