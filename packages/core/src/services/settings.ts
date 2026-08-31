/**
 * Settings Service
 *
 * Key-value store for site configuration
 */

import { and, eq } from "drizzle-orm";
import { type Database, supportsDrizzleTransaction } from "../db/index.js";
import type { DatabaseDialect } from "../db/dialect.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { now } from "../lib/time.js";
import {
  SETTINGS_KEYS,
  ONBOARDING_STATUS,
  type OnboardingStatus,
  type SettingsKey,
} from "../lib/constants.js";
import {
  baseLocale,
  isLocale,
  isValidContentLanguage,
  normalizeContentLanguage,
  resolveFirstRunDashboardLocale,
} from "../i18n/locales.js";
import type { StorageDriver } from "../lib/storage.js";
import type { MediaService } from "./media.js";
import {
  validateUploadFile,
  generateSiteAssetStorageKey,
  getSiteStorageKey,
} from "../lib/upload.js";
import { arrayBufferToBase64 } from "../lib/favicon.js";
import { ValidationError } from "../lib/errors.js";
import { normalizeEditableSettingValue } from "../lib/schemas.js";
import { parseDiscoverSetting, type DiscoverSetting } from "../lib/discover.js";
import {
  sendDiscoverPing,
  type DiscoverAnnounceOutcome,
} from "../lib/discover-ping.js";
import { isSupportedTimeZone, normalizeTimeZone } from "../lib/timezones.js";
import type { FeedKind } from "../types/constants.js";

/**
 * Read a stored announcement outcome back.
 *
 * Tolerant on purpose: this is a settings row a person can edit or an older
 * version can have written differently, and the worst honest answer is "no
 * attempt recorded" — never a crashed settings page.
 *
 * @param raw - The stored JSON, if any
 * @returns The outcome, or null when absent or unreadable
 */
function parseAnnounceState(
  raw: string | null,
): DiscoverAnnounceOutcome | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    if (typeof value["at"] !== "number") return null;
    if (typeof value["ok"] !== "boolean") return null;
    if (typeof value["feedUrl"] !== "string") return null;
    return {
      at: value["at"],
      ok: value["ok"],
      feedUrl: value["feedUrl"],
      ...(typeof value["status"] === "number"
        ? { status: value["status"] }
        : {}),
      ...(typeof value["error"] === "string" ? { error: value["error"] } : {}),
    };
  } catch {
    return null;
  }
}

export interface GeneralSettingsData {
  siteName: string;
  siteDescription: string;
  siteFooter: string;
  siteLanguage: string;
  /** Admin UI locale; empty string follows the content language. */
  dashboardLanguage?: string;
  showJantBrandingOnHome: boolean;
  mainRssFeed?: FeedKind;
  timeZone: string;
}

export interface SiteSettingsData {
  siteName: string;
  siteDescription: string;
  siteFooter: string;
}

export interface SiteSettingsResult {
  displayName: string;
  siteNameChanged: boolean;
}

/**
 * Locale fields a settings page owns.
 *
 * Every field is "undefined = leave untouched" so the two pages that split
 * these settings — Language and General — can each send only what they own,
 * without either erasing the other's field.
 */
export interface LocaleSettingsData {
  /** Site content language; also the primary language when multilingual is on. */
  siteLanguage?: string;
  /**
   * Admin dashboard UI locale. Empty string clears the explicit setting so the
   * dashboard follows the content language. When set, must be a catalog locale.
   */
  dashboardLanguage?: string;
  /** IANA time zone; empty string resets to UTC. */
  timeZone?: string;
}

export interface GeneralSettingsResult {
  languageChanged: boolean;
  displayName: string;
}

export interface AvatarUploadData {
  file: { stream(): ReadableStream; name: string; type: string; size: number };
  faviconIco?: ArrayBuffer;
  appleTouchIcon?: ArrayBuffer;
}

export interface AvatarUploadDeps {
  media: MediaService;
  storage: StorageDriver;
  storageProvider: string;
  maxFileSizeMB: number;
}

