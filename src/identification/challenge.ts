import { leadingZeroBits, sha256Words } from "./sha256.js";

/** Mirrors the server's `Challenge`; kept structural so the browser bundle stays server-free. */
export interface ChallengeLike {
  algorithm: "sha256-leading-zero-bits";
  salt: string;
  difficulty: number;
  expiresAt: number;
  eventId: string;
  action: string;
  signature: string;
}

export interface SolveOptions {
  /** Hashes between yields to the event loop, so the page stays responsive. Default 2 000. */
  batchSize?: number;
  /** Give up after this long. Default 30 s. */
  timeoutMs?: number;
}

export interface SolvedChallenge {
  nonce: number;
  hashes: number;
  durationMs: number;
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Finds a nonce so that `sha256(salt + nonce)` has `difficulty` leading zero
 * bits. Runs on the main thread in small batches; no UI, no interaction.
 */
export async function solveChallenge(
  challenge: ChallengeLike,
  options: SolveOptions = {},
): Promise<SolvedChallenge> {
  const batchSize = options.batchSize ?? 2_000;
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  const startedAt = Date.now();

  let nonce = 0;
  while (leadingZeroBits(sha256Words(`${challenge.salt}${nonce}`)) < challenge.difficulty) {
    nonce += 1;
    if (nonce % batchSize === 0) {
      if (Date.now() > deadline) {
        throw new Error("bot-signal challenge timed out");
      }
      await yieldToEventLoop();
    }
  }
  return { nonce, hashes: nonce + 1, durationMs: Date.now() - startedAt };
}
