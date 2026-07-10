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

/** Chromium UA without the browser-provided `window.chrome` object */
export function isMissingChromeObject(context: ExtendedWindow): boolean {
  if (!isChromiumBrowser(context)) {
    return false;
  }

  // `chrome.runtime` is an extension API and is not guaranteed to be exposed
  // to ordinary web pages. Only the absence of the browser marker itself is
  // suspicious; requiring `runtime` makes legitimate Chromium look automated.
  return context.chrome === undefined;
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

  // Mobile Chrome exposes no plugins by design, so an empty list there is
  // normal, not suspicious — only desktop Chromium ships the fixed PDF set.
  if (/Mobi|Android/i.test(context.navigator.userAgent)) {
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

/** `navigator.webdriver` was patched (own property) or deleted from the prototype */
export function isSuspiciousWebDriverDescriptor(
  context: ExtendedWindow,
): boolean {
  const navigator = context.navigator;

  // Genuine browsers define the getter on Navigator.prototype — an own
  // property means an automation framework redefined it.
  if (Object.prototype.hasOwnProperty.call(navigator, "webdriver")) {
    return true;
  }

  if (!isChromiumBrowser(context)) {
    return false;
  }

  // Stealth patches sometimes delete the descriptor outright; a Chromium
  // navigator without `webdriver` anywhere on its prototype chain is tampered.
  for (
    let prototype = Object.getPrototypeOf(navigator);
    prototype !== null;
    prototype = Object.getPrototypeOf(prototype)
  ) {
    if (Object.prototype.hasOwnProperty.call(prototype, "webdriver")) {
      return false;
    }
  }

  return true;
}
