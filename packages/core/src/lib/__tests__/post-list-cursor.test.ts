import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors.js";
import {
  decodePostListCursor,
  encodePostListCursor,
  isLegacyPostListCursor,
  type PostListCursorShape,
} from "../post-list-cursor.js";

const POST_ID = "pst_01jpyx3m7gw4w3h7m4bknq0v1d";
const SHAPE: PostListCursorShape = {
  mode: "newest:activity:pinned",
  kinds: ["number", "number", "id"],
};

/** Encode an arbitrary payload the way the codec would, for hostile inputs. */
function encodeRaw(payload: unknown): string {
  return btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeError(raw: string, shape = SHAPE): string {
  try {
    decodePostListCursor(raw, shape);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return (error as ValidationError).message;
  }
  throw new Error(`Expected ${raw} to be rejected`);
}

describe("post list cursor", () => {
  it("round-trips a key tuple", () => {
    const values = [-1, 1706000000, POST_ID];
    const cursor = encodePostListCursor(SHAPE.mode, values);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodePostListCursor(cursor, SHAPE)).toEqual(values);
  });

  it("stays short enough for a URL at the widest tuple", () => {
    const cursor = encodePostListCursor("rating_desc:thread_updated:pinned", [
      1706000000,
      5,
      1706000000,
      POST_ID,
    ]);
    expect(cursor.length).toBeLessThan(200);
  });

  it("never looks like a bare post ID", () => {
    const cursor = encodePostListCursor(SHAPE.mode, [-1, 0, POST_ID]);
    expect(isLegacyPostListCursor(cursor)).toBe(false);
    expect(isLegacyPostListCursor(POST_ID)).toBe(true);
    expect(isLegacyPostListCursor("med_01jpyx4g9m8b4y50a4gx3t7p1n")).toBe(
      false,
    );
  });

  it("rejects a cursor that can't be read", () => {
    const unreadable = decodeError("not a cursor");
    for (const raw of [
      "",
      "a",
      "%%%",
      "x".repeat(600),
      encodeRaw("just a string"),
      encodeRaw([1, "newest:activity:pinned", []]),
      encodeRaw({ s: SHAPE.mode, k: [-1, 0, POST_ID] }),
      encodeRaw({ v: 1, s: SHAPE.mode }),
      encodeRaw({ v: 1, s: SHAPE.mode, k: [-1, 0, POST_ID], extra: true }),
      encodeRaw({ v: 1, s: 7, k: [-1, 0, POST_ID] }),
      // Wrong length, wrong kinds, a fraction, an unsafe integer, a non-post ID.
      encodeRaw({ v: 1, s: SHAPE.mode, k: [-1, POST_ID] }),
      encodeRaw({ v: 1, s: SHAPE.mode, k: [-1, 0, POST_ID, 4] }),
      encodeRaw({ v: 1, s: SHAPE.mode, k: ["-1", 0, POST_ID] }),
      encodeRaw({ v: 1, s: SHAPE.mode, k: [-1, 0.5, POST_ID] }),
      encodeRaw({ v: 1, s: SHAPE.mode, k: [-1, 2 ** 60, POST_ID] }),
      encodeRaw({
        v: 1,
        s: SHAPE.mode,
        k: [-1, 0, "med_01jpyx4g9m8b4y50a4gx3t7p1n"],
      }),
      encodeRaw({ v: 1, s: SHAPE.mode, k: [-1, 0, null] }),
    ]) {
      expect(decodeError(raw)).toBe(unreadable);
    }
  });

  it("names an unknown format version", () => {
    expect(
      decodeError(encodeRaw({ v: 2, s: SHAPE.mode, k: [-1, 0, POST_ID] })),
    ).toMatch(/different version/);
  });

  it("names a cursor taken in another sort mode", () => {
    const cursor = encodePostListCursor("newest:published:unpinned", [
      0,
      POST_ID,
    ]);
    expect(decodeError(cursor)).toMatch(/different order/);
  });
});
