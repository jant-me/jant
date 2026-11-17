/**
 * Safe remote URL fetching on the server.
 *
 * Two callers fetch URLs an author supplied. Image sideloading rehosts the
 * `<img>` sources of an article pasted from another site (a browser `fetch` of
 * a third-party image is blocked by CORS for most hosts). Link previews read
 * the `<head>` of the page a Link post points at, and the images it names.
 * Either URL is attacker-influenced, so every fetch passes through an SSRF
 * guard and a bounded reader that caps size and time.
 *
 * Two layers guard the address. {@link assertPublicHttpUrl} refuses a URL whose
 * host is a private name or IP literal, in any of the forms an IPv6 address can
 * carry an IPv4 one. On Node, every fetch here also resolves each host and
 * refuses it when any address it resolves to is private, which catches names
 * like `127.0.0.1.nip.io`. A Worker's fetch can't reach a private network at
 * all, so it skips the lookup. A host that answers a public address to the
 * check and a private one to the fetch a moment later (DNS rebinding) is out of
 * reach of both; that needs network-level egress control.
 */

import { ValidationError } from "./errors.js";

/** A browser-like UA — many CDNs serving article images block unknown bots. */
const IMAGE_USER_AGENT =
  "Mozilla/5.0 (compatible; Jant image sideloader) AppleWebKit/537.36";

/** The UA a page is read with for a Link preview. */
const PAGE_USER_AGENT =
  "Mozilla/5.0 (compatible; Jant link preview; +https://jant.me) AppleWebKit/537.36";

/** What a fetch is for, which names it in the errors it throws. */
export type FetchTarget = "image" | "page";

const FETCH_ERRORS: Record<
  FetchTarget,
  {
    invalid: string;
    protocol: string;
    credentials: string;
    privateAddress: string;
    unresolved: string;
    timeout: string;
    failed: string;
    redirects: string;
  }
> = {
  image: {
    invalid: "That doesn't look like a valid image URL.",
    protocol: "Only http and https image URLs can be fetched.",
    credentials: "Image URLs can't include credentials.",
    privateAddress: "That image URL points to a private address.",
    unresolved: "Couldn't find the image's host.",
    timeout: "Timed out fetching the image.",
    failed: "Couldn't fetch the image",
    redirects: "Too many redirects fetching the image.",
  },
  page: {
    invalid: "That doesn't look like a valid URL.",
    protocol: "Only http and https pages can be fetched.",
    credentials: "Page URLs can't include credentials.",
    privateAddress: "That URL points to a private address.",
    unresolved: "Couldn't find the page's host.",
    timeout: "Timed out fetching the page.",
    failed: "Couldn't fetch the page",
    redirects: "Too many redirects fetching the page.",
  },
};

const IMAGE_TOO_LARGE = "That image is too large.";

export interface FetchedImage {
  bytes: Uint8Array;
  /** Lowercased content-type with parameters stripped, or null if absent. */
  contentType: string | null;
}

export interface FetchImageBytesOptions {
  /** Reject (and abort) once the body exceeds this many bytes. */
  maxBytes: number;
  /** Abort the whole request after this many milliseconds. */
  timeoutMs: number;
  /** Maximum redirect hops to follow (each re-validated). Default 3. */
  maxRedirects?: number;
}

export interface FetchedHtmlHead {
  /** The document up to its `</head>` or `<body>`, or up to `maxBytes`. */
  html: string;
  /** The URL the document came from, after redirects. */
  url: URL;
}

export interface FetchHtmlHeadOptions {
  /** Stop reading (without failing) once this many bytes have arrived. */
  maxBytes: number;
  /** Abort the whole request after this many milliseconds. */
  timeoutMs: number;
  /** Maximum redirect hops to follow (each re-validated). Default 5. */
  maxRedirects?: number;
}

