/**
 * MCP OAuth 2.1 Service
 *
 * Implements Dynamic Client Registration (RFC 7591), single-use PKCE (S256)
 * authorization codes, session-bound consent CSRF tokens, and token exchange
 * that mints a standard revocable Jant API token in `api_token`.
 */

import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/index.js";
import {
  sqliteSchemaBundle,
  type DatabaseSchema,
} from "../db/schema-bundle.js";
import { timingSafeEqualText } from "../lib/crypto.js";
import { ValidationError } from "../lib/errors.js";
import { createEntityId } from "../lib/ids.js";
import { now } from "../lib/time.js";
import type { ApiTokenService } from "./api-token.js";

const AUTH_CODE_TTL_SECONDS = 300; // 5 minutes
const MAX_CLIENT_NAME_LENGTH = 100;
const MAX_REDIRECT_URIS = 10;
const FORBIDDEN_REDIRECT_SCHEMES = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
  "blob:",
]);

export interface OAuthClientRecord {
  id: string;
  name: string;
  redirectUris: string[];
  createdAt: number;
}

export interface OAuthTokenExchangeResult {
  accessToken: string;
  tokenType: "Bearer";
  scope: string;
}

export interface OAuthService {
  registerClient(input: {
    name: string;
    redirectUris: string[];
  }): Promise<OAuthClientRecord>;
  getClient(clientId: string): Promise<OAuthClientRecord | null>;
  createAuthorizationCode(input: {
    clientId: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    scope: string;
  }): Promise<string>;
  exchangeAuthorizationCode(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<OAuthTokenExchangeResult | null>;
  generateConsentCsrfToken(sessionId: string): Promise<string>;
  verifyConsentCsrfToken(sessionId: string, token: string): Promise<boolean>;
}

/**
 * Validate an OAuth 2.1 redirect URI per RFC 8252 & OAuth 2.1 Section 2.3.1:
 * - No fragments (`#`)
 * - Rejects dangerous schemes (`javascript:`, `data:`, `vbscript:`, `file:`, `blob:`)
 * - Allows `https:` for any host
 * - Allows `http:` ONLY for loopback (`localhost`, `127.0.0.1`, `[::1]`)
 * - Allows custom native/desktop app schemes (`cursor://`, `claude://`, etc.)
 *
 * @param uri - Candidate redirect URI
 * @returns `true` if allowed
 * @example
 * ```ts
 * isAllowedOAuthRedirectUri("http://127.0.0.1:4321/callback"); // true
 * isAllowedOAuthRedirectUri("http://example.com/callback"); // false
 * ```
 */
export function isAllowedOAuthRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  if (parsed.hash) return false;

  const protocol = parsed.protocol.toLowerCase();
  if (FORBIDDEN_REDIRECT_SCHEMES.has(protocol)) return false;

  if (protocol === "https:") {
    return Boolean(parsed.hostname);
  }

  if (protocol === "http:") {
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]"
    );
  }

  return /^[a-z][a-z0-9+.-]*:$/.test(protocol);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return new Uint8Array(digest);
}

async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(await sha256Bytes(value));
}

/**
 * Compute the PKCE S256 challenge (`BASE64URL(SHA256(code_verifier))`).
 *
 * @param codeVerifier - Raw PKCE verifier string
 * @returns Base64url-encoded SHA-256 challenge
 * @example
 * ```ts
 * await computePkceS256Challenge("verifier...");
 * ```
 */
export async function computePkceS256Challenge(
  codeVerifier: string,
): Promise<string> {
  return bytesToBase64Url(await sha256Bytes(codeVerifier));
}

function randomBase64Url(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return bytesToHex(new Uint8Array(sig));
}

