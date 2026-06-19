import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "patchright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BROWSER_BUNDLE_PATH = path.join(ROOT, "dist/browser.js");

let cachedBrowserBundle: string | null = null;

function readBrowserBundle(): string {
  if (!cachedBrowserBundle) {
    cachedBrowserBundle = fs.readFileSync(BROWSER_BUNDLE_PATH, "utf-8");
  }
  return cachedBrowserBundle;
}

export const INSTANT_RESULT_KEYS = [
  "isWebDriver",
  "isPhantomJS",
  "isNightmare",
  "isSelenium",
  "isDomAutomation",
  "isHeadless",
  "isSuspiciousResolution",
  "isUserAgentValid",
  "isWebGLSupported",
  "isModern",
  "isMissingChromeObject",
  "isSoftwareRenderer",
  "isSuspiciousWindowDimensions",
  "isEmptyPlugins",
  "isAutomationArtifacts",
  "isSuspiciousWebDriverDescriptor",
  "isChromium",
  "isLegitClient",
] as const;

export type InstantBrowserResult = Record<(typeof INSTANT_RESULT_KEYS)[number], boolean>;

export interface PatchrightSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

/**
 * Patchright evaluates scripts in an isolated execution context (not the page's
 * main world). Load the browser bundle there so page.evaluate can call detection APIs.
 */
export async function injectDetectionBundle(page: Page): Promise<void> {
  const bundle = readBrowserBundle();
  const injected = await page.evaluate((code) => {
    const blob = new Blob([code], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const dynamicImport = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<Record<string, unknown>>;

    return dynamicImport(url)
      .then((detection) => {
        URL.revokeObjectURL(url);
        window.__detection = detection as HarnessWindow["__detection"];
        window.__harnessReady = true;
        const status = document.getElementById("status");
        if (status) {
          status.textContent = "ready";
        }
        return true;
      })
      .catch((error: unknown) => {
        URL.revokeObjectURL(url);
        throw error;
      });
  }, bundle);

  if (!injected) {
    throw new Error("Failed to inject detection bundle into patchright page");
  }
}

export async function navigateToHarness(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/harness`, { waitUntil: "networkidle" });
  await injectDetectionBundle(page);
}

export async function openHarnessPage(
  browser: Browser,
  baseUrl: string,
): Promise<PatchrightSession> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  const page = await context.newPage();
  await navigateToHarness(page, baseUrl);

  return { browser, context, page };
}

export async function runInstantDetection(page: Page): Promise<InstantBrowserResult> {
  return page.evaluate(async () => {
    const detection = window.__detection;
    return detection.detectInstantClient(window);
  });
}

export async function runInstantDetectionAsync(
  page: Page,
): Promise<InstantBrowserResult & { isShaderF16Supported: boolean | null }> {
  return page.evaluate(async () => {
    const detection = window.__detection;
    return detection.detectInstantClientAsync(window);
  });
}

export async function runBehavioralObserve(
  page: Page,
  durationMs: number,
  scoreThreshold = 0.55,
): Promise<{
  suspicionScore: number;
  isLegitClient: boolean;
  signals: Array<{ id: string; triggered: boolean }>;
}> {
  return page.evaluate(
    async ({ observeMs, threshold }) => {
      const detection = window.__detection;
      const detector = detection.createBehavioralClientDetector({
        context: window,
        scoreThreshold: threshold,
      });
      const result = await detector.observe(observeMs);
      return {
        suspicionScore: result.suspicionScore,
        isLegitClient: result.isLegitClient,
        signals: result.signals.map((signal) => ({
          id: signal.id,
          triggered: signal.triggered,
        })),
      };
    },
    { observeMs: durationMs, threshold: scoreThreshold },
  );
}

export async function linearMousePath(page: Page): Promise<void> {
  await page.mouse.move(10, 10);
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(step * 40, step * 20);
    await page.waitForTimeout(16);
  }
}

export async function organicMousePath(page: Page): Promise<void> {
  const points = [
    [12, 8],
    [34, 19],
    [61, 41],
    [95, 58],
    [130, 71],
    [178, 89],
    [220, 96],
  ] as const;

  await page.mouse.move(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(60 + Math.floor(Math.random() * 80));
  }
}

export async function teleportMouse(page: Page): Promise<void> {
  await page.mouse.move(10, 10);
  await page.mouse.move(900, 500);
}

export async function linearScroll(page: Page): Promise<void> {
  for (let step = 0; step < 6; step += 1) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(100);
  }
}

export async function organicScroll(page: Page): Promise<void> {
  const deltas = [120, 84, 210, 36, 160, 52];
  for (const delta of deltas) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(120 + Math.floor(Math.random() * 120));
  }
}

export async function linearTyping(page: Page): Promise<void> {
  await page.focus("#typing-target");
  await page.keyboard.type("automated-input", { delay: 50 });
}

export async function organicTyping(page: Page): Promise<void> {
  await page.focus("#typing-target");
  const chars = "hello world";
  for (const char of chars) {
    await page.keyboard.type(char, { delay: 80 + Math.floor(Math.random() * 120) });
  }
}

export function triggeredSignalIds(
  signals: Array<{ id: string; triggered: boolean }>,
): string[] {
  return signals.filter((signal) => signal.triggered).map((signal) => signal.id);
}

interface HarnessWindow extends Window {
  __harnessReady?: boolean;
  __detection: {
    detectInstantClient: (context: Window) => InstantBrowserResult;
    detectInstantClientAsync: (
      context: Window,
    ) => Promise<InstantBrowserResult & { isShaderF16Supported: boolean | null }>;
    createBehavioralClientDetector: (options: {
      context: Window;
      scoreThreshold?: number;
    }) => {
      observe: (ms: number) => Promise<{
        suspicionScore: number;
        isLegitClient: boolean;
        signals: Array<{ id: string; triggered: boolean }>;
      }>;
    };
  };
}

declare global {
  interface Window {
    __harnessReady?: boolean;
    __detection: HarnessWindow["__detection"];
  }
}
