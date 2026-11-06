/**
 * Signed state for the GitHub App install flow.
 *
 * When Jant Core runs behind a hosted control plane (multi-host / multi-site),
 * the GitHub App's Setup URL and redirect URI must point at one fixed URL — typically the
 * control plane, which then dispatches the browser back to the correct site.
 *
 * The `state` query parameter that rides through that round-trip must tell
 * the control plane *which* site to redirect to. We can't trust it as-is
 * (attacker could swap the host), so it's signed with a secret shared
 * between core and the control plane (`HOSTED_CONTROL_PLANE_SSO_SECRET`).
 *
 * Wire format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256 signature)>`
 */

const textEncoder = new TextEncoder();

export interface InstallStatePayload {
  /** Format version. Bump if payload shape changes. */
  v: 1;
  /** Target site host (e.g. "alice.jant.me"). Cloud redirects here after verify. */
  host: string;
  /** Random per-request nonce; also mirrored into the core-side cookie for CSRF. */
  nonce: string;
  /** Unix-seconds expiry (short — this only needs to outlast the install click). */
  exp: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string): Uint8Array {
  const padded =
    input.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((input.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(payload),
  );
  return toBase64Url(new Uint8Array(sig));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Generate a short hex nonce suitable for cookie + HMAC input. */
export function generateInstallNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Sign an install-state token. `ttlSeconds` defaults to 10 minutes — long
 * enough for a typical install click-through, short enough that a leaked
 * token stops being useful quickly.
 */
export async function signInstallState(
  host: string,
  nonce: string,
  secret: string,
  ttlSeconds = 600,
): Promise<string> {
  const payload: InstallStatePayload = {
    v: 1,
    host,
    nonce,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = toBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const signature = await hmacSign(secret, encoded);
  return `${encoded}.${signature}`;
}

/**
 * Verify a state token. Returns the payload when valid and unexpired,
 * otherwise `null`. Does not enforce host/nonce matching — callers should
 * compare those against their own trusted values (cookie / request host).
 */
export async function verifyInstallState(
  state: string,
  secret: string,
): Promise<InstallStatePayload | null> {
  const dot = state.indexOf(".");
  if (dot <= 0) return null;
  const encoded = state.slice(0, dot);
  const signature = state.slice(dot + 1);

  const expected = await hmacSign(secret, encoded);
  if (!constantTimeEqual(signature, expected)) return null;

  let payload: InstallStatePayload;
  try {
    const json = new TextDecoder().decode(fromBase64Url(encoded));
    payload = JSON.parse(json) as InstallStatePayload;
  } catch {
    return null;
  }

  if (payload.v !== 1) return null;
  if (typeof payload.host !== "string" || !payload.host) return null;
  if (typeof payload.nonce !== "string" || !payload.nonce) return null;
  if (typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}
