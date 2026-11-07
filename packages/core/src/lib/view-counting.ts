/**
 * What counts as a page view, and the keys a view is filed under.
 *
 * Views are counted on the server from the facts of one request and its
 * response: no script, no cookie, no stored address. That makes two things
 * matter here. First, telling a reader from a machine without ever seeing the
 * reader: a browser's top-level navigation announces itself in the
 * `Sec-Fetch-*` headers every current engine sends and almost no crawler does,
 * and the short User-Agent list below is only a backstop for the headless
 * browsers that still say what they are. Second, reducing what is kept to a
 * counter key: the site's calendar day, the page, and the referring host.
 */

/**
 * What the page a route rendered counts as: a post, by id, or any other
 * public page, by its path. Routes set it on the context (`viewTarget`) and
 * `middleware/view-counter.ts` reads it after the response.
 */
export type ViewTarget = { kind: "post"; id: string } | { kind: "path" };

/**
 * The `page` and `referrer` of a site-day's overflow row, where new
 * page-referrer pairs land once the day has `VIEW_COUNT_ROWS_PER_SITE_DAY`
 * rows. Never a real page or host: a path starts with `/`, a post id with
 * `pst_`, and a hostname has no `*`.
 */
export const VIEW_OVERFLOW_KEY = "*";

/** Longest page key stored; a path past this is nothing a site links to. */
const PAGE_KEY_MAX_LENGTH = 512;
/** A hostname's own limit. */
const HOST_MAX_LENGTH = 253;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Machines that run a browser engine and say so, and HTTP libraries that send
 * a `Sec-Fetch-Dest: document` of their own. Everything else is already kept
 * out by the navigation check, so this list stays short and obvious rather
 * than trying to be complete.
 */
const BOT_USER_AGENT = new RegExp(
  [
    "bot",
    "crawl",
    "spider",
    "slurp",
    "scrape",
    "fetch",
    "preview",
    "headless",
    "phantom",
    "selenium",
    "puppeteer",
    "playwright",
    "lighthouse",
    "pagespeed",
    "python",
    "curl/",
    "wget/",
    "java/",
    "go-http-client",
    "okhttp",
    "libwww",
    "httpclient",
    "axios",
    "feed",
    "rss",
    "validator",
    "monitor",
    "uptime",
    "facebookexternalhit",
    "embedly",
    "whatsapp",
  ].join("|"),
  "i",
);

/**
 * Whether a User-Agent names a machine rather than a reader's browser.
 *
 * A missing User-Agent counts as a machine: every browser sends one.
 *
 * @param userAgent - The request's `User-Agent`, if any
 * @returns `true` when the request should not count as a view
 * @example
 * ```ts
 * isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)"); // true
 * isBotUserAgent("Mozilla/5.0 (Macintosh) Safari/605.1.15"); // false
 * ```
 */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return BOT_USER_AGENT.test(userAgent);
}

/** The facts of one request and its response that decide a view. */
export interface ViewCandidate {
  method: string;
  status: number;
  /** The response's `Content-Type`. */
  contentType: string | null;
  isAuthenticated: boolean;
  /** The request headers. */
  headers: Headers;
}

/**
 * Whether a request and its response are one reader opening one page.
 *
 * A view is a `GET` that answered `200` with HTML to someone who is not signed
 * in, from a browser's top-level navigation (`Sec-Fetch-Dest: document`,
 * `Sec-Fetch-Mode: navigate`) that is not a prefetch or prerender, with a
 * User-Agent that is not a known machine. The `Sec-Fetch-*` requirement is
 * what keeps out the long tail of crawlers and HTTP clients; it also keeps out
 * browsers from before 2023 that never sent the headers, which by now is a
 * share small enough to accept.
 *
 * @param candidate - The request and response facts
 * @returns `true` when this response counts as a view
 * @example
 * ```ts
 * shouldCountView({
 *   method: "GET",
 *   status: 200,
 *   contentType: "text/html; charset=UTF-8",
 *   isAuthenticated: false,
 *   headers: request.headers,
 * });
 * ```
 */