/**
 * Validate that a string is a public http(s) URL safe to fetch server-side.
 *
 * Throws {@link ValidationError} for non-http(s) protocols, embedded
 * credentials, localhost names, and private/loopback/link-local/ULA/CGNAT IP
 * literals (including the `169.254.169.254` cloud-metadata address).
 *
 * @param raw - The candidate URL string
 * @param target - What the URL is fetched for, which names it in the error
 * @returns The parsed {@link URL}
 * @example
 * ```ts
 * const url = assertPublicHttpUrl("https://example.com/photo.jpg");
 * ```
 */
export function assertPublicHttpUrl(
  raw: string,
  target: FetchTarget = "image",
): URL {
  const errors = FETCH_ERRORS[target];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError(errors.invalid);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError(errors.protocol);
  }
  if (url.username || url.password) {
    throw new ValidationError(errors.credentials);
  }

  // A trailing dot names the same host (`localhost.` is `localhost`).
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    isPrivateAddress(host)
  ) {
    throw new ValidationError(errors.privateAddress);
  }

  return url;
}

/**
 * Resolves a URL's host and refuses it when any address is private.
 *
 * Skipped on Cloudflare Workers, whose fetch can't reach a private network.
 *
 * @param url - A URL already accepted by {@link assertPublicHttpUrl}
 * @param target - What the URL is fetched for, which names it in the error
 * @throws {ValidationError} When the host resolves to a private address or
 *   doesn't resolve
 * @example
 * ```ts
 * await assertResolvesPublic(new URL("https://127.0.0.1.nip.io/a.png")); // throws
 * ```
 */
export async function assertResolvesPublic(
  url: URL,
  target: FetchTarget = "image",
): Promise<void> {
  if (isCloudflareWorker()) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(host)) return; // Already checked by assertPublicHttpUrl.

  const errors = FETCH_ERRORS[target];
  const lookup = await loadDnsLookup();
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new ValidationError(errors.unresolved);
  }
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new ValidationError(errors.privateAddress);
  }
}

type DnsLookup = (typeof import("node:dns/promises"))["lookup"];
let dnsLookup: Promise<DnsLookup> | undefined;

/**
 * `node:dns/promises`, imported once. A preview resolves its thumbnail and
 * its icon side by side, so two lookups often start together; they share one
 * import rather than each starting their own.
 */
function loadDnsLookup(): Promise<DnsLookup> {
  dnsLookup ??= import("node:dns/promises").then(({ lookup }) => lookup);
  return dnsLookup;
}

function isCloudflareWorker(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers"
  );
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/**
 * GET a URL, following redirects by hand so that every hop passes the SSRF
 * guard, and return the first response that isn't a redirect.
 */
