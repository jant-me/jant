/**
 * Language Service
 *
 * Owns the multilingual content lifecycle: which languages a site serves, which
 * one the unprefixed root URLs belong to, and the ordering rules that keep
 * those two settings consistent with the `post.language` column.
 *
 * These operations are multi-step by nature — enabling has to check URL-prefix
 * conflicts, write two settings, and stamp every unmarked post, in that order —
 * so they live here rather than in routes, and this service is the only writer
 * of `MULTILINGUAL_ENABLED` and `ADDITIONAL_LANGUAGES`.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import {
  formatLanguageList,
  isValidContentLanguage,
  normalizeContentLanguage,
  parseLanguageList,
  toLanguagePrefix,
} from "../i18n/locales.js";
import { RESERVED_PATHS } from "../lib/constants.js";
import {
  ConflictError,
  LanguageInUseError,
  ValidationError,
} from "../lib/errors.js";
import type { PathService } from "./path.js";
import type { PostService } from "./post.js";
import type { SettingsService } from "./settings.js";

/** The site's language configuration, as the rest of the app reads it. */
export interface LanguageState {
  /** Whether per-language browsing views are served. */
  enabled: boolean;
  /** Canonical tag served from the unprefixed root URLs. */
  primary: string;
  /** Canonical tags served under a URL prefix, in switcher order. */
  additional: string[];
  /** Every configured language, primary first. */
  all: string[];
}

/** What the enable dialog needs to describe what it is about to do. */
export interface LanguageEnablePreview {
  /** Posts that would be stamped with the primary language. */
  pendingCount: number;
  /** Current primary language, prefilled into the dialog. */
  primary: string;
}

export interface EnableMultilingualInput {
  /** Primary language; may differ from the stored one when the author edits it in the dialog. */
  primary: string;
  /** At least one language to serve under a prefix. */
  additional: string[];
}

export interface LanguageService {
  /** Read the site's language configuration. */
  getState(): Promise<LanguageState>;
  /** Numbers and defaults for the enable confirmation dialog. */
  getEnablePreview(): Promise<LanguageEnablePreview>;
  /**
   * Turn on multilingual content.
   *
   * Validates the language set, rejects prefixes that would shadow an existing
   * URL, writes both settings, then stamps every post that has no language yet
   * with the primary language — so the root view keeps showing exactly what it
   * showed a moment earlier.
   *
   * @returns How many posts were stamped
   * @throws {ValidationError} When the language set is empty or malformed
   * @throws {ConflictError} When a language prefix collides with a stored path
   */
  enable(input: EnableMultilingualInput): Promise<{ markedCount: number }>;
  /**
   * Turn off multilingual content, keeping the configuration and every stored
   * `post.language` value so re-enabling restores the same setup and the old
   * prefixes can still redirect.
   */
  disable(): Promise<void>;
  /**
   * Move the root URLs to another configured language.
   *
   * Swaps the two lists in one step: the new primary leaves the additional
   * list and the old primary joins it. Doing only half would leave the old
   * primary's posts with no view at all — filtered out of the root, and with no
   * prefix of their own.
   */
  setPrimary(language: string): Promise<void>;
  /** Add a language to serve under a URL prefix. */
  addLanguage(language: string): Promise<void>;
  /**
   * Stop serving a language.
   *
   * Only allowed while no post is written in it. With posts present there is no
   * good answer — hiding, migrating, or redirecting them all guess at intent —
   * so this reports the count and leaves the choice to the author.
   *
   * Removing the last additional language turns multilingual content off with
   * it: per-language views need a second language to mean anything, and a site
   * left with the flag on and nothing to serve under it would report the
   * feature as on everywhere the setting is read while behaving as
   * single-language everywhere it is used.
   *
   * @returns Whether multilingual content was turned off along with it
   * @throws {ConflictError} When posts still use the language
   */
  removeLanguage(language: string): Promise<{ multilingualDisabled: boolean }>;
}

export interface LanguageServiceDeps {
  settings: SettingsService;
  posts: PostService;
  paths: PathService;
}

/** Language tags whose URL prefix can never work, whatever the site contains. */
const RESERVED_PREFIXES = new Set<string>(RESERVED_PATHS);