export function createOAuthService(
  db: Database,
  siteId: string,
  apiTokens: ApiTokenService,
  options?: {
    schema?: DatabaseSchema;
    authSecret?: string;
  },
): OAuthService {
  const schema = options?.schema ?? sqliteSchemaBundle;
  const authSecret = options?.authSecret;

  return {
    async registerClient(input) {
      const name = input.name.trim().slice(0, MAX_CLIENT_NAME_LENGTH);
      if (!name) {
        throw new ValidationError("client_name must not be empty");
      }

      const uniqueUris = [...new Set(input.redirectUris.map((u) => u.trim()))];
      if (uniqueUris.length === 0 || uniqueUris.length > MAX_REDIRECT_URIS) {
        throw new ValidationError(
          `Provide between 1 and ${MAX_REDIRECT_URIS} redirect_uris`,
        );
      }

      for (const uri of uniqueUris) {
        if (!isAllowedOAuthRedirectUri(uri)) {
          throw new ValidationError(`Invalid redirect_uri: ${uri}`);
        }
      }

      const id = createEntityId("oauthClient");
      const createdAt = now();

      await db.insert(schema.oauthClients).values({
        id,
        siteId,
        name,
        redirectUris: JSON.stringify(uniqueUris),
        createdAt,
      });

      return {
        id,
        name,
        redirectUris: uniqueUris,
        createdAt,
      };
    },

    async getClient(clientId) {
      const [row] = await db
        .select()
        .from(schema.oauthClients)
        .where(
          and(
            eq(schema.oauthClients.siteId, siteId),
            eq(schema.oauthClients.id, clientId),
          ),
        )
        .limit(1);

      if (!row) return null;

      let redirectUris: string[] = [];
      try {
        const parsed: unknown = JSON.parse(row.redirectUris);
        if (Array.isArray(parsed)) {
          redirectUris = parsed.filter(
            (item): item is string => typeof item === "string",
          );
        }
      } catch {
        redirectUris = [];
      }

      return {
        id: row.id,
        name: row.name,
        redirectUris,
        createdAt: row.createdAt,
      };
    },

    async createAuthorizationCode(input) {
      const rawCode = randomBase64Url(32);
      const codeHash = await sha256Hex(rawCode);
      const createdAt = now();

      await db.insert(schema.oauthCodes).values({
        id: createEntityId("oauthCode"),
        siteId,
        clientId: input.clientId,
        userId: input.userId,
        codeHash,
        redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge,
        scope: input.scope,
        expiresAt: createdAt + AUTH_CODE_TTL_SECONDS,
        usedAt: null,
        createdAt,
      });

      return rawCode;
    },

    async exchangeAuthorizationCode(input) {
      if (
        !input.code ||
        !input.clientId ||
        !input.redirectUri ||
        !input.codeVerifier ||
        input.codeVerifier.length < 43 ||
        input.codeVerifier.length > 128
      ) {
        return null;
      }

      const codeHash = await sha256Hex(input.code);
      const currentTs = now();

      // Atomic single-use claim: only succeeds if the code has never been used.
      const claimed = await db
        .update(schema.oauthCodes)
        .set({ usedAt: currentTs })
        .where(
          and(
            eq(schema.oauthCodes.siteId, siteId),
            eq(schema.oauthCodes.codeHash, codeHash),
            isNull(schema.oauthCodes.usedAt),
          ),
        )
        .returning();

      const codeRow = claimed[0];
      if (!codeRow) return null;

      if (
        codeRow.expiresAt < currentTs ||
        codeRow.clientId !== input.clientId ||
        codeRow.redirectUri !== input.redirectUri
      ) {
        return null;
      }

      const computedChallenge = await computePkceS256Challenge(
        input.codeVerifier,
      );
      if (!timingSafeEqualText(computedChallenge, codeRow.codeChallenge)) {
        return null;
      }

      const client = await this.getClient(codeRow.clientId);
      if (!client) return null;

      const label = `${client.name} (MCP)`.slice(0, 100);
      const { plaintext } = await apiTokens.create(label);

      return {
        accessToken: plaintext,
        tokenType: "Bearer",
        scope: codeRow.scope,
      };
    },

    async generateConsentCsrfToken(sessionId) {
      if (!authSecret) {
        throw new Error("AUTH_SECRET is required for OAuth consent CSRF");
      }
      return hmacHex(authSecret, `oauth-consent:${siteId}:${sessionId}`);
    },

    async verifyConsentCsrfToken(sessionId, token) {
      if (!authSecret || !token) return false;
      const expected = await hmacHex(
        authSecret,
        `oauth-consent:${siteId}:${sessionId}`,
      );
      return timingSafeEqualText(expected, token);
    },
  };
}
