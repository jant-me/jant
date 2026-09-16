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
 * The first act belongs to self-hosted installs alone. A hosted site gets its
 * owner through the control plane's handoff, so on a host-based install only
 * the second act runs, against the site the request resolved — the same site
 * the route's membership check reads. On a hosted install the database holds
 * every tenant, so "the only site" is not a question with an answer there.
 *
 * A self-hosted install that is deployed rather than clicked through runs both
 * acts back to back without a browser — see `setUpInstance`.
 */

import { and, eq } from "drizzle-orm";
import type { DatabaseDialect } from "../db/dialect.js";
import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { AUTH_ID_PREFIX, createTypeId } from "../lib/ids.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { deriveAccountName } from "../lib/schemas.js";
import { now } from "../lib/time.js";
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

export interface SetUpInstanceData {
  /** The owner's sign-in address, normalized the way sign-in normalizes it. */
  email: string;
  /** The owner's password in plain text. Only its hash is stored. */
  password: string;
  /** The id to create the site with. See `EnsureSingleSiteOptions.id`. */
  siteId?: string;
  /** The site's name. Omitted leaves the built-in fallback name in place. */
  siteName?: string;
  /**
   * Language the site publishes in. Omitted means the base locale, the same
   * as an empty answer on the screen.
   */
  siteLanguage?: string;
  /** The site's time zone. Omitted means UTC, as on the screen. */
  timeZone?: string;
}

/**
 * What `setUpInstance` found:
 * - `created`: nothing existed, and now the account, the site and its answers do
 * - `resumed`: an earlier run stopped after creating the account; this one
 *   finished the rest
 * - `already-set-up`: setup had finished before, and nothing was changed
 */
export type SetUpInstanceOutcome = "created" | "resumed" | "already-set-up";

export interface SetUpInstanceResult {
  outcome: SetUpInstanceOutcome;
  siteId: string;
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
   * @throws {Error} On a host-based install, where a site's owner arrives
   *   through the control plane's handoff instead
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

  /**
   * Set a self-hosted install up without a browser: the owner account, the
   * site around it, and the answers the second screen would have collected,
   * ending with onboarding complete.
   *
   * The site half is the screens' own code. The account half differs in one
   * way: the first screen opens the account through better-auth so the
   * browser leaves with a session, and there is no browser here to hand one
   * to. The rows are written directly instead, with the same password hash
   * better-auth is configured with, and named the way the first screen names
   * them until the site's name replaces it.
   *
   * Safe to run on every start. An install that finished setup is left as it
   * is, whatever this call was given — the owner may have changed their
   * address or password since, and a restart must not undo that. A run that
   * stopped after creating the account resumes, but only with that account's
   * address and password, which is what the first screen asks for too.
   *
   * @param data - The owner's credentials and the site's answers, already
   *   validated
   * @returns What was found, and the site
   * @throws {Error} On a host-based install; when the site exists under an id
   *   other than `siteId`; when an account for another address exists; when
   *   the password does not match the account an earlier run left
   * @example
   * ```ts
   * await bootstrap.setUpInstance({
   *   email: "owner@example.com",
   *   password: "correct horse battery",
   *   siteName: "Field Notes",
   * });
   * ```
   */
  setUpInstance(data: SetUpInstanceData): Promise<SetUpInstanceResult>;
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

  function settingsFor(targetSiteId: string) {
    return createSettingsService(db, targetSiteId, databaseSchema, dialect);
  }

  /**
   * A host-based install refuses before anything is written. The control
   * plane creates each hosted site already provisioned, and its owner arrives
   * through the hosted handoff, the only way anyone becomes a member of one.
   * Attaching whoever just signed in to the site the host resolved would let
   * any account in a database every tenant shares take a site that had lost
   * its onboarding status.
   */
  function assertSelfHosted(step: string): void {
    if (siteResolutionMode === "host-based") {
      throw new Error(
        `${step} runs on self-hosted installs only. A hosted site's owner arrives through the control plane's handoff.`,
      );
    }
  }

