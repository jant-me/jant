/**
 * Bootstrap Service
 *
 * Owns first-run setup, which runs in two acts on a self-hosted site: the
 * account is created first, and everything about the site itself is settled
 * afterwards. The two are separate methods because the site is left standing
 * between them — `markSiteProvisioned` closes the first act, which is the same
 * state a control plane leaves a hosted site in, so the second act is one code
 * path for both install kinds.
 *
 * Both acts write to the site the request resolved, the same site the route's
 * membership check reads. On a hosted install the database holds every tenant,
 * so "the only site" is not a question with an answer there.
 */

import type { DatabaseDialect } from "../db/dialect.js";
import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { createNavItemService } from "./navigation.js";
import { createSettingsService } from "./settings.js";
import { createSiteMemberService } from "./site-member.js";
import {
  createSiteService,
  TRANSIENT_SINGLE_SITE_ID,
  type EnsureSingleSiteOptions,
} from "./site.js";

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

/**
 * Create the first-run setup service for one request.
 *
 * @param db - The database
 * @param siteId - The site the request resolved. On a self-hosted install that
 *   has not finished the account step this is the transient placeholder, since
 *   no site row exists yet.
 * @param options - The schema, dialect and resolution mode the runtime uses,
 *   and where a self-hosted site's row and domain come from
 * @returns The bootstrap service bound to that site
 */
export function createBootstrapService(
  db: Database,
  siteId: string,
  options?: {
    schema?: DatabaseSchema;
    databaseDialect?: DatabaseDialect;
    bootstrapSite?: EnsureSingleSiteOptions;
    siteResolutionMode?: "single-site" | "host-based";
  },
): BootstrapService {
  const databaseSchema = options?.schema ?? sqliteSchemaBundle;
  const dialect = options?.databaseDialect ?? "sqlite";
  const siteResolutionMode = options?.siteResolutionMode ?? "single-site";

  /**
   * The request's site, which must be a real row by the time anything is
   * written to it. The placeholder only stands in for a self-hosted site the
   * account step has yet to create.
   */
  function existingSiteId(step: string): string {
    if (siteId === TRANSIENT_SINGLE_SITE_ID) {
      throw new Error(
        `${step} needs an existing site, but the request resolved none.`,
      );
    }
    return siteId;
  }

  /**
   * The site the account step stands up. A self-hosted install has no row
   * until now, so this is the step that creates it — along with its domain,
   * when one is configured. A hosted site was created by the control plane
   * and resolved from the request's host; the account attaches to that one.
   */
  async function siteToProvision(): Promise<string> {
    if (siteResolutionMode === "host-based") {
      return existingSiteId("provisionOwnerAccount");
    }
    const { site } = await createSiteService(
      db,
      databaseSchema,
    ).ensureSingleSite(options?.bootstrapSite);
    return site.id;
  }

  return {
    async provisionOwnerAccount(data) {
      const provisionedSiteId = await siteToProvision();
      const settings = createSettingsService(
        db,
        provisionedSiteId,
        databaseSchema,
        dialect,
      );
      const navItems = createNavItemService(
        db,
        provisionedSiteId,
        databaseSchema,
      );
      const siteMembers = createSiteMemberService(db, databaseSchema);

      await siteMembers.ensure(provisionedSiteId, data.ownerUserId, "owner");
      await navItems.materializeDefaultNavigation();
      await settings.markSiteProvisioned();
    },

    async completeSiteSetup(data, opts, deps) {
      const settings = createSettingsService(
        db,
        existingSiteId("completeSiteSetup"),
        databaseSchema,
        dialect,
      );

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
