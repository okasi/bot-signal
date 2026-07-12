import { chromium, type Browser } from "patchright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  openHarnessPage,
  runMainWorldInstantDetectionAsync,
  runInstantDetection,
  runInstantDetectionAsync,
} from "../helpers/patchright-harness.js";
import { startTestServer, type TestServer } from "../helpers/test-server.js";

describe("patchright async instant detection", () => {
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

  it("runs detectInstantClientAsync without throwing", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runInstantDetectionAsync(page);

    expect(typeof result.isShaderF16Supported).not.toBe("undefined");
    expect(typeof result.isLegitClient).toBe("boolean");

    await context.close();
  });

  it("reports shader-f16 support state on Chromium", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runInstantDetectionAsync(page);

    expect(result.isChromium).toBe(true);
    expect(
      result.isShaderF16Supported === true ||
        result.isShaderF16Supported === false,
    ).toBe(true);

    await context.close();
  });

  it("keeps a Patchright-like isolated-world pattern framework-agnostic", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runInstantDetectionAsync(page);

    expect(result.isLegitClient).toBe(false);
    expect(result.automation.kind).toBe("browser-automation");
    expect(result.automation.alternatives).toContain("playwright");

    await context.close();
  });

  it("classifies Patchright-launched headless Chromium generically in the main world", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runMainWorldInstantDetectionAsync(page);

    expect(result.isLegitClient).toBe(false);
    expect(result.isHeadless).toBe(true);
    expect(result.isUserAgentDataMismatch).toBe(false);
    expect(result.automation.kind).toBe("browser-automation");
    expect(result.automation.alternatives).toContain("patchright");

    await context.close();
  });

  it("async and sync instant checks agree on core flags", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const sync = await runInstantDetection(page);
    const asyncResult = await runInstantDetectionAsync(page);

    expect(asyncResult.isWebDriver).toBe(sync.isWebDriver);
    expect(asyncResult.isChromium).toBe(sync.isChromium);
    expect(asyncResult.isUserAgentValid).toBe(sync.isUserAgentValid);
    expect(asyncResult.isWebGLSupported).toBe(sync.isWebGLSupported);

    await context.close();
  });

  it("checkShaderF16Support resolves in browser context", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    const supported = await page.evaluate(async () => {
      const detection = (window as any).__detection;
      return detection.checkShaderF16Support(window);
    });

    expect(typeof supported).toBe("boolean");

    await context.close();
  });
});

describe("patchright vs stealth expectations", () => {
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

  it("records patchright baseline instant result for regression tracking", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runInstantDetection(page);

    expect(result.isWebDriver).toBe(false);
    expect(result.isAutomationArtifacts).toBe(false);
    expect(result.isUserAgentValid).toBe(true);
    // WebGL availability is environment-dependent in headless Chromium 139+
    const probe = await page.evaluate(() =>
      Boolean(document.createElement("canvas").getContext("webgl")),
    );
    expect(result.isWebGLSupported).toBe(probe);

    await context.close();
  });

  it("patchright channel chrome launches and detects", async () => {
    const chrome = await chromium.launch({
      headless: true,
      channel: "chromium",
    });
    const { context, page } = await openHarnessPage(chrome, server.baseUrl);
    const result = await runInstantDetection(page);

    expect(result.isChromium).toBe(true);
    expect(typeof result.isLegitClient).toBe("boolean");

    await context.close();
    await chrome.close();
  });

  it("isChromiumBrowser helper agrees with instant result", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);

    const agrees = await page.evaluate(() => {
      const detection = (window as any).__detection;
      const result = detection.detectInstantClient(window);
      return detection.isChromiumBrowser(window) === result.isChromium;
    });

    expect(agrees).toBe(true);

    await context.close();
  });

  it("isAutomationArtifacts is false in unmodified patchright session", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runInstantDetection(page);

    expect(result.isAutomationArtifacts).toBe(false);

    await context.close();
  });

  it("isSuspiciousWebDriverDescriptor is false in patchright session", async () => {
    const { context, page } = await openHarnessPage(browser, server.baseUrl);
    const result = await runInstantDetection(page);

    expect(result.isSuspiciousWebDriverDescriptor).toBe(false);

    await context.close();
  });
});