  /**
   * Stand the site up around its owner. A self-hosted install has no row until
   * now, so this is the step that creates it — along with its domain, when one
   * is configured.
   *
   * @returns The site's id
   */
  async function provisionSite(
    step: string,
    ownerUserId: string,
    siteOptions: EnsureSingleSiteOptions | undefined,
  ): Promise<string> {
    assertSelfHosted(step);
    const { site } = await createSiteService(
      db,
      databaseSchema,
    ).ensureSingleSite(siteOptions);
    const navItems = createNavItemService(db, site.id, databaseSchema);
    const siteMembers = createSiteMemberService(db, databaseSchema);

    await siteMembers.ensure(site.id, ownerUserId, "owner");
    await navItems.materializeDefaultNavigation();
    await settingsFor(site.id).markSiteProvisioned();
    return site.id;
  }

  async function recordSiteAnswers(
    targetSiteId: string,
    data: CompleteSiteSetupData,
    opts: { oldLanguage: string },
    deps: CompleteSiteSetupDeps | undefined,
  ): Promise<void> {
    const settings = settingsFor(targetSiteId);

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
  }

  /**
   * The account a browserless setup stands the site up around: a new one when
   * the install has none, or the one an interrupted run left, claimed with its
   * own password — the way the first screen resumes by signing in.
   */
  async function claimOwnerAccount(
    email: string,
    password: string,
  ): Promise<{ userId: string; created: boolean }> {
    const { account, user } = databaseSchema;
    const [existing] = await db
      .select({ id: user.id, passwordHash: account.password })
      .from(user)
      .leftJoin(
        account,
        and(eq(account.userId, user.id), eq(account.providerId, "credential")),
      )
      .where(eq(user.email, email))
      .limit(1);

    if (existing) {
      const matches =
        !!existing.passwordHash &&
        (await verifyPassword({ hash: existing.passwordHash, password }));
      if (!matches) {
        throw new Error(
          `An earlier setup created the account for ${email}, and the password given does not match it.`,
        );
      }
      return { userId: existing.id, created: false };
    }

    const [other] = await db.select({ id: user.id }).from(user).limit(1);
    if (other) {
      throw new Error(
        `This install already has an account under another address. Pass that account's address and password to finish setup.`,
      );
    }

    const userId = createTypeId(AUTH_ID_PREFIX.user);
    const timestamp = new Date(now() * 1000);
    await db.insert(user).values({
      id: userId,
      email,
      emailVerified: false,
      image: null,
      // The first screen's stand-in, replaced when the site is named.
      name: deriveAccountName(email),
      role: "admin",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.insert(account).values({
      id: createTypeId(AUTH_ID_PREFIX.account),
      accountId: userId,
      userId,
      providerId: "credential",
      password: await hashPassword(password),
      accessToken: null,
      accessTokenExpiresAt: null,
      idToken: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      scope: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { userId, created: true };
  }

  return {
    async provisionOwnerAccount(data) {
      await provisionSite(
        "provisionOwnerAccount",
        data.ownerUserId,
        options?.bootstrapSite,
      );
    },

    async completeSiteSetup(data, opts, deps) {
      await recordSiteAnswers(
        existingSiteId("completeSiteSetup"),
        data,
        opts,
        deps,
      );
    },

    async setUpInstance(data) {
      assertSelfHosted("setUpInstance");

      const existingSite = await createSiteService(
        db,
        databaseSchema,
      ).getOnlySite();
      if (
        existingSite &&
        data.siteId !== undefined &&
        existingSite.id !== data.siteId
      ) {
        throw new Error(
          `This install's site is ${existingSite.id}, not ${data.siteId}. Check that the database is the one you meant.`,
        );
      }
      if (
        existingSite &&
        (await settingsFor(existingSite.id).isOnboardingComplete())
      ) {
        return { outcome: "already-set-up", siteId: existingSite.id };
      }

      const owner = await claimOwnerAccount(data.email, data.password);
      const setUpSiteId = await provisionSite("setUpInstance", owner.userId, {
        ...options?.bootstrapSite,
        id: data.siteId,
      });
      const { user } = databaseSchema;
      await recordSiteAnswers(
        setUpSiteId,
        {
          siteName: data.siteName,
          siteLanguage: data.siteLanguage,
          timeZone: data.timeZone ?? null,
        },
        {
          oldLanguage:
            (await settingsFor(setUpSiteId).get("SITE_LANGUAGE")) ?? "",
        },
        {
          async updateCurrentUserName(displayName) {
            await db
              .update(user)
              .set({ name: displayName, updatedAt: new Date(now() * 1000) })
              .where(eq(user.id, owner.userId));
          },
        },
      );

      return {
        outcome: owner.created ? "created" : "resumed",
        siteId: setUpSiteId,
      };
    },
  };
}
