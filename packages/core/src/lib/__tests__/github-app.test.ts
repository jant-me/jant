/**
 * Which installations the signed-in GitHub user owns.
 *
 * `GET /user/installations` lists more than the user owns: a collaborator
 * on one repository of a personal account sees that account's whole
 * installation. Binding it would give them every repository it covers, so
 * these tests pin the narrower rule `listOwnedInstallations` applies.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  createPkcePair,
  listOwnedInstallations,
} from "../github-app.js";

const OAUTH = { clientId: "Iv1.client", clientSecret: "shh" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("listOwnedInstallations", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function answer(installations: unknown[]) {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/login/oauth/access_token")) {
        return json({ access_token: "ghu_token", token_type: "bearer" });
      }
      if (url.endsWith("/user")) return json({ id: 1, login: "octo" });
      if (url.includes("/user/installations")) {
        return json({ total_count: installations.length, installations });
      }
      return json({}, 404);
    });
  }

  it("keeps the user's own account and organizations they belong to", async () => {
    answer([
      {
        id: 10,
        account: { id: 1, login: "octo", type: "User", avatar_url: "a" },
      },
      {
        id: 20,
        account: { id: 99, login: "octo-org", type: "Organization" },
      },
    ]);

    const owned = await listOwnedInstallations(OAUTH, "code", "verifier");

    expect(owned).toEqual([
      {
        installationId: "10",
        account: { login: "octo", type: "User", avatarUrl: "a" },
      },
      {
        installationId: "20",
        account: { login: "octo-org", type: "Organization", avatarUrl: "" },
      },
    ]);
  });

  it("leaves out another person's account the user only collaborates on", async () => {
    answer([
      { id: 30, account: { id: 2, login: "stranger", type: "User" } },
      { id: 40, account: { id: 3, slug: "acme-enterprise", name: "Acme" } },
    ]);

    expect(await listOwnedInstallations(OAUTH, "code", "verifier")).toEqual([]);
  });

  it("sends the client credentials and the PKCE verifier with the code", async () => {
    answer([]);

    await listOwnedInstallations(OAUTH, "the-code", "the-verifier");

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toEqual({
      client_id: "Iv1.client",
      client_secret: "shh",
      code: "the-code",
      code_verifier: "the-verifier",
    });
  });

  it("fails on a code GitHub turns down", async () => {
    // GitHub answers a bad or expired code with 200 and an `error` field.
    fetchMock.mockResolvedValue(json({ error: "bad_verification_code" }));

    await expect(
      listOwnedInstallations(OAUTH, "stale", "verifier"),
    ).rejects.toThrow(/bad_verification_code/);
  });
});

describe("buildAuthorizeUrl", () => {
  it("asks for an S256 PKCE challenge and leaves the redirect to the App's settings", async () => {
    const { verifier, challenge } = await createPkcePair();

    const url = new URL(buildAuthorizeUrl("Iv1.client", "st", challenge));

    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "Iv1.client",
      state: "st",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toBe(verifier);
  });
});
