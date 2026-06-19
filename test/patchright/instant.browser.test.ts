import { chromium, type Browser } from "patchright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  INSTANT_RESULT_KEYS,
  openHarnessPage,
  runInstantDetection,
} from "../helpers/patchright-harness.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("patchright instant detection — real browser context", () => {
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

  it("loads the harness and exposes the detection API", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    const api = await page.evaluate(() => Object.keys((window as any).__detection).sort());

    expect(api).toContain("detectInstantClient");
    expect(api).toContain("detectInstantClientAsync");
    expect(api).toContain("createBehavioralClientDetector");

    await context.close();
  });

  it("returns every instant result field", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runInstantDetection(page);

    for (const key of INSTANT_RESULT_KEYS) {
      expect(typeof result[key]).toBe("boolean");
    }

    await context.close();
  });

  it("reports a valid Chromium user agent", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runInstantDetection(page);

    expect(result.isUserAgentValid).toBe(true);
    expect(result.isChromium).toBe(true);

    await context.close();
  });

  it("supports WebGL in patchright Chromium", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runInstantDetection(page);

    expect(result.isWebGLSupported).toBe(true);

    await context.close();
  });

  it("does not flag phantom or nightmare markers in a clean session", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runInstantDetection(page);

    expect(result.isPhantomJS).toBe(false);
    expect(result.isNightmare).toBe(false);
    expect(result.isSelenium).toBe(false);

    await context.close();
  });

  it("does not expose navigator.webdriver in patchright by default", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    const webdriver = await page.evaluate(() => navigator.webdriver);
    const result = await runInstantDetection(page);

    expect(webdriver).toBeFalsy();
    expect(result.isWebDriver).toBe(false);
    expect(result.isHeadless).toBe(false);

    await context.close();
  });

  it("uses a modern Chrome user agent version", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runInstantDetection(page);

    expect(result.isModern).toBe(true);

    await context.close();
  });

  it("has a non-suspicious viewport in the default context", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runInstantDetection(page);

    expect(result.isSuspiciousResolution).toBe(false);

    await context.close();
  });

  it("serializes instant results to JSON without loss", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runInstantDetection(page);
    const roundTrip = JSON.parse(JSON.stringify(result));

    expect(roundTrip).toEqual(result);

    await context.close();
  });

  it.skipIf(!!process.env.CI)("headed patchright still runs instant detection", async () => {
    const headed = await chromium.launch({ headless: false });
    const { context, page } = await openHarnessPage(headed, server.baseUrl);
    const result = await runInstantDetection(page);

    expect(result.isUserAgentValid).toBe(true);
    expect(typeof result.isLegitClient).toBe("boolean");

    await context.close();
    await headed.close();
  });

  it("headless shell reports window dimensions", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const dimensions = await page.evaluate(() => ({
      outerWidth: window.outerWidth,
      innerWidth: window.innerWidth,
      screenX: window.screenX,
      screenY: window.screenY,
    }));

    expect(dimensions.outerWidth).toBeGreaterThan(0);
    expect(dimensions.innerWidth).toBeGreaterThan(0);

    await context.close();
  });

  it("default export matches detectInstantClient", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    const matches = await page.evaluate(() => {
      const detection = (window as any).__detection;
      return JSON.stringify(detection.default(window)) ===
        JSON.stringify(detection.detectInstantClient(window));
    });

    expect(matches).toBe(true);

    await context.close();
  });
});
