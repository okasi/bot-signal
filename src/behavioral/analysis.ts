import type {
  BehavioralSamples,
  BehavioralSignal,
  ClickSample,
  ConfidenceLevel,
  KeySample,
  MouseSample,
  ScrollSample,
} from "./types.js";

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) {
    return 1;
  }

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
  if (points.length < 3) {
    return 0;
  }

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

export function hasLinearMouseMovement(mouseMoves: MouseSample[]): boolean {
  if (mouseMoves.length < 6) {
    return false;
  }

  const speeds: number[] = [];

  for (let index = 1; index < mouseMoves.length; index += 1) {
    const previous = mouseMoves[index - 1];
    const current = mouseMoves[index];
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

  const speedUniformity = coefficientOfVariation(speeds);
  const lineDeviation = maxLineDeviation(mouseMoves);

  return speedUniformity < 0.08 && lineDeviation < 4;
}

export function hasTeleportMouse(mouseMoves: MouseSample[]): boolean {
  for (let index = 1; index < mouseMoves.length; index += 1) {
    const previous = mouseMoves[index - 1];
    const current = mouseMoves[index];
    const elapsed = current.t - previous.t;
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);

    if (elapsed <= 20 && distance > 200) {
      return true;
    }

    if (distance > 600) {
      return true;
    }
  }

  return false;
}

export function hasClickWithoutMouseMovement(
  mouseMoves: MouseSample[],
  clicks: ClickSample[],
): boolean {
  if (clicks.length === 0) {
    return false;
  }

  return clicks.some((click) => {
    const recentMoves = mouseMoves.filter(
      (move) => move.t >= click.t - 2_000 && move.t <= click.t,
    );

    return recentMoves.length === 0;
  });
}

export function hasNoMouseActivity(
  mouseMoves: MouseSample[],
  clicks: ClickSample[],
): boolean {
  return clicks.length > 0 && mouseMoves.length === 0;
}

export function hasLinearScroll(scrollEvents: ScrollSample[]): boolean {
  if (scrollEvents.length < 4) {
    return false;
  }

  const deltas = scrollEvents.map((event) => Math.abs(event.deltaY));
  const intervals: number[] = [];

  for (let index = 1; index < scrollEvents.length; index += 1) {
    intervals.push(scrollEvents[index].t - scrollEvents[index - 1].t);
  }

  return (
    coefficientOfVariation(deltas) < 0.1 &&
    coefficientOfVariation(intervals) < 0.12
  );
}

export function hasLinearTyping(keyPresses: KeySample[]): boolean {
  if (keyPresses.length < 5) {
    return false;
  }

  const intervals: number[] = [];

  for (let index = 1; index < keyPresses.length; index += 1) {
    intervals.push(keyPresses[index].t - keyPresses[index - 1].t);
  }

  const intervalUniformity = coefficientOfVariation(intervals);
  const averageInterval = mean(intervals);

  return intervalUniformity < 0.08 || averageInterval < 25;
}

export function hasSyntheticEvents(samples: BehavioralSamples): boolean {
  const events = [
    ...samples.mouseMoves,
    ...samples.scrolls,
    ...samples.keyPresses,
    ...samples.clicks,
  ];

  return events.some((event) => !event.isTrusted);
}

export function buildBehavioralSignals(samples: BehavioralSamples): BehavioralSignal[] {
  return [
    createSignal(
      "no-mouse-activity",
      "Clicks were recorded without any mouse movement",
      hasNoMouseActivity(samples.mouseMoves, samples.clicks),
      0.2,
      "low",
    ),
    createSignal(
      "click-without-mouse-movement",
      "At least one click had no recent mouse movement",
      hasClickWithoutMouseMovement(samples.mouseMoves, samples.clicks),
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
