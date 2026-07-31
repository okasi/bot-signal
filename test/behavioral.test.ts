import { describe, expect, it, vi } from "vitest";
import {
  analyzeBehavioralSamples,
  aggregateSuspicionScore,
  buildBehavioralSignals,
  createBehavioralClientDetector,
  hasClickWithoutMouseMovement,
  hasLinearMouseMovement,
  hasLinearScroll,
  hasLinearTapRhythm,
  hasLinearTouchMovement,
  hasLinearTyping,
  hasNoMouseActivity,
  hasSyntheticEvents,
  hasTeleportMouse,
  hasTeleportTouch,
  hasZeroMouseMovementDeltas,
} from "../src/behavioral/index.js";
import type {
  BehavioralSamples,
  ClickSample,
  ExtendedWindow,
  KeySample,
  MouseSample,
  ScrollSample,
  TouchSample,
} from "../src/behavioral/types.js";

function createLinearMouseMoves(count = 8): MouseSample[] {
  const moves: MouseSample[] = [];

  for (let index = 0; index < count; index += 1) {
    moves.push({
      x: index * 40,
      y: index * 20,
      t: index * 16,
      isTrusted: true,
    });
  }

  return moves;
}

function createHumanMouseMoves(): MouseSample[] {
  return [
    { x: 0, y: 0, t: 0, isTrusted: true },
    { x: 18, y: 4, t: 31, isTrusted: true },
    { x: 52, y: 19, t: 88, isTrusted: true },
    { x: 90, y: 55, t: 151, isTrusted: true },
    { x: 140, y: 72, t: 233, isTrusted: true },
    { x: 201, y: 88, t: 340, isTrusted: true },
  ];
}

function createLinearScrolls(count = 5): ScrollSample[] {
  const scrolls: ScrollSample[] = [];

  for (let index = 0; index < count; index += 1) {
    scrolls.push({
      deltaY: 120,
      t: index * 100,
      isTrusted: true,
    });
  }

  return scrolls;
}

function createLinearTyping(count = 6): KeySample[] {
  const keys: KeySample[] = [];

  for (let index = 0; index < count; index += 1) {
    keys.push({
      t: index * 50,
      isTrusted: true,
    });
  }

  return keys;
}

function createSamples(
  overrides: Partial<BehavioralSamples> = {},
): BehavioralSamples {
  return {
    mouseMoves: [],
    scrolls: [],
    keyPresses: [],
    clicks: [],
    observationMs: 5_000,
    ...overrides,
  };
}

function createListenerTarget(): ExtendedWindow {
  return new EventTarget() as unknown as ExtendedWindow;
}

class CapturingEventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, handler: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(handler);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, handler: EventListener): void {
    this.listeners.get(type)?.delete(handler);
  }

  emit(type: string, event: Record<string, unknown>): void {
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event as Event);
    }
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function createCapturingTarget(): CapturingEventTarget & ExtendedWindow {
  return new CapturingEventTarget() as CapturingEventTarget & ExtendedWindow;
}

