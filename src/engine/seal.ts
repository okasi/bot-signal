import { fromBase64, toBase64Url } from "./crypto.js";

const VERSION = 1;
const IV_LENGTH = 12;
const MIN_SEALED_LENGTH = 1 + IV_LENGTH + 16;

/** Accepts a 32-byte key as base64/base64url text or raw bytes. */
export function normalizeSealKey(key: string | Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = typeof key === "string" ? fromBase64(key) : new Uint8Array(key);
  if (bytes.length !== 32) {
    throw new Error("bot-signal sealKey must be 32 bytes (base64 string or bytes)");
  }
  return bytes;
}

function importKey(key: string | Uint8Array): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey("raw", normalizeSealKey(key), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypts and authenticates a JSON value (AES-256-GCM). The browser can forward it but cannot read or alter it. */
export async function sealResult(value: unknown, key: string | Uint8Array): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await importKey(key),
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  );
  const sealed = new Uint8Array(1 + IV_LENGTH + ciphertext.length);
  sealed[0] = VERSION;
  sealed.set(iv, 1);
  sealed.set(ciphertext, 1 + IV_LENGTH);
  return toBase64Url(sealed);
}

/** Decrypts a value produced by {@link sealResult}. Rejects if it was tampered with or the key is wrong. */
export async function unsealResult<T = unknown>(sealed: string, key: string | Uint8Array): Promise<T> {
  const data = fromBase64(sealed);
  if (data.length < MIN_SEALED_LENGTH || data[0] !== VERSION) {
    throw new Error("bot-signal sealed result is malformed");
  }
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: data.subarray(1, 1 + IV_LENGTH) },
    await importKey(key),
    data.subarray(1 + IV_LENGTH),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
