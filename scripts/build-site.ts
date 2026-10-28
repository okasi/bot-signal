import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = path.join(ROOT, "docs");
const publishDir = path.join(ROOT, ".pages");
const browserBundle = path.join(ROOT, "dist/browser.js");
const siteBundle = path.join(publishDir, "browser.js");
// The demo runs the identification engine in the tab (portable WebCrypto build).
const edgeBundle = path.join(ROOT, "dist/edge.js");
const siteEdgeBundle = path.join(publishDir, "edge.js");
const assetVersion = (process.env.GITHUB_SHA ?? "local").slice(0, 12);

if (!fs.existsSync(browserBundle) || !fs.existsSync(edgeBundle)) {
  console.error("Missing dist/browser.js or dist/edge.js — run npm run build first");
  process.exit(1);
}

fs.rmSync(publishDir, { force: true, recursive: true });
fs.cpSync(docsDir, publishDir, {
  recursive: true,
  filter: (source) => !source.endsWith("browser.js") && !source.endsWith("edge.js"),
});
fs.copyFileSync(browserBundle, siteBundle);
fs.copyFileSync(edgeBundle, siteEdgeBundle);

const indexPath = path.join(publishDir, "index.html");
const appPath = path.join(publishDir, "app.js");

fs.writeFileSync(
  indexPath,
  fs
    .readFileSync(indexPath, "utf-8")
    .replace("./styles.css", `./styles.css?v=${assetVersion}`)
    .replace("./app.js", `./app.js?v=${assetVersion}`),
  "utf-8",
);

fs.writeFileSync(
  appPath,
  fs
    .readFileSync(appPath, "utf-8")
    .replace("./browser.js", `./browser.js?v=${assetVersion}`)
    .replace("./edge.js", `./edge.js?v=${assetVersion}`),
  "utf-8",
);

console.log(`Built ${path.relative(ROOT, publishDir)} with asset version ${assetVersion}`);
