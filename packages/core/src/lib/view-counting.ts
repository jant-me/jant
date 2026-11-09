/**
 * What counts as a page view, and the keys a view is filed under.
 *
 * A view is decided in two steps. Here, from the facts of one request and
 * its response, whether it may count at all: a browser's top-level navigation
 * announces itself in the `Sec-Fetch-*` headers every current engine sends
 * and almost no crawler does, and the short User-Agent list below is only a
 * backstop for the headless browsers that still say what they are. Then, in
 * the browser, whether the page was seen: the reader bundle confirms the
 * view after a few seconds in front of the reader or on the first
 * interaction (`lib/view-token.ts`), which a crawler running a real browser
 * never gets to. No cookie, no stored address. This module also reduces what
 * is kept to a counter key: the site's calendar day and hour, the page, and
 * where the reader came from — the source the link was tagged with, or else
 * the referring host, either one folded to the address its source is listed
 * under (`referrer-aliases.ts`), or the site itself.
 */

import { ID_PREFIX, isTypeId } from "./ids.js";
import { canonicalSource } from "./referrer-aliases.js";

/**
 * What the page a route rendered counts as: a post, a collection or a smart
 * collection, by id, so a count survives a change of address and an alias
 * and its canonical path are one page; or any other public page — the home
 * page, the archive, an aggregate selection — by its path. Routes set it on
 * the context (`viewTarget`) and `middleware/view-counter.ts` reads it after
 * the response.
 */
export type ViewTarget =
  | { kind: "post" | "collection" | "smartCollection"; id: string }
  | { kind: "path" };

/**
 * The `page` and `referrer` of a site-day's overflow row, where new
 * page-referrer pairs land once the day has `VIEW_COUNT_ROWS_PER_SITE_DAY`
 * rows. Never a real page or host: a path starts with `/`, an id with its
 * TypeID prefix, and a hostname has no `*`.
 */
export const VIEW_OVERFLOW_KEY = "*";

/**
 * The referrer of a view that came from another page of the site itself:
 * a reader moving on from the home page to a post. Kept apart from a direct
 * visit so that "Direct" means what it says, and never a host, since no
 * hostname is `/`.
 */
export const VIEW_INTERNAL_REFERRER = "/";

/** What a counter key names, told from its shape alone. */
export type ViewPageKind =
  "post" | "collection" | "smartCollection" | "path" | "overflow";

/**
 * What a counter key names. A key is self-describing: the overflow key,
 * a path, or a TypeID whose prefix says which table the entity is in. The
 * table needs no kind column for it.
 *
 * @param key - A `view_count.page` value
 * @returns Its kind, or `null` for a string that could never be a key
 * @example
 * ```ts
 * viewPageKind("/archive"); // "path"
 * viewPageKind("pst_01h455vb4pex5vsknk084sn02q"); // "post"
 * viewPageKind("nonsense"); // null
 * ```
 */
export function viewPageKind(key: string): ViewPageKind | null {
  if (key === VIEW_OVERFLOW_KEY) return "overflow";
  if (key.startsWith("/")) return "path";
  if (isTypeId(key, ID_PREFIX.post)) return "post";
  if (isTypeId(key, ID_PREFIX.collection)) return "collection";
  if (isTypeId(key, ID_PREFIX.smartCollection)) return "smartCollection";
  return null;
}

/** Longest page key stored; a path past this is nothing a site links to. */
const PAGE_KEY_MAX_LENGTH = 512;
/** A hostname's own limit. */
const HOST_MAX_LENGTH = 253;

/**
 * Where a `Referer` may come from: the web, or an Android app that says which
 * app opened the link (`android-app://com.example.app/`). Anything else is a
 * direct visit.
 */
