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
} from "./types.js";

const DEFAULT_MIN_OBSERVATION_MS = 3_000;
const DEFAULT_SCORE_THRESHOLD = 0.55;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

type Listener = {
  target: EventTarget;
  type: string;
  handler: EventListener;
};

function createEmptySamples(observationMs = 0): BehavioralSamples {
  return {
    mouseMoves: [],
    scrolls: [],
    keyPresses: [],
    clicks: [],
    observationMs,
  };
}

export function createBehavioralClientDetector(
  options: BehavioralDetectorOptions = {},
): BehavioralClientDetector {
  const context = options.context ?? (globalThis as unknown as ExtendedWindow);
  const minObservationMs = options.minObservationMs ?? DEFAULT_MIN_OBSERVATION_MS;
  const scoreThreshold = options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  let samples = createEmptySamples();
  let startedAt = 0;
  let listeners: Listener[] = [];
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let isActive = false;

  const getObservationMs = (): number => {
    if (startedAt === 0) {
      return samples.observationMs;
    }

    return Math.max(samples.observationMs, Date.now() - startedAt);
  };

  const evaluate = (): BehavioralClientResult =>
    analyzeBehavioralSamples(
      {
        ...samples,
        observationMs: getObservationMs(),
      },
      scoreThreshold,
    );

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
    const sample: MouseSample = {
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
      t: Date.now(),
      isTrusted: mouseEvent.isTrusted,
    };
    samples.mouseMoves.push(sample);
  };

  const onWheel = (event: Event): void => {
    const wheelEvent = event as WheelEvent;
    const sample: ScrollSample = {
      deltaY: wheelEvent.deltaY,
      t: Date.now(),
      isTrusted: wheelEvent.isTrusted,
    };
    samples.scrolls.push(sample);
  };

  const onKeyDown = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
    const sample: KeySample = {
      t: Date.now(),
      isTrusted: keyboardEvent.isTrusted,
    };
    samples.keyPresses.push(sample);
  };

  const onClick = (event: Event): void => {
    const mouseEvent = event as MouseEvent;
    const sample: ClickSample = {
      x: mouseEvent.clientX,
      y: mouseEvent.clientY,
      t: Date.now(),
      isTrusted: mouseEvent.isTrusted,
    };
    samples.clicks.push(sample);
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

    if (options.onUpdate) {
      pollTimer = setInterval(() => {
        options.onUpdate?.(evaluate());
      }, pollIntervalMs);
    }
  };

  const stop = (): void => {
    if (!isActive) {
      return;
    }

    isActive = false;
    samples.observationMs = getObservationMs();

    for (const listener of listeners) {
      listener.target.removeEventListener(listener.type, listener.handler);
    }

    listeners = [];

    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };

  const reset = (): void => {
    stop();
    samples = createEmptySamples();
    startedAt = 0;
  };

  const getResult = (): BehavioralClientResult => evaluate();

  const observe = (durationMs = minObservationMs): Promise<BehavioralClientResult> =>
    new Promise((resolve) => {
      start();

      setTimeout(() => {
        stop();
        resolve(getResult());
      }, durationMs);
    });

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
