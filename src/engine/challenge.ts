import { leadingZeroBits, sha256Words } from "../identification/sha256.js";
import { fromBase64, hmac, randomId, safeEqual, toBase64Url } from "./crypto.js";
import type { Decision } from "./decide.js";

/** Invisible proof-of-work challenge. Costs a person a fraction of a second; costs abuse at scale real CPU. */
export interface Challenge {
  algorithm: "sha256-leading-zero-bits";
  /** Random salt bound to the event and action. */
  salt: string;
  /** Required leading zero bits of `sha256(salt + nonce)`. */
  difficulty: number;
  expiresAt: number;
  eventId: string;
  action: string;
  signature: string;
}

export interface ChallengeSolution {
  challenge: Challenge;
  nonce: number;
}

export interface TokenClaims {
  eventId: string;
  visitorId: string;
  action: string;
  decision: Decision;
  /** `true` when the client solved a challenge to obtain this token. */
  challengePassed: boolean;
  expiresAt: number;
  nonce: string;
}

export type ChallengeFailure =
  | "malformed"
  | "bad-signature"
  | "expired"
  | "wrong-solution"
  | "replayed";

export type TokenFailure = "malformed" | "bad-signature" | "expired" | "wrong-action" | "replayed";

/** Hashes per second are ~1–4 M in modern browsers; 18 bits ≈ 262 k hashes on average. */
export const MIN_DIFFICULTY = 12;
export const MAX_DIFFICULTY = 24;

function challengeMessage(challenge: Omit<Challenge, "signature">): string {
  return [
    challenge.algorithm,
    challenge.salt,
    challenge.difficulty,
    challenge.expiresAt,
    challenge.eventId,
    challenge.action,
  ].join("|");
}

export async function createChallenge(
  secret: string,
  input: { eventId: string; action: string; difficulty: number; ttlMs: number; now: number },
): Promise<Challenge> {
  const unsigned = {
    algorithm: "sha256-leading-zero-bits" as const,
    salt: randomId(16),
    difficulty: Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, Math.round(input.difficulty))),
    expiresAt: input.now + input.ttlMs,
    eventId: input.eventId,
    action: input.action,
  };
  return { ...unsigned, signature: await hmac(secret, challengeMessage(unsigned)) };
}

function isChallengeShape(value: unknown): value is Challenge {
  const challenge = value as Record<string, unknown> | null;
  return (
    typeof challenge === "object" &&
    challenge !== null &&
    challenge.algorithm === "sha256-leading-zero-bits" &&
    typeof challenge.salt === "string" &&
    challenge.salt.length <= 64 &&
    typeof challenge.difficulty === "number" &&
    typeof challenge.expiresAt === "number" &&
    typeof challenge.eventId === "string" &&
    challenge.eventId.length <= 64 &&
    typeof challenge.action === "string" &&
    challenge.action.length <= 64 &&
    typeof challenge.signature === "string"
  );
}

/** Checks signature, expiry and work. Replay protection is applied by the caller. */
export async function checkChallengeSolution(
  secret: string,
  solution: unknown,
  now: number,
): Promise<{ ok: true; challenge: Challenge } | { ok: false; reason: ChallengeFailure }> {
  const candidate = solution as Partial<ChallengeSolution> | null;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !isChallengeShape(candidate.challenge) ||
    !Number.isSafeInteger(candidate.nonce) ||
    (candidate.nonce as number) < 0
  ) {
    return { ok: false, reason: "malformed" };
  }

  const { challenge } = candidate;
  const { signature, ...unsigned } = challenge;
  if (!safeEqual(signature, await hmac(secret, challengeMessage(unsigned)))) {
    return { ok: false, reason: "bad-signature" };
  }
  if (challenge.expiresAt < now) {
    return { ok: false, reason: "expired" };
  }
  if (leadingZeroBits(sha256Words(`${challenge.salt}${candidate.nonce}`)) < challenge.difficulty) {
    return { ok: false, reason: "wrong-solution" };
  }
  return { ok: true, challenge };
}

export async function signToken(secret: string, claims: TokenClaims): Promise<string> {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  return `bst1.${body}.${await hmac(secret, body)}`;
}

/** Verifies signature, expiry and action. Single-use enforcement is applied by the caller. */
export async function checkToken(
  secret: string,
  token: unknown,
  action: string | undefined,
  now: number,
): Promise<{ ok: true; claims: TokenClaims } | { ok: false; reason: TokenFailure }> {
  const parts = typeof token === "string" && token.length <= 4096 ? token.split(".") : [];
  if (parts.length !== 3 || parts[0] !== "bst1") {
    return { ok: false, reason: "malformed" };
  }
  const [, body, signature] = parts as [string, string, string];
  if (!safeEqual(signature, await hmac(secret, body))) {
    return { ok: false, reason: "bad-signature" };
  }

  const claims = JSON.parse(new TextDecoder().decode(fromBase64(body))) as TokenClaims;
  if (claims.expiresAt < now) {
    return { ok: false, reason: "expired" };
  }
  if (action !== undefined && claims.action !== action) {
    return { ok: false, reason: "wrong-action" };
  }
  return { ok: true, claims };
}
