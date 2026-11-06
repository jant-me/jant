/**
 * GitHub App authentication helpers.
 *
 * Implements the App → installation token exchange using Web Crypto so it
 * runs unchanged in Cloudflare Workers and Node 18+.
 *
 * Flow:
 *  1. Sign a short-lived JWT with the App's RSA private key (RS256).
 *  2. Exchange the JWT for a per-installation access token.
 *  3. Cache the installation token in-process until shortly before expiry.
 *
 * The installation token can then be passed to `createGitHubClient` the same
 * way a PAT is — the downstream client is auth-agnostic.
 */

import type { GitHubAppEnvConfig, GitHubAppOAuthConfig } from "./env.js";

const GITHUB_API = "https://api.github.com";
const GITHUB_OAUTH = "https://github.com/login/oauth";

// ---------------------------------------------------------------------------
// Installation token cache
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string;
  /** Unix seconds when the cached token should be considered expired. */
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
const CACHE_SAFETY_MARGIN_SECONDS = 60;

function cacheKey(appId: string, installationId: string): string {
  return `${appId}:${installationId}`;
}

// ---------------------------------------------------------------------------
// JWT signing (RS256 via Web Crypto)
// ---------------------------------------------------------------------------

function base64UrlEncode(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * ASN.1 DER length encoding (short form for < 128, long form otherwise).
 * Used to wrap a PKCS#1 key inside a PKCS#8 envelope.
 */
function encodeDerLength(len: number): number[] {
  if (len < 0x80) return [len];
  if (len <= 0xff) return [0x81, len];
  if (len <= 0xffff) return [0x82, (len >> 8) & 0xff, len & 0xff];
  throw new Error("Private key too large to encode");
}

/**
 * Wrap a PKCS#1 `RSAPrivateKey` DER blob in a PKCS#8 `PrivateKeyInfo` envelope.
 * Web Crypto's `importKey("pkcs8", ...)` only accepts PKCS#8, but GitHub
 * hands out PKCS#1 PEMs (`-----BEGIN RSA PRIVATE KEY-----`) by default, so
 * we wrap on the fly when we detect that header.
 */
function wrapPkcs1AsPkcs8(pkcs1: Uint8Array): Uint8Array {
  // AlgorithmIdentifier for rsaEncryption (OID 1.2.840.113549.1.1.1) + NULL params.
  const rsaAlgorithmIdentifier = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ];
  const version = [0x02, 0x01, 0x00]; // INTEGER 0
  const octetStringHeader = [0x04, ...encodeDerLength(pkcs1.length)];
  const bodyLen =
    version.length +
    rsaAlgorithmIdentifier.length +
    octetStringHeader.length +
    pkcs1.length;
  const outerHeader = [0x30, ...encodeDerLength(bodyLen)];

  const out = new Uint8Array(outerHeader.length + bodyLen);
  let off = 0;
  out.set(outerHeader, off);
  off += outerHeader.length;
  out.set(version, off);
  off += version.length;
  out.set(rsaAlgorithmIdentifier, off);
  off += rsaAlgorithmIdentifier.length;
  out.set(octetStringHeader, off);
  off += octetStringHeader.length;
  out.set(pkcs1, off);
  return out;
}

function pemToPkcs8(pem: string): ArrayBuffer {
  // GitHub Apps hand out PKCS#1 PEMs (`BEGIN RSA PRIVATE KEY`), but Web
  // Crypto only imports PKCS#8 (`BEGIN PRIVATE KEY`). Accept either and
  // auto-wrap PKCS#1 as PKCS#8 so users don't have to run openssl.
  const isPkcs1 = /-----BEGIN RSA PRIVATE KEY-----/.test(pem);
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!cleaned) throw new Error("Empty GitHub App private key");
  const binary = atob(cleaned);
  const rawDer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) rawDer[i] = binary.charCodeAt(i);

  const pkcs8 = isPkcs1 ? wrapPkcs1AsPkcs8(rawDer) : rawDer;
  // Copy into a fresh ArrayBuffer so the type is narrow (Web Crypto
  // rejects SharedArrayBuffer in some type signatures) and detached from
  // any larger backing store.
  const out = new ArrayBuffer(pkcs8.byteLength);
  new Uint8Array(out).set(pkcs8);
  return out;
}