describe("behavioral analysis", () => {
  it("detects linear mouse movement", () => {
    expect(hasLinearMouseMovement(createLinearMouseMoves())).toBe(true);
    expect(hasLinearMouseMovement(createHumanMouseMoves())).toBe(false);
  });

  it("requires enough usable mouse speed samples before flagging linear movement", () => {
    expect(hasLinearMouseMovement(createLinearMouseMoves(5))).toBe(false);
    expect(
      hasLinearMouseMovement([
        { x: 0, y: 0, t: 0, isTrusted: true },
        { x: 10, y: 10, t: 0, isTrusted: true },
        { x: 20, y: 20, t: 0, isTrusted: true },
        { x: 30, y: 30, t: 0, isTrusted: true },
        { x: 40, y: 40, t: 0, isTrusted: true },
        { x: 50, y: 50, t: 0, isTrusted: true },
      ]),
    ).toBe(false);
    expect(
      hasLinearMouseMovement([
        { x: 10, y: 10, t: 0, isTrusted: true },
        { x: 10, y: 10, t: 16, isTrusted: true },
        { x: 10, y: 10, t: 32, isTrusted: true },
        { x: 10, y: 10, t: 48, isTrusted: true },
        { x: 10, y: 10, t: 64, isTrusted: true },
        { x: 10, y: 10, t: 80, isTrusted: true },
      ]),
    ).toBe(true);
  });

  it("detects teleport mouse movement", () => {
    const moves: MouseSample[] = [
      { x: 0, y: 0, t: 0, isTrusted: true },
      { x: 800, y: 500, t: 10, isTrusted: true },
    ];

    expect(hasTeleportMouse(moves)).toBe(true);
  });

  it("detects long mouse traces whose browser deltas are always zero", () => {
    const zeroDeltas = Array.from({ length: 51 }, (_, index) => ({
      x: index,
      y: index % 7,
      movementX: 0,
      movementY: 0,
      t: index * 16,
      isTrusted: true,
    }));

    expect(hasZeroMouseMovementDeltas(zeroDeltas)).toBe(true);
    expect(hasZeroMouseMovementDeltas(zeroDeltas.slice(0, 50))).toBe(false);
    expect(
      hasZeroMouseMovementDeltas([
        ...zeroDeltas.slice(0, 50),
        { ...zeroDeltas[50], movementX: 1 },
      ]),
    ).toBe(false);
    expect(hasZeroMouseMovementDeltas(createLinearMouseMoves(51))).toBe(false);
    expect(
      buildBehavioralSignals(createSamples({ mouseMoves: zeroDeltas })).find(
        ({ id }) => id === "zero-mouse-movement-deltas",
      ),
    ).toMatchObject({ triggered: true, weight: 0.3, confidence: "medium" });
  });

  it("detects large cursor jumps even when elapsed time is above 20ms", () => {
    const moves: MouseSample[] = [
      { x: 0, y: 0, t: 0, isTrusted: true },
      { x: 700, y: 0, t: 50, isTrusted: true },
    ];

    expect(hasTeleportMouse(moves)).toBe(true);
  });

  it("does not flag window re-entry as teleport", () => {
    // Cursor left the window and came back somewhere else much later.
    const moves: MouseSample[] = [
      { x: 5, y: 300, t: 0, isTrusted: true },
      { x: 1200, y: 40, t: 850, isTrusted: true },
    ];

    expect(hasTeleportMouse(moves)).toBe(false);
  });

  it("detects clicks without recent mouse movement", () => {
    const clicks: ClickSample[] = [{ x: 100, y: 100, t: 1_000, isTrusted: true }];

    expect(hasClickWithoutMouseMovement([], clicks)).toBe(true);
    expect(
      hasClickWithoutMouseMovement(
        [{ x: 90, y: 90, t: 900, isTrusted: true }],
        clicks,
      ),
    ).toBe(false);
  });

  it("does not flag keyboard-activated clicks", () => {
    const keyboardClicks: ClickSample[] = [
      { x: 0, y: 0, t: 1_000, isTrusted: true, detail: 0 },
    ];

    expect(hasClickWithoutMouseMovement([], keyboardClicks)).toBe(false);
    expect(hasNoMouseActivity([], keyboardClicks)).toBe(false);
  });

  it("does not flag tap-driven clicks on touch devices", () => {
    const clicks: ClickSample[] = [{ x: 100, y: 100, t: 1_000, isTrusted: true }];
    const touches = [{ t: 950, isTrusted: true }];

    expect(hasClickWithoutMouseMovement([], clicks, touches)).toBe(false);
    expect(hasNoMouseActivity([], clicks, touches)).toBe(false);
  });

  it("detects no mouse activity with clicks", () => {
    expect(hasNoMouseActivity([], [{ x: 1, y: 1, t: 0, isTrusted: true }])).toBe(
      true,
    );
  });

  it("detects linear scroll patterns", () => {
    expect(hasLinearScroll(createLinearScrolls())).toBe(true);
    expect(hasLinearScroll(createLinearScrolls(3))).toBe(false);
    expect(
      hasLinearScroll([
        { deltaY: 0, t: 0, isTrusted: true },
        { deltaY: 0, t: 100, isTrusted: true },
        { deltaY: 0, t: 200, isTrusted: true },
        { deltaY: 0, t: 300, isTrusted: true },
      ]),
    ).toBe(true);
    expect(
      hasLinearScroll([
        { deltaY: 120, t: 0, isTrusted: true },
        { deltaY: 84, t: 140, isTrusted: true },
        { deltaY: 210, t: 360, isTrusted: true },
        { deltaY: 36, t: 470, isTrusted: true },
      ]),
    ).toBe(false);
  });

  it("detects linear typing patterns", () => {
    expect(hasLinearTyping(createLinearTyping())).toBe(true);
    expect(hasLinearTyping(createLinearTyping(4))).toBe(false);
    expect(
      hasLinearTyping([
        { t: 0, isTrusted: true },
        { t: 112, isTrusted: true },
        { t: 181, isTrusted: true },
        { t: 352, isTrusted: true },
        { t: 401, isTrusted: true },
      ]),
    ).toBe(false);
  });

  it("ignores OS key auto-repeat when analyzing typing rhythm", () => {
    // Holding a key: one deliberate press followed by uniform ~33ms repeats.
    const held: KeySample[] = [{ t: 0, isTrusted: true }];
    for (let index = 1; index < 20; index += 1) {
      held.push({ t: index * 33, isTrusted: true, repeat: true });
    }

    expect(hasLinearTyping(held)).toBe(false);
  });

  it("detects synthetic events", () => {
    expect(
      hasSyntheticEvents(
        createSamples({
          clicks: [{ x: 1, y: 1, t: 0, isTrusted: false }],
          touches: [{ t: 0, isTrusted: false }],
        }),
      ),
    ).toBe(true);
  });

  it("catches a robotic mouse burst embedded in a longer trace", () => {
    const organic = createHumanMouseMoves();
    const robotic: MouseSample[] = [];
    for (let index = 0; index < 16; index += 1) {
      robotic.push({
        x: 500 + index * 40,
        y: 500 + index * 20,
        t: 1_000 + index * 16,
        isTrusted: true,
      });
    }
    const trailingNoise: MouseSample[] = [
      { x: 9_000, y: 12, t: 5_000, isTrusted: true },
      { x: 9_040, y: 18, t: 5_050, isTrusted: true },
    ];

    // Whole-trace CoV would be diluted by the organic noise. The scripted run
    // is isolated whether it leads, trails, or sits at an off-grid offset
    // surrounded by noise on both sides.
    expect(hasLinearMouseMovement([...robotic, ...organic])).toBe(true);
    expect(hasLinearMouseMovement([...organic, ...robotic])).toBe(true);
    expect(
      hasLinearMouseMovement([...organic.slice(0, 3), ...robotic, ...trailingNoise]),
    ).toBe(true);
    expect(hasLinearMouseMovement(organic)).toBe(false);
  });

  it("does not flag a long organic (curved, irregular) mouse trace", () => {
    const moves: MouseSample[] = [];
    let t = 0;
    for (let index = 0; index < 30; index += 1) {
      t += 25 + (index % 5) * 12;
      moves.push({
        x: index * 20,
        y: Math.round(80 * Math.sin(index / 3)),
        t,
        isTrusted: true,
      });
    }

    expect(hasLinearMouseMovement(moves)).toBe(false);
  });

  it("catches a robotic scroll burst inside a longer trace", () => {
    const scrolls: ScrollSample[] = [
      { deltaY: 120, t: 0, isTrusted: true },
      { deltaY: 80, t: 140, isTrusted: true },
      { deltaY: 210, t: 330, isTrusted: true },
      { deltaY: 36, t: 470, isTrusted: true },
      { deltaY: 160, t: 690, isTrusted: true },
    ];
    for (let index = 0; index < 8; index += 1) {
      scrolls.push({ deltaY: 120, t: 1_000 + index * 100, isTrusted: true });
    }

    expect(hasLinearScroll(scrolls)).toBe(true);
  });
});

