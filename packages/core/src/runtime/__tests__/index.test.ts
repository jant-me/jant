import { describe, it, expect } from "vitest";
import { hasSessionCookie } from "../index.js";

describe("hasSessionCookie", () => {
  it.each([
    ["__Secure-better-auth.session_token=abc", true],
    ["better-auth.session_token=abc", true],
    ["theme=dark; __Secure-better-auth.session_token=abc; lang=en", true],
    ["theme=dark", false],
    ["", false],
    [null, false],
    [undefined, false],
    // A cookie merely *named* after the session must not count — only a value
    // assignment does, so a stray marker cookie can't force primary reads.
    ["mysession_token", false],
  ])("hasSessionCookie(%s) → %s", (cookieHeader, expected) => {
    expect(hasSessionCookie(cookieHeader)).toBe(expected);
  });
});
