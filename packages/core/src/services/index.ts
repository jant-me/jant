/**
 * Services (v2)
 *
 * Business logic layer
 */

import type { Database } from "../db/index.js";
import type { DatabaseDialect } from "../db/dialect.js";
import type { RawQueryClient } from "../db/raw-query.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { createSettingsService, type SettingsService } from "./settings.js";
import { createPostService, type PostService } from "./post.js";
import { createCustomUrlService, type CustomUrlService } from "./custom-url.js";
import { createPathService, type PathService } from "./path.js";
import { createMediaService, type MediaService } from "./media.js";
import { createSiteService, type SiteService } from "./site.js";
import {
  createCollectionService,
  type CollectionService,
} from "./collection.js";
import { createSearchService, type SearchService } from "./search.js";
import { createNavItemService, type NavItemService } from "./navigation.js";
import { createAuthService, type AuthService } from "./auth.js";
import { createApiTokenService, type ApiTokenService } from "./api-token.js";
import { createBootstrapService, type BootstrapService } from "./bootstrap.js";
import { createSiteAdminService, type SiteAdminService } from "./site-admin.js";
import {
  createSiteMemberService,
  type SiteMemberService,
} from "./site-member.js";
import {
  createSiteProfileService,
  type SiteProfileService,
} from "./site-profile.js";
import { createAboutPageService, type AboutPageService } from "./about-page.js";
import { createLanguageService, type LanguageService } from "./language.js";
import {
  createUploadSessionService,
  type UploadSessionService,
} from "./upload-session.js";
import {
  createGitHubAppInstallationsService,
  type GitHubAppInstallationsService,
} from "./github-app-installations.js";
import { createTelegramService, type TelegramService } from "./telegram.js";
import type { HostedControlPlaneClient } from "../lib/hosted-control-plane.js";
import type { EnsureSingleSiteOptions } from "./site.js";

export interface Services {
  settings: SettingsService;
  site: SiteService;
  paths: PathService;
  posts: PostService;
  customUrls: CustomUrlService;
  media: MediaService;
  uploads: UploadSessionService;
  collections: CollectionService;
  search: SearchService;
  navItems: NavItemService;
  auth: AuthService;
  apiTokens: ApiTokenService;
  bootstrap: BootstrapService;
  siteAdmin: SiteAdminService;
  siteMembers: SiteMemberService;
  siteProfile: SiteProfileService;
  aboutPage: AboutPageService;
  language: LanguageService;
  githubAppInstallations: GitHubAppInstallationsService;
  telegram: TelegramService;
}

export function createServices(
  db: Database,
  rawQuery: RawQueryClient,
  siteId: string,
  config?: {
    slugIdLength?: number;
    schema?: DatabaseSchema;
    databaseDialect?: DatabaseDialect;
    bootstrapSite?: EnsureSingleSiteOptions;
    siteResolutionMode?: "single-site" | "host-based";
    enforceHostedMediaQuota?: boolean;
    hostedControlPlane?: HostedControlPlaneClient | null;
  },
): Services {
  const databaseSchema = config?.schema ?? sqliteSchemaBundle;
  const dialect = config?.databaseDialect ?? "sqlite";
  const site = createSiteService(db, databaseSchema);
  const settings = createSettingsService(db, siteId, databaseSchema, dialect);
  const paths = createPathService(db, siteId, databaseSchema);
  const navItems = createNavItemService(db, siteId, databaseSchema);
  const posts = createPostService(
    db,
    {
      slugIdLength: config?.slugIdLength ?? 5,
      databaseDialect: dialect,
    },
    siteId,
    paths,
    databaseSchema,
  );
  const collections = createCollectionService(
    db,
    siteId,
    paths,
    databaseSchema,
    dialect,
  );
  const media = createMediaService(db, siteId, databaseSchema, dialect, {
    enforceHostedQuota: config?.enforceHostedMediaQuota ?? false,
    hostedControlPlane: config?.hostedControlPlane ?? null,
  });

  return {
    settings,
    site,
    paths,
    posts,
    customUrls: createCustomUrlService(db, siteId, paths, databaseSchema),
    media,
    uploads: createUploadSessionService(db, siteId, media, databaseSchema),
    collections,
    search: createSearchService(rawQuery, siteId, dialect),
    navItems,
    auth: createAuthService(
      db,
      settings,
      {
        databaseDialect: dialect,
      },
      databaseSchema,
    ),
    apiTokens: createApiTokenService(db, siteId, databaseSchema),
    bootstrap: createBootstrapService(db, {
      schema: databaseSchema,
      bootstrapSite: config?.bootstrapSite,
    }),
    siteAdmin: createSiteAdminService(db, databaseSchema, dialect, {
      siteResolutionMode: config?.siteResolutionMode,
    }),
    siteMembers: createSiteMemberService(db, databaseSchema),
    siteProfile: createSiteProfileService(settings, siteId, {
      hostedControlPlane: config?.hostedControlPlane ?? null,
      logSyncError: (error) => {
        const message =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);
        process.stderr.write(
          `[Jant] Hosted control plane metadata sync failed: ${message}\n`,
        );
      },
    }),
    aboutPage: createAboutPageService({
      paths,
      posts,
      collections,
    }),
    language: createLanguageService({ settings, posts, paths }),
    githubAppInstallations: createGitHubAppInstallationsService(
      db,
      databaseSchema,
    ),
    telegram: createTelegramService(db, siteId, databaseSchema),
  };
}

export type { SettingsService } from "./settings.js";
export type { SiteService } from "./site.js";
export type { PathService } from "./path.js";
export type { PostService, PostFilters, PostDeleteDeps } from "./post.js";
export type { CustomUrlService } from "./custom-url.js";
export type { MediaService, MediaFilters } from "./media.js";
export type { UploadSessionService } from "./upload-session.js";
export type { CollectionService } from "./collection.js";
export type { SearchService, SearchResult, SearchOptions } from "./search.js";
export type { NavItemService } from "./navigation.js";
export type { AboutPageService, AboutPageStatus } from "./about-page.js";
export type { LanguageService, LanguageState } from "./language.js";
export type { AuthService, DeleteAccountDeps } from "./auth.js";
export type { ApiTokenService } from "./api-token.js";
export type {
  BootstrapService,
  CompleteInitialSetupData,
} from "./bootstrap.js";
export type { SiteMemberService } from "./site-member.js";
export type { SiteProfileService } from "./site-profile.js";
export type {
  CreateManagedSiteInput,
  ManagedSiteResult,
  SiteAdminService,
} from "./site-admin.js";
export type {
  GitHubAppInstallationsService,
  GitHubInstallationAccount,
  GitHubAccountType,
  StoredGitHubAppInstallation,
} from "./github-app-installations.js";
export type {
  TelegramService,
  TelegramBinding,
  TelegramStatus,
  TelegramUserBot,
} from "./telegram.js";