async function fetchFollowingPublicRedirects(
  startUrl: URL,
  input: {
    target: FetchTarget;
    headers: (url: URL) => Record<string, string>;
    signal: AbortController["signal"];
    maxRedirects: number;
  },
): Promise<{ response: Response; url: URL }> {
  const errors = FETCH_ERRORS[input.target];
  let url = startUrl;
  let response: Response | null = null;

  for (let hop = 0; hop <= input.maxRedirects; hop++) {
    await assertResolvesPublic(url, input.target);
    response = await fetch(url.toString(), {
      method: "GET",
      redirect: "manual",
      signal: input.signal,
      headers: input.headers(url),
    }).catch((error) => {
      if (input.signal.aborted) {
        throw new ValidationError(errors.timeout);
      }
      throw new ValidationError(
        error instanceof Error
          ? `${errors.failed}: ${error.message}`
          : `${errors.failed}.`,
      );
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break; // No target — fall through to the (failing) checks.
      if (hop === input.maxRedirects) {
        throw new ValidationError(errors.redirects);
      }
      // Re-validate every hop so a redirect can't escape the SSRF guard.
      url = assertPublicHttpUrl(
        new URL(location, url).toString(),
        input.target,
      );
      continue;
    }
    break;
  }

  if (!response) {
    throw new ValidationError(`${errors.failed}.`);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ValidationError(`${errors.failed} (HTTP ${response.status}).`);
  }
  return { response, url };
}

/**
 * Fetch a remote image with an SSRF-checked redirect chain, a size cap, and a
 * timeout. Reads the body in chunks and aborts the moment it exceeds `maxBytes`
 * so an untrusted host can't exhaust memory.
 *
 * @param startUrl - A URL already validated by {@link assertPublicHttpUrl}
 * @param options - Size cap, timeout, and redirect budget
 * @returns The raw bytes and the response content-type
 * @example
 * ```ts
 * const { bytes, contentType } = await fetchImageBytes(url, {
 *   maxBytes: 25 * 1024 * 1024,
 *   timeoutMs: 15000,
 * });
 * ```
 */
export async function fetchImageBytes(
  startUrl: URL,
  options: FetchImageBytesOptions,
): Promise<FetchedImage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const { response } = await fetchFollowingPublicRedirects(startUrl, {
      target: "image",
      signal: controller.signal,
      maxRedirects: options.maxRedirects ?? 3,
      headers: (url) => ({
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": IMAGE_USER_AGENT,
        // Many CDNs (Douban, WeChat, Bilibili, etc.) reject hotlinked image
        // requests that lack a Referer or carry a foreign one. Sending the
        // image's own origin satisfies the common "referer must be same-site"
        // hotlink check.
        Referer: `${url.origin}/`,
      }),
    });

    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new ValidationError(IMAGE_TOO_LARGE);
    }

    const contentType = normalizeContentType(
      response.headers.get("content-type"),
    );
    const bytes = await readBounded(response, options.maxBytes);
    return { bytes, contentType };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the `<head>` of an HTML page with an SSRF-checked redirect chain and a
 * timeout. Reading stops at `</head>` or `<body>`, or once `maxBytes` have
 * arrived — a truncated head is returned, not refused, because the metadata a
 * preview needs sits near the top. Only HTML is read: a response that declares
 * another content type is refused before its body is touched.
 *
 * The bytes are decoded as UTF-8 whatever the page's charset: callers read
 * attribute values that are URLs and keywords, which are ASCII in any
 * charset a page is likely to use.
 *
 * @param startUrl - A URL already validated by {@link assertPublicHttpUrl}
 * @param options - Read cap, timeout, and redirect budget
 * @returns The head's HTML and the URL it came from after redirects
 * @example
 * ```ts
 * const { html, url } = await fetchHtmlHead(
 *   assertPublicHttpUrl("https://example.com/post", "page"),
 *   { maxBytes: 512 * 1024, timeoutMs: 3000 },
 * );
 * ```
 */
export async function fetchHtmlHead(
  startUrl: URL,
  options: FetchHtmlHeadOptions,
): Promise<FetchedHtmlHead> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const { response, url } = await fetchFollowingPublicRedirects(startUrl, {
      target: "page",
      signal: controller.signal,
      maxRedirects: options.maxRedirects ?? 5,
      headers: () => ({
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "User-Agent": PAGE_USER_AGENT,
      }),
    });

    const contentType = normalizeContentType(
      response.headers.get("content-type"),
    );
    if (
      contentType &&
      contentType !== "text/html" &&
      contentType !== "application/xhtml+xml"
    ) {
      await response.body?.cancel().catch(() => {});
      throw new ValidationError(`${FETCH_ERRORS.page.failed}: not HTML.`);
    }

    const html = await readHead(response, options.maxBytes).catch((error) => {
      if (controller.signal.aborted) {
        throw new ValidationError(FETCH_ERRORS.page.timeout);
      }
      throw error;
    });
    return { html, url };
  } finally {
    clearTimeout(timer);
  }
}

/** Where a document's head ends: its closing tag, or the body's opening one. */
const HEAD_END = /<\/head[\s>]|<body[\s>]/i;

/** Longest tail of one chunk that could start a {@link HEAD_END} match. */
const HEAD_END_OVERLAP = 6;

