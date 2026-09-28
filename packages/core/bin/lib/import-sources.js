/**
 * Where `jant site import` may read an export's files from.
 *
 * An export is a directory or archive someone else may have written, and its
 * front matter names the files to upload. A path in it must stay inside the
 * export, or `../../.ssh/id_rsa` is read and published as an attachment; a
 * remote URL must be a public address, or the import fetches from the
 * machine's own network and publishes what it finds.
 */

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { relative, resolve, isAbsolute } from "node:path";

const MAX_REDIRECTS = 3;

/** Every address range an import must not fetch from. */
const PRIVATE_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
]) {
  PRIVATE_ADDRESSES.addSubnet(network, prefix, "ipv4");
}
// An IPv4-mapped address (::ffff:a.b.c.d) is checked against the IPv4 rules
// above on its own; a `::ffff:0:0/96` rule would match every IPv4 address.
for (const [network, prefix] of [
  // IPv4-compatible (covering :: and ::1), then the forms that carry an IPv4
  // address inside: NAT64, 6to4, Teredo.
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["2002::", 16],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["fe80::", 10],
  ["fc00::", 7],
  ["ff00::", 8],
]) {
  PRIVATE_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

/**
 * Resolves a path from an export against a directory, refusing one that
 * leaves it.
 *
 * @param {string} root - Directory the path must stay inside
 * @param {...string} segments - Path segments from the export
 * @returns {string | null} The absolute path, or `null` when it escapes `root`
 *
 * @example
 * resolveInside("/tmp/site", "static", "media/a.webp"); // "/tmp/site/static/media/a.webp"
 * resolveInside("/tmp/site", "static", "../../.ssh/id_rsa"); // null
 */
export function resolveInside(root, ...segments) {
  const base = resolve(root);
  const target = resolve(base, ...segments);
  const path = relative(base, target);
  if (path === "" || path.startsWith("..") || isAbsolute(path)) {
    return null;
  }
  return target;
}

/**
 * Whether an IP address is private, loopback, link-local, or otherwise not a
 * public unicast address.
 *
 * @param {string} address - An IPv4 or IPv6 address
 * @returns {boolean}
 *
 * @example
 * isPrivateAddress("169.254.169.254"); // true
 * isPrivateAddress("93.184.215.14"); // false
 */
export function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 0) return true;
  return PRIVATE_ADDRESSES.check(address, family === 6 ? "ipv6" : "ipv4");
}

/**
 * Refuses a URL an import must not fetch: anything but http(s), embedded
 * credentials, `localhost`, or a host that resolves to a private address.
 *
 * @param {string} rawUrl - The URL from the export
 * @returns {Promise<URL>} The parsed URL
 * @throws {Error} When the URL isn't a public http(s) address
 *
 * @example
 * await assertPublicUrl("https://example.com/media/a.webp");
 */
export async function assertPublicUrl(rawUrl) {
  const url = new URL(rawUrl);
  const refuse = (reason) =>
    new Error(`Refusing to fetch ${url.href}: ${reason}.`);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw refuse("only http and https URLs are fetched");
  }
  if (url.username || url.password) {
    throw refuse("it includes credentials");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw refuse("it points to a private address");
  }
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true, verbatim: true })).map(
        (entry) => entry.address,
      );
  if (addresses.some(isPrivateAddress)) {
    throw refuse("it points to a private address");
  }
  return url;
}

/**
 * Fetches a file an export links to, checking the address of every redirect
 * hop as well as the first.
 *
 * @param {string} rawUrl - The URL from the export
 * @returns {Promise<Response>} The final response
 *
 * @example
 * const response = await fetchPublic("https://example.com/media/a.webp");
 */
export async function fetchPublic(rawUrl) {
  let url = await assertPublicUrl(rawUrl);
  for (let hop = 0; ; hop += 1) {
    const response = await fetch(url, { redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      return response;
    }
    if (hop === MAX_REDIRECTS) {
      throw new Error(`Too many redirects fetching ${rawUrl}.`);
    }
    url = await assertPublicUrl(new URL(location, url).href);
  }
}