export function shouldCountView(candidate: ViewCandidate): boolean {
  if (candidate.method !== "GET") return false;
  if (candidate.status !== 200) return false;
  if (!candidate.contentType?.toLowerCase().startsWith("text/html")) {
    return false;
  }
  if (candidate.isAuthenticated) return false;

  const { headers } = candidate;
  if (headers.get("sec-fetch-dest") !== "document") return false;
  if (headers.get("sec-fetch-mode") !== "navigate") return false;

  // Speculative loads: Chrome's speculation rules (`Sec-Purpose`), the older
  // `Purpose` and `X-Purpose` hints, Firefox's `X-Moz`. A page fetched ahead
  // of a click is not a page read.
  const purpose = [
    headers.get("sec-purpose"),
    headers.get("purpose"),
    headers.get("x-purpose"),
    headers.get("x-moz"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    purpose.includes("prefetch") ||
    purpose.includes("prerender") ||
    purpose.includes("preview")
  ) {
    return false;
  }

  return !isBotUserAgent(headers.get("user-agent"));
}

function normalizeHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

/**
 * The host a view came from, reduced to what the stats keep.
 *
 * Lowercased, with a leading `www.` and a trailing dot removed, so one site
 * is one row. Empty for a direct visit, for a link from the site itself, and
 * for anything that is not an `http(s)` URL — browsers send only the origin
 * across sites by default, and that is all that is wanted anyway.
 *
 * @param referer - The request's `Referer` header, if any
 * @param ownHost - The host the site is being served on
 * @returns The referring host, or `""`
 * @example
 * ```ts
 * referrerHost("https://www.Example.com/post?x=1", "blog.example"); // "example.com"
 * referrerHost("https://blog.example/", "blog.example"); // ""
 * referrerHost(null, "blog.example"); // ""
 * ```
 */
export function referrerHost(
  referer: string | null | undefined,
  ownHost: string,
): string {
  if (!referer) return "";
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  const host = normalizeHost(url.hostname);
  if (!host || host === normalizeHost(ownHost)) return "";
  return host.slice(0, HOST_MAX_LENGTH);
}

/**
 * The key a non-post page is counted under: its path, with the language
 * view's prefix and any trailing slash removed, so `/en/archive/` and
 * `/archive` are one page.
 *
 * @param path - The request's internal path, site prefix already removed
 * @param viewBase - The language view's prefix (`/en`), or `""` on the root view
 * @returns The page key
 * @example
 * ```ts
 * viewPathKey("/en/archive", "/en"); // "/archive"
 * viewPathKey("/en", "/en"); // "/"
 * viewPathKey("/", ""); // "/"
 * ```
 */
export function viewPathKey(path: string, viewBase: string): string {
  let key = path;
  if (viewBase && (key === viewBase || key.startsWith(`${viewBase}/`))) {
    key = key.slice(viewBase.length) || "/";
  }
  key = key.replace(/\/+$/, "") || "/";
  return key.slice(0, PAGE_KEY_MAX_LENGTH);
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    // `en-CA` writes dates as `YYYY-MM-DD`.
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * The calendar day a moment falls on in a time zone, as `YYYY-MM-DD`.
 *
 * An unknown time zone falls back to UTC rather than failing: a view is not
 * worth an error, and the site's zone is validated where it is set.
 *
 * @param timestamp - Unix timestamp in seconds
 * @param timeZone - IANA time zone, such as `Asia/Shanghai`
 * @returns The day key
 * @example
 * ```ts
 * formatDayKey(1_762_560_000, "Asia/Shanghai"); // "2025-11-08"
 * formatDayKey(1_762_560_000, "UTC"); // "2025-11-08"
 * ```
 */
export function formatDayKey(timestamp: number, timeZone: string): string {
  const date = new Date(timestamp * 1000);
  try {
    return dayFormatter(timeZone).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Whether a string is a `YYYY-MM-DD` day key.
 *
 * @param value - The string to check
 * @returns `true` for a day key
 * @example
 * ```ts
 * isDayKey("2026-11-08"); // true
 * isDayKey("2026-11-8"); // false
 * ```
 */
export function isDayKey(value: string): boolean {
  return DAY_KEY.test(value);
}

/**
 * A day key some days before or after another.
 *
 * Calendar arithmetic in UTC, so a local time zone's daylight-saving jumps
 * never land a day on the wrong key.
 *
 * @param day - The starting day key
 * @param days - Days to move; negative moves back
 * @returns The resulting day key
 * @example
 * ```ts
 * shiftDayKey("2026-03-01", -1); // "2026-02-28"
 * shiftDayKey("2026-12-31", 1); // "2027-01-01"
 * ```
 */
export function shiftDayKey(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + days))
    .toISOString()
    .slice(0, 10);
}

/**
 * The run of day keys that ends on a day, oldest first.
 *
 * @param day - The last day of the run
 * @param count - How many days, the last one included
 * @returns `count` day keys ending at `day`
 * @example
 * ```ts
 * dayKeysEndingAt("2026-11-08", 3); // ["2026-11-06", "2026-11-07", "2026-11-08"]
 * ```
 */
export function dayKeysEndingAt(day: string, count: number): string[] {
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    keys.push(shiftDayKey(day, -offset));
  }
  return keys;
}
