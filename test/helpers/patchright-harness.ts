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
  return runBehavioralScenario(page, "idle", durationMs, scoreThreshold);
}

export type BehavioralScenario =
  | "idle"
  | "linear-mouse"
  | "teleport-mouse"
  | "linear-scroll"
  | "linear-typing"
  | "click-without-mouse"
  | "synthetic-click"
  | "robotic-combo"
  | "organic-combo";

export async function runBehavioralScenario(
  page: Page,
  scenario: BehavioralScenario,
  observeMs: number,
  scoreThreshold = 0.55,
): Promise<{
  suspicionScore: number;
  isLegitClient: boolean;
  signals: Array<{ id: string; triggered: boolean }>;
  sampleCounts?: {
    mouseMoves: number;
    scrolls: number;
    keyPresses: number;
    clicks: number;
  };
  observationMs?: number;
}> {
  return page.evaluate(
    async ({ activeScenario, durationMs, threshold }) => {
      const detection = window.__detection;
      const detector = detection.createBehavioralClientDetector({
        context: window,
        scoreThreshold: threshold,
      });

      const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

      const dispatchMouseMove = (x: number, y: number) => {
        window.dispatchEvent(
          new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }),
        );
      };

      const dispatchWheel = (deltaY: number) => {
        window.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true }));
      };

      const dispatchKeyDown = () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
      };

      const dispatchClick = (x: number, y: number) => {
        const target = document.getElementById("click-target") ?? window;
        target.dispatchEvent(
          new MouseEvent("click", { clientX: x, clientY: y, bubbles: true }),
        );
      };

      detector.start();

      switch (activeScenario) {
        case "linear-mouse":
          for (let step = 1; step <= 12; step += 1) {
            dispatchMouseMove(step * 40, step * 20);
            await sleep(16);
          }
          break;
        case "teleport-mouse":
          dispatchMouseMove(10, 10);
          await sleep(5);
          dispatchMouseMove(900, 500);
          break;
        case "linear-scroll":
          for (let step = 0; step < 6; step += 1) {
            dispatchWheel(120);
            await sleep(100);
          }
          break;
        case "linear-typing":
          for (const _char of "automated-input") {
            dispatchKeyDown();
            await sleep(50);
          }
          break;
        case "click-without-mouse":
          dispatchClick(120, 80);
          break;
        case "synthetic-click":
          dispatchClick(120, 80);
          break;
        case "robotic-combo":
          for (let step = 1; step <= 12; step += 1) {
            dispatchMouseMove(step * 40, step * 20);
            await sleep(16);
          }
          for (let step = 0; step < 6; step += 1) {
            dispatchWheel(120);
            await sleep(100);
          }
          for (const _char of "automated-input") {
            dispatchKeyDown();
            await sleep(50);
          }
          dispatchClick(120, 80);
          break;
        case "organic-combo": {
          const mousePoints = [
            [12, 8],
            [34, 19],
            [61, 41],
            [95, 58],
            [130, 71],
            [178, 89],
            [220, 96],
          ] as const;
          for (const [x, y] of mousePoints) {
            dispatchMouseMove(x, y);
            await sleep(60 + Math.floor(Math.random() * 80));
          }
          for (const delta of [120, 84, 210, 36, 160, 52]) {
            dispatchWheel(delta);
            await sleep(120 + Math.floor(Math.random() * 120));
          }
          for (const _char of "hello world") {
            dispatchKeyDown();
            await sleep(80 + Math.floor(Math.random() * 120));
          }
          break;
        }
        case "idle":
          break;
        default: {
          const neverScenario: never = activeScenario;
          throw new Error(`Unknown scenario: ${neverScenario}`);
        }
      }

      await sleep(durationMs);
      detector.stop();
      const result = detector.getResult();

      return {
        suspicionScore: result.suspicionScore,
        isLegitClient: result.isLegitClient,
        signals: result.signals.map((signal) => ({
          id: signal.id,
          triggered: signal.triggered,
        })),
        sampleCounts: result.sampleCounts,
        observationMs: result.observationMs,
      };
    },
    { activeScenario: scenario, durationMs: observeMs, threshold: scoreThreshold },
  );
}

/** @deprecated Patchright isolated context ignores Playwright mouse APIs — use runBehavioralScenario */
export async function linearMousePath(page: Page): Promise<void> {
  await runBehavioralScenario(page, "linear-mouse", 0);
}

/** @deprecated Use runBehavioralScenario */
export async function organicMousePath(page: Page): Promise<void> {
  await runBehavioralScenario(page, "organic-combo", 0);
}

/** @deprecated Use runBehavioralScenario */
export async function teleportMouse(page: Page): Promise<void> {
  await runBehavioralScenario(page, "teleport-mouse", 0);
}

/** @deprecated Use runBehavioralScenario */
export async function linearScroll(page: Page): Promise<void> {
  await runBehavioralScenario(page, "linear-scroll", 0);
}

/** @deprecated Use runBehavioralScenario */
export async function organicScroll(page: Page): Promise<void> {
  await runBehavioralScenario(page, "organic-combo", 0);
}

/** @deprecated Use runBehavioralScenario */
export async function linearTyping(page: Page): Promise<void> {
  await runBehavioralScenario(page, "linear-typing", 0);
}

/** @deprecated Use runBehavioralScenario */
export async function organicTyping(page: Page): Promise<void> {
  await runBehavioralScenario(page, "organic-combo", 0);
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
