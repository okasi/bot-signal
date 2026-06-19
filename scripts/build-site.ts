import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserBundle = path.join(ROOT, "dist/browser.js");
const siteBundle = path.join(ROOT, "docs/browser.js");

if (!fs.existsSync(browserBundle)) {
  console.error("Missing dist/browser.js — run npm run build first");
  process.exit(1);
}

fs.copyFileSync(browserBundle, siteBundle);
console.log(`Copied ${path.relative(ROOT, browserBundle)} → ${path.relative(ROOT, siteBundle)}`);
