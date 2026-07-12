import { buildBehavioralSignals } from "./analysis.js";
import type {
  BehavioralClientResult,
  BehavioralSampleCounts,
  BehavioralSamples,
  BehavioralSignal,
  ConfidenceLevel,
} from "./types.js";

/**
 * Combines triggered signal weights into one score:
 * `1 - Π(1 - weightᵢ)` — independent-probability union, so extra signals
 * always raise the score but never past 1.
 * @internal
 */
export function aggregateSuspicionScore(signals: BehavioralSignal[]): number {
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

/**
 * Confidence in the verdict based on sample volume and high-confidence signal hits.
 * @internal
 */
export function resolveConfidence(
  signals: BehavioralSignal[],
  sampleCounts: BehavioralSampleCounts,
  suspicionScore: number,
): ConfidenceLevel {
  const totalSamples =
    sampleCounts.mouseMoves +
    sampleCounts.scrolls +
    sampleCounts.keyPresses +
    sampleCounts.clicks +
    sampleCounts.touches;
  const triggeredHigh = signals.filter(
    (signal) => signal.triggered && signal.confidence === "high",
  ).length;

  if (totalSamples < 5) {
    return "low";
  }

  if (triggeredHigh >= 2 || suspicionScore >= 0.75) {
    return "high";
  }

  if (suspicionScore >= 0.4 || totalSamples >= 20) {
    return "medium";
  }

  return "low";
}

/**
 * Counts how many events in the samples were not trusted (script-generated).
 * @internal
 */
export function countSyntheticEvents(samples: BehavioralSamples): number {
  return [
    ...samples.mouseMoves,
    ...samples.scrolls,
    ...samples.keyPresses,
    ...samples.clicks,
    ...(samples.touches ?? []),
  ].filter((event) => !event.isTrusted).length;
}

/**
 * Scores a set of recorded interaction samples without running a detector —
 * useful for analyzing samples collected elsewhere (e.g. beaconed to a server).
 */
export function analyzeBehavioralSamples(
  samples: BehavioralSamples,
  scoreThreshold = 0.55,
): BehavioralClientResult {
  const signals = buildBehavioralSignals(samples);
  const suspicionScore = aggregateSuspicionScore(signals);
  const sampleCounts: BehavioralSampleCounts = {
    mouseMoves: samples.mouseMoves.length,
    scrolls: samples.scrolls.length,
    keyPresses: samples.keyPresses.length,
    clicks: samples.clicks.length,
    touches: samples.touches?.length ?? 0,
    syntheticEvents: countSyntheticEvents(samples),
  };
  const confidence = resolveConfidence(signals, sampleCounts, suspicionScore);

  return {
    suspicionScore,
    confidence,
    signals,
    sampleCounts,
    observationMs: samples.observationMs,
    isLegitClient: suspicionScore < scoreThreshold,
  };
}
