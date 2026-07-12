import type { ExtendedWindow } from "./types.js";
import { isChromiumBrowser } from "./webgpu.js";

const SOFTWARE_RENDERER_PATTERNS = [
  /swiftshader/i,
  /llvmpipe/i,
  /mesa offscreen/i,
  /software renderer/i,
];

const PLAYWRIGHT_KEY_PATTERNS = [
  /^__playwright(?:__binding__)?$/,
  /^__pw(?:InitScripts|_manual)$/,
];

const PUPPETEER_KEY_PATTERNS = [/^__puppeteer_evaluation_script__$/];

const CHROMEDRIVER_KEY_PATTERNS = [
  /^cdc_[a-zA-Z0-9]{10,}_(?:Array|JSON|Object|Promise|Proxy|Symbol|Window)$/,
  /^\$cdc_[a-zA-Z0-9]{10,}_$/,
  /^\$chrome_asyncScriptInfo$/,
  /^_WEBDRIVER_ELEM_CACHE$/,
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
  if (isPlaywright(context) || isPuppeteer(context) || isChromeDriver(context)) {
    return true;
  }

  return false;
}

/** Playwright bindings or init-script registries leaked into the page realm. */
export function isPlaywright(context: ExtendedWindow): boolean {
  return (
    Boolean(
      context.__playwright ||
        context.__pw_manual ||
        context.__playwright__binding__ ||
        context.__pwInitScripts,
    ) || hasMatchingKey(context, PLAYWRIGHT_KEY_PATTERNS)
  );
}

/** Puppeteer evaluation helpers leaked into the page realm. */
export function isPuppeteer(context: ExtendedWindow): boolean {
  return (
    Boolean(context.__puppeteer_evaluation_script__) ||
    hasMatchingKey(context, PUPPETEER_KEY_PATTERNS)
  );
}

/** ChromeDriver/Selenium `cdc_` and element-cache artifacts. */
export function isChromeDriver(context: ExtendedWindow): boolean {
  return (
    Boolean(context._WEBDRIVER_ELEM_CACHE) ||
    hasMatchingKey(context, CHROMEDRIVER_KEY_PATTERNS) ||
    hasMatchingKey(context.document, CHROMEDRIVER_KEY_PATTERNS)
  );
}

/** UA major version or mobile/platform claim conflicts with User-Agent Client Hints. */
export function isUserAgentDataMismatch(context: ExtendedWindow): boolean {
  const data = context.navigator.userAgentData;
  if (!data) {
    return false;
  }

  const userAgent = context.navigator.userAgent;
  const chromeMajor = userAgent.match(/(?:Chrome|Chromium)\/(\d+)/)?.[1];
  const brandMajors = data.brands
    .filter((brand) => /^(?:Chromium|Google Chrome)$/i.test(brand.brand))
    .map((brand) => brand.version.match(/^\d+/)?.[0])
    .filter((version): version is string => version !== undefined);

  if (
    chromeMajor &&
    brandMajors.length > 0 &&
    brandMajors.some((version) => version !== chromeMajor)
  ) {
    return true;
  }

  const uaIsMobile = /Mobi/i.test(userAgent);
  if (typeof data.mobile === "boolean" && data.mobile !== uaIsMobile) {
    return true;
  }

  if (data.platform) {
    if (/Android/i.test(userAgent) && !/Android/i.test(data.platform)) {
      return true;
    }
    if (/CrOS/i.test(userAgent) && !/Chrome OS/i.test(data.platform)) {
      return true;
    }
    if (
      /Linux/i.test(userAgent) &&
      !/Android|CrOS/i.test(userAgent) &&
      !/Linux/i.test(data.platform)
    ) {
      return true;
    }
    if (/Windows/i.test(userAgent) && !/Windows/i.test(data.platform)) {
      return true;
    }
    if (
      /(Macintosh|Mac OS X)/i.test(userAgent) &&
      !/macOS/i.test(data.platform)
    ) {
      return true;
    }
  }

  return false;
}

/** `navigator.language` disagrees with the first entry in `navigator.languages`. */
export function isLanguageInconsistent(context: ExtendedWindow): boolean {
  const { language, languages } = context.navigator;
  if (!language || !languages) {
    return false;
  }

  return (
    languages.length === 0 ||
    languages[0]?.toLowerCase() !== language.toLowerCase()
  );
}

/** Plugin and MIME-type arrays were patched independently and no longer agree. */
export function isPluginMimeTypeInconsistent(context: ExtendedWindow): boolean {
  if (!context.navigator.plugins || !context.navigator.mimeTypes) {
    return false;
  }

  const pluginCount = context.navigator.plugins.length;
  const mimeTypeCount = context.navigator.mimeTypes.length;
  return (pluginCount === 0) !== (mimeTypeCount === 0);
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
