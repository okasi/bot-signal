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
  touches: number;
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
  /** `true` for auto-repeat while a key is held — excluded from typing-rhythm analysis */
  repeat?: boolean;
}

export interface ClickSample {
  x: number;
  y: number;
  t: number;
  isTrusted: boolean;
  /** `MouseEvent.detail` — `0` for keyboard-activated clicks (Enter/Space on a control) */
  detail?: number;
}

export interface TouchSample {
  t: number;
  isTrusted: boolean;
}

export interface BehavioralSamples {
  mouseMoves: MouseSample[];
  scrolls: ScrollSample[];
  keyPresses: KeySample[];
  clicks: ClickSample[];
  /** Touch activity — exempts tap-driven clicks from mouse-based signals */
  touches?: TouchSample[];
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
  /**
   * Retain only samples from the last N milliseconds so a long-lived
   * `start()` (without `stop()`) cannot grow memory without bound and each
   * poll scores recent behavior. Defaults to 60000; set `Infinity` to keep
   * everything. Short one-shot `observe()` calls are unaffected.
   */
  sampleWindowMs?: number;
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
