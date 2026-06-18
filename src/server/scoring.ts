import { buildServerSignals } from "./analysis.js";
import type {
  ConfidenceLevel,
  ServerClientContext,
  ServerClientResult,
  ServerDetectorOptions,
  ServerSignal,
} from "./types.js";

export function aggregateServerSuspicionScore(signals: ServerSignal[]): number {
  const triggered = signals.filter((signal) => signal.triggered);

  if (triggered.length === 0) {
    return 0;
  }

  let score = 1;

  for (const signal of triggered) {
    score *= 1 - signal.weight;
  }

  return 1 - score;
}

export function resolveServerConfidence(
  signals: ServerSignal[],
  suspicionScore: number,
): ConfidenceLevel {
  const triggeredHigh = signals.filter(
    (signal) => signal.triggered && signal.confidence === "high",
  ).length;

  if (triggeredHigh >= 1 || suspicionScore >= 0.7) {
    return "high";
  }

  if (suspicionScore >= 0.35) {
    return "medium";
  }

  return "low";
}

export function detectServerClient(
  context: ServerClientContext,
  options: ServerDetectorOptions = {},
): ServerClientResult {
  const scoreThreshold = options.scoreThreshold ?? 0.5;
  const signals = buildServerSignals(context, options);
  const suspicionScore = aggregateServerSuspicionScore(signals);
  const confidence = resolveServerConfidence(signals, suspicionScore);

  return {
    suspicionScore,
    confidence,
    signals,
    isLegitClient: suspicionScore < scoreThreshold,
    context: {
      ipTimezone: context.ipTimezone,
      clientTimezone: context.clientTimezone,
      tlsFingerprint: context.tlsFingerprint,
      userAgent: context.userAgent,
      ipCountry: context.ipCountry,
    },
  };
}
