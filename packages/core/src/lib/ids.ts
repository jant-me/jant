/**
 * IDs
 *
 * Every row is keyed by a TypeID (https://github.com/jetify-com/typeid): a
 * prefix naming the entity, `_`, and a UUIDv7 written as 26 characters of
 * lowercase Crockford base32, such as `pst_01h455vb4pex5vsknk084sn02q`.
 *
 * Made here rather than with typeid-js: its latest release asks for uuid 10,
 * which an advisory flags, so every site's `npm install` reported it and
 * `npm audit fix --force` offered to downgrade `@jant/core`. The output is
 * the same, down to uuid's counter that keeps IDs made within one
 * millisecond in the order they were made.
 */

import { z } from "zod";

export const ID_PREFIX = {
  site: "sit",
  siteDomain: "sdm",
  post: "pst",
  /** Shared key linking Posts that are translations of one another. */
  translationGroup: "tgr",
  media: "med",
  uploadSession: "upl",
  collection: "col",
  smartCollection: "smc",
  path: "pth",
  collectionDirectoryItem: "cdi",
  navItem: "nav",
  apiToken: "api",
  user: "usr",
  session: "ses",
  account: "acc",
  verification: "vrf",
  telegramBinding: "tgb",
  telegramBindingCode: "tgc",
  telegramMediaGroupItem: "tmg",
  storagePurge: "spg",
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];
export type IdEntity = keyof typeof ID_PREFIX;

export const AUTH_ID_PREFIX = {
  user: ID_PREFIX.user,
  session: ID_PREFIX.session,
  account: ID_PREFIX.account,
  verification: ID_PREFIX.verification,
} as const;

const TYPE_ID_MESSAGE = "Invalid ID";

const BASE32_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const SUFFIX_LENGTH = 26;
/** Up to 63 of `a-z` and `_`, starting and ending with a letter, or none. */
const PREFIX_PATTERN = /^(?:[a-z](?:[a-z_]{0,61}[a-z])?)?$/;
/** 128 bits in 130, so the first character carries only three: 0–7. */
const SUFFIX_PATTERN = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;

/**
 * The last UUIDv7 made: its millisecond and its 32-bit counter.
 *
 * Within one millisecond, or when the clock steps back, the counter goes up
 * by one instead of being drawn again, so IDs keep the order they were made
 * in. On Workers `Date.now()` stands still until the request does I/O, so
 * every ID one request makes before its first query shares a millisecond.
 */
const v7State = { msecs: -Infinity, seq: 0 };

/**
 * A new UUIDv7 (RFC 9562), as uuid's `v7()` makes it.
 *
 * Bytes 0–5 hold the Unix time in milliseconds. The counter fills the 12
 * bits after the version and the 20 after the variant; the last 42 bits are
 * random. A new millisecond seeds the counter from 31 random bits.
 *
 * @returns The UUID's 16 bytes
 */
function uuidV7Bytes(): Uint8Array {
  const random = crypto.getRandomValues(new Uint8Array(16));
  const randomByte = new DataView(random.buffer);
  const now = Date.now();
  if (now > v7State.msecs) {
    v7State.seq =
      (randomByte.getUint8(6) << 23) |
      (randomByte.getUint8(7) << 16) |
      (randomByte.getUint8(8) << 8) |
      randomByte.getUint8(9);
    v7State.msecs = now;
  } else {
    v7State.seq = (v7State.seq + 1) | 0;
    if (v7State.seq === 0) v7State.msecs++;
  }

  const { msecs, seq } = v7State;
  const bytes = new Uint8Array(16);
  bytes[0] = (msecs / 0x10000000000) & 0xff;
  bytes[1] = (msecs / 0x100000000) & 0xff;
  bytes[2] = (msecs / 0x1000000) & 0xff;
  bytes[3] = (msecs / 0x10000) & 0xff;
  bytes[4] = (msecs / 0x100) & 0xff;
  bytes[5] = msecs & 0xff;
  bytes[6] = 0x70 | ((seq >>> 28) & 0x0f);
  bytes[7] = (seq >>> 20) & 0xff;
  bytes[8] = 0x80 | ((seq >>> 14) & 0x3f);
  bytes[9] = (seq >>> 6) & 0xff;
  bytes[10] = ((seq << 2) & 0xff) | (randomByte.getUint8(10) & 0x03);
  bytes.set(random.subarray(11), 11);
  return bytes;
}

/**
 * Write 16 bytes as a TypeID suffix: 26 base32 characters, most significant
 * first.
 *
 * @param bytes - A UUID's 16 bytes
 * @returns The suffix
 */
function encodeSuffix(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix = BASE32_ALPHABET[Number(value & 31n)] + suffix;
    value >>= 5n;
  }
  return suffix;
}

/**
 * A new TypeID with the given prefix.
 *
 * @param prefix - The entity's prefix
 * @returns The ID, such as `pst_01h455vb4pex5vsknk084sn02q`
 * @example
 * createTypeId(ID_PREFIX.post); // "pst_01k…"
 */
export function createTypeId(prefix: IdPrefix): string {
  return `${prefix}_${encodeSuffix(uuidV7Bytes())}`;
}

/**
 * A new TypeID for an entity.
 *
 * @param entity - Which entity, a key of {@link ID_PREFIX}
 * @returns The ID
 * @example
 * createEntityId("media"); // "med_01k…"
 */
export function createEntityId(entity: IdEntity): string {
  return createTypeId(ID_PREFIX[entity]);
}

/**
 * Whether a string is a well-formed TypeID, with the given prefix if one is
 * named.
 *
 * Without a prefix, any valid one passes, and so does a bare suffix: TypeIDs
 * may have no prefix at all.
 *
 * @param value - The string to check
 * @param prefix - The prefix it must have
 * @returns Whether it is one
 * @example
 * isTypeId("pst_01h455vb4pex5vsknk084sn02q", ID_PREFIX.post); // true
 * isTypeId("pst_01h455vb4pex5vsknk084sn02q", ID_PREFIX.media); // false
 */
export function isTypeId(value: string, prefix?: IdPrefix): boolean {
  const separator = value.lastIndexOf("_");
  // A separator needs a prefix before it.
  if (separator === 0) return false;
  const valuePrefix = separator === -1 ? "" : value.slice(0, separator);
  if (prefix !== undefined && valuePrefix !== prefix) return false;
  return (
    PREFIX_PATTERN.test(valuePrefix) &&
    SUFFIX_PATTERN.test(value.slice(separator + 1))
  );
}

export function createTypeIdSchema(prefix?: IdPrefix) {
  return z.string().refine((value) => isTypeId(value, prefix), {
    message: TYPE_ID_MESSAGE,
  });
}
