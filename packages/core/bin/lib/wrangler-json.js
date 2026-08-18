/**
 * Parsing helpers for Wrangler's stdout.
 *
 * Deliberately separate from `wrangler-cli.js`: that module spawns processes
 * and is stubbed wholesale in tests, while this one is pure and must always be
 * the real implementation.
 */

/**
 * Strip the non-JSON preamble Wrangler sometimes writes to stdout before the
 * actual payload.
 *
 * Wrangler announces things like "Proxy environment variables detected. We'll
 * use your proxy for fetch requests." on stdout rather than stderr, which makes
 * a bare `JSON.parse` of `--json` output throw for anyone with `HTTPS_PROXY` or
 * `ALL_PROXY` set. Every caller that parses Wrangler JSON must go through here.
 *
 * @param {string} raw Raw stdout captured from a Wrangler invocation.
 * @returns {string} The payload starting at the first JSON object or array.
 * @example
 * extractWranglerJson('Proxy environment variables detected.\n[{"results":[]}]');
 * // => '[{"results":[]}]'
 */
export function extractWranglerJson(raw) {
  const arrayStart = raw.indexOf("[");
  const objectStart = raw.indexOf("{");
  if (arrayStart === -1 && objectStart === -1) return raw;
  const start =
    arrayStart === -1
      ? objectStart
      : objectStart === -1
        ? arrayStart
        : Math.min(arrayStart, objectStart);
  return raw.slice(start);
}
