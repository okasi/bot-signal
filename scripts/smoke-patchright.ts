import { chromium } from "patchright";
import { navigateToHarness, runInstantDetection } from "../test/helpers/patchright-harness.js";
import { startTestServer } from "../test/helpers/test-server.js";

const server = await startTestServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await navigateToHarness(page, server.baseUrl);
const result = await runInstantDetection(page);
console.log("ok", result.isChromium, result.isLegitClient);

await browser.close();
await server.close();
