/**
 * Compare two byte arrays using a constant-time loop.
 *
 * This avoids relying on runtime-specific crypto helpers so the same behavior
 * works in Node.js and Workers.
 *
 * @param a - First byte array
 * @param b - Second byte array
 * @returns `true` when the inputs are byte-for-byte identical
 *
 * @example
 * ```ts
 * const isEqual = timingSafeEqualBytes(
 *   new TextEncoder().encode("abc"),
 *   new TextEncoder().encode("abc"),
 * );
 * ```
 */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < a.byteLength; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }

  return mismatch === 0;
}

/**
 * Compare two strings using a constant-time byte comparison.
 *
 * @param a - First string
 * @param b - Second string
 * @returns `true` when the UTF-8 byte sequences are identical
 *
 * @example
 * ```ts
 * const isEqual = timingSafeEqualText("token-a", "token-b");
 * ```
 */
export function timingSafeEqualText(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  return timingSafeEqualBytes(encoder.encode(a), encoder.encode(b));
}

/**
 * Derive a hex HMAC-SHA256 of `message` under `secret`.
 *
 * Deriving a value instead of storing one is what lets a token be handed out
 * repeatedly without a server-side record: the same inputs always produce the
 * same output, so re-issuing is free and issuing twice cannot invalidate the
 * first copy.
 *
 * @param secret - Key material, never leaves the server
 * @param message - Value being signed
 * @returns Lowercase hex signature, 64 characters
 *
 * @example
 * ```ts
 * const signature = await hmacHex(env.AUTH_SECRET, `delete-account:${sessionId}`);
 * ```
 */
export async function hmacHex(
  secret: string,
  message: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message),
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
