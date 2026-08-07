/**
 * Bootstrap Service
 *
 * Owns first-run site shell setup after account creation.
 */

import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import {
  baseLocale,
  isValidContentLanguage,
  normalizeContentLanguage,
  resolveCatalogLocale,
} from "../i18n/locales.js";
import { createNavItemService } from "./navigation.js";
import { createSettingsService } from "./settings.js";
import { createSiteMemberService } from "./site-member.js";
import { createSiteService, type EnsureSingleSiteOptions } from "./site.js";

export interface CompleteInitialSetupData {
  ownerUserId: string;
  siteName: string;
  /** Language the site publishes in, chosen explicitly during setup. */
  siteLanguage?: string | null;
  /**
   * The browser's own language, used only to pin the dashboard UI locale.
   *
   * Kept separate from `siteLanguage` because the two genuinely differ for the
   * people this matters to most: someone running an English-language blog from
   * a Chinese browser wants an English site and a Chinese dashboard.
   */
  browserLanguage?: string | null;
  timeZone?: string | null;
}

export interface BootstrapService {
  /**
   * Complete first-run setup for a newly created account.
   * Materializes the versioned navigation profile and marks onboarding complete
   * last so an interrupted setup can recover safely.
   *
   * @param data - Initial site shell values captured during setup
   */
  completeInitialSetup(data: CompleteInitialSetupData): Promise<void>;
}

export function createBootstrapService(
  db: Database,
  options?: {
    schema?: DatabaseSchema;
    bootstrapSite?: EnsureSingleSiteOptions;
  },
): BootstrapService {
  const databaseSchema = options?.schema ?? sqliteSchemaBundle;

  return {
    async completeInitialSetup(data) {
      const siteService = createSiteService(db, databaseSchema);
      const { site } = await siteService.ensureSingleSite(
        options?.bootstrapSite,
      );
      const settings = createSettingsService(db, site.id, databaseSchema);
      const navItems = createNavItemService(db, site.id, databaseSchema);
      const siteMembers = createSiteMemberService(db, databaseSchema);

      await siteMembers.ensure(site.id, data.ownerUserId, "owner");
      await navItems.materializeDefaultNavigation();
      await settings.set("SITE_NAME", data.siteName.trim());
      await settings.set("TIME_ZONE", data.timeZone ?? "UTC");
      const siteLanguage =
        data.siteLanguage && isValidContentLanguage(data.siteLanguage)
          ? normalizeContentLanguage(data.siteLanguage)
          : baseLocale;
      await settings.set("SITE_LANGUAGE", siteLanguage);
      // Pin the dashboard UI locale to the browser's language, not the site's.
      // The dashboard is read by one person — the author — so their own
      // language is the better signal, and pinning it keeps it stable when the
      // public content language later changes.
      await settings.set(
        "DASHBOARD_LANGUAGE",
        resolveCatalogLocale(data.browserLanguage ?? siteLanguage),
      );

      await settings.completeOnboarding();
    },
  };
}
