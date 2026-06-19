import { describe, expect, it } from "vitest";
import {
  analyzeBehavioralSamples,
  aggregateSuspicionScore,
  buildBehavioralSignals,
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

describe("behavioral analysis", () => {
  it("detects linear mouse movement", () => {
    expect(hasLinearMouseMovement(createLinearMouseMoves())).toBe(true);
    expect(hasLinearMouseMovement(createHumanMouseMoves())).toBe(false);
  });

  it("detects teleport mouse movement", () => {
    const moves: MouseSample[] = [
      { x: 0, y: 0, t: 0, isTrusted: true },
      { x: 800, y: 500, t: 10, isTrusted: true },
    ];

    expect(hasTeleportMouse(moves)).toBe(true);
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

  it("detects no mouse activity with clicks", () => {
    expect(hasNoMouseActivity([], [{ x: 1, y: 1, t: 0, isTrusted: true }])).toBe(
      true,
    );
  });

  it("detects linear scroll patterns", () => {
    expect(hasLinearScroll(createLinearScrolls())).toBe(true);
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

  it("detects synthetic events", () => {
    expect(
      hasSyntheticEvents(
        createSamples({
          clicks: [{ x: 1, y: 1, t: 0, isTrusted: false }],
        }),
      ),
    ).toBe(true);
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