async function importPrivateKey(pem: string) {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * Create a JWT signed with the GitHub App's private key.
 *
 * GitHub allows up to 10 minutes; we issue 9 minutes with a 60s backdated `iat`
 * to tolerate clock skew.
 */
export async function createAppJwt(
  appId: string,
  privateKeyPem: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

// ---------------------------------------------------------------------------
// Installation token exchange
// ---------------------------------------------------------------------------

interface AccessTokenResponse {
  token: string;
  expires_at: string;
}

/**
 * Fetch (or reuse) a short-lived installation access token.
 *
 * Results are cached in-process until `CACHE_SAFETY_MARGIN_SECONDS` before the
 * real expiry so the same token can be reused across a burst of API calls.
 */
export async function getInstallationToken(
  app: GitHubAppEnvConfig,
  installationId: string,
): Promise<string> {
  const key = cacheKey(app.appId, installationId);
  const cached = tokenCache.get(key);
  const nowSec = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > nowSec) return cached.token;

  const jwt = await createAppJwt(app.appId, app.privateKey);
  const res = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "User-Agent": "jant-github-sync",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `GitHub App token exchange failed (${res.status}): ${body}`,
    );
  }

  const data = (await res.json()) as AccessTokenResponse;
  const expiresAt =
    Math.floor(new Date(data.expires_at).getTime() / 1000) -
    CACHE_SAFETY_MARGIN_SECONDS;
  tokenCache.set(key, { token: data.token, expiresAt });
  return data.token;
}

/**
 * List repositories accessible to a given installation.
 *
 * Used during the connect flow so users can pick which repo to sync.
 */
export async function listInstallationRepos(
  app: GitHubAppEnvConfig,
  installationId: string,
): Promise<
  Array<{ fullName: string; private: boolean; defaultBranch: string }>
> {
  const token = await getInstallationToken(app, installationId);
  const repos: Array<{
    fullName: string;
    private: boolean;
    defaultBranch: string;
  }> = [];
  let page = 1;
  // GitHub caps at 100 per page; we page until exhausted (installations
  // rarely have >100 repos but do it right).
  while (true) {
    const res = await fetch(
      `${GITHUB_API}/installation/repositories?per_page=100&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "jant-github-sync",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Listing installation repos failed: ${res.status} ${body}`,
      );
    }
    const data = (await res.json()) as {
      repositories: Array<{
        full_name: string;
        private: boolean;
        default_branch: string;
      }>;
    };
    for (const r of data.repositories) {
      repos.push({
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
      });
    }
    if (data.repositories.length < 100) break;
    page++;
  }
  return repos;
}

/**
 * Build the URL users visit to install the GitHub App on their account/org.
 *
 * `state` is a CSRF token the caller should verify on the redirect back.
 */
