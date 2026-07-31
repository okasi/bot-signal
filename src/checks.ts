import type { ExtendedWindow } from "./types.js";
import { isChromiumBrowser } from "./webgpu.js";

const SOFTWARE_RENDERER_PATTERNS = [
  /swiftshader/i,
  /llvmpipe/i,
  /mesa offscreen/i,
  /software renderer/i,
];

/**
 * GPU strings that only exist on one platform. A renderer that names a
 * graphics backend the claimed OS cannot run is a spoofed WebGL identity.
 */
const GPU_PLATFORM_RULES: Array<{ renderer: RegExp; platform: RegExp }> = [
  { renderer: /Direct3D|\bD3D(?:9|11|12)\b/i, platform: /Windows|Win64|WOW64/i },
  {
    renderer: /Metal Renderer|Apple GPU|Apple M\d/i,
    platform: /Macintosh|Mac OS X|iPhone|iPad|iPod/i,
  },
  { renderer: /Adreno|Mali-|PowerVR Rogue/i, platform: /Android/i },
];

/** `navigator.deviceMemory` is quantised to powers of two by every engine. */
const ALLOWED_DEVICE_MEMORY = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];

/**
 * How far a canvas channel may drift before it counts as rewritten. Colour
 * management on wide-gamut displays moves values by a step, and the per-origin
 * noise that browser fingerprint protection injects — Opera, Brave, and
 * privacy extensions all do it, intermittently — perturbs the low bits. Neither
 * belongs to a bot, so the band is wide enough to clear both while a stubbed or
 * constant-returning canvas still lands far outside it.
 */
const CANVAS_CHANNEL_TOLERANCE = 8;

/** Colour depths real display pipelines report; anything else is fabricated. */
const ALLOWED_COLOR_DEPTHS = [8, 15, 16, 24, 30, 32, 48];

/** Navigator properties every engine exposes as prototype accessors. */
const NAVIGATOR_ACCESSOR_PROPERTIES = [
  "webdriver",
  "hardwareConcurrency",
  "languages",
  "plugins",
] as const;

const PLAYWRIGHT_KEY_PATTERNS = [
  /^__playwright(?:__binding__)?$/,
  /^__pw(?:InitScripts|_manual)$/,
];

const PUPPETEER_KEY_PATTERNS = [
  /^__puppeteer_evaluation_script__$/,
];

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
  /^driver-evaluate$/,
  /^webdriver-evaluate$/,
  /^webdriverCommand$/,
  /^webdriver-evaluate-response$/,
  /^webdriver$/,
  /^_Selenium_IDE_Recorder$/,
  /^_selenium$/,
  /^calledSelenium$/,
  /^__webdriverFunc$/,
  /^__lastWatir(?:Alert|Confirm|Prompt)$/,
  /^ChromeDriverw$/,
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

const AUTOMATION_STACK_PATTERN = /(?:pptr:|UtilityScript\.)/i;
const PLAYWRIGHT_BINDING_SOURCE_PATTERN =
  /exposeBindingHandle supports a single argument/;
const PUPPETEER_BINDING_SOURCE_PATTERN = /This is the Puppeteer binding/;
const SANNYSOFT_DOCUMENT_CACHE_KEY_PATTERN = /\$[a-z]dc_/;

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

function hasMatchingTruthyKey(target: object, patterns: RegExp[]): boolean {
  for (const key of Object.getOwnPropertyNames(target)) {
    if (
      patterns.some((pattern) => pattern.test(key)) &&
      Boolean(getPropertySafely(target, key))
    ) {
      return true;
    }
  }

  return false;
}

/** Reads a potentially page-defined property without letting its getter abort detection. */
export function getPropertySafely(
  target: object,
  property: PropertyKey,
): unknown {
  try {
    return Reflect.get(target, property);
  } catch {
    return undefined;
  }
}

function hasFunctionSourceMarker(
  context: ExtendedWindow,
  pattern: RegExp,
): boolean {
  let toString: unknown;
  try {
    toString =
      context.Function?.prototype.toString ?? Function.prototype.toString;
  } catch {
    return false;
  }
  if (typeof toString !== "function") {
    return false;
  }
  for (const key of Object.getOwnPropertyNames(context)) {
    const value = Object.getOwnPropertyDescriptor(context, key)?.value;
    if (typeof value === "function") {
      try {
        if (pattern.test(toString.call(value))) {
          return true;
        }
      } catch {
        continue;
      }
    }
  }

  return false;
}

