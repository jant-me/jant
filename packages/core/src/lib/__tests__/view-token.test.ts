import { describe, expect, it } from "vitest";
import {
  signViewToken,
  verifyViewToken,
  VIEW_TOKEN_SLOT_SECONDS,
  VIEW_TOKEN_SLOTS_ACCEPTED,
} from "../view-token.js";

const SECRET = "s".repeat(40);
const NOW = 1_762_560_000;
const CLAIMS = {
  siteId: "sit_test00000000000000000000000",
  page: "pst_01h455vb4pex5vsknk084sn02q",
  referrer: "news.ycombinator.com",
  units: [],
};

describe("view tokens", () => {
  it("carries the claims back, and is the same token within a slot", async () => {
    const token = await signViewToken(SECRET, CLAIMS, NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{32}$/);
    expect(await verifyViewToken(SECRET, token, NOW)).toEqual(CLAIMS);
    expect(await signViewToken(SECRET, CLAIMS, NOW + 1)).toBe(token);
    // Another page, another token.
    expect(await signViewToken(SECRET, { ...CLAIMS, page: "/" }, NOW)).not.toBe(
      token,
    );
  });

  it("carries the Threads a list page shows whole, and leaves them out otherwise", async () => {
    const units = [
      "pst_01h455vb4pex5vsknk084sn02q",
      "pst_01h455vb4pex5vsknk084sn02r",
    ];
    const listPage = await signViewToken(
      SECRET,
      { ...CLAIMS, page: "/", units },
      NOW,
    );
    expect(await verifyViewToken(SECRET, listPage, NOW)).toEqual({
      ...CLAIMS,
      page: "/",
      units,
    });
    // A page with none writes no list at all.
    const plain = await signViewToken(SECRET, CLAIMS, NOW);
    const [payload] = plain.split(".") as [string];
    expect(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).not.toContain(
      '"l"',
    );
  });

  it("is accepted for its slot and the ones after, then not", async () => {
    const token = await signViewToken(SECRET, CLAIMS, NOW);
    const stillGood =
      NOW + VIEW_TOKEN_SLOT_SECONDS * VIEW_TOKEN_SLOTS_ACCEPTED - 1;
    expect(await verifyViewToken(SECRET, token, stillGood)).toEqual(CLAIMS);
    expect(await verifyViewToken(SECRET, token, stillGood + 1)).toBeNull();
    // A token from the future is not ours either.
    expect(
      await verifyViewToken(SECRET, token, NOW - VIEW_TOKEN_SLOT_SECONDS),
    ).toBeNull();
  });

  it("rejects what was not signed with the secret", async () => {
    const token = await signViewToken(SECRET, CLAIMS, NOW);
    const [payload, sig] = token.split(".") as [string, string];
    expect(await verifyViewToken("t".repeat(40), token, NOW)).toBeNull();
    // Altered payload, kept signature.
    const other = (
      await signViewToken(SECRET, { ...CLAIMS, page: "/" }, NOW)
    ).split(".")[0] as string;
    expect(await verifyViewToken(SECRET, `${other}.${sig}`, NOW)).toBeNull();
    // Altered signature.
    const flipped = sig.endsWith("0")
      ? `${sig.slice(0, -1)}1`
      : `${sig.slice(0, -1)}0`;
    expect(
      await verifyViewToken(SECRET, `${payload}.${flipped}`, NOW),
    ).toBeNull();
  });

  it("rejects anything that is not a token", async () => {
    for (const junk of [
      "",
      ".",
      "abc",
      "abc.",
      ".abcdef",
      "a.b",
      `${"x".repeat(3000)}.${"0".repeat(32)}`,
      "not-base64!.00000000000000000000000000000000",
    ]) {
      expect(await verifyViewToken(SECRET, junk, NOW)).toBeNull();
    }
  });
});
