import { describe, expect, it, vi } from "vitest";
import {
  analyzeBehavioralSamples,
  aggregateSuspicionScore,
  buildBehavioralSignals,
  createBehavioralClientDetector,
  hasClickWithoutMouseMovement,
  hasLinearMouseMovement,
  hasLinearScroll,
  hasLinearTyping,
  hasNoMouseActivity,
  hasSyntheticEvents,
  hasTeleportMouse,
} from "../src/behavioral/index.js";
import type {
  BehavioralSamples,
  ClickSample,
  ExtendedWindow,
  KeySample,
  MouseSample,
  ScrollSample,
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
      context.emit("touchstart", { isTrusted: true });

      const active = detector.getResult();

      expect(active.sampleCounts).toMatchObject({
        mouseMoves: 1,
        scrolls: 1,
        keyPresses: 1,
        clicks: 1,
        touches: 1,
        syntheticEvents: 1,
      });

      detector.stop();

      expect(context.count("mousemove")).toBe(0);
      expect(context.count("wheel")).toBe(0);
      expect(context.count("keydown")).toBe(0);
      expect(context.count("click")).toBe(0);
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