export function buildInstallUrl(slug: string, state: string): string {
  const params = new URLSearchParams({ state });
  return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Installation metadata (App JWT — not installation token)
// ---------------------------------------------------------------------------

export interface InstallationAccount {
  login: string;
  type: "User" | "Organization";
  avatarUrl: string;
}

/**
 * Fetch metadata for a given installation, including the account it's
 * installed on. Uses an App JWT because the target endpoint is
 * `/app/installations/{id}`, which is App-scoped, not installation-scoped.
 */
export async function getInstallation(
  app: GitHubAppEnvConfig,
  installationId: string,
): Promise<{ account: InstallationAccount }> {
  const jwt = await createAppJwt(app.appId, app.privateKey);
  const res = await fetch(
    `${GITHUB_API}/app/installations/${encodeURIComponent(installationId)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "User-Agent": "jant-github-sync",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fetching installation failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as {
    account: { login: string; type: string; avatar_url?: string };
  };
  const type = data.account.type === "Organization" ? "Organization" : "User";
  return {
    account: {
      login: data.account.login,
      type,
      avatarUrl: data.account.avatar_url ?? "",
    },
  };
}

// ---------------------------------------------------------------------------
// Paginated repo listing (single page at a time)
// ---------------------------------------------------------------------------

export interface InstallationRepo {
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
}

export interface InstallationRepoPage {
  repos: InstallationRepo[];
  /** Server-reported total count (not always accurate but useful as a hint). */
  totalCount: number;
  hasMore: boolean;
  nextPage: number | null;
}

/**
 * Fetch a single page of installation repositories.
 *
 * Used by the picker for lazy-loading. Callers can either stop after the
 * first page (UI does local filtering) or keep paging for larger accounts.
 * For search, prefer `searchInstallationRepos` — this endpoint does not
 * support a query parameter.
 */
export async function listInstallationReposPage(
  app: GitHubAppEnvConfig,
  installationId: string,
  page: number,
  perPage = 100,
): Promise<InstallationRepoPage> {
  const token = await getInstallationToken(app, installationId);
  const res = await fetch(
    `${GITHUB_API}/installation/repositories?per_page=${perPage}&page=${page}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "jant-github-sync",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Listing installation repos failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as {
    total_count: number;
    repositories: Array<{
      name: string;
      full_name: string;
      private: boolean;
      default_branch: string;
      updated_at: string | null;
      created_at: string | null;
    }>;
  };
  // GitHub's installation/repositories endpoint has no `sort` parameter —
  // newly added repos land at the end of the list. Sort the page by
  // updated_at desc (falling back to created_at) so a freshly created
  // repo appears at the top, which is what users expect when they come
  // back from `github.com/new`. For accounts with >100 repos the newest
  // one may still live on a later page; the picker's search path then
  // takes over and also sorts by `updated` server-side.
  const repos = data.repositories
    .slice()
    .sort((a, b) => {
      const at = Date.parse(a.updated_at ?? a.created_at ?? "") || 0;
      const bt = Date.parse(b.updated_at ?? b.created_at ?? "") || 0;
      return bt - at;
    })
    .map((r) => ({
      fullName: r.full_name,
      name: r.name,
      private: r.private,
      defaultBranch: r.default_branch,
    }));
  const hasMore = repos.length === perPage;
  return {
    repos,
    totalCount: data.total_count,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
  };
}

/**
 * Search the installation's repositories via `GET /search/repositories`.
 *
 * GitHub's Search API doesn't scope automatically to an installation, so
 * we filter server-side by the installation's account login. This keeps
 * results relevant while still covering repos past the first 100.
 *
 * The `q` string is wrapped (caller passes raw user input, we add the
 * scope qualifier). Uses the installation token for auth.
 */
export async function searchInstallationRepos(
  app: GitHubAppEnvConfig,
  installationId: string,
  accountLogin: string,
  q: string,
  perPage = 30,
): Promise<{ repos: InstallationRepo[]; totalCount: number }> {
  const token = await getInstallationToken(app, installationId);
  // `in:name` restricts matching to the repo name, which is what users type.
  // `user:{login}` scopes to the account the installation is on (works for
  // both user and org accounts). GitHub's search syntax uses space-separated
  // qualifiers; our caller should pre-trim `q`.
  const fullQuery = `${q} in:name user:${accountLogin} fork:true`;
  // Sort by last-updated desc so a freshly created repo surfaces first.
  const params = new URLSearchParams({
    q: fullQuery,
    per_page: String(perPage),
    sort: "updated",
    order: "desc",
  });
  const res = await fetch(
    `${GITHUB_API}/search/repositories?${params.toString()}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "jant-github-sync",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Searching repos failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as {
    total_count: number;
    items: Array<{
      name: string;
      full_name: string;
      private: boolean;
      default_branch: string;
    }>;
  };
  return {
    repos: data.items.map((r) => ({
      fullName: r.full_name,
      name: r.name,
      private: r.private,
      defaultBranch: r.default_branch,
    })),
    totalCount: data.total_count,
  };
}

// ---------------------------------------------------------------------------
// Who owns an installation (OAuth web flow)
// ---------------------------------------------------------------------------
//
// An installation id is not a secret and proves nothing: GitHub's Setup URL
// hands it over as a query parameter, so anyone can type another account's
// id into that URL. The only thing that ties an installation to the person
// in the browser is GitHub's answer to "which installations can this user
// reach", which takes a user access token — hence the web flow below.

/**
 * Create a PKCE verifier and its S256 challenge for one authorization.
 *
 * @returns The verifier to keep until the callback, and the challenge to
 *   send to GitHub.
 * @example
 * const { verifier, challenge } = await createPkcePair();
 */
export async function createPkcePair(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = base64UrlEncode(bytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64UrlEncode(digest) };
}

/**
 * Build the URL that asks GitHub to sign the author in for this App.
 *
 * No `redirect_uri`: GitHub then uses the first redirect URI in the App's
 * settings, which on a hosted deployment is the control plane's dispatcher
 * — the one URL that can route the browser back to any site.
 *
 * @param clientId - The App's OAuth client ID (not its App ID).
 * @param state - CSRF token, also kept in a cookie for the callback.
 * @param codeChallenge - PKCE challenge from `createPkcePair`.
 * @returns The authorize URL.
 * @example
 * buildAuthorizeUrl("Iv1.abc", state, challenge);
 * // "https://github.com/login/oauth/authorize?client_id=Iv1.abc&state=…"
 */
export function buildAuthorizeUrl(
  clientId: string,
  state: string,
  codeChallenge: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${GITHUB_OAUTH}/authorize?${params.toString()}`;
}

/** An installation of this App that the signed-in GitHub user owns. */
export interface OwnedInstallation {
  installationId: string;
  account: InstallationAccount;
}

/**
 * Exchange the code from GitHub's callback for a user access token, and list
 * the installations of this App that user owns.
 *
 * "Owns" is narrower than what `GET /user/installations` returns. GitHub
 * lists a personal account's installation for every collaborator on one of
 * its repositories, and binding it would hand that collaborator every
 * repository the installation covers — so a personal installation counts
 * only for the account itself. An organization's installation counts for
 * the members GitHub lists it for, which is the access GitHub itself gives
 * them. Enterprise installations carry no login and are left out.
 *
 * The token is used for these two reads and then dropped; nothing stores it.
 *
 * @param oauth - The App's client credentials.
 * @param code - The `code` query parameter from the callback.
 * @param codeVerifier - The PKCE verifier kept since the authorize redirect.
 * @returns The owned installations, possibly none.
 * @example
 * const owned = await listOwnedInstallations(app.oauth, code, verifier);
 */
export async function listOwnedInstallations(
  oauth: GitHubAppOAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<OwnedInstallation[]> {
  const token = await exchangeUserCode(oauth, code, codeVerifier);
  const user = (await fetchUserJson(token, "/user")) as { id: number };

  const owned: OwnedInstallation[] = [];
  for (let page = 1; ; page++) {
    const data = (await fetchUserJson(
      token,
      `/user/installations?per_page=100&page=${page}`,
    )) as {
      installations: Array<{
        id: number;
        account: {
          id?: number;
          login?: string;
          type?: string;
          avatar_url?: string;
        } | null;
      }>;
    };
    for (const installation of data.installations) {
      const account = installation.account;
      if (!account?.login) continue;
      const isOwner =
        account.type === "Organization" ||
        (account.type === "User" && account.id === user.id);
      if (!isOwner) continue;
      owned.push({
        installationId: String(installation.id),
        account: {
          login: account.login,
          type: account.type === "Organization" ? "Organization" : "User",
          avatarUrl: account.avatar_url ?? "",
        },
      });
    }
    if (data.installations.length < 100) break;
  }
  return owned;
}

async function exchangeUserCode(
  oauth: GitHubAppOAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<string> {
  const res = await fetch(`${GITHUB_OAUTH}/access_token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "jant-github-sync",
    },
    body: new URLSearchParams({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      code,
      code_verifier: codeVerifier,
    }).toString(),
  });
  // GitHub answers a bad or expired code with 200 and an `error` field.
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      `GitHub OAuth code exchange failed (${res.status}): ${data.error ?? "no access token"}`,
    );
  }
  return data.access_token;
}

async function fetchUserJson(token: string, path: string): Promise<unknown> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "jant-github-sync",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${path} failed (${res.status}): ${body}`);
  }
  return res.json();
}
