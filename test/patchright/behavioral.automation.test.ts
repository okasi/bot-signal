import { chromium, type Browser } from "patchright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  openHarnessPage,
  runBehavioralScenario,
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
});