describe("behavioral scoring", () => {
  it("aggregates triggered signal weights", () => {
    const signals = buildBehavioralSignals(
      createSamples({
        mouseMoves: createLinearMouseMoves(),
        scrolls: createLinearScrolls(),
        keyPresses: createLinearTyping(),
        clicks: [{ x: 0, y: 0, t: 0, isTrusted: false }],
      }),
    );

    const score = aggregateSuspicionScore(signals);

    expect(score).toBeGreaterThan(0.7);
  });

  it("returns a low score for human-like samples", () => {
    const result = analyzeBehavioralSamples(
      createSamples({
        mouseMoves: createHumanMouseMoves(),
        scrolls: [
          { deltaY: 120, t: 0, isTrusted: true },
          { deltaY: 84, t: 140, isTrusted: true },
          { deltaY: 210, t: 360, isTrusted: true },
          { deltaY: 36, t: 470, isTrusted: true },
        ],
        keyPresses: [
          { t: 0, isTrusted: true },
          { t: 112, isTrusted: true },
          { t: 181, isTrusted: true },
          { t: 352, isTrusted: true },
          { t: 401, isTrusted: true },
        ],
      }),
    );

    expect(result.suspicionScore).toBeLessThan(0.55);
    expect(result.isLegitClient).toBe(true);
    expect(result.confidence).not.toBe("high");
  });

  it("flags robotic samples as suspicious with confidence", () => {
    const result = analyzeBehavioralSamples(
      createSamples({
        mouseMoves: createLinearMouseMoves(),
        scrolls: createLinearScrolls(),
        keyPresses: createLinearTyping(),
        clicks: [{ x: 320, y: 160, t: 200, isTrusted: false }],
      }),
    );

    expect(result.isLegitClient).toBe(false);
    expect(result.suspicionScore).toBeGreaterThanOrEqual(0.55);
    expect(result.confidence).toBe("high");
    expect(result.signals.some((signal) => signal.triggered)).toBe(true);
  });
});

