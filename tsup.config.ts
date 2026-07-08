import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts", "src/browser.ts", "src/server.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
  },
  {
    // Script-tag / CDN build of the browser API (unpkg, jsdelivr) — emits dist/browser.global.js
    entry: { browser: "src/browser.ts" },
    format: ["iife"],
    globalName: "DetectBotClient",
    minify: true,
    sourcemap: true,
    treeshake: true,
  },
]);
