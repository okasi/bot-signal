/**
 * Renders the social preview card to `docs/og.png` (1200x630).
 *
 * Run manually after changing the card — the PNG is committed, so the normal
 * site build stays dependency-free:
 *   npx tsx scripts/build-og-image.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "patchright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(ROOT, "docs/og.png");
const icon = fs.readFileSync(path.join(ROOT, "docs/icon.svg"), "utf-8");

const card = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; margin: 0; }
      body {
        width: 1200px;
        height: 630px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 30px;
        padding: 78px 84px;
        background: #0d0d0d;
        background-image:
          radial-gradient(50rem 26rem at 8% -10%, rgba(57, 135, 229, 0.28), transparent 62%),
          radial-gradient(38rem 22rem at 98% 10%, rgba(57, 135, 229, 0.18), transparent 66%);
        color: #ffffff;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .brand { display: flex; align-items: center; gap: 16px; }
      .brand svg { width: 54px; height: 54px; color: #3987e5; }
      .brand span {
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        font-size: 34px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      h1 {
        font-size: 74px;
        line-height: 1.06;
        letter-spacing: -0.03em;
        font-weight: 760;
        max-width: 17ch;
      }
      h1 em { font-style: normal; color: #6da7ec; }
      p { font-size: 29px; line-height: 1.45; color: #c3c2b7; max-width: 30ch; }
      .tags { display: flex; gap: 12px; margin-top: 8px; }
      .tags span {
        padding: 9px 20px;
        border: 1px solid #2c2c2a;
        border-radius: 999px;
        background: #1a1a19;
        color: #c3c2b7;
        font-size: 23px;
        font-weight: 550;
      }
    </style>
  </head>
  <body>
    <div class="brand">${icon}<span>bot-signal</span></div>
    <h1>Bot detection for <em>JavaScript</em> &amp; Node.js</h1>
    <p>Headless Chrome, Playwright, Puppeteer, Selenium — and scripted input.</p>
    <div class="tags"><span>Instant</span><span>Behavioral</span><span>Server</span></div>
  </body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
await page.setContent(card, { waitUntil: "load" });
await page.screenshot({ path: output });
await browser.close();

console.log(`Wrote ${path.relative(ROOT, output)}`);
