/**
 * WebCrypto helpers shared by the engine. Uses only `globalThis.crypto`,
 * so the engine runs unchanged in Node ≥ 20, browsers, Cloudflare Workers,
 * Vercel Edge, Deno and Bun.
 */

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function subtle(): SubtleCrypto {
  return globalThis.crypto.subtle;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function randomId(bytes: number): string {
  return toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = subtle().importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    keyCache.set(secret, key);
  }
  return key;
}

/** HMAC-SHA-256, base64url-encoded. */
export async function hmac(secret: string, message: string): Promise<string> {
  const signature = await subtle().sign("HMAC", await hmacKey(secret), encoder.encode(message));
  return toBase64Url(new Uint8Array(signature));
}

/** Constant-time string comparison for signatures. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/** Derives an independent secret for one purpose (tokens, challenges…) from the deployment salt. */
export function deriveSecret(salt: string, purpose: string): Promise<string> {
  return hmac(salt, `bot-signal:${purpose}`);
}