const REFERER_SCHEMES = new Set(["http:", "https:", "android-app:"]);

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}$/;

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
 * Lowercased, with a leading `www.` and a trailing dot removed, then folded
 * to the address its source is listed under (`old.reddit.com` and `redd.it`
 * are both `reddit.com`), so one site is one row. A link opened from an
 * Android app names the app rather than a site; a known app folds to its
 * site, an unknown one is kept by its package id. A link from the site
 * itself is {@link VIEW_INTERNAL_REFERRER}. Empty for a direct visit and for
 * any other scheme — browsers send only the origin across sites by default,
 * and that is all that is wanted anyway.
 *
 * @param referer - The request's `Referer` header, if any
 * @param ownHost - The host the site is being served on
 * @returns The referring host, `/` for the site itself, or `""`
 * @example
 * ```ts
 * referrerHost("https://www.Example.com/post?x=1", "blog.example"); // "example.com"
 * referrerHost("https://old.reddit.com/r/blogs", "blog.example"); // "reddit.com"
 * referrerHost("android-app://com.example.app/", "blog.example"); // "com.example.app"
 * referrerHost("https://blog.example/", "blog.example"); // "/"
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
  if (!REFERER_SCHEMES.has(url.protocol)) return "";
  const host = normalizeHost(url.hostname);
  if (!host) return "";
  if (host === normalizeHost(ownHost)) return VIEW_INTERNAL_REFERRER;
  return canonicalSource(host).slice(0, HOST_MAX_LENGTH);
}

/** Query parameters whose value says where a link was shared, in the order tried. */
const SOURCE_QUERY_PARAMS = ["utm_source", "ref"] as const;

/**
 * What a source parameter may look like once normalized: a hostname
 * (`chatgpt.com`) or a plain word someone tagged a link with (`newsletter`,
 * `hacker_news`). Anything else — spaces, slashes, markup, a long string —
 * is not a name worth a row and is ignored.
 */
const SOURCE_TOKEN = /^[a-z0-9][a-z0-9._-]{0,62}$/;

/**
 * The referrer a view is filed under.
 *
 * A `utm_source` or `ref` parameter on the link wins when it names something:
 * whoever tagged the link said where it would be shared, which beats the host
 * the browser happened to report and is often the only signal — an app
 * opening a link sends no `Referer`, and ChatGPT tags the links in its
 * answers with `utm_source=chatgpt.com`. Without a usable tag the `Referer`
 * host decides, as in {@link referrerHost}. Both are normalized and folded
 * the same way, so a `utm_source=chatgpt.com` and a `Referer` from
 * chatgpt.com are one row, and so are `utm_source=twitter` and a `Referer`
 * from t.co. A view with no `Referer` at all is still the site's own when
 * the browser says so in `Sec-Fetch-Site`, which no referrer policy
 * suppresses.
 *
 * @param input - The request's `Referer` header, its URL (for the query
 *   string), the host the site is being served on, and the request's
 *   `Sec-Fetch-Site` header
 * @returns The referrer key: a host or tag, `/` for the site itself, or
 *   `""` for a direct visit
 * @example
 * ```ts
 * viewReferrer({
 *   referer: null,
 *   requestUrl: "https://blog.example/post?utm_source=chatgpt.com",
 *   ownHost: "blog.example",
 * }); // "chatgpt.com"
 * viewReferrer({
 *   referer: "https://t.co/abc",
 *   requestUrl: "https://blog.example/post?ref=newsletter",
 *   ownHost: "blog.example",
 * }); // "newsletter"
 * viewReferrer({
 *   referer: "https://news.ycombinator.com/",
 *   requestUrl: "https://blog.example/post",
 *   ownHost: "blog.example",
 * }); // "news.ycombinator.com"
 * ```
 */
export function viewReferrer(input: {
  referer: string | null | undefined;
  requestUrl: string;
  ownHost: string;
  fetchSite?: string | null;
}): string {
  const tagged = taggedSource(input.requestUrl, input.ownHost);
  if (tagged !== null) return tagged;
  const host = referrerHost(input.referer, input.ownHost);
  if (host !== "") return host;
  return input.fetchSite === "same-origin" || input.fetchSite === "same-site"
    ? VIEW_INTERNAL_REFERRER
    : "";
}

/**
 * The source a link's own parameters name, or `null` when they name none.
 * `""` is a tag naming the site itself, which is a direct visit.
 */
function taggedSource(requestUrl: string, ownHost: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URL(requestUrl).searchParams;
  } catch {
    return null;
  }
  for (const name of SOURCE_QUERY_PARAMS) {
    const value = params.get(name)?.trim();
    if (!value) continue;
    const token = normalizeHost(value);
    if (!SOURCE_TOKEN.test(token)) continue;
    if (token === normalizeHost(ownHost)) return "";
    return canonicalSource(token);
  }
  return null;
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
 * The hour a moment falls in, in a time zone, as `YYYY-MM-DDTHH`: the day key
 * and the hour of the day, so a day's hours sort and compare as strings.
 *
 * @param timestamp - Unix timestamp in seconds
 * @param timeZone - IANA time zone
 * @returns The hour key
 * @example
 * ```ts
 * formatHourKey(1_762_560_000, "Asia/Shanghai"); // "2025-11-08T08"
 * ```
 */
export function formatHourKey(timestamp: number, timeZone: string): string {
  const date = new Date(timestamp * 1000);
  let hour: string;
  try {
    hour =
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(date)
        .find((part) => part.type === "hour")?.value ?? "00";
  } catch {
    hour = String(date.getUTCHours()).padStart(2, "0");
  }
  return `${formatDayKey(timestamp, timeZone)}T${hour}`;
}

/**
 * Whether a string is a `YYYY-MM-DDTHH` hour key.
 *
 * @param value - The string to check
 * @returns `true` for an hour key
 * @example
 * ```ts
 * isHourKey("2026-11-09T14"); // true
 * ```
 */
export function isHourKey(value: string): boolean {
  return HOUR_KEY.test(value);
}

/**
 * The 24 hour keys of a day, in order.
 *
 * @param day - The day key
 * @returns `day`'s hours, `T00` through `T23`
 * @example
 * ```ts
 * hourKeysOfDay("2026-11-09")[14]; // "2026-11-09T14"
 * ```
 */
export function hourKeysOfDay(day: string): string[] {
  return Array.from(
    { length: 24 },
    (_, hour) => `${day}T${String(hour).padStart(2, "0")}`,
  );
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
