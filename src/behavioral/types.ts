import type { ExtendedWindow } from "../types.js";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface BehavioralSignal {
  id: string;
  description: string;
  triggered: boolean;
  weight: number;
  confidence: ConfidenceLevel;
  score: number;
}

export interface BehavioralSampleCounts {
  mouseMoves: number;
  scrolls: number;
  keyPresses: number;
  clicks: number;
  syntheticEvents: number;
}

export interface MouseSample {
  x: number;
  y: number;
  t: number;
  isTrusted: boolean;
}

export interface ScrollSample {
  deltaY: number;
  t: number;
  isTrusted: boolean;
}

export interface KeySample {
  t: number;
  isTrusted: boolean;
}

export interface ClickSample {
  x: number;
  y: number;
  t: number;
  isTrusted: boolean;
}

export interface BehavioralSamples {
  mouseMoves: MouseSample[];
  scrolls: ScrollSample[];
  keyPresses: KeySample[];
  clicks: ClickSample[];
  observationMs: number;
}

export interface BehavioralClientResult {
  suspicionScore: number;
  confidence: ConfidenceLevel;
  signals: BehavioralSignal[];
  sampleCounts: BehavioralSampleCounts;
  observationMs: number;
  isLegitClient: boolean;
}

export interface BehavioralDetectorOptions {
  context?: ExtendedWindow;
  minObservationMs?: number;
  scoreThreshold?: number;
  pollIntervalMs?: number;
  onUpdate?: (result: BehavioralClientResult) => void;
}

export interface BehavioralClientDetector {
  start(): void;
  stop(): void;
  reset(): void;
  getResult(): BehavioralClientResult;
  observe(durationMs?: number): Promise<BehavioralClientResult>;
}

export type { ExtendedWindow };
