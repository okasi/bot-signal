import { analyzeBehavioralSamples } from "./scoring.js";
import type {
  BehavioralClientDetector,
  BehavioralClientResult,
  BehavioralDetectorOptions,
  BehavioralSamples,
  ClickSample,
  ExtendedWindow,
  KeySample,
  MouseSample,
  ScrollSample,
  TouchSample,
} from "./types.js";

const DEFAULT_MIN_OBSERVATION_MS = 3_000;
const DEFAULT_SCORE_THRESHOLD = 0.55;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_SAMPLE_WINDOW_MS = 60_000;

type Listener = {
  target: EventTarget;
  type: string;
  handler: EventListener;
};

/** Drops samples older than `cutoff` from the front of a time-ordered stream. */
function pruneStream(stream: Array<{ t: number }>, cutoff: number): void {
  let firstFresh = 0;
  while (firstFresh < stream.length && stream[firstFresh].t < cutoff) {
    firstFresh += 1;
  }
  if (firstFresh > 0) {
    stream.splice(0, firstFresh);
  }
}

function createEmptySamples(observationMs = 0): Required<BehavioralSamples> {
  return {
    mouseMoves: [],
    scrolls: [],
    keyPresses: [],
    clicks: [],
    touches: [],
    observationMs,
  };
}

/**
 * Creates a detector that observes mouse, wheel, keyboard, click, and touch
 * events on `options.context` (defaults to `globalThis`) and scores how
 * robotic the interaction looks.
 *
 * Call `observe(ms)` for a one-shot observation, or `start()`/`stop()` +
 * `getResult()` to manage the window yourself. Pass `onUpdate` to receive
 * periodic results while observing.
 *
 * @example
 * const result = await createBehavioralClientDetector({ context: window }).observe(10_000);
 * if (!result.isLegitClient) challenge();
 */
export function createBehavioralClientDetector(
  options: BehavioralDetectorOptions = {},
): BehavioralClientDetector {
  const context = options.context ?? (globalThis as unknown as ExtendedWindow);
  const minObservationMs = options.minObservationMs ?? DEFAULT_MIN_OBSERVATION_MS;
  const scoreThreshold = options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sampleWindowMs = options.sampleWindowMs ?? DEFAULT_SAMPLE_WINDOW_MS;

  let samples = createEmptySamples();
  let startedAt: number | undefined;
  let listeners: Listener[] = [];
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let isActive = false;
  let observeTimer: ReturnType<typeof setTimeout> | undefined;
  let observeResolve: ((result: BehavioralClientResult) => void) | undefined;

  const pruneRetainedSamples = (now = Date.now()): void => {
    if (!Number.isFinite(sampleWindowMs)) {
      return;
    }

    const cutoff = now - sampleWindowMs;
    pruneStream(samples.mouseMoves, cutoff);
    pruneStream(samples.scrolls, cutoff);
    pruneStream(samples.keyPresses, cutoff);
    pruneStream(samples.clicks, cutoff);
    pruneStream(samples.touches, cutoff);
  };

  const record = <T extends { t: number }>(stream: T[], sample: T): void => {
    stream.push(sample);
    pruneRetainedSamples(sample.t);
  };

  const getObservationMs = (): number => {
    if (startedAt === undefined) {
      return samples.observationMs;
    }

    return samples.observationMs + (Date.now() - startedAt);
  };

  const evaluate = (): BehavioralClientResult => {
    if (isActive) {
      pruneRetainedSamples();
    }

    return analyzeBehavioralSamples(
      {
        ...samples,
        observationMs: getObservationMs(),
      },
      scoreThreshold,
    );
  };

  const addListener = (
    target: EventTarget,
    type: string,
    handler: EventListener,
  ): void => {
    target.addEventListener(type, handler, { passive: true });
    listeners.push({ target, type, handler });
  };

  const onMouseMove = (event: Event): void => {
    const mouseEvent = event as MouseEvent;
    record<MouseSample>(samples.mouseMoves, {
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
      t: Date.now(),
      isTrusted: mouseEvent.isTrusted,
    });
  };

  const onWheel = (event: Event): void => {
    const wheelEvent = event as WheelEvent;
    record<ScrollSample>(samples.scrolls, {
      deltaY: wheelEvent.deltaY,
      t: Date.now(),
      isTrusted: wheelEvent.isTrusted,
    });
  };

  const onKeyDown = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
    record<KeySample>(samples.keyPresses, {
      t: Date.now(),
      isTrusted: keyboardEvent.isTrusted,
      repeat: keyboardEvent.repeat,
    });
  };

  const onClick = (event: Event): void => {
    const mouseEvent = event as MouseEvent;
    record<ClickSample>(samples.clicks, {
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
      t: Date.now(),
      isTrusted: mouseEvent.isTrusted,
      detail: mouseEvent.detail,
    });
  };

  const onTouchStart = (event: Event): void => {
    record<TouchSample>(samples.touches, {
      t: Date.now(),
      isTrusted: event.isTrusted,
    });
  };

  const start = (): void => {
    if (isActive) {
      return;
    }

    isActive = true;
    startedAt = Date.now();
    addListener(context, "mousemove", onMouseMove);
    addListener(context, "wheel", onWheel);
    addListener(context, "keydown", onKeyDown);
    addListener(context, "click", onClick);
    addListener(context, "touchstart", onTouchStart);

    if (options.onUpdate) {
      pollTimer = setInterval(() => {
        options.onUpdate?.(evaluate());
      }, pollIntervalMs);
    }
  };

  const settleObservation = (): void => {
    if (!observeResolve) {
      return;
    }

    const resolve = observeResolve;
    observeResolve = undefined;

    if (observeTimer !== undefined) {
      clearTimeout(observeTimer);
      observeTimer = undefined;
    }

    resolve(evaluate());
  };

  const stop = (): void => {
    if (!isActive) {
      return;
    }

    pruneRetainedSamples();
    isActive = false;
    samples.observationMs = getObservationMs();
    startedAt = undefined;

    for (const listener of listeners) {
      listener.target.removeEventListener(listener.type, listener.handler);
    }

    listeners = [];

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }

    settleObservation();
  };

  const reset = (): void => {
    stop();
    samples = createEmptySamples();
    startedAt = undefined;
  };

  const getResult = (): BehavioralClientResult => evaluate();

  const observe = (
    durationMs = minObservationMs,
  ): Promise<BehavioralClientResult> => {
    if (observeResolve) {
      return Promise.reject(
        new Error(
          "createBehavioralClientDetector: an observation is already in progress",
        ),
      );
    }

    start();

    return new Promise<BehavioralClientResult>((resolve) => {
      observeResolve = resolve;
      observeTimer = setTimeout(stop, durationMs);
    });
  };

  return {
    start,
    stop,
    reset,
    getResult,
    observe,
  };
}

export {
  aggregateSuspicionScore,
  analyzeBehavioralSamples,
  resolveConfidence,
} from "./scoring.js";
export {
  buildBehavioralSignals,
  hasClickWithoutMouseMovement,
  hasLinearMouseMovement,
  hasLinearScroll,
  hasLinearTyping,
  hasNoMouseActivity,
  hasSyntheticEvents,
  hasTeleportMouse,
} from "./analysis.js";
