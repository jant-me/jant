/**
 * Snapshot Setting Registry Guard
 *
 * `jant site snapshot export/import` filters `site_setting` through the
 * hand-written `SNAPSHOT_SETTING_KEYS` allowlist in `bin/lib/site-snapshot.js`.
 * `bin/` is plain JavaScript, outside the type system, so a new setting key
 * compiles, lints and tests clean while the snapshot silently skips it.
 *
 * That already happened. `MULTILINGUAL_ENABLED` and `ADDITIONAL_LANGUAGES`
 * arrived with multilingual content and never reached the allowlist, while the
 * whole-row `post` dump kept carrying `language` and `translation_group_id`.
 * Restoring a multilingual site therefore produced posts stamped per language
 * on a site that served no per-language views — and the nightly demo rebuild
 * reset `demo.jant.me` to a single-language site every night.
 *
 * This test closes the gap the same way `snapshot-tables.test.ts` does for
 * tables: every DB-backed setting has to be named in one of the two
 * registries, so a new key forces a decision instead of defaulting to
 * "forgotten".
 *
 * `envOnly` keys are the one exemption, and are asserted to be in neither
 * list: they resolve from the environment and never reach `site_setting`, so
 * there is no row for an export to read or for `--replace` to clear.
 */

import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_EXCLUDED_SETTING_KEYS,
  SNAPSHOT_SETTING_KEYS,
} from "../../bin/lib/site-snapshot.js";
import { CONFIG_FIELDS } from "../types/config.js";

type ConfigKey = keyof typeof CONFIG_FIELDS;

const ALL_KEYS = Object.keys(CONFIG_FIELDS) as ConfigKey[];

/** Keys that can hold a `site_setting` row — everything not env-resolved. */
const DB_BACKED_KEYS = ALL_KEYS.filter(
  (key) => !("envOnly" in CONFIG_FIELDS[key] && CONFIG_FIELDS[key].envOnly),
);

/** Keys resolved from the environment, which never reach `site_setting`. */
const ENV_ONLY_KEYS = ALL_KEYS.filter((key) => !DB_BACKED_KEYS.includes(key));

describe("snapshot setting registry", () => {
  it("names every DB-backed setting in exactly one registry", () => {
    const carried = new Set<string>(SNAPSHOT_SETTING_KEYS);
    const excluded = new Set<string>(SNAPSHOT_EXCLUDED_SETTING_KEYS);

    const unregistered = DB_BACKED_KEYS.filter(
      (key) => !carried.has(key) && !excluded.has(key),
    );
    const registeredTwice = DB_BACKED_KEYS.filter(
      (key) => carried.has(key) && excluded.has(key),
    );

    expect(
      { unregistered, registeredTwice },
      "Add each new DB-backed setting to SNAPSHOT_SETTING_KEYS (it belongs to " +
        "the site's published content) or to SNAPSHOT_EXCLUDED_SETTING_KEYS " +
        "(with the reason), in bin/lib/site-snapshot.js.",
    ).toEqual({ unregistered: [], registeredTwice: [] });
  });

  it("leaves env-only settings out of both registries", () => {
    const listed = ENV_ONLY_KEYS.filter(
      (key) =>
        SNAPSHOT_SETTING_KEYS.includes(key) ||
        SNAPSHOT_EXCLUDED_SETTING_KEYS.includes(key),
    );

    expect(listed).toEqual([]);
  });

  it("registers no key that CONFIG_FIELDS does not define", () => {
    const known = new Set<string>(ALL_KEYS);
    const unknown = [
      ...SNAPSHOT_SETTING_KEYS,
      ...SNAPSHOT_EXCLUDED_SETTING_KEYS,
    ].filter((key) => !known.has(key));

    expect(unknown).toEqual([]);
  });

  it("carries the whole language trio, so restored posts keep their views", () => {
    // `post.language` and `post.translation_group_id` ride along in the
    // whole-row `post` dump. A snapshot that carried those but not the switch
    // restored a site whose per-language views had silently disappeared.
    expect(SNAPSHOT_SETTING_KEYS).toEqual(
      expect.arrayContaining([
        "SITE_LANGUAGE",
        "MULTILINGUAL_ENABLED",
        "ADDITIONAL_LANGUAGES",
      ]),
    );
  });
});