describe("behavioral detector lifecycle", () => {
  it("freezes observation time after stop", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(0);
      const detector = createBehavioralClientDetector({
        context: createListenerTarget(),
      });

      detector.start();
      vi.advanceTimersByTime(1_500);
      detector.stop();

      expect(detector.getResult().observationMs).toBe(1_500);

      vi.advanceTimersByTime(5_000);

      expect(detector.getResult().observationMs).toBe(1_500);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accumulates observation time across repeated start and stop calls", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(0);
      const detector = createBehavioralClientDetector({
        context: createListenerTarget(),
      });

      detector.start();
      vi.advanceTimersByTime(1_000);
      detector.stop();

      vi.advanceTimersByTime(10_000);

      detector.start();
      vi.advanceTimersByTime(750);
      detector.stop();

      expect(detector.getResult().observationMs).toBe(1_750);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records DOM event samples and removes listeners on stop", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(10_000);
      const context = createCapturingTarget();
      const detector = createBehavioralClientDetector({ context });

      detector.start();
      context.emit("mousemove", {
        clientX: 10,
        clientY: 20,
        isTrusted: true,
      });
      context.emit("wheel", { deltaY: 120, isTrusted: true });
      context.emit("keydown", { repeat: true, isTrusted: true });
      context.emit("click", {
        clientX: 10,
        clientY: 20,
        detail: 1,
        isTrusted: false,
      });
      // Single finger down and dragging: both carry coordinates.
      context.emit("touchstart", {
        isTrusted: true,
        touches: { length: 1 },
        changedTouches: [{ clientX: 40, clientY: 60 }],
      });
      context.emit("touchmove", {
        isTrusted: true,
        touches: { length: 1 },
        changedTouches: [{ clientX: 48, clientY: 66 }],
      });
      // A second finger joins — recorded, but without a point to attribute.
      context.emit("touchmove", {
        isTrusted: true,
        touches: { length: 2 },
        changedTouches: [{ clientX: 300, clientY: 500 }],
      });

      const active = detector.getResult();

      expect(active.sampleCounts).toMatchObject({
        mouseMoves: 1,
        scrolls: 1,
        keyPresses: 1,
        clicks: 1,
        touches: 3,
        syntheticEvents: 1,
      });

      detector.stop();

      expect(context.count("mousemove")).toBe(0);
      expect(context.count("wheel")).toBe(0);
      expect(context.count("keydown")).toBe(0);
      expect(context.count("click")).toBe(0);
      expect(context.count("touchstart")).toBe(0);
      expect(context.count("touchmove")).toBe(0);
      expect(context.count("touchstart")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not register duplicate listeners when started twice", () => {
    const context = createCapturingTarget();
    const detector = createBehavioralClientDetector({ context });

    detector.start();
    detector.start();

    expect(context.count("mousemove")).toBe(1);
    expect(context.count("wheel")).toBe(1);

    detector.stop();
  });

  it("can be created with the default global context", () => {
    const detector = createBehavioralClientDetector();

    expect(detector.getResult().sampleCounts.mouseMoves).toBe(0);
  });

  it("emits periodic updates, observes for a duration, and resets samples", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(0);
      const context = createCapturingTarget();
      const onUpdate = vi.fn();
      const detector = createBehavioralClientDetector({
        context,
        pollIntervalMs: 100,
        onUpdate,
      });

      const observed = detector.observe(250);

      vi.advanceTimersByTime(100);
      context.emit("mousemove", {
        clientX: 1,
        clientY: 1,
        isTrusted: true,
      });
      vi.advanceTimersByTime(150);

      await expect(observed).resolves.toMatchObject({
        observationMs: 250,
        sampleCounts: { mouseMoves: 1 },
      });
      expect(onUpdate).toHaveBeenCalledTimes(2);

      detector.reset();

      expect(detector.getResult().observationMs).toBe(0);
      expect(detector.getResult().sampleCounts.mouseMoves).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a concurrent observation and still resolves the first", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(0);
      const detector = createBehavioralClientDetector({
        context: createListenerTarget(),
      });

      const first = detector.observe(250);
      const second = detector.observe(250);

      await expect(second).rejects.toThrow(/in progress/);

      vi.advanceTimersByTime(250);
      await expect(first).resolves.toMatchObject({ observationMs: 250 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves an in-flight observation when stopped early", async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(0);
      const detector = createBehavioralClientDetector({
        context: createListenerTarget(),
      });

      const observed = detector.observe(10_000);
      vi.advanceTimersByTime(1_000);
      detector.stop();

      await expect(observed).resolves.toMatchObject({ observationMs: 1_000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops samples older than the retention window", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(0);
      const context = createCapturingTarget();
      const detector = createBehavioralClientDetector({
        context,
        sampleWindowMs: 1_000,
      });

      detector.start();
      context.emit("mousemove", { clientX: 1, clientY: 1, isTrusted: true });
      vi.advanceTimersByTime(500);
      context.emit("mousemove", { clientX: 2, clientY: 2, isTrusted: true });
      vi.advanceTimersByTime(1_000); // now t=1500, cutoff=500 drops the t=0 sample
      context.emit("mousemove", { clientX: 3, clientY: 3, isTrusted: true });

      expect(detector.getResult().sampleCounts.mouseMoves).toBe(2);

      detector.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops stale samples from inactive streams when scoring an active detector", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(0);
      const context = createCapturingTarget();
      const detector = createBehavioralClientDetector({
        context,
        sampleWindowMs: 1_000,
      });

      detector.start();
      context.emit("mousemove", { clientX: 1, clientY: 1, isTrusted: true });
      vi.advanceTimersByTime(70_000);

      expect(detector.getResult().sampleCounts.mouseMoves).toBe(0);

      detector.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps all active samples when retention is disabled", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(0);
      const context = createCapturingTarget();
      const detector = createBehavioralClientDetector({
        context,
        sampleWindowMs: Infinity,
      });

      detector.start();
      context.emit("mousemove", { clientX: 1, clientY: 1, isTrusted: true });
      vi.advanceTimersByTime(70_000);

      expect(detector.getResult().sampleCounts.mouseMoves).toBe(1);

      detector.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps stopped detector results frozen instead of aging samples out", () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(0);
      const context = createCapturingTarget();
      const detector = createBehavioralClientDetector({
        context,
        sampleWindowMs: 1_000,
      });

      detector.start();
      context.emit("mousemove", { clientX: 1, clientY: 1, isTrusted: true });
      vi.advanceTimersByTime(500);
      detector.stop();
      vi.advanceTimersByTime(70_000);

      expect(detector.getResult().sampleCounts.mouseMoves).toBe(1);
      expect(detector.getResult().observationMs).toBe(500);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("touch gesture analysis", () => {
  /** First point is the contact; the rest are the drag. */
  const swipe = (
    points: Array<{ x: number; y: number; t: number }>,
  ): TouchSample[] =>
    points.map((point, index) => ({
      ...point,
      isTrusted: true,
      kind: index === 0 ? ("start" as const) : ("move" as const),
    }));

  /** A dispatched swipe interpolates: perfectly straight, perfectly even. */
  const scriptedSwipe = (count = 12) =>
    swipe(
      Array.from({ length: count }, (_, index) => ({
        x: 100 + index * 20,
        y: 300,
        t: 1_000 + index * 16,
      })),
    );

  /** A finger arcs and its speed varies across the stroke. */
  const humanSwipe = () =>
    swipe(
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((index) => ({
        x: 100 + index * 17 + (index % 3) * 6,
        y: 300 + Math.round(Math.sin(index / 2) * 14),
        t: 1_000 + index * 16 + (index % 4) * 7,
      })),
    );

  it("flags an interpolated swipe and clears a human one", () => {
    expect(hasLinearTouchMovement(scriptedSwipe())).toBe(true);
    expect(hasLinearTouchMovement(humanSwipe())).toBe(false);
    expect(hasLinearTouchMovement([])).toBe(false);
    expect(hasLinearTouchMovement()).toBe(false);
  });

  it("flags a contact point that jumps mid-gesture", () => {
    expect(
      hasTeleportTouch(
        swipe([
          { x: 100, y: 300, t: 1_000 },
          { x: 900, y: 300, t: 1_010 },
        ]),
      ),
    ).toBe(true);
    expect(hasTeleportTouch(humanSwipe())).toBe(false);
  });

  it("does not read a finger lifting and landing elsewhere as a jump", () => {
    // Two separate taps far apart: each contact starts a fresh gesture.
    expect(
      hasTeleportTouch([
        { t: 1_000, isTrusted: true, kind: "start", x: 60, y: 100 },
        { t: 1_008, isTrusted: true, kind: "move", x: 62, y: 102 },
        { t: 1_012, isTrusted: true, kind: "start", x: 940, y: 700 },
        { t: 1_020, isTrusted: true, kind: "move", x: 942, y: 702 },
      ]),
    ).toBe(false);
  });

  it("ignores multi-finger points that carry no coordinates", () => {
    // Pinch: interleaved contacts recorded without coordinates.
    const pinch: TouchSample[] = Array.from({ length: 14 }, (_, index) => ({
      t: 1_000 + index * 16,
      isTrusted: true,
      kind: "move" as const,
    }));
    expect(hasLinearTouchMovement(pinch)).toBe(false);
    expect(hasTeleportTouch(pinch)).toBe(false);
  });

  it("flags metronome and superhuman tap rhythm", () => {
    const taps = (intervals: number[]): TouchSample[] => {
      let t = 1_000;
      return intervals.map((gap) => {
        t += gap;
        return { t, isTrusted: true, kind: "start" as const, x: 50, y: 50 };
      });
    };
    expect(hasLinearTapRhythm(taps([200, 200, 200, 200, 200]))).toBe(true);
    expect(hasLinearTapRhythm(taps([10, 12, 11, 9, 10]))).toBe(true);
    expect(hasLinearTapRhythm(taps([180, 340, 210, 95, 420]))).toBe(false);
    expect(hasLinearTapRhythm(taps([200, 200]))).toBe(false);
    expect(hasLinearTapRhythm()).toBe(false);
  });

  it("treats samples without a kind as contacts, as older payloads were", () => {
    const legacy: TouchSample[] = [200, 200, 200, 200, 200].map((gap, index) => ({
      t: 1_000 + gap * (index + 1),
      isTrusted: true,
    }));
    expect(hasLinearTapRhythm(legacy)).toBe(true);
    expect(hasLinearTouchMovement(legacy)).toBe(false);
    expect(hasTeleportTouch(legacy)).toBe(false);
  });

  it("scores a scripted swipe through the public API", () => {
    const result = analyzeBehavioralSamples({
      mouseMoves: [],
      scrolls: [],
      keyPresses: [],
      clicks: [],
      touches: scriptedSwipe(),
      observationMs: 5_000,
    });
    expect(result.signals.filter((signal) => signal.triggered).map((signal) => signal.id))
      .toContain("linear-touch-movement");
    expect(result.sampleCounts.touches).toBe(12);
  });

  it("leaves an ordinary touch session alone", () => {
    const result = analyzeBehavioralSamples({
      mouseMoves: [],
      scrolls: [],
      keyPresses: [],
      clicks: [{ x: 120, y: 400, t: 1_400, isTrusted: true, detail: 1 }],
      touches: humanSwipe(),
      observationMs: 5_000,
    });
    expect(result.suspicionScore).toBe(0);
    expect(result.isLegitClient).toBe(true);
  });
});
