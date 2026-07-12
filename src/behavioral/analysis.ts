import type {
  BehavioralSamples,
  BehavioralSignal,
  ClickSample,
  ConfidenceLevel,
  KeySample,
  MouseSample,
  ScrollSample,
  TouchSample,
} from "./types.js";

/**
 * Behavioral heuristic tuning constants.
 *
 * These thresholds are empirical and chosen to balance detection of obvious
 * automation against common false positives (touch devices, high-DPI mice,
 * human variance, window re-entry, OS key repeat, etc.).
 *
 * They are intentionally not exposed as runtime options for the main API to
 * keep the surface small and the behavior predictable. Power users can copy
 * the analysis functions if they need to tune.
 */

/** How far back a mouse move or touch still explains a click */
const CLICK_ORIGIN_WINDOW_MS = 2_000;

/** Cursor jumps only count as teleports when they happen quickly — a large
 * gap means the pointer likely left and re-entered the window. */
const TELEPORT_MAX_ELAPSED_MS = 100;

/** Very fast teleport (implausible human reaction + distance). */
const TELEPORT_FAST_ELAPSED_MS = 20;
const TELEPORT_FAST_DISTANCE_PX = 200;
const TELEPORT_ANY_DISTANCE_PX = 600;

// Linearity is checked over every sliding sub-window as well as the whole
// trace, so a scripted burst can't hide inside replayed human noise by sitting
// at an off-grid offset.
const MOUSE_LINEAR_WINDOW = 14;
const SCROLL_LINEAR_WINDOW = 8;

/** Minimum samples required before we consider a trace for linearity. */
const MIN_MOUSE_FOR_LINEAR = 6;
const MIN_SCROLL_FOR_LINEAR = 4;
const MIN_KEYS_FOR_LINEAR = 5;

/** Coefficient of variation cutoffs for "too uniform". Lower = more robotic. */
const MOUSE_CV_SPEED_MAX = 0.08;
const SCROLL_CV_DELTA_MAX = 0.1;
const SCROLL_CV_INTERVAL_MAX = 0.12;
const TYPING_CV_INTERVAL_MAX = 0.08;

/** Max perpendicular deviation (pixels) allowed for a "straight" mouse line. */
const MOUSE_MAX_LINE_DEVIATION = 4;

/** Typing faster than this average interval (ms) is considered superhuman. */
const TYPING_SUPERHUMAN_INTERVAL_MS = 25;

/**
 * Returns true if the whole trace, or any contiguous `window`-length slice of
 * it, satisfies `isLinear`. Sliding by one guarantees a linear run of at least
 * `window` samples is caught regardless of where it starts.
 */
function anyLinearWindow<T>(
  samples: T[],
  window: number,
  isLinear: (segment: T[]) => boolean,
): boolean {
  if (samples.length <= window) {
    return isLinear(samples);
  }

  for (let start = 0; start + window <= samples.length; start += 1) {
    if (isLinear(samples.slice(start, start + window))) {
      return true;
    }
  }

  return false;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function coefficientOfVariation(values: number[]): number {
  const average = mean(values);
  if (average === 0) {
    return 0;
  }

  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    values.length;

  return Math.sqrt(variance) / Math.abs(average);
}

function maxLineDeviation(points: MouseSample[]): number {
  const start = points[0];
  const end = points[points.length - 1];
  const lineLength = Math.hypot(end.x - start.x, end.y - start.y);

  if (lineLength === 0) {
    return 0;
  }

  let maxDeviation = 0;

  for (const point of points) {
    const area = Math.abs(
      (end.x - start.x) * (start.y - point.y) -
        (start.x - point.x) * (end.y - start.y),
    );
    maxDeviation = Math.max(maxDeviation, area / lineLength);
  }

  return maxDeviation;
}

function createSignal(
  id: string,
  description: string,
  triggered: boolean,
  weight: number,
  confidence: ConfidenceLevel,
): BehavioralSignal {
  return {
    id,
    description,
    triggered,
    weight,
    confidence,
    score: triggered ? weight : 0,
  };
}

function isLinearMouseSegment(points: MouseSample[]): boolean {
  const speeds: number[] = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const elapsed = current.t - previous.t;

    if (elapsed <= 0) {
      continue;
    }

    speeds.push(
      Math.hypot(current.x - previous.x, current.y - previous.y) / elapsed,
    );
  }

  if (speeds.length < 5) {
    return false;
  }

  return coefficientOfVariation(speeds) < MOUSE_CV_SPEED_MAX && maxLineDeviation(points) < MOUSE_MAX_LINE_DEVIATION;
}

/**
 * Mouse path is a near-perfect line traversed at near-constant speed.
 * @internal
 */
export function hasLinearMouseMovement(mouseMoves: MouseSample[]): boolean {
  if (mouseMoves.length < MIN_MOUSE_FOR_LINEAR) {
    return false;
  }

  return anyLinearWindow(mouseMoves, MOUSE_LINEAR_WINDOW, isLinearMouseSegment);
}

/**
 * Cursor covered an implausible distance between closely-spaced events.
 * @internal
 */
export function hasTeleportMouse(mouseMoves: MouseSample[]): boolean {
  for (let index = 1; index < mouseMoves.length; index += 1) {
    const previous = mouseMoves[index - 1];
    const current = mouseMoves[index];
    const elapsed = current.t - previous.t;

    if (elapsed > TELEPORT_MAX_ELAPSED_MS) {
      continue;
    }

    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);

    if (elapsed <= TELEPORT_FAST_ELAPSED_MS && distance > TELEPORT_FAST_DISTANCE_PX) {
      return true;
    }

    if (distance > TELEPORT_ANY_DISTANCE_PX) {
      return true;
    }
  }

  return false;
}

