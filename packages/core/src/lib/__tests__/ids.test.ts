import { afterEach, describe, expect, it, vi } from "vitest";
import { ID_PREFIX, createTypeId, isTypeId } from "../ids.js";

const MS = 1792384097123;
const PATTERN = Uint8Array.from({ length: 16 }, (_, i) => i * 17);
const ONES = new Uint8Array(16).fill(0xff);
const ZEROS = new Uint8Array(16);

/** Load `ids.ts` again, so the v7 counter starts from nothing. */
async function freshIds() {
  vi.resetModules();
  return import("../ids.js");
}

/** Make the next `crypto.getRandomValues()` calls return these bytes. */
function queueRandomBytes(...queue: Uint8Array[]) {
  vi.spyOn(crypto, "getRandomValues").mockImplementation(<T>(array: T): T => {
    const next = queue.shift();
    if (!next) throw new Error("No random bytes queued");
    (array as Uint8Array).set(next);
    return array;
  });
}

describe("createTypeId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the prefix and a UUIDv7 in 26 base32 characters", () => {
    const before = Date.now();
    const id = createTypeId(ID_PREFIX.post);
    expect(id).toMatch(/^pst_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
    expect(isTypeId(id, ID_PREFIX.post)).toBe(true);

    // The first ten characters hold the 48-bit millisecond timestamp.
    let msecs = 0;
    for (const char of id.slice(4, 14)) {
      msecs = msecs * 32 + "0123456789abcdefghjkmnpqrstvwxyz".indexOf(char);
    }
    expect(msecs).toBeGreaterThanOrEqual(before);
    expect(msecs).toBeLessThanOrEqual(Date.now());
  });

  // Expected values come from typeid-js 1.2.0 over uuid 11's v7(), with the
  // same clock and random bytes, before Jant stopped depending on them.
  it("makes what typeid-js and uuid's v7() made for the same clock and bytes", async () => {
    const ids = await freshIds();
    const now = vi.spyOn(Date, "now");
    queueRandomBytes(PATTERN, ONES, ZEROS, ZEROS, ONES);

    now.mockReturnValue(MS);
    expect(ids.createTypeId("pst")).toBe("pst_01m596npv3ecvsw8k6qf6dvvqz");
    // Same millisecond: the counter goes up by one.
    expect(ids.createTypeId("pst")).toBe("pst_01m596npv3ecvsw8kbzzzzzzzz");
    // The clock stepped back: still the last millisecond, counter up by one.
    now.mockReturnValue(MS - 5);
    expect(ids.createTypeId("pst")).toBe("pst_01m596npv3ecvsw8kc00000000");
    // A new millisecond draws the counter again.
    now.mockReturnValue(MS + 1);
    expect(ids.createTypeId("pst")).toBe("pst_01m596npv4e008000000000000");
    expect(ids.createTypeId("pst")).toBe("pst_01m596npv4e0080007zzzzzzzz");
  });

  it("keeps IDs made within one millisecond in the order they were made", async () => {
    const ids = await freshIds();
    vi.spyOn(Date, "now").mockReturnValue(MS);
    const made = Array.from({ length: 200 }, () => ids.createTypeId("med"));
    expect([...made].sort()).toEqual(made);
    expect(new Set(made).size).toBe(made.length);
  });
});

describe("isTypeId", () => {
  // Each case's answer is what typeid-js 1.2.0's fromString() gave.
  it.each([
    ["pst_01h455vb4pex5vsknk084sn02q", true, true],
    ["pst_7zzzzzzzzzzzzzzzzzzzzzzzzz", true, true],
    ["pst_00000000000000000000000000", true, true],
    // The first character carries three bits.
    ["pst_8zzzzzzzzzzzzzzzzzzzzzzzzz", false, false],
    // Lowercase only.
    ["pst_01H455VB4PEX5VSKNK084SN02Q", false, false],
    ["Pst_01h455vb4pex5vsknk084sn02q", false, false],
    // 26 characters.
    ["pst_01h455vb4pex5vsknk084sn02", false, false],
    ["pst_01h455vb4pex5vsknk084sn02qq", false, false],
    ["pst_", false, false],
    // Crockford base32 has no i, l, o, or u.
    ["pst_01h455vb4pex5vsknk084sn0lq", false, false],
    ["pst_01h455vb4pex5vsknk084sn0uq", false, false],
    // A separator needs a prefix, and a prefix starts and ends with a letter.
    ["_01h455vb4pex5vsknk084sn02q", false, false],
    ["pst__01h455vb4pex5vsknk084sn02q", false, false],
    ["_pst_01h455vb4pex5vsknk084sn02q", false, false],
    ["pst-01h455vb4pex5vsknk084sn02q", false, false],
    // No prefix at all is a TypeID, just not a post's.
    ["01h455vb4pex5vsknk084sn02q", true, false],
    // Prefixes can hold underscores, and run to 63 characters.
    ["pre_fix_01h455vb4pex5vsknk084sn02q", true, false],
    [`${"a".repeat(63)}_01h455vb4pex5vsknk084sn02q`, true, false],
    [`${"a".repeat(64)}_01h455vb4pex5vsknk084sn02q`, false, false],
  ])("%s: %s, as a post ID %s", (value, valid, validPost) => {
    expect(isTypeId(value)).toBe(valid);
    expect(isTypeId(value, ID_PREFIX.post)).toBe(validPost);
  });
});