async function readHead(response: Response, maxBytes: number): Promise<string> {
  const decoder = new TextDecoder("utf-8");
  const body = response.body;
  if (!body) {
    const text = decoder.decode(
      new Uint8Array(await response.arrayBuffer()).subarray(0, maxBytes),
    );
    return cutAtHeadEnd(text);
  }

  const reader = body.getReader();
  let text = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = maxBytes - total;
      const chunk = value.byteLength > room ? value.subarray(0, room) : value;
      total += chunk.byteLength;
      const searchFrom = Math.max(0, text.length - HEAD_END_OVERLAP);
      text += decoder.decode(chunk, { stream: true });
      const end = text.slice(searchFrom).search(HEAD_END);
      if (end !== -1) return text.slice(0, searchFrom + end);
      if (total >= maxBytes) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text + decoder.decode();
}

function cutAtHeadEnd(text: string): string {
  const end = text.search(HEAD_END);
  return end === -1 ? text : text.slice(0, end);
}

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const body = response.body;
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new ValidationError(IMAGE_TOO_LARGE);
    }
    return buffer;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ValidationError(IMAGE_TOO_LARGE);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function normalizeContentType(raw: string | null): string | null {
  if (!raw) return null;
  const type = raw.split(";")[0]?.trim().toLowerCase();
  return type || null;
}

/**
 * True when a host or resolved address is not a public unicast address: a
 * private, loopback, link-local, CGNAT, multicast, or reserved IPv4 address,
 * or an IPv6 address in the matching ranges, including every form that embeds
 * an IPv4 address (mapped, compatible, NAT64, 6to4). Names return `false`.
 *
 * @param host - An IP literal, bracketed or bare, or a host name
 * @returns `true` when the address must not be fetched
 *
 * @example
 * ```ts
 * isPrivateAddress("10.0.0.1"); // true
 * isPrivateAddress("[::7f00:1]"); // true: IPv4-compatible 127.0.0.1
 * isPrivateAddress("example.com"); // false
 * ```
 */
export function isPrivateAddress(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) return isPrivateIpv4(bare);
  if (bare.includes(":")) return isPrivateIpv6(bare);
  return false;
}

/**
 * True when a dotted-quad IPv4 address is in a non-public range. The WHATWG
 * URL parser already normalizes decimal, octal, and hex IPv4 forms to
 * dotted-quad, so checking `url.hostname` is sufficient.
 */
function isPrivateIpv4(host: string): boolean {
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => part > 255)) return true;
  const [a = 0, b = 0] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "this" network
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local (metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 192 && b === 0 && octets[2] === 0) return true; // 192.0.0/24 IETF
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** Expands an IPv6 address to its eight 16-bit groups, or null if malformed. */
function expandIpv6(address: string): number[] | null {
  let text = address.split("%")[0] ?? "";
  // A trailing dotted IPv4 part becomes two groups.
  const v4 = text.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [p1, p2, p3, p4] = v4.slice(1, 5).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    if ([p1, p2, p3, p4].some((part) => part > 255)) return null;
    text = `${text.slice(0, v4.index)}${((p1 << 8) | p2).toString(16)}:${((p3 << 8) | p4).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string | undefined) =>
    part ? part.split(":").map((group) => parseInt(group, 16)) : [];
  const head = parse(halves[0]);
  const tail = parse(halves[1]);
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...head, ...Array<number>(missing).fill(0), ...tail];
  if (
    groups.some(
      (group) => !Number.isInteger(group) || group < 0 || group > 0xffff,
    )
  ) {
    return null;
  }
  return groups;
}

function embeddedIpv4(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/** True when an IPv6 address is in a non-public range, or embeds a private IPv4. */
function isPrivateIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups) return true; // Malformed → unsafe.
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] =
    groups;

  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible, which covers :: and ::1).
    if (g5 === 0xffff || g5 === 0) return true;
  }
  if (g0 === 0x64 && g1 === 0xff9b) {
    // 64:ff9b::/96 well-known NAT64 prefix; 64:ff9b:1::/48 is local-use.
    return g2 !== 0 || isPrivateIpv4(embeddedIpv4(g6, g7));
  }
  if (g0 === 0x2002) return isPrivateIpv4(embeddedIpv4(g1, g2)); // 6to4
  if (g0 === 0x2001 && g1 === 0) return true; // 2001::/32 Teredo
  if (g0 === 0x2001 && g1 === 0xdb8) return true; // 2001:db8::/32 documentation
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}
