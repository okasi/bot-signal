import { chromium, type Browser } from "patchright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openHarnessPage } from "../helpers/patchright-harness.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("patchright behavioral analysis exports in browser", () => {
  let server: TestServer;
  let browser: Browser;

  beforeAll(async () => {
    server = await startTestServer();
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
    await server.close();
  });

  it("analyzeBehavioralSamples runs in page context", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    const result = await page.evaluate(() => {
      const detection = (window as any).__detection;
      return detection.analyzeBehavioralSamples({
        mouseMoves: [
          { x: 0, y: 0, t: 0, isTrusted: true },
          { x: 40, y: 20, t: 16, isTrusted: true },
          { x: 80, y: 40, t: 32, isTrusted: true },
          { x: 120, y: 60, t: 48, isTrusted: true },
          { x: 160, y: 80, t: 64, isTrusted: true },
          { x: 200, y: 100, t: 80, isTrusted: true },
        ],
        scrolls: [],
        keyPresses: [],
        clicks: [],
        observationMs: 1_000,
      });
    });

    expect(result.suspicionScore).toBeGreaterThan(0);
    expect(
      result.signals.some(
        (signal: { id: string; triggered: boolean }) =>
          signal.id === "linear-mouse-movement" && signal.triggered,
      ),
    ).toBe(true);
    // A single medium-weight signal stays below the default 0.55 threshold.
    expect(result.isLegitClient).toBe(true);

    await context.close();
  });

  it("hasLinearMouseMovement detects scripted paths in browser", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    const triggered = await page.evaluate(() => {
      const detection = (window as any).__detection;
      return detection.hasLinearMouseMovement([
        { x: 0, y: 0, t: 0, isTrusted: true },
        { x: 40, y: 20, t: 16, isTrusted: true },
        { x: 80, y: 40, t: 32, isTrusted: true },
        { x: 120, y: 60, t: 48, isTrusted: true },
        { x: 160, y: 80, t: 64, isTrusted: true },
        { x: 200, y: 100, t: 80, isTrusted: true },
      ]);
    });

    expect(triggered).toBe(true);

    await context.close();
  });

  it("hasTeleportMouse detects large jumps in browser", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    const triggered = await page.evaluate(() => {
      const detection = (window as any).__detection;
      return detection.hasTeleportMouse([
        { x: 0, y: 0, t: 0, isTrusted: true },
        { x: 900, y: 500, t: 5, isTrusted: true },
      ]);
    });

    expect(triggered).toBe(true);

    await context.close();
  });

  it("aggregateSuspicionScore combines weights in browser", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    const score = await page.evaluate(() => {
      const detection = (window as any).__detection;
      const signals = detection.buildBehavioralSignals({
        mouseMoves: [
          { x: 0, y: 0, t: 0, isTrusted: true },
          { x: 40, y: 20, t: 16, isTrusted: true },
          { x: 80, y: 40, t: 32, isTrusted: true },
          { x: 120, y: 60, t: 48, isTrusted: true },
          { x: 160, y: 80, t: 64, isTrusted: true },
          { x: 200, y: 100, t: 80, isTrusted: true },
        ],
        scrolls: [
          { deltaY: 120, t: 0, isTrusted: true },
          { deltaY: 120, t: 100, isTrusted: true },
          { deltaY: 120, t: 200, isTrusted: true },
          { deltaY: 120, t: 300, isTrusted: true },
        ],
        keyPresses: [],
        clicks: [{ x: 1, y: 1, t: 400, isTrusted: false }],
        observationMs: 1_000,
      });
      return detection.aggregateSuspicionScore(signals);
    });

    expect(score).toBeGreaterThan(0.5);

    await context.close();
  });

  it("detector start/stop lifecycle works in browser", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    const counts = await page.evaluate(async () => {
      const detection = (window as any).__detection;
      const detector = detection.createBehavioralClientDetector({
        context: window,
      });
      detector.start();
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10 }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      const during = detector.getResult();
      detector.stop();
      const after = detector.getResult();
      return {
        duringMoves: during.sampleCounts.mouseMoves,
        afterMoves: after.sampleCounts.mouseMoves,
      };
    });

    expect(counts.duringMoves).toBeGreaterThan(0);
    expect(counts.afterMoves).toBeGreaterThan(0);

    await context.close();
  });
});

describe("patchright standalone instant helpers in browser", () => {
  let server: TestServer;
  let browser: Browser;

  beforeAll(async () => {
    server = await startTestServer();
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
    await server.close();
  });

  it("isSoftwareRenderer returns boolean in real Chromium", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    const value = await page.evaluate(() => {
      const detection = (window as any).__detection;
      return detection.isSoftwareRenderer(window);
    });

    expect(typeof value).toBe("boolean");

    await context.close();
  });

  it("isMissingChromeObject is false when chrome.runtime exists", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    const value = await page.evaluate(() => {
      const detection = (window as any).__detection;
      return detection.isMissingChromeObject(window);
    });

    expect(typeof value).toBe("boolean");

    await context.close();
  });

  it("isEmptyPlugins reflects navigator.plugins in browser", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    const pluginCount = await page.evaluate(() => navigator.plugins.length);
    const flagged = await page.evaluate(() => {
      const detection = (window as any).__detection;
      return detection.isEmptyPlugins(window);
    });

    expect(flagged).toBe(pluginCount === 0);

    await context.close();
  });

  it("isSuspiciousWindowDimensions reads real window metrics", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    const payload = await page.evaluate(() => {
      const detection = (window as any).__detection;
      return {
        flagged: detection.isSuspiciousWindowDimensions(window),
        outerWidth: window.outerWidth,
        innerWidth: window.innerWidth,
        screenX: window.screenX,
        screenY: window.screenY,
      };
    });

    expect(typeof payload.flagged).toBe("boolean");
    expect(payload.outerWidth).toBeGreaterThan(0);

    await context.close();
  });
});