/**
 * Read the site's language configuration directly from its settings rows.
 *
 * A standalone reader rather than a method on the service because slug and
 * custom-URL validation need it from inside other services, where threading a
 * whole `LanguageService` through would be more wiring than the two values are
 * worth. The service remains the only *writer*.
 *
 * @param db - Site database handle
 * @param siteId - Site the settings belong to
 * @param databaseSchema - Dialect-specific schema bundle
 * @returns The primary language tag; every language the site publishes, primary
 *   first (empty while multilingual content is off); and the URL prefixes
 *   language views currently serve
 * @example
 * await readLanguageSettings(db, siteId);
 * // => { primary: "zh-Hans", languages: ["zh-Hans", "en"], reservedPrefixes: ["en"] }
 */
export async function readLanguageSettings(
  db: Database,
  siteId: string,
  databaseSchema: DatabaseSchema = sqliteSchemaBundle,
): Promise<{
  primary: string;
  languages: string[];
  reservedPrefixes: string[];
}> {
  const { settings } = databaseSchema;
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(
      and(
        eq(settings.siteId, siteId),
        inArray(settings.key, [
          "SITE_LANGUAGE",
          "MULTILINGUAL_ENABLED",
          "ADDITIONAL_LANGUAGES",
        ]),
      ),
    );
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const primary = normalizeContentLanguage(values.get("SITE_LANGUAGE") ?? "");
  const additional =
    values.get("MULTILINGUAL_ENABLED") === "true"
      ? parseLanguageList(values.get("ADDITIONAL_LANGUAGES")).filter(
          (tag) => tag !== primary,
        )
      : [];
  // Empty — not `[primary]` — when the site publishes one language, so callers
  // can treat "no languages" as "this site is not multilingual".
  const languages = additional.length > 0 ? [primary, ...additional] : [];
  return {
    primary,
    languages,
    reservedPrefixes: additional.map(toLanguagePrefix),
  };
}

function requireValidLanguage(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !isValidContentLanguage(trimmed)) {
    throw new ValidationError(
      "Enter a valid BCP 47 language tag (e.g. en, zh-Hans, ja).",
    );
  }
  return normalizeContentLanguage(trimmed);
}