export interface SettingsService {
  get(key: SettingsKey): Promise<string | null>;
  getAll(): Promise<Record<string, string>>;
  set(key: SettingsKey, value: string): Promise<void>;
  setMany(entries: Partial<Record<SettingsKey, string>>): Promise<void>;
  remove(key: SettingsKey): Promise<void>;
  /** How far first-run setup has got: pending → provisioned → completed. */
  getOnboardingStatus(): Promise<OnboardingStatus>;
  isOnboardingComplete(): Promise<boolean>;
  /**
   * Mark a control-plane-created site as real but not yet confirmed by its
   * owner. Public pages serve normally from here; setup still owes one answer.
   */
  markSiteProvisioned(): Promise<void>;
  completeOnboarding(): Promise<void>;
  /**
   * Close first-run setup on a site whose shell already exists, by recording
   * the language its author says they write in.
   *
   * @param data - The confirmed content language, plus the browser's own
   *   language so the dashboard can be pinned to it
   * @param opts - The language in effect before this answer
   */
  confirmFirstRunLanguage(
    data: { siteLanguage: string; browserLanguage?: string | null },
    opts: { oldLanguage: string },
  ): Promise<void>;
  updateSiteSettings(
    data: SiteSettingsData,
    opts: { fallbackSiteName: string; oldSiteName: string },
  ): Promise<SiteSettingsResult>;
  updateLocaleSettings(
    data: LocaleSettingsData,
    opts: {
      oldLanguage: string;
      oldDashboardLanguage?: string;
    },
  ): Promise<{ languageChanged: boolean }>;
  updateFeedSettings(data: { mainRssFeed?: FeedKind }): Promise<void>;
  updateHomeBranding(showJantBrandingOnHome: boolean): Promise<void>;
  updateSearchSettings(
    allowIndexing: boolean,
    opts: { demoMode: boolean },
  ): Promise<void>;
  /**
   * Record the site's Jant Discover choice.
   *
   * Always stores an explicit value, including `off`. Once someone has used
   * this control their answer is their own, and the rule that reads `noindex`
   * as a refusal stops applying to them.
   *
   * @param mode - The choice the owner just made
   * @param opts - Demo sites never announce themselves
   * @returns Whether this save is the moment the site opted in, and so should
   *   announce itself to the configured directory
   */
  updateDiscoverSetting(
    mode: DiscoverSetting,
    opts: { demoMode: boolean },
  ): Promise<{ shouldAnnounce: boolean }>;
  /**
   * Announce this site's feed to the configured directory, and remember how it
   * went.
   *
   * The remembering is the point. An announcement that fails silently leaves
   * the owner with a setting that reads "on" and a directory that has never
   * heard of them, and no way to tell the two apart.
   *
   * Never throws: the caller runs this as background work behind a settings
   * save, which must not fail because a directory is down.
   *
   * @param input - The directory endpoint and the feed address to announce
   * @returns What the attempt came to
   */
  announceToDiscover(input: {
    endpoint: string;
    feedUrl: string;
  }): Promise<DiscoverAnnounceOutcome>;
  /**
   * The last announcement attempt, or `null` if the site has never made one.
   *
   * @returns The stored outcome, or null when absent or unreadable
   */
  getDiscoverAnnounceState(): Promise<DiscoverAnnounceOutcome | null>;
  /**
   * Update general site settings with trim/set/remove logic.
   * Empty strings are removed. Default values are removed to keep the DB clean.
   *
   * @param data - Form data from the settings page
   * @param opts - Old language (for change detection) and fallback site name
   * @returns Whether the language changed and the display name for the site
   */
  updateGeneral(
    data: GeneralSettingsData,
    opts: {
      oldLanguage: string;
      fallbackSiteName: string;
    },
  ): Promise<GeneralSettingsResult>;
  /**
   * Upload an avatar image: validates file, stores in storage, creates media record,
   * updates settings (SITE_AVATAR, SITE_FAVICON_ICO, SITE_FAVICON_APPLE_TOUCH, SITE_FAVICON_VERSION).
   *
   * @param data - Avatar file and optional favicon variants
   * @param deps - Media service and storage driver dependencies
   * @throws {ValidationError} When file validation fails
   */
  uploadAvatar(data: AvatarUploadData, deps: AvatarUploadDeps): Promise<void>;
  /**
   * Remove avatar and all favicon-related settings. The apple-touch-icon's
   * media row is deleted and its storage object is retired (moved to the
   * recycle bin, or deleted) via the media service when supplied — so removal
   * is recoverable rather than erasing the bytes with no trace.
   */
  removeAvatar(deps?: {
    storage?: StorageDriver | null;
    media?: MediaService;
    storageProvider?: string;
  }): Promise<void>;
}

