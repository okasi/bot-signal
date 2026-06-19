import type { ExtendedWindow } from "./types.js";
import { isChromiumBrowser } from "./webgpu.js";

const SOFTWARE_RENDERER_PATTERNS = [
  /swiftshader/i,
  /llvmpipe/i,
  /mesa offscreen/i,
  /software renderer/i,
];

const WINDOW_AUTOMATION_KEY_PATTERNS = [
  /^cdc_[a-zA-Z0-9]+_/,
  /^__playwright/,
  /^__pw_/,
  /^_WEBDRIVER_ELEM_CACHE$/,
];

const DOCUMENT_AUTOMATION_KEY_PATTERNS = [
  /^cdc_[a-zA-Z0-9]+_/,
  /^\$cdc_/,
  /^\$chrome_asyncScriptInfo$/,
  /^__webdriver/,
  /^__selenium/,
  /^__driver/,
];

function hasMatchingKey(target: object, patterns: RegExp[]): boolean {
  for (const key of Object.getOwnPropertyNames(target)) {
    for (const pattern of patterns) {
      if (pattern.test(key)) {
        return true;
      }
    }
  }

  return false;
}

/** Chromium UA without a plausible `window.chrome.runtime` object */
export function isMissingChromeObject(context: ExtendedWindow): boolean {
  if (!isChromiumBrowser(context)) {
    return false;
  }

  const chrome = context.chrome as { runtime?: unknown } | undefined;
  return chrome?.runtime === undefined;
}

/** WebGL reports a software renderer such as SwiftShader or llvmpipe */
export function isSoftwareRenderer(context: ExtendedWindow): boolean {
  const canvas = context.document.createElement("canvas");
  const gl =
    canvas.getContext("webgl") ??
    canvas.getContext("experimental-webgl" as "webgl");

  if (!gl) {
    return false;
  }

  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  if (!debugInfo) {
    return false;
  }

  const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
  if (typeof renderer !== "string") {
    return false;
  }

  return SOFTWARE_RENDERER_PATTERNS.some((pattern) => pattern.test(renderer));
}

/** Window has no browser chrome and sits at the origin — common in headless automation */
export function isSuspiciousWindowDimensions(context: ExtendedWindow): boolean {
  const noBrowserChrome =
    context.outerWidth === context.innerWidth &&
    context.outerHeight === context.innerHeight;
  const zeroScreenOffset =
    context.screenX === 0 &&
    context.screenY === 0 &&
    context.outerWidth > 800;

  return noBrowserChrome && zeroScreenOffset;
}

/** Desktop Chromium with an empty plugin list */
export function isEmptyPlugins(context: ExtendedWindow): boolean {
  if (!isChromiumBrowser(context)) {
    return false;
  }

  return context.navigator.plugins.length === 0;
}

/** Known ChromeDriver, Puppeteer, or Playwright artifacts on `window` / `document` */
export function isAutomationArtifacts(context: ExtendedWindow): boolean {
  if (
    context.__playwright ||
    context.__pw_manual ||
    context._WEBDRIVER_ELEM_CACHE
  ) {
    return true;
  }

  if (hasMatchingKey(context, WINDOW_AUTOMATION_KEY_PATTERNS)) {
    return true;
  }

  return hasMatchingKey(context.document, DOCUMENT_AUTOMATION_KEY_PATTERNS);
}

/** `navigator.webdriver` was patched or installed as an own property */
export function isSuspiciousWebDriverDescriptor(
  context: ExtendedWindow,
): boolean {
  if (Object.prototype.hasOwnProperty.call(context.navigator, "webdriver")) {
    return true;
  }

  if (typeof Navigator === "undefined" || typeof window === "undefined") {
    return false;
  }

  if (!isChromiumBrowser(context)) {
    return false;
  }

  const prototypeDescriptor = Object.getOwnPropertyDescriptor(
    Navigator.prototype,
    "webdriver",
  );

  return !prototypeDescriptor;
}