export function createLanguageService(
  deps: LanguageServiceDeps,
): LanguageService {
  const { settings, posts, paths } = deps;

  async function readState(): Promise<LanguageState> {
    const [enabledValue, primaryValue, additionalValue] = await Promise.all([
      settings.get("MULTILINGUAL_ENABLED"),
      settings.get("SITE_LANGUAGE"),
      settings.get("ADDITIONAL_LANGUAGES"),
    ]);

    const primary = primaryValue?.trim()
      ? normalizeContentLanguage(primaryValue)
      : "en";
    // Defensive: a hand-edited settings row could list the primary language
    // twice. The prefix for it would never route, so drop it here rather than
    // letting a dead entry reach the switcher.
    const additional = parseLanguageList(additionalValue).filter(
      (tag) => tag !== primary,
    );

    return {
      enabled: enabledValue === "true" && additional.length > 0,
      primary,
      additional,
      all: [primary, ...additional],
    };
  }

  /**
   * Reject a language whose URL prefix would shadow something already served.
   *
   * Language prefixes are checked here, when a language is added, rather than
   * being reserved globally: the two-letter ISO codes are ordinary English
   * words (`it`, `is`, `no`, `go`, `my`), and permanently confiscating those
   * slugs from every site for an off-by-default feature is out of proportion.
   */
  async function assertPrefixAvailable(language: string): Promise<void> {
    const prefix = toLanguagePrefix(language);

    if (RESERVED_PREFIXES.has(prefix)) {
      throw new ConflictError(
        `Jant already uses /${prefix} for its own pages, so it cannot serve a language there.`,
      );
    }

    const clashes = await paths.findPathsUnderSegment(prefix, 3);
    const first = clashes[0];
    if (first) {
      throw new ConflictError(
        `/${first.path} is already taken. Change that URL, then add this language.`,
      );
    }
  }

  function normalizeAdditional(
    tags: readonly string[],
    primary: string,
  ): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of tags) {
      const tag = requireValidLanguage(raw);
      if (tag === primary || seen.has(tag)) continue;
      seen.add(tag);
      result.push(tag);
    }
    return result;
  }

  async function writeLanguages(
    primary: string,
    additional: readonly string[],
  ): Promise<void> {
    await settings.set("SITE_LANGUAGE", primary);
    if (additional.length > 0) {
      await settings.set(
        "ADDITIONAL_LANGUAGES",
        formatLanguageList(additional),
      );
    } else {
      await settings.remove("ADDITIONAL_LANGUAGES");
    }
  }

  return {
    getState: readState,

    async getEnablePreview() {
      const [state, pendingCount] = await Promise.all([
        readState(),
        posts.countMissingLanguage(),
      ]);
      return { pendingCount, primary: state.primary };
    },

    async enable(input) {
      const primary = requireValidLanguage(input.primary);
      const additional = normalizeAdditional(input.additional, primary);
      if (additional.length === 0) {
        throw new ValidationError(
          "Add at least one more language before turning this on.",
        );
      }

      // The list must keep a place for every language posts are already
      // written in. Turning multilingual off keeps both the languages and
      // the stamps, so a re-enable that dropped one from the dialog would
      // otherwise strand its posts outside every view — the exact orphaning
      // the remove guard exists to prevent, through a side door.
      const allowed = new Set([primary, ...additional]);
      const stranded = (await posts.listLanguagesInUse()).find(
        (entry) => !allowed.has(entry.language),
      );
      if (stranded) {
        throw new LanguageInUseError(
          stranded.count === 1
            ? "One post is still written in a language missing from this list. Keep the language, or change the post's language first."
            : `${stranded.count} posts are still written in a language missing from this list. Keep the language, or change their language first.`,
          stranded.language,
          stranded.count,
        );
      }

      // Every prefix is checked before anything is written, so a conflict
      // leaves the site exactly as it was.
      for (const language of additional) {
        await assertPrefixAvailable(language);
      }

      await writeLanguages(primary, additional);
      await settings.set("MULTILINGUAL_ENABLED", "true");

      const markedCount = await posts.materializeMissingLanguage(primary);
      return { markedCount };
    },

    async disable() {
      await settings.remove("MULTILINGUAL_ENABLED");
    },

    async setPrimary(language) {
      const next = requireValidLanguage(language);
      const state = await readState();
      if (next === state.primary) return;

      if (!state.additional.includes(next)) {
        throw new ValidationError(
          "Add that language to the site before making it the primary language.",
        );
      }

      // The old primary needs a prefix from now on, and the new one no longer
      // does. Both halves in one write: doing either alone would leave a
      // language's posts with nowhere to appear.
      const additional = [
        ...state.additional.filter((tag) => tag !== next),
        state.primary,
      ];
      await writeLanguages(next, additional);
    },

    async addLanguage(language) {
      const tag = requireValidLanguage(language);
      const state = await readState();
      if (tag === state.primary) {
        throw new ConflictError(
          "That is already this site's primary language.",
        );
      }
      if (state.additional.includes(tag)) return;

      await assertPrefixAvailable(tag);
      await writeLanguages(state.primary, [...state.additional, tag]);
    },

    async removeLanguage(language) {
      const tag = requireValidLanguage(language);
      const state = await readState();
      if (tag === state.primary) {
        throw new ConflictError(
          "This is the primary language. Make another language primary first.",
        );
      }
      if (!state.additional.includes(tag)) {
        return { multilingualDisabled: false };
      }

      // Counted whether or not multilingual is currently on: the settings page
      // stays reachable after it is switched off, and the posts are still there.
      const postCount = await posts.countByLanguage(tag);
      if (postCount > 0) {
        throw new LanguageInUseError(
          postCount === 1
            ? "One post is still written in this language. Change its language, or keep the language."
            : `${postCount} posts are still written in this language. Change their language, or keep the language.`,
          tag,
          postCount,
        );
      }

      const remaining = state.additional.filter((entry) => entry !== tag);
      await writeLanguages(state.primary, remaining);

      // Nothing left to serve under a prefix, so the feature goes with it. The
      // flag is only cleared when it was actually on — a removal made while
      // multilingual is off has nothing to turn off, and saying so would be a
      // lie the settings page then has to explain.
      const multilingualDisabled = remaining.length === 0 && state.enabled;
      if (multilingualDisabled) {
        await settings.remove("MULTILINGUAL_ENABLED");
      }
      return { multilingualDisabled };
    },
  };
}