export function createSettingsService(
  db: Database,
  siteId: string,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
  databaseDialect: DatabaseDialect = "sqlite",
): SettingsService {
  const { settings } = databaseSchema;

  function normalizeSettingValue(key: SettingsKey, value: string): string {
    return normalizeEditableSettingValue(key, value);
  }

  return {
    async get(key) {
      const result = await db
        .select()
        .from(settings)
        .where(and(eq(settings.siteId, siteId), eq(settings.key, key)))
        .limit(1);
      return result[0]?.value ?? null;
    },

    async getAll() {
      const rows = await db
        .select()
        .from(settings)
        .where(eq(settings.siteId, siteId));
      const result: Record<string, string> = {};
      for (const row of rows) {
        result[row.key] = row.value;
      }
      return result;
    },

    async set(key, value) {
      const timestamp = now();
      const normalizedValue = normalizeSettingValue(key, value);
      await db
        .insert(settings)
        .values({ siteId, key, value: normalizedValue, updatedAt: timestamp })
        .onConflictDoUpdate({
          target: [settings.siteId, settings.key],
          set: { value: normalizedValue, updatedAt: timestamp },
        });
    },

    async remove(key) {
      await db
        .delete(settings)
        .where(and(eq(settings.siteId, siteId), eq(settings.key, key)));
    },

    async setMany(entries) {
      const timestamp = now();
      const pairs = (Object.keys(entries) as SettingsKey[])
        .map((key) => {
          const value = entries[key];
          return value === undefined
            ? { key, value }
            : { key, value: normalizeSettingValue(key, value) };
        })
        .filter(
          (pair): pair is { key: SettingsKey; value: string } =>
            pair.value !== undefined,
        );

      if (pairs.length === 0) return;

      if (!supportsDrizzleTransaction(db, databaseDialect)) {
        const queries = pairs.map(({ key, value }) =>
          db
            .insert(settings)
            .values({ siteId, key, value, updatedAt: timestamp })
            .onConflictDoUpdate({
              target: [settings.siteId, settings.key],
              set: { value, updatedAt: timestamp },
            }),
        );

        await db.batch(
          queries as [(typeof queries)[number], ...(typeof queries)[number][]],
        );
        return;
      }

      await db.transaction(async (tx) => {
        for (const { key, value } of pairs) {
          await tx
            .insert(settings)
            .values({ siteId, key, value, updatedAt: timestamp })
            .onConflictDoUpdate({
              target: [settings.siteId, settings.key],
              set: { value, updatedAt: timestamp },
            });
        }
      });
    },

    async getOnboardingStatus() {
      const status = await this.get(SETTINGS_KEYS.ONBOARDING_STATUS);
      if (status === ONBOARDING_STATUS.COMPLETED) {
        return ONBOARDING_STATUS.COMPLETED;
      }
      if (status === ONBOARDING_STATUS.PROVISIONED) {
        return ONBOARDING_STATUS.PROVISIONED;
      }
      return ONBOARDING_STATUS.PENDING;
    },

    async isOnboardingComplete() {
      const status = await this.get(SETTINGS_KEYS.ONBOARDING_STATUS);
      return status === ONBOARDING_STATUS.COMPLETED;
    },

    async markSiteProvisioned() {
      await this.set(
        SETTINGS_KEYS.ONBOARDING_STATUS,
        ONBOARDING_STATUS.PROVISIONED,
      );
    },

    async completeOnboarding() {
      await this.set(
        SETTINGS_KEYS.ONBOARDING_STATUS,
        ONBOARDING_STATUS.COMPLETED,
      );
    },

    async confirmFirstRunLanguage(data, opts) {
      await this.updateLocaleSettings(
        {
          siteLanguage: data.siteLanguage,
          // Empty means "follow the content language", which is right unless
          // the browser named a catalog following would not reach.
          dashboardLanguage:
            resolveFirstRunDashboardLocale(
              data.siteLanguage,
              data.browserLanguage,
            ) ?? "",
        },
        { oldLanguage: opts.oldLanguage },
      );
      await this.completeOnboarding();
    },

    async updateSiteSettings(data, opts) {
      const trimmedSiteName = data.siteName.trim();
      const trimmedDescription = data.siteDescription.trim();
      const trimmedFooter = data.siteFooter.trim();

      if (trimmedSiteName) {
        await this.set("SITE_NAME", trimmedSiteName);
      } else {
        await this.remove("SITE_NAME");
      }

      if (trimmedDescription) {
        await this.set("SITE_DESCRIPTION", trimmedDescription);
      } else {
        await this.remove("SITE_DESCRIPTION");
      }

      if (trimmedFooter) {
        await this.set("SITE_FOOTER", trimmedFooter);
      } else {
        await this.remove("SITE_FOOTER");
      }

      return {
        displayName: trimmedSiteName || opts.fallbackSiteName,
        siteNameChanged: opts.oldSiteName !== trimmedSiteName,
      };
    },

    async updateLocaleSettings(data, opts) {
      let languageChanged = false;
      if (data.siteLanguage !== undefined) {
        const trimmedLanguage = data.siteLanguage.trim() || baseLocale;
        if (!isValidContentLanguage(trimmedLanguage)) {
          throw new ValidationError(
            "Enter a valid BCP 47 language tag (e.g. en, zh-Hans, fi, ja, fr-CA).",
          );
        }
        const normalized = normalizeContentLanguage(trimmedLanguage);
        await this.set("SITE_LANGUAGE", normalized);
        languageChanged = opts.oldLanguage !== normalized;
      }

      // Dashboard UI locale. undefined = leave untouched; "" = clear so the
      // dashboard follows the content language; otherwise it must be one of the
      // translated catalog locales.
      let dashboardChanged = false;
      if (data.dashboardLanguage !== undefined) {
        const dashboardLanguage = data.dashboardLanguage.trim();
        if (dashboardLanguage && !isLocale(dashboardLanguage)) {
          throw new ValidationError(
            "Choose a dashboard language Jant is translated into.",
          );
        }
        if (dashboardLanguage) {
          await this.set("DASHBOARD_LANGUAGE", dashboardLanguage);
        } else {
          await this.remove("DASHBOARD_LANGUAGE");
        }
        dashboardChanged =
          (opts.oldDashboardLanguage ?? "") !== dashboardLanguage;
      }

      if (data.timeZone !== undefined) {
        if (data.timeZone) {
          if (!isSupportedTimeZone(data.timeZone)) {
            throw new ValidationError("Choose a valid time zone.");
          }

          const normalizedTimeZone = normalizeTimeZone(data.timeZone);
          if (normalizedTimeZone !== "UTC") {
            await this.set("TIME_ZONE", normalizedTimeZone);
          } else {
            await this.remove("TIME_ZONE");
          }
        } else {
          await this.remove("TIME_ZONE");
        }
      }

      return { languageChanged: languageChanged || dashboardChanged };
    },

    async updateFeedSettings(data) {
      if (data.mainRssFeed !== undefined) {
        if (data.mainRssFeed === "latest") {
          await this.set("MAIN_RSS_FEED", data.mainRssFeed);
        } else {
          await this.remove("MAIN_RSS_FEED");
        }
      }
    },

    async updateHomeBranding(showJantBrandingOnHome) {
      if (showJantBrandingOnHome) {
        await this.set("SHOW_JANT_BRANDING_ON_HOME", "true");
      } else {
        await this.remove("SHOW_JANT_BRANDING_ON_HOME");
      }
    },

    async updateSearchSettings(allowIndexing, opts) {
      if (opts.demoMode || !allowIndexing) {
        await this.set("NOINDEX", "true");
      } else {
        await this.remove("NOINDEX");
      }
    },

    async updateDiscoverSetting(mode, opts) {
      const previous = parseDiscoverSetting(await this.get("DISCOVER"));
      await this.set("DISCOVER", mode);

      // The moment a site opts in is the only moment worth announcing. Coming
      // from `off` is obvious; coming from unset matters just as much, because
      // a site that has never touched this control has never told anyone it
      // exists — and switching between `latest` and `featured` while already
      // listed changes nothing a directory needs to be told twice.
      const optedIn =
        mode !== "off" && (previous === null || previous === "off");
      return { shouldAnnounce: optedIn && !opts.demoMode };
    },

    async announceToDiscover(input) {
      const outcome = await sendDiscoverPing({
        endpoint: input.endpoint,
        feedUrl: input.feedUrl,
        now,
      });
      await this.set("DISCOVER_ANNOUNCE_STATE", JSON.stringify(outcome));
      return outcome;
    },

    async getDiscoverAnnounceState() {
      return parseAnnounceState(await this.get("DISCOVER_ANNOUNCE_STATE"));
    },

    async updateGeneral(data, opts) {
      const { displayName } = await this.updateSiteSettings(data, {
        fallbackSiteName: opts.fallbackSiteName,
        oldSiteName: data.siteName.trim(),
      });
      await this.updateHomeBranding(data.showJantBrandingOnHome);
      const { languageChanged } = await this.updateLocaleSettings(data, {
        oldLanguage: opts.oldLanguage,
      });

      await this.updateFeedSettings({ mainRssFeed: data.mainRssFeed });

      return {
        languageChanged,
        displayName,
      };
    },

    async uploadAvatar(data, deps) {
      const uploadError = validateUploadFile(data.file as unknown as File, {
        imagesOnly: true,
        maxFileSizeMB: deps.maxFileSizeMB,
      });
      if (uploadError) {
        throw new ValidationError(uploadError);
      }

      const { id, filename, storageKey } = generateSiteAssetStorageKey(
        siteId,
        "avatar",
        data.file.name,
      );

      await deps.storage.put(storageKey, data.file.stream(), {
        contentType: data.file.type,
      });

      await deps.media.create({
        id,
        filename,
        originalName: data.file.name,
        mimeType: data.file.type,
        size: data.file.size,
        storageKey,
        provider: deps.storageProvider,
      });

      await this.set("SITE_AVATAR", storageKey);

      // Store favicon ICO as base64 in settings (tiny file, accessed every page load)
      if (data.faviconIco) {
        const b64 = arrayBufferToBase64(data.faviconIco);
        await this.set("SITE_FAVICON_ICO", b64);
      }

      // Store apple-touch-icon in storage (high-resolution PNG, not tiny enough for base64)
      if (data.appleTouchIcon) {
        const appleTouchKey = getSiteStorageKey(
          siteId,
          "favicon",
          "apple-touch-icon.png",
        );

        // The storage key is fixed across uploads, so an existing media
        // row would violate the (provider, storage_key) unique index.
        const existing = await deps.media.getByStorageKey(
          appleTouchKey,
          deps.storageProvider,
        );
        if (existing) {
          await deps.media.delete(existing.id);
        }

        await deps.storage.put(
          appleTouchKey,
          new Uint8Array(data.appleTouchIcon),
          { contentType: "image/png" },
        );
        await deps.media.create({
          filename: "apple-touch-icon.png",
          originalName: "apple-touch-icon.png",
          mimeType: "image/png",
          size: data.appleTouchIcon.byteLength,
          storageKey: appleTouchKey,
          provider: deps.storageProvider,
        });
        await this.set("SITE_FAVICON_APPLE_TOUCH", appleTouchKey);
      }

      // Set favicon version for cache-busting
      const ts = new Date();
      const version =
        String(ts.getUTCFullYear()) +
        String(ts.getUTCMonth() + 1).padStart(2, "0") +
        String(ts.getUTCDate()).padStart(2, "0") +
        String(ts.getUTCHours()).padStart(2, "0") +
        String(ts.getUTCMinutes()).padStart(2, "0");
      await this.set("SITE_FAVICON_VERSION", version);
    },

    async removeAvatar(deps) {
      const appleTouchKey = await this.get("SITE_FAVICON_APPLE_TOUCH");

      // Retire the apple-touch-icon through the media service so its object goes
      // to the recycle bin (recoverable) rather than being erased now. Also
      // removes its media row.
      if (deps?.media && deps.storageProvider && appleTouchKey) {
        const existing = await deps.media.getByStorageKey(
          appleTouchKey,
          deps.storageProvider,
        );
        if (existing) {
          await deps.media.delete(existing.id, deps.storage);
        }
      }

      await this.remove("SITE_AVATAR");
      await this.remove("SITE_FAVICON_ICO");
      await this.remove("SITE_FAVICON_APPLE_TOUCH");
      await this.remove("SITE_FAVICON_VERSION");
    },
  };
}
