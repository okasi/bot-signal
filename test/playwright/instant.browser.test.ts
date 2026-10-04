import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestServer, type TestServer } from "../helpers/test-server.js";
import type { InstantClientAsyncResult, InstantClientResult } from "../../src/types.js";

interface PageDetection {
  sync: InstantClientResult;
  async: InstantClientAsyncResult;
  isHuman: boolean;
  isHumanAsync: boolean;
}

// The detector runs from ordinary page scripts. Playwright only reads the
// completed result from the DOM, so its evaluate stack cannot affect detection.
const DETECTION_PAGE = `<!doctype html>
<html><head><script src="/dist/browser.global.js"></script></head><body>
<script>
void (async () => {
  try {
    const detection = {
      sync: BotSignal.detectInstantClient(window),
      async: await BotSignal.detectInstantClientAsync(window),
      isHuman: BotSignal.isHuman(window),
      isHumanAsync: await BotSignal.isHumanAsync(window),
    };
    document.documentElement.setAttribute("data-result", JSON.stringify(detection));
  } catch (error) {
    document.documentElement.setAttribute("data-result", JSON.stringify({ error: String(error) }));
  }
})();
</script></body></html>`;

async function detectInPage(browser: Browser | BrowserContext, baseUrl: string): Promise<PageDetection> {
  const page = await browser.newPage();
  try {
    await page.route("**/playwright-detection", (route) =>
      route.fulfill({ contentType: "text/html", body: DETECTION_PAGE }),
    );
    await page.goto(`${baseUrl}/playwright-detection`);
    const root = page.locator("html[data-result]");
    await root.waitFor();
    const result = JSON.parse((await root.getAttribute("data-result"))!);
    expect(result.error).toBeUndefined();
    return result;
  } finally {
    await page.close();
  }
}

describe("actual Playwright Chromium detection in page scripts", () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it.each([true, false])("detects stock Chromium with headless=%s", async (headless) => {
    const browser = await chromium.launch({ headless });
    try {
      const result = await detectInPage(browser, server.baseUrl);
      for (const verdict of [result.sync, result.async]) {
        expect(verdict.isWebDriver).toBe(true);
        expect(verdict.isLegitClient).toBe(false);
        expect(verdict.suspicionScore).toBe(1);
        expect(verdict.automation.isAutomated).toBe(true);
        expect(verdict.automation.kind).toBe("browser-automation");
        expect(verdict.automation.alternatives).toContain("playwright");
      }
      expect(result.isHuman).toBe(false);
      expect(result.isHumanAsync).toBe(false);
      console.info(JSON.stringify({
        chromium: browser.version(), headless,
        isHuman: result.isHuman, isHumanAsync: result.isHumanAsync,
        webdriver: result.sync.isWebDriver, score: result.sync.suspicionScore,
        automation: result.sync.automation,
      }));
    } finally {
      await browser.close();
    }
  });

  it("attributes an actual Playwright exposed binding", async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    try {
      await context.exposeBinding("testBinding", () => "ready");
      const result = await detectInPage(context, server.baseUrl);
      for (const verdict of [result.sync, result.async]) {
        expect(verdict.isPlaywright).toBe(true);
        expect(verdict.isLegitClient).toBe(false);
        expect(verdict.automation.kind).toBe("playwright");
      }
      expect(result.isHuman).toBe(false);
      expect(result.isHumanAsync).toBe(false);
    } finally {
      await context.close();
      await browser.close();
    }
  });

  it("shows automation in the demo and copies the actual detection details", async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    try {
      const page = await context.newPage();
      await page.route("**/docs/browser.js*", (route) => route.fulfill({
        path: fileURLToPath(new URL("../../dist/browser.js", import.meta.url)),
        contentType: "text/javascript",
      }));
      await page.goto(`${server.baseUrl}/docs/index.html`);
      await page.locator("#instant-banner.banner--bad").waitFor();
      expect(await page.locator("#hero-verdict-text").textContent()).toBe("Automation suspected");
      await page.getByRole("button", { name: "Copy detection details" }).click();
      await page.locator("#copy-detection.is-copied").waitFor();
      const details = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
      expect(details.version).toBeTruthy();
      expect(details.navigator.webdriver).toBe(true);
      expect(details.result.isLegitClient).toBe(false);
      expect(details.result.automation.isAutomated).toBe(true);
      expect(details.result.automation.alternatives).toContain("playwright");
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
