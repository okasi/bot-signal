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

const LEGACY_AUTOMATION_KEY_PATTERNS = [
  /^_Selenium_IDE_Recorder$/,
  /^_selenium$/,
  /^calledSelenium$/,
  /^webdriver$/,
  /^__webdriverFunc$/,
  /^__lastWatir(?:Alert|Confirm|Prompt)$/,
  /^ChromeDriverw$/,
  /^awesomium$/,
  /^RunPerfTest$/,
  /^CefSharp$/,
  /^fmget_targets$/,
  /^geb$/,
  /^nightmare$/,
  /^__phantomas$/,
  /^wdioElectron$/,
];

const LEGACY_DOCUMENT_KEY_PATTERNS = [
  /^__selenium_evaluate$/,
  /^selenium-evaluate$/,
  /^__selenium_unwrapped$/,
  /^__webdriver_script_(?:fn|func|function)$/,
  /^__driver_evaluate$/,
  /^__webdriver_evaluate$/,
  /^__fxdriver_evaluate$/,
  /^__driver_unwrapped$/,
  /^__webdriver_unwrapped$/,
  /^__fxdriver_unwrapped$/,
  /^__\$webdriverAsyncExecutor$/,
];

const AUTOMATION_STACK_PATTERN = /(?:pptr:|UtilityScript\.|Puppeteer|PhantomJS)/i;

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

/** Known automation framework/runtime artifacts on `window` / `document` */
export function isAutomationArtifacts(context: ExtendedWindow): boolean {
  if (isPlaywright(context) || isPuppeteer(context) || isChromeDriver(context)) {
    return true;
  }

  const process = context.process;
  const isElectron =
    process?.type === "renderer" ||
    process?.versions?.electron !== undefined ||
    /(?:Electron|SlimerJS)/i.test(
      `${context.navigator.userAgent} ${context.navigator.appVersion ?? ""}`,
    );
  const isSequentum = /Sequentum/i.test(String(context.external ?? ""));

  return (
    isElectron ||
    isSequentum ||
    hasMatchingKey(context, LEGACY_AUTOMATION_KEY_PATTERNS) ||
    hasMatchingKey(context.document, LEGACY_DOCUMENT_KEY_PATTERNS)
  );
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

function findPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  for (
    let target: object | null = value;
    target !== null;
    target = Object.getPrototypeOf(target) as object | null
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    if (descriptor) {
      return descriptor;
    }
  }

  return undefined;
}

function isNativeFunction(value: unknown, toString: (this: Function) => string): boolean {
  if (typeof value !== "function") {
    return false;
  }

  try {
    return /\{\s*\[native code\]\s*\}/.test(toString.call(value));
  } catch {
    return false;
  }
}

/** Core functions or Navigator getters no longer have browser-native source. */
export function isNativeFunctionTampered(context: ExtendedWindow): boolean {
  const functionConstructor = context.Function;
  if (!functionConstructor) {
    return false;
  }

  const { bind, toString } = functionConstructor.prototype;
  if (
    !isNativeFunction(toString, toString) ||
    !isNativeFunction(bind, toString)
  ) {
    return true;
  }

  for (const property of ["hardwareConcurrency", "languages", "plugins"] as const) {
    const descriptor = findPropertyDescriptor(context.navigator, property);
    if (descriptor?.get && !isNativeFunction(descriptor.get, toString)) {
      return true;
    }
  }

  return false;
}

function platformContradictsUserAgent(platform: string, userAgent: string): boolean {
  if (/Android/i.test(userAgent)) {
    return !/Android|Linux/i.test(platform);
  }
  if (/CrOS/i.test(userAgent)) {
    return !/CrOS|Linux/i.test(platform);
  }
  if (/Windows/i.test(userAgent)) {
    return !/Win/i.test(platform);
  }
  if (/(?:iPhone|iPad|iPod)/i.test(userAgent)) {
    return !/(?:iPhone|iPad|iPod|Mac)/i.test(platform);
  }
  if (/(?:Macintosh|Mac OS X)/i.test(userAgent)) {
    return !/Mac/i.test(platform);
  }
  if (/Linux/i.test(userAgent)) {
    return !/Linux/i.test(platform);
  }

  return false;
}

