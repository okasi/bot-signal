import type { IdentificationEvent } from "./types.js";

export type Decision = "allow" | "challenge" | "block";

/** Built-in actions with tuned defaults. Any other string uses the `default` policy. */
export type ProtectedAction = "signup" | "login" | "checkout" | "content" | "api" | "default";

export interface DecisionPolicy {
  /** Suspect score at which an invisible proof-of-work challenge is required. */
  challengeAt: number;
  /** Suspect score at which the request is refused outright. */
  blockAt: number;
  /** Block confidently detected automation (server-side evidence or definitive in-page markers). */
  blockBadBots: boolean;
  /** Let verified crawlers (search engines, signed AI agents) through without a challenge. */
  allowVerifiedBots: boolean;
  /** Distinct accounts (`linkedId`) per device in 24 h before challenging: multi-accounting, trial abuse. */
  maxAccountsPerDevice: number;
  /** Distinct devices per IP in 1 h before challenging: credential stuffing, signup farms. */
  maxDevicesPerIp: number;
}

export const DEFAULT_POLICIES: Record<ProtectedAction, DecisionPolicy> = {
  signup: { challengeAt: 25, blockAt: 70, blockBadBots: true, allowVerifiedBots: false, maxAccountsPerDevice: 2, maxDevicesPerIp: 15 },
  login: { challengeAt: 30, blockAt: 75, blockBadBots: true, allowVerifiedBots: false, maxAccountsPerDevice: 4, maxDevicesPerIp: 20 },
  checkout: { challengeAt: 20, blockAt: 60, blockBadBots: true, allowVerifiedBots: false, maxAccountsPerDevice: 3, maxDevicesPerIp: 20 },
  content: { challengeAt: 40, blockAt: 85, blockBadBots: true, allowVerifiedBots: true, maxAccountsPerDevice: 10, maxDevicesPerIp: 50 },
  api: { challengeAt: 35, blockAt: 80, blockBadBots: true, allowVerifiedBots: true, maxAccountsPerDevice: 10, maxDevicesPerIp: 50 },
  default: { challengeAt: 35, blockAt: 75, blockBadBots: true, allowVerifiedBots: true, maxAccountsPerDevice: 5, maxDevicesPerIp: 25 },
};

export interface DecisionResult {
  decision: Decision;
  /** Human-readable reasons, safe to log. Do not show them to the visitor. */
  reasons: string[];
  /** Proof-of-work difficulty in bits when `decision` is `challenge`. */
  difficulty: number;
}

export function resolvePolicy(
  action: string,
  overrides: Partial<Record<string, Partial<DecisionPolicy>>> = {},
): DecisionPolicy {
  const base = DEFAULT_POLICIES[action as ProtectedAction] ?? DEFAULT_POLICIES.default;
  return { ...base, ...overrides[action] };
}

/** Harder challenges for riskier visitors: 16 bits (≈ instant) up to 22 bits (~1–3 s). */
export function challengeDifficulty(suspectScore: number): number {
  return 16 + Math.min(6, Math.floor(suspectScore / 15));
}

/**
 * Turns an identification event into allow / challenge / block for one action.
 * Pure and synchronous, so it is easy to unit-test your own policies.
 */
export function decide(event: IdentificationEvent, policy: DecisionPolicy): DecisionResult {
  const signals = event.smartSignals;
  const score = signals.suspectScore;
  const reasons: string[] = [];
  const difficulty = challengeDifficulty(score);

  if (signals.bot.result === "good") {
    return policy.allowVerifiedBots
      ? { decision: "allow", reasons: ["verified crawler"], difficulty }
      : { decision: "block", reasons: ["verified crawler on a human-only action"], difficulty };
  }

  const definitiveBot =
    signals.bot.result === "bad" &&
    (signals.bot.serverScore >= 0.5 || signals.bot.clientScore >= 0.99);
  if (policy.blockBadBots && definitiveBot) {
    reasons.push(`automation detected (${signals.bot.automationKind})`);
    return { decision: "block", reasons, difficulty };
  }
  if (score >= policy.blockAt) {
    reasons.push(`suspect score ${score} ≥ ${policy.blockAt}`);
    return { decision: "block", reasons, difficulty };
  }

  if (signals.bot.result === "bad") {
    reasons.push("weak automation signals");
  }
  if (score >= policy.challengeAt) {
    reasons.push(`suspect score ${score} ≥ ${policy.challengeAt}`);
  }
  if (signals.velocity.distinctLinkedId["24h"] > policy.maxAccountsPerDevice) {
    reasons.push(`${signals.velocity.distinctLinkedId["24h"]} accounts on this device in 24 h`);
  }
  if (signals.velocity.ipDistinctVisitors["1h"] > policy.maxDevicesPerIp) {
    reasons.push(`${signals.velocity.ipDistinctVisitors["1h"]} devices on this IP in 1 h`);
  }

  return reasons.length > 0
    ? { decision: "challenge", reasons, difficulty }
    : { decision: "allow", reasons: [], difficulty };
}