/**
 * Trusted clicks with `detail === 0` come from keyboard activation
 * (Enter/Space on a control) — not from a pointer. Untrusted clicks never
 * get this exemption: synthetic events also default to `detail: 0`.
 */
function isPointerClick(click: ClickSample): boolean {
  return !(click.isTrusted && click.detail === 0);
}

function hasRecentSample(
  samples: Array<{ t: number }>,
  at: number,
  windowMs: number,
): boolean {
  return samples.some((sample) => sample.t >= at - windowMs && sample.t <= at);
}

/**
 * A pointer click landed with no mouse or touch activity in the preceding 2s.
 * @internal
 */
export function hasClickWithoutMouseMovement(
  mouseMoves: MouseSample[],
  clicks: ClickSample[],
  touches: TouchSample[] = [],
): boolean {
  return clicks.some(
    (click) =>
      isPointerClick(click) &&
      !hasRecentSample(mouseMoves, click.t, CLICK_ORIGIN_WINDOW_MS) &&
      !hasRecentSample(touches, click.t, CLICK_ORIGIN_WINDOW_MS),
  );
}

/**
 * Pointer clicks were recorded in a session with zero mouse or touch events.
 * @internal
 */
export function hasNoMouseActivity(
  mouseMoves: MouseSample[],
  clicks: ClickSample[],
  touches: TouchSample[] = [],
): boolean {
  return (
    clicks.some(isPointerClick) &&
    mouseMoves.length === 0 &&
    touches.length === 0
  );
}

function isLinearScrollSegment(scrollEvents: ScrollSample[]): boolean {
  const deltas = scrollEvents.map((event) => Math.abs(event.deltaY));
  const intervals: number[] = [];

  for (let index = 1; index < scrollEvents.length; index += 1) {
    intervals.push(scrollEvents[index].t - scrollEvents[index - 1].t);
  }

  return (
    coefficientOfVariation(deltas) < SCROLL_CV_DELTA_MAX &&
    coefficientOfVariation(intervals) < SCROLL_CV_INTERVAL_MAX
  );
}

/**
 * Scroll deltas and inter-event timing are too uniform to be a human hand.
 * @internal
 */
export function hasLinearScroll(scrollEvents: ScrollSample[]): boolean {
  if (scrollEvents.length < MIN_SCROLL_FOR_LINEAR) {
    return false;
  }

  return anyLinearWindow(scrollEvents, SCROLL_LINEAR_WINDOW, isLinearScrollSegment);
}

/**
 * Keystroke rhythm is metronome-uniform or faster than humanly possible.
 * @internal
 */
export function hasLinearTyping(keyPresses: KeySample[]): boolean {
  // OS key auto-repeat is perfectly uniform and fast — only analyze
  // deliberate keystrokes.
  const deliberate = keyPresses.filter((key) => !key.repeat);

  if (deliberate.length < MIN_KEYS_FOR_LINEAR) {
    return false;
  }

  const intervals: number[] = [];

  for (let index = 1; index < deliberate.length; index += 1) {
    intervals.push(deliberate[index].t - deliberate[index - 1].t);
  }

  const intervalUniformity = coefficientOfVariation(intervals);
  const averageInterval = mean(intervals);

  return intervalUniformity < TYPING_CV_INTERVAL_MAX || averageInterval < TYPING_SUPERHUMAN_INTERVAL_MS;
}

/**
 * Any observed event was script-dispatched (`isTrusted === false`).
 * @internal
 */
export function hasSyntheticEvents(samples: BehavioralSamples): boolean {
  const events = [
    ...samples.mouseMoves,
    ...samples.scrolls,
    ...samples.keyPresses,
    ...samples.clicks,
    ...(samples.touches ?? []),
  ];

  return events.some((event) => !event.isTrusted);
}

/**
 * Evaluates every behavioral heuristic and returns the weighted signal list.
 * @internal
 */
export function buildBehavioralSignals(samples: BehavioralSamples): BehavioralSignal[] {
  const touches = samples.touches ?? [];

  return [
    createSignal(
      "no-mouse-activity",
      "Clicks were recorded without any mouse or touch activity",
      hasNoMouseActivity(samples.mouseMoves, samples.clicks, touches),
      0.2,
      "low",
    ),
    createSignal(
      "click-without-mouse-movement",
      "At least one click had no recent mouse or touch activity",
      hasClickWithoutMouseMovement(samples.mouseMoves, samples.clicks, touches),
      0.35,
      "high",
    ),
    createSignal(
      "linear-mouse-movement",
      "Mouse path is unusually straight with uniform speed",
      hasLinearMouseMovement(samples.mouseMoves),
      0.25,
      "medium",
    ),
    createSignal(
      "teleport-mouse",
      "Mouse position jumped implausibly between events",
      hasTeleportMouse(samples.mouseMoves),
      0.4,
      "high",
    ),
    createSignal(
      "linear-scroll",
      "Scroll deltas and timing are overly uniform",
      hasLinearScroll(samples.scrolls),
      0.3,
      "medium",
    ),
    createSignal(
      "linear-typing",
      "Typing intervals are robotic or superhuman",
      hasLinearTyping(samples.keyPresses),
      0.35,
      "high",
    ),
    createSignal(
      "synthetic-events",
      "Observed pointer or keyboard events were not trusted",
      hasSyntheticEvents(samples),
      0.5,
      "high",
    ),
  ];
}
