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
  /** Browser-reported delta from the previous mouse event, when collected. */
  movementX?: number;
  /** Browser-reported delta from the previous mouse event, when collected. */
  movementY?: number;
  /** Page/screen coordinates used to detect a Chromium CDP Input leak. */
  pageX?: number;
  pageY?: number;
  screenX?: number;
  screenY?: number;
  /** Whether browser chrome was hidden when this event was collected. */
  isFullscreen?: boolean;
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
  /** Page/screen coordinates used to detect a Chromium CDP Input leak. */
  pageX?: number;
  pageY?: number;
  screenX?: number;
  screenY?: number;
  /** Whether browser chrome was hidden when this event was collected. */
  isFullscreen?: boolean;
}

export interface TouchSample {
  t: number;
  isTrusted: boolean;
  /**
   * Primary contact point. Absent in samples recorded before touch gestures
   * were analysed, which the gesture heuristics skip rather than guess at.
   */
  x?: number;
  y?: number;
  /**
   * `"start"` for a new contact, `"move"` while a finger drags. Absent in
   * older samples, which were all contacts and are treated as `"start"`.
   */
  kind?: "start" | "move";
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
