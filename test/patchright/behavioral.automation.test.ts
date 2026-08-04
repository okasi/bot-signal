import { chromium, type Browser } from "patchright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  openHarnessPage,
  runBehavioralScenario,
  runMainWorldInstantDetectionAsync,
  triggeredSignalIds,
} from "../helpers/patchright-harness.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("patchright behavioral detection — automated interaction patterns", () => {
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

  it("flags linear mouse movement as suspicious", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runBehavioralScenario(page, "linear-mouse", 500);

    expect(triggeredSignalIds(result.signals)).toContain("linear-mouse-movement");
    expect(result.isLegitClient).toBe(false);

    await context.close();
  });

  it("flags teleport mouse jumps", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runBehavioralScenario(page, "teleport-mouse", 500);

    expect(triggeredSignalIds(result.signals)).toContain("teleport-mouse");

    await context.close();
  });

  it("flags linear scroll patterns", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runBehavioralScenario(page, "linear-scroll", 500);

    expect(triggeredSignalIds(result.signals)).toContain("linear-scroll");
    expect(result.isLegitClient).toBe(false);

    await context.close();
  });

  it("flags robotic typing intervals", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runBehavioralScenario(page, "linear-typing", 500);

    expect(triggeredSignalIds(result.signals)).toContain("linear-typing");
    expect(result.isLegitClient).toBe(false);

    await context.close();
  });

  it("flags click without preceding mouse movement", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runBehavioralScenario(page, "click-without-mouse", 500);

    expect(triggeredSignalIds(result.signals)).toContain(
      "click-without-mouse-movement",
    );

    await context.close();
  });

  it("flags synthetic untrusted pointer events", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runBehavioralScenario(page, "synthetic-click", 500);

    expect(triggeredSignalIds(result.signals)).toContain("synthetic-events");

    await context.close();
  });

  it("combines multiple robotic signals into a high score", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runBehavioralScenario(page, "robotic-combo", 500);

    expect(result.suspicionScore).toBeGreaterThan(0.7);
    expect(result.isLegitClient).toBe(false);

    await context.close();
  });

  it("organic mouse and scroll stays below threshold", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runBehavioralScenario(page, "organic-combo", 1_500);

    expect(result.suspicionScore).toBeLessThan(0.55);
    expect(result.isLegitClient).toBe(true);

    await context.close();
  });

  it("returns sample counts after observation", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runBehavioralScenario(page, "linear-mouse", 500);

    expect(result.sampleCounts?.mouseMoves).toBeGreaterThan(0);
    expect(result.observationMs).toBeGreaterThan(0);

    await context.close();
  });

  it("matches the CDP coordinate signal to trusted main-world event geometry", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    await runMainWorldInstantDetectionAsync(page);

    await page.evaluate(() => {
      const runner = document.createElement("script");
      runner.textContent = `(() => {
        const samples = [];
        window.__botSignalCoordinateSamples = samples;
        window.addEventListener("mousemove", (event) => {
          samples.push({
            pageX: event.pageX,
            pageY: event.pageY,
            screenX: event.screenX,
            screenY: event.screenY,
            isTrusted: event.isTrusted,
            isFullscreen: window.outerHeight - window.innerHeight <= 1,
          });
        }, { capture: true });
        const detector = window.BotSignal.createBehavioralClientDetector({ context: window });
        window.__botSignalCoordinateDetector = detector;
        detector.start();
      })();`;
      document.head.append(runner);
      runner.remove();
    });

    await page.mouse.move(100, 120);
    await page.mouse.move(240, 260);

    const attribute = "data-cdp-coordinate-result";
    await page.evaluate((resultAttribute) => {
      const runner = document.createElement("script");
      runner.textContent = `(() => {
        const detector = window.__botSignalCoordinateDetector;
        const result = detector.getResult();
        detector.stop();
        const signal = result.signals.find(({ id }) => id === "cdp-input-coordinate-leak");
        document.documentElement.setAttribute(
          ${JSON.stringify(resultAttribute)},
          JSON.stringify({
            samples: window.__botSignalCoordinateSamples,
            triggered: Boolean(signal && signal.triggered),
          }),
        );
      })();`;
      document.head.append(runner);
      runner.remove();
    }, attribute);

    const serialized = await page.locator("html").getAttribute(attribute);
    const payload = JSON.parse(serialized ?? "null") as {
      samples: Array<{
        pageX: number;
        pageY: number;
        screenX: number;
        screenY: number;
        isTrusted: boolean;
        isFullscreen: boolean;
      }>;
      triggered: boolean;
    };
    expect(payload.samples.length).toBeGreaterThanOrEqual(2);
    expect(payload.samples.every(({ isTrusted }) => isTrusted)).toBe(true);
    expect(
      new Set(
        payload.samples.map((sample) => `${sample.pageX},${sample.pageY}`),
      ).size,
    ).toBeGreaterThanOrEqual(2);
    const leakedPositions = new Set(
      payload.samples
        .filter(
          (sample) =>
            sample.isTrusted &&
            !sample.isFullscreen &&
            sample.pageX === sample.screenX &&
            sample.pageY === sample.screenY,
        )
        .map((sample) => `${sample.pageX},${sample.pageY}`),
    );
    expect(payload.triggered).toBe(leakedPositions.size >= 2);

    await context.close();
  });
});
