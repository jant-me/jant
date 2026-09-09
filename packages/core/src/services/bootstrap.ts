/**
 * Bootstrap Service
 *
 * Owns first-run setup, which runs in two acts on a self-hosted site: the
 * account is created first, and everything about the site itself is settled
 * afterwards. The two are separate methods because the site is left standing
 * between them — `markSiteProvisioned` closes the first act, which is the same
 * state a control plane leaves a hosted site in, so the second act is one code
 * path for both install kinds.
 */

import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { createNavItemService } from "./navigation.js";
import { createSettingsService } from "./settings.js";
import { createSiteMemberService } from "./site-member.js";
import { createSiteService, type EnsureSingleSiteOptions } from "./site.js";

export interface ProvisionOwnerAccountData {
  /** The account the first setup screen just created. */
  ownerUserId: string;
}

export interface CompleteSiteSetupData {
  /**
   * The site's name, on an install that does not have one yet.
   *
   * Omitted on a hosted site: the control plane named it at creation, so the
   * second screen never asks and must not overwrite.
   */
  siteName?: string | null;
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
  /**
   * The browser's time zone, already mapped to a supported one by the caller.
   *
   * Omitted where the shell already carries one, so a second screen loaded in
   * a different place cannot move a hosted site's clock.
   */
  timeZone?: string | null;
}

export interface CompleteSiteSetupDeps {
  /**
   * Align the operator's better-auth account name with the site's display
   * name, the way the general settings page does whenever the name changes.
   *
   * Injected rather than called here: the update needs the request's own
   * headers to know whose account it is, and a service has none.
   */
  updateCurrentUserName?: ((displayName: string) => Promise<void>) | null;
}

export interface BootstrapService {
  /**
   * Stand the site up around a newly created owner account.
   *
   * Everything here is what a site needs to exist at all — a row, an owner, a
   * navigation profile. Nothing here is an answer the author gave, because at
   * this point they have given none beyond their credentials.
   *
   * Ends by marking the site provisioned rather than complete. That is what
   * makes the gap between the two screens survivable: at `provisioned` the
   * onboarding middleware serves `/signin` normally, so an author who loses
   * the session before finishing signs back in and lands on the second screen.
   *
   * @param data - The account the first screen created
   */
  provisionOwnerAccount(data: ProvisionOwnerAccountData): Promise<void>;

  /**
   * Close first-run setup by recording what the author said about their site.
   *
   * Shared by both install kinds: a self-hosted site arrives here from its
   * second screen with a name to set, a hosted site from its only screen with
   * the name already stored. Onboarding is marked complete last, so an
   * interrupted run resumes rather than stranding a half-answered site.
   *
   * @param data - The answers the second screen collected
   * @param opts - The language in effect before this answer
   * @param deps - Cross-cutting work the route owns, such as the better-auth
   *   account rename that needs the request's headers
   */
  completeSiteSetup(
    data: CompleteSiteSetupData,
    opts: { oldLanguage: string },
    deps?: CompleteSiteSetupDeps,
  ): Promise<void>;
}

export function createBootstrapService(
  db: Database,
  options?: {
    schema?: DatabaseSchema;
    bootstrapSite?: EnsureSingleSiteOptions;
  },
): BootstrapService {
  const databaseSchema = options?.schema ?? sqliteSchemaBundle;

  async function resolveSiteSettings() {
    const siteService = createSiteService(db, databaseSchema);
    const { site } = await siteService.ensureSingleSite(options?.bootstrapSite);
    return {
      site,
      settings: createSettingsService(db, site.id, databaseSchema),
    };
  }

  return {
    async provisionOwnerAccount(data) {
      const { site, settings } = await resolveSiteSettings();
      const navItems = createNavItemService(db, site.id, databaseSchema);
      const siteMembers = createSiteMemberService(db, databaseSchema);

      await siteMembers.ensure(site.id, data.ownerUserId, "owner");
      await navItems.materializeDefaultNavigation();
      await settings.markSiteProvisioned();
    },

    async completeSiteSetup(data, opts, deps) {
      const { settings } = await resolveSiteSettings();

      const siteName = data.siteName?.trim();
      if (siteName) {
        await settings.set("SITE_NAME", siteName);
        // Before onboarding closes, deliberately: if the rename fails the site
        // is still provisioned, and the author retries the screen they were
        // already on rather than landing in a finished site under a stale name.
        await deps?.updateCurrentUserName?.(siteName);
      }

      // `undefined` means the shell already has one. `null` is a browser that
      // reported nothing, which is the same UTC default the site would fall
      // back to anyway — written so a later reader sees a chosen value.
      if (data.timeZone !== undefined) {
        await settings.set("TIME_ZONE", data.timeZone ?? "UTC");
      }

      await settings.confirmFirstRunLanguage(
        {
          siteLanguage: data.siteLanguage ?? "",
          browserLanguage: data.browserLanguage,
        },
        opts,
      );
    },
  };
}