function hasInstalledExposedFunction(target: object): boolean {
  return Object.getOwnPropertyNames(target).some((key) => {
    const value = Object.getOwnPropertyDescriptor(target, key)?.value as
      | (Function & { __installed?: unknown })
      | undefined;
    if (typeof value !== "function") {
      return false;
    }
    try {
      return value.__installed === true;
    } catch {
      return false;
    }
  });
}

function hasPrefixedFunction(target: object, pattern: RegExp): boolean {
  return Object.getOwnPropertyNames(target).some((key) =>
    pattern.test(key) &&
    typeof Object.getOwnPropertyDescriptor(target, key)?.value === "function"
  );
}

function hasAutomationDocumentAttribute(context: ExtendedWindow): boolean {
  try {
    const root = context.document.documentElement;
    return Boolean(
      root?.hasAttribute &&
        ["selenium", "webdriver", "driver"].some((attribute) =>
          root.hasAttribute(attribute),
        ),
    );
  } catch {
    return false;
  }
}

/** Exact Selenium/WebDriver markers exposed on `document`. */
export function isSeleniumDocumentArtifacts(context: ExtendedWindow): boolean {
  return hasMatchingTruthyKey(context.document, LEGACY_DOCUMENT_KEY_PATTERNS);
}

function hasSannysoftDocumentCache(context: ExtendedWindow): boolean {
  for (const key in context.document) {
    if (!SANNYSOFT_DOCUMENT_CACHE_KEY_PATTERN.test(key)) {
      continue;
    }
    const value = getPropertySafely(context.document, key);
    if (
      ((typeof value === "object" && value !== null) ||
        typeof value === "function") &&
      Boolean(getPropertySafely(value, "cache_"))
    ) {
      return true;
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
  return getPropertySafely(context, "chrome") === undefined;
}

/** Reads the unmasked WebGL vendor/renderer pair, or `null` when unavailable. */
function readWebGlIdentity(
  context: ExtendedWindow,
): { vendor: string; renderer: string } | null {
  const canvas = context.document.createElement("canvas");
  const gl =
    canvas.getContext("webgl") ??
    canvas.getContext("experimental-webgl" as "webgl");

  if (!gl) {
    return null;
  }

  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  if (!debugInfo) {
    return null;
  }

  const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
  if (typeof renderer !== "string") {
    return null;
  }

  const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
  return { vendor: typeof vendor === "string" ? vendor : "", renderer };
}

/** WebGL reports a software renderer such as SwiftShader or llvmpipe */
export function isSoftwareRenderer(context: ExtendedWindow): boolean {
  const identity = readWebGlIdentity(context);
  if (!identity) {
    return false;
  }

  return SOFTWARE_RENDERER_PATTERNS.some((pattern) =>
    pattern.test(identity.renderer),
  );
}

/**
 * The WebGL renderer names a graphics backend the User-Agent's platform
 * cannot provide — Direct3D off Windows, Metal off Apple, Adreno off Android.
 */
export function isGpuPlatformMismatch(context: ExtendedWindow): boolean {
  const identity = readWebGlIdentity(context);
  if (!identity) {
    return false;
  }

  const userAgent = context.navigator.userAgent;
  const gpu = `${identity.vendor} ${identity.renderer}`;
  return GPU_PLATFORM_RULES.some(
    (rule) => rule.renderer.test(gpu) && !rule.platform.test(userAgent),
  );
}

/** Window has no browser chrome and sits at the origin — common in headless automation */
export function isSuspiciousWindowDimensions(context: ExtendedWindow): boolean {
  if (context.outerWidth === 0 && context.outerHeight === 0) {
    return true;
  }

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

/** Legacy automation and embedded-runtime artifacts, excluding exact frameworks. */
export function isLegacyAutomationArtifacts(context: ExtendedWindow): boolean {
  const processValue = getPropertySafely(context, "process");
  const process =
    (typeof processValue === "object" && processValue !== null) ||
    typeof processValue === "function"
      ? processValue
      : undefined;
  const versions = process
    ? getPropertySafely(process, "versions")
    : undefined;
  const hasElectronVersion =
    ((typeof versions === "object" && versions !== null) ||
      typeof versions === "function") &&
    getPropertySafely(versions, "electron") !== undefined;
  const isElectron =
    (process && getPropertySafely(process, "type") === "renderer") ||
    hasElectronVersion ||
    /(?:Electron|SlimerJS)/i.test(
      `${context.navigator.userAgent} ${context.navigator.appVersion ?? ""}`,
    );
  let isSequentum = false;
  try {
    isSequentum = /Sequentum/i.test(String(context.external ?? ""));
  } catch {
    isSequentum = false;
  }

  return (
    isElectron ||
    isSequentum ||
    hasMatchingTruthyKey(context, LEGACY_AUTOMATION_KEY_PATTERNS) ||
    isSeleniumDocumentArtifacts(context) ||
    hasInstalledExposedFunction(context) ||
    hasAutomationDocumentAttribute(context)
  );
}

/** Known automation framework/runtime artifacts on `window` / `document` */
export function isAutomationArtifacts(context: ExtendedWindow): boolean {
  return isPlaywright(context) ||
    isPuppeteer(context) ||
    isChromeDriver(context) ||
    isLegacyAutomationArtifacts(context);
}

/** Playwright bindings or init-script registries leaked into the page realm. */
export function isPlaywright(context: ExtendedWindow): boolean {
  return (
    hasMatchingKey(context, PLAYWRIGHT_KEY_PATTERNS) ||
    hasFunctionSourceMarker(context, PLAYWRIGHT_BINDING_SOURCE_PATTERN)
  );
}

/** Puppeteer evaluation helpers leaked into the page realm. */
export function isPuppeteer(context: ExtendedWindow): boolean {
  return (
    hasMatchingKey(context, PUPPETEER_KEY_PATTERNS) ||
    hasPrefixedFunction(context, /^puppeteer_/) ||
    hasFunctionSourceMarker(context, PUPPETEER_BINDING_SOURCE_PATTERN)
  );
}

/** ChromeDriver/Selenium `cdc_` and element-cache artifacts. */
export function isChromeDriver(context: ExtendedWindow): boolean {
  return (
    hasMatchingKey(context, CHROMEDRIVER_KEY_PATTERNS) ||
    hasMatchingKey(context.document, CHROMEDRIVER_KEY_PATTERNS) ||
    hasSannysoftDocumentCache(context)
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
  if (!languages) {
    return false;
  }
  if (languages.length === 0) {
    return true;
  }
  if (!language) {
    return false;
  }

  return languages[0]?.toLowerCase() !== language.toLowerCase();
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
  const functionConstructor = getPropertySafely(context, "Function") as
    | FunctionConstructor
    | undefined;
  if (!functionConstructor) {
    return false;
  }

  let bind: unknown;
  let toString: unknown;
  try {
    ({ bind, toString } = functionConstructor.prototype);
  } catch {
    return true;
  }
  if (typeof toString !== "function") {
    return true;
  }
  const functionToString = toString as (this: Function) => string;
  if (
    !isNativeFunction(toString, functionToString) ||
    !isNativeFunction(bind, functionToString)
  ) {
    return true;
  }

  const isNativeNavigator =
    Object.prototype.toString.call(context.navigator) === "[object Navigator]";

  for (const property of NAVIGATOR_ACCESSOR_PROPERTIES) {
    const descriptor = findPropertyDescriptor(context.navigator, property);
    if (!descriptor) {
      continue;
    }
    // Engines expose these as prototype accessors. A plain data property means
    // something re-defined it with `Object.defineProperty(..., { value })`.
    if (!descriptor.get) {
      if (isNativeNavigator) {
        return true;
      }
      continue;
    }
    if (!isNativeFunction(descriptor.get, functionToString)) {
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
  try {
    const firstPlugin = plugins[0];
    if (
      firstPlugin &&
      firstPlugin.toString() !== "[object Plugin]"
    ) {
      return true;
    }
  } catch {
    return true;
  }
  if (context.MimeType) {
    for (let index = 0; index < mimeTypes.length; index += 1) {
      if (!(mimeTypes[index] instanceof context.MimeType)) {
        return true;
      }
    }
  }

  if (plugins.length > 0 && typeof plugins.item === "function") {
    try {
      // Native `PluginArray.item()` takes an `unsigned long`, so 2³² wraps to
      // index 0. Array-backed fakes return `undefined` instead.
      if (plugins.item(4294967296) !== plugins[0]) {
        return true;
      }
      // Real MIME entries link back to the plugin that enables them.
      const mimeType = plugins[0]?.[0];
      if (mimeType && mimeType.enabledPlugin !== plugins[0]) {
        return true;
      }
    } catch {
      return true;
    }
  }

  return false;
}

/** Navigator values a second realm reports, for drift comparison. */
export interface RealmNavigatorSnapshot {
  userAgent?: string;
  language?: string;
  languages?: readonly string[];
  platform?: string;
}

/**
 * How many Navigator values must drift between realms before it counts.
 *
 * Browser extensions — including the ones Opera, Brave, and Edge ship
 * built in — routinely rewrite a single value in the top document without
 * touching workers or `about:blank` frames. Spoofing frameworks install a
 * whole persona, so requiring two independent differences keeps the signal
 * without firing on an ordinary browser carrying an extension.
 */
export const MINIMUM_REALM_DRIFT = 2;

/** Counts Navigator values that differ between the main realm and another one. */
export function countNavigatorDrift(
  main: RealmNavigatorSnapshot,
  other: RealmNavigatorSnapshot,
): number {
  let drift = 0;

  if (
    typeof main.userAgent === "string" &&
    typeof other.userAgent === "string" &&
    main.userAgent !== other.userAgent
  ) {
    drift += 1;
  }
  if (
    Boolean(main.platform) &&
    typeof other.platform === "string" &&
    main.platform !== other.platform
  ) {
    drift += 1;
  }
  // `hardwareConcurrency` is deliberately left out. Browser fingerprint
  // protection reduces it in the top document and nowhere else — Opera 133
  // reports 2 cores to the page while its workers and `about:blank` frames
  // report the machine's real 10 — so cross-realm drift there says nothing
  // about automation. Patched core counts are still caught by
  // isNativeFunctionTampered and isSuspiciousHardware.

  // `language` and `languages` move together, so they count once between them.
  const mainLanguages = main.languages;
  const otherLanguages = other.languages;
  const hasLanguagesDrift =
    mainLanguages !== undefined &&
    otherLanguages !== undefined &&
    mainLanguages.length > 0 &&
    otherLanguages.length > 0 &&
    JSON.stringify(Array.from(mainLanguages)) !==
      JSON.stringify(Array.from(otherLanguages));
  const hasLanguageDrift =
    Boolean(main.language) &&
    Boolean(other.language) &&
    main.language !== other.language;
  if (hasLanguagesDrift || hasLanguageDrift) {
    drift += 1;
  }

  return drift;
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
      const frameGet = (frame.self as (Window & { get?: unknown }) | undefined)
        ?.get;

      // A fresh realm gets its own window, navigator, and function objects.
      // Sharing any of them means something re-pointed the iframe at the page,
      // and no browser or extension can produce that.
      const isSharedRealm =
        frame === context ||
        child === main ||
        (typeof frameGet === "function" && frameGet.toString().length > 5) ||
        (typeof frame.setTimeout === "function" &&
          frame.setTimeout === context.setTimeout);

      // `webdriver` is set by the browser itself, so the two realms always
      // agree on it unless a patch reached only one of them.
      const hasWebDriverDrift =
        Boolean(main.webdriver) !== Boolean(child.webdriver);

      inconsistent =
        isSharedRealm ||
        hasWebDriverDrift ||
        countNavigatorDrift(main, child) >= MINIMUM_REALM_DRIFT;
    }
  } catch {
    inconsistent = false;
  }
  iframe.remove();
  return inconsistent;
}

/** Error stacks contain automation-specific source URLs or injected frames. */
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

  // Engines round `deviceMemory` to a power of two, so an off-grid value was
  // fabricated. Large values are legitimate — real workstations report 32.
  if (typeof memory === "number" && !ALLOWED_DEVICE_MEMORY.includes(memory)) {
    return true;
  }

  if (typeof cores !== "number") {
    return false;
  }

  return (
    !Number.isInteger(cores) ||
    cores < 1 ||
    cores > 128 ||
    (cores > 32 && typeof memory === "number" && memory <= 2)
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
    const expected = [17, 34, 51, 255];
    // Colour management on wide-gamut and HDR displays shifts readback by a
    // step or two, so only a deviation larger than that counts as rewritten.
    return [red, green, blue, alpha].some(
      (channel, index) =>
        typeof channel !== "number" ||
        Math.abs(channel - expected[index]!) > CANVAS_CHANNEL_TOLERANCE,
    );
  } catch {
    return false;
  }
}

type BrowserEngine = "chromium" | "gecko" | "webkit";

/** The engine the User-Agent implies, or `null` when it names no known browser. */
function getClaimedEngine(userAgent: string): BrowserEngine | null {
  // iOS puts every browser on WebKit regardless of the brand in the UA.
  if (/(?:iPhone|iPad|iPod)/i.test(userAgent)) {
    return "webkit";
  }
  if (/\b(?:Chrome|Chromium|Edg|OPR|SamsungBrowser)\//i.test(userAgent)) {
    return "chromium";
  }
  if (/\bFirefox\//i.test(userAgent)) {
    return "gecko";
  }
  if (/\bVersion\/[^ ]+.*Safari\//i.test(userAgent)) {
    return "webkit";
  }

  return null;
}

/**
 * The JavaScript engine contradicts the browser the User-Agent claims.
 *
 * `eval.toString().length` is 33 in V8 (single-line native source) and 37 in
 * SpiderMonkey and JavaScriptCore, and `InternalError` exists only in
 * SpiderMonkey — neither is touched by User-Agent spoofing.
 */
export function isEngineInconsistent(context: ExtendedWindow): boolean {
  const engine = getClaimedEngine(context.navigator.userAgent);
  if (!engine) {
    return false;
  }

  const hasSpiderMonkeyGlobals =
    getPropertySafely(context, "InternalError") !== undefined ||
    getPropertySafely(context, "mozInnerScreenX") !== undefined;
  if (hasSpiderMonkeyGlobals !== (engine === "gecko")) {
    return true;
  }

  const evaluate = getPropertySafely(context, "eval");
  if (typeof evaluate !== "function") {
    return false;
  }

  let evalLength: number;
  try {
    evalLength = evaluate.toString().length;
  } catch {
    return false;
  }

  // Only the two known native shapes attribute an engine; anything else is a
  // wrapped `eval`, which isNativeFunctionTampered already covers.
  if (evalLength === 33) {
    return engine !== "chromium";
  }
  if (evalLength === 37) {
    return engine === "chromium";
  }

  return false;
}

/**
 * CSS media queries contradict the values `navigator`/`screen` report.
 * Stealth patches override the JS getters but not the CSS engine behind them.
 */
export function isMediaQueryInconsistent(context: ExtendedWindow): boolean {
  const matchMedia = context.matchMedia;
  if (typeof matchMedia !== "function") {
    return false;
  }

  const matches = (query: string): boolean | null => {
    try {
      return matchMedia.call(context, query).matches;
    } catch {
      return null;
    }
  };

  // Only `resolution` is compared. `screen.colorDepth` against the CSS `color`
  // query looked equivalent but is not: Opera 133 on a 10-bit display reports
  // colorDepth 24 while CSS reports 10 bits per channel, so any mapping
  // between them flags a stock browser.

  // Bail out on engines that do not support resolution queries at all.
  if (matches("(min-resolution: 0dppx)") !== true) {
    return false;
  }

  const ratio = context.devicePixelRatio;
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio <= 0) {
    return false;
  }

  // Page zoom and fractional HiDPI scaling make the ratio a long float, so the
  // window scales with it instead of being a fixed epsilon.
  const tolerance = Math.max(ratio * 0.02, 0.02);
  return (
    matches(`(min-resolution: ${ratio - tolerance}dppx)`) === false ||
    matches(`(max-resolution: ${ratio + tolerance}dppx)`) === false
  );
}

/** `screen` reports geometry no display pipeline can produce. */
export function isScreenGeometryInconsistent(context: ExtendedWindow): boolean {
  const screen = context.screen;
  const { width, height, availWidth, availHeight, colorDepth, pixelDepth } =
    screen;

  if (typeof width !== "number" || typeof height !== "number") {
    return false;
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return true;
  }
  // The available area is carved out of the screen, so it can never exceed it.
  if (typeof availWidth === "number" && availWidth > width) {
    return true;
  }
  if (typeof availHeight === "number" && availHeight > height) {
    return true;
  }
  if (typeof colorDepth === "number") {
    if (!ALLOWED_COLOR_DEPTHS.includes(colorDepth)) {
      return true;
    }
    if (typeof pixelDepth === "number" && pixelDepth !== colorDepth) {
      return true;
    }
  }

  const ratio = context.devicePixelRatio;
  return typeof ratio === "number" && (ratio <= 0 || ratio > 8);
}

/**
 * A Chromium build without H.264 — the bundled Chromium that Playwright and
 * unbranded automation images ship, as opposed to Google Chrome.
 */
export function isMissingProprietaryCodecs(context: ExtendedWindow): boolean {
  if (!isChromiumBrowser(context)) {
    return false;
  }

  try {
    const video = context.document.createElement("video");
    if (typeof video.canPlayType !== "function") {
      return false;
    }
    return video.canPlayType('video/mp4; codecs="avc1.42E01E"') === "";
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

  const isNativeNavigator =
    Object.prototype.toString.call(navigator) === "[object Navigator]";

  // Stealth patches sometimes delete the descriptor outright; a Chromium
  // navigator without `webdriver` anywhere on its prototype chain is tampered.
  for (
    let prototype = Object.getPrototypeOf(navigator);
    prototype !== null;
    prototype = Object.getPrototypeOf(prototype)
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "webdriver");
    if (descriptor) {
      return isNativeNavigator &&
        (typeof descriptor.get !== "function" ||
          descriptor.set !== undefined ||
          descriptor.enumerable !== true ||
          descriptor.configurable !== true);
    }
  }

  return true;
}