/** Legacy Navigator identity claims contradict the User-Agent or touch support. */
export function isNavigatorIdentityInconsistent(context: ExtendedWindow): boolean {
  const navigator = context.navigator;
  const userAgent = navigator.userAgent;
  const vendor = navigator.vendor;

  if (
    (/\b(?:Chrome|Chromium|Edg)\//i.test(userAgent) &&
      vendor !== undefined &&
      vendor !== "Google Inc.") ||
    (/\bFirefox\//i.test(userAgent) && Boolean(vendor)) ||
    (/\bVersion\/[^ ]+.*Safari\//i.test(userAgent) &&
      vendor !== undefined &&
      vendor !== "Apple Computer, Inc.")
  ) {
    return true;
  }

  if (navigator.platform && platformContradictsUserAgent(navigator.platform, userAgent)) {
    return true;
  }

  if (
    navigator.productSub !== undefined &&
    /\b(?:Chrome|Chromium|Edg|Version\/[^ ]+.*Safari)\//i.test(userAgent) &&
    navigator.productSub !== "20030107"
  ) {
    return true;
  }

  return /(?:Mobi|Android|iPhone|iPad)/i.test(userAgent) &&
    navigator.maxTouchPoints !== undefined &&
    navigator.maxTouchPoints === 0;
}

/** PluginArray/MimeTypeArray objects or entries do not use native prototypes. */
export function isPluginArrayInconsistent(context: ExtendedWindow): boolean {
  const { plugins, mimeTypes } = context.navigator;
  if (!plugins || !mimeTypes) {
    return false;
  }

  if (context.PluginArray && !(plugins instanceof context.PluginArray)) {
    return true;
  }
  if (context.MimeTypeArray && !(mimeTypes instanceof context.MimeTypeArray)) {
    return true;
  }

  if (context.Plugin) {
    for (let index = 0; index < plugins.length; index += 1) {
      if (!(plugins[index] instanceof context.Plugin)) {
        return true;
      }
    }
  }
  if (context.MimeType) {
    for (let index = 0; index < mimeTypes.length; index += 1) {
      if (!(mimeTypes[index] instanceof context.MimeType)) {
        return true;
      }
    }
  }

  return false;
}

/** A fresh same-origin iframe exposes Navigator values that differ from the main realm. */
export function isIframeInconsistent(context: ExtendedWindow): boolean {
  const parent = context.document.documentElement ?? context.document.body;
  if (!parent?.appendChild) {
    return false;
  }

  const iframe = context.document.createElement("iframe");
  let inconsistent = false;
  try {
    iframe.style.display = "none";
    parent.appendChild(iframe);
    const frame = iframe.contentWindow;
    if (frame) {
      const main = context.navigator;
      const child = frame.navigator;
      inconsistent =
        Boolean(main.webdriver) !== Boolean(child.webdriver) ||
        main.userAgent !== child.userAgent ||
        (Boolean(main.platform) && main.platform !== child.platform) ||
        (Boolean(main.languages) &&
          JSON.stringify(main.languages) !== JSON.stringify(child.languages)) ||
        (typeof main.hardwareConcurrency === "number" &&
          main.hardwareConcurrency !== child.hardwareConcurrency);
    }
  } catch {
    inconsistent = false;
  }
  iframe.remove();
  return inconsistent;
}

/** Error stacks contain automation-injected source URLs or framework names. */
export function isErrorStackAutomation(context: ExtendedWindow): boolean {
  if (!context.Error) {
    return false;
  }

  try {
    return AUTOMATION_STACK_PATTERN.test(new context.Error().stack ?? "");
  } catch {
    return false;
  }
}

/** Screen/viewport matches common untouched automation defaults. */
export function isDefaultAutomationViewport(context: ExtendedWindow): boolean {
  const dimensions = [
    [context.screen.width, context.screen.height],
    [context.innerWidth, context.innerHeight],
  ];

  return dimensions.some(
    ([width, height]) =>
      (width === 800 && height === 600) ||
      (width === 1280 && height === 720),
  );
}

/** Spoofed or implausible CPU/device-memory combinations. */
export function isSuspiciousHardware(context: ExtendedWindow): boolean {
  const cores = context.navigator.hardwareConcurrency;
  const memory = context.navigator.deviceMemory;

  return (
    (typeof memory === "number" && memory > 16) ||
    (typeof cores === "number" &&
      (cores > 64 ||
        (cores > 32 && typeof memory === "number" && memory <= 8)))
  );
}

/** Network Information reports the zero-RTT default common in headless contexts. */
export function isZeroConnectionRtt(context: ExtendedWindow): boolean {
  const connection = context.navigator.connection;
  return !/Android/i.test(context.navigator.userAgent) && connection?.rtt === 0;
}

/** A deterministic 1px canvas write was modified on readback. */
export function isCanvasTampered(context: ExtendedWindow): boolean {
  try {
    const canvas = context.document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const canvasContext = canvas.getContext("2d");
    if (!canvasContext) {
      return false;
    }

    canvasContext.clearRect(0, 0, 1, 1);
    canvasContext.fillStyle = "#112233";
    canvasContext.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = canvasContext.getImageData(0, 0, 1, 1).data;
    return red !== 17 || green !== 34 || blue !== 51 || alpha !== 255;
  } catch {
    return false;
  }
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
