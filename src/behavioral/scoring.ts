import { buildBehavioralSignals } from "./analysis.js";
import type {
  BehavioralClientResult,
  BehavioralSampleCounts,
  BehavioralSamples,
  BehavioralSignal,
  ConfidenceLevel,
} from "./types.js";

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

export function resolveConfidence(
  signals: BehavioralSignal[],
  sampleCounts: BehavioralSampleCounts,
  suspicionScore: number,
): ConfidenceLevel {
  const totalSamples =
    sampleCounts.mouseMoves +
    sampleCounts.scrolls +
    sampleCounts.keyPresses +
    sampleCounts.clicks;
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

export function countSyntheticEvents(samples: BehavioralSamples): number {
  return [
    ...samples.mouseMoves,
    ...samples.scrolls,
    ...samples.keyPresses,
    ...samples.clicks,
  ].filter((event) => !event.isTrusted).length;
}

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
