/**
 * Answer the argument forms that 0.8.0 renamed with their replacement.
 *
 * `parseArgs` would report an old option as a bare "Unknown option", and an
 * old positional site URL as an unexpected argument. These helpers name the
 * form to use instead, so a script written for 0.7 fails with the fix in the
 * message.
 */

/**
 * Find the first option in `argv` that was renamed.
 *
 * @param {string} command Command path, e.g. `site export`
 * @param {string[]} argv Arguments after the command path
 * @param {Record<string, string>} renamed Old option (`--directory`, `-d`) → what to pass instead
 * @returns {string | null} An error message, or null when no renamed option is used
 * @example
 * ```js
 * findRenamedOption("deploy", ["--site-path-prefix", "/blog"], {
 *   "--site-path-prefix": "--path-prefix",
 * });
 * // "jant deploy no longer takes --site-path-prefix. Use --path-prefix."
 * ```
 */
export function findRenamedOption(command, argv, renamed) {
  for (const arg of argv) {
    if (arg === "--") break;
    if (!arg.startsWith("-")) continue;
    const option = arg.split("=")[0];
    if (Object.hasOwn(renamed, option)) {
      return `jant ${command} no longer takes ${option}. Use ${renamed[option]}.`;
    }
  }
  return null;
}

/**
 * Describe a positional site URL, which `--url` replaced.
 *
 * @param {string} command Command path, e.g. `site import`
 * @param {string[]} positionals Positional arguments `parseArgs` collected
 * @returns {string | null} An error message, or null when there are none
 * @example
 * ```js
 * findPositionalUrl("site export", ["https://example.com"]);
 * // "jant site export takes the site as --url. Run: jant site export --url https://example.com"
 * ```
 */
export function findPositionalUrl(command, positionals) {
  if (positionals.length === 0) return null;
  const [first] = positionals;
  if (/^https?:\/\//i.test(first)) {
    return `jant ${command} takes the site as --url. Run: jant ${command} --url ${first}`;
  }
  return `jant ${command} takes no positional arguments: ${positionals.join(" ")}`;
}
