import { chromium, type Browser } from "patchright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  navigateToHarness,
  openHarnessPage,
  runInstantDetection,
} from "../helpers/patchright-harness.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("patchright instant detection — injected automation markers", () => {
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

  it("flags navigator.webdriver when forced on", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    await page.evaluate(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => true,
        configurable: true,
      });
    });

    const result = await runInstantDetection(page);

    expect(result.isWebDriver).toBe(true);
    expect(result.isHeadless).toBe(true);
    expect(result.isLegitClient).toBe(false);

    await context.close();
  });

  it("flags Playwright artifact injection", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    await page.evaluate(() => {
      (window as any).__playwright = { version: "test" };
    });

    const result = await runInstantDetection(page);

    expect(result.isAutomationArtifacts).toBe(true);
    expect(result.isLegitClient).toBe(false);

    await context.close();
  });

  it("flags ChromeDriver cdc document markers", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    await page.evaluate(() => {
      (document as any).$cdc_adoQpoasnfa76pfcZLmcfl_ = true;
    });

    const result = await runInstantDetection(page);

    expect(result.isAutomationArtifacts).toBe(true);
    expect(result.isLegitClient).toBe(false);

    await context.close();
  });

  it("flags Selenium document markers", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    await page.evaluate(() => {
      (document as any).__selenium_unwrapped = true;
    });

    const result = await runInstantDetection(page);

    expect(result.isSelenium).toBe(true);
    expect(result.isLegitClient).toBe(false);

    await context.close();
  });

  it("flags PhantomJS globals", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    await page.evaluate(() => {
      (window as any).callPhantom = () => {};
    });

    const result = await runInstantDetection(page);

    expect(result.isPhantomJS).toBe(true);
    expect(result.isLegitClient).toBe(false);

    await context.close();
  });

  it("flags Nightmare.js marker", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    await page.evaluate(() => {
      (window as any).__nightmare = true;
    });

    const result = await runInstantDetection(page);

    expect(result.isNightmare).toBe(true);
    expect(result.isLegitClient).toBe(false);

    await context.close();
  });

  it("flags invalid user agent strings", async () => {
    const context = await browser.newContext({
      userAgent: "python-requests/2.31.0",
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await navigateToHarness(page, server.baseUrl);

    const result = await runInstantDetection(page);

    expect(result.isUserAgentValid).toBe(false);
    expect(result.isLegitClient).toBe(false);

    await context.close();
  });

  it("flags suspicious tiny viewport", async () => {
    const context = await browser.newContext({
      viewport: { width: 100, height: 100 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    await navigateToHarness(page, server.baseUrl);

    const result = await runInstantDetection(page);

    expect(result.isSuspiciousResolution).toBe(true);
    expect(result.isLegitClient).toBe(false);

    await context.close();
  });

  it("treats missing window.chrome as a soft, non-blocking signal", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    await page.evaluate(() => {
      delete (window as any).chrome;
    });

    const result = await runInstantDetection(page);
    const strict = await runInstantDetection(page, { scoreThreshold: 0.3 });
    const signal = result.signals.find((s) => s.id === "isMissingChromeObject");

    expect(result.isMissingChromeObject).toBe(true);
    expect(signal?.triggered).toBe(true);
    // Weighted below the default threshold — no longer a hard block on its own
    // (headless may still cross 0.5 once WebGL absence stacks on top).
    expect(signal?.weight).toBeLessThan(0.5);
    expect(strict.isLegitClient).toBe(false);

    await context.close();
  });

  it("flags headless user agent substring", async () => {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/121.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await navigateToHarness(page, server.baseUrl);

    const result = await runInstantDetection(page);

    expect(result.isHeadless).toBe(true);
    expect(result.isLegitClient).toBe(false);

    await context.close();
  });

  it("flags DOM automation controller globals", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    await page.evaluate(() => {
      (window as any).domAutomationController = {};
    });

    const result = await runInstantDetection(page);

    expect(result.isDomAutomation).toBe(true);
    expect(result.isLegitClient).toBe(false);

    await context.close();
  });

  it("treats empty plugins as a soft, non-blocking signal", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    await page.evaluate(() => {
      Object.defineProperty(navigator, "plugins", {
        get: () => ({ length: 0 }),
        configurable: true,
      });
    });

    const result = await runInstantDetection(page);
    const strict = await runInstantDetection(page, { scoreThreshold: 0.2 });
    const signal = result.signals.find((s) => s.id === "isEmptyPlugins");

    expect(result.isEmptyPlugins).toBe(true);
    expect(signal?.triggered).toBe(true);
    expect(signal?.weight).toBeLessThan(0.5);
    expect(strict.isLegitClient).toBe(false);

    await context.close();
  });
});
