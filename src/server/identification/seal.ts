import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function normalizeSealKey(key: string | Uint8Array): Buffer {
  const buffer = typeof key === "string" ? Buffer.from(key, "base64") : Buffer.from(key);
  if (buffer.length !== 32) {
    throw new Error("bot-signal sealKey must be 32 bytes (base64 string or bytes)");
  }
  return buffer;
}

/** Encrypts and authenticates a JSON value. The browser can forward it but cannot read or alter it. */
export function sealResult(value: unknown, key: string | Uint8Array): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", normalizeSealKey(key), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from([VERSION]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]).toString("base64url");
}

/** Decrypts a value produced by {@link sealResult}. Throws if it was tampered with or the key is wrong. */
export function unsealResult<T = unknown>(sealed: string, key: string | Uint8Array): T {
  const data = Buffer.from(sealed, "base64url");
  if (data.length < 1 + IV_LENGTH + TAG_LENGTH || data[0] !== VERSION) {
    throw new Error("bot-signal sealed result is malformed");
  }
  const iv = data.subarray(1, 1 + IV_LENGTH);
  const tag = data.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", normalizeSealKey(key), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(data.subarray(1 + IV_LENGTH + TAG_LENGTH)),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
