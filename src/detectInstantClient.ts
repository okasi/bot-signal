import {
  createAutomationAssessment,
  type AutomationAssessment,
  type AutomationKind,
} from "./automation.js";
import {
  checkCdpRuntime,
  checkHighEntropyUserAgentData,
  checkMediaDevices,
  checkNotificationPermissionConsistency,
  checkSpeechVoices,
  checkWorkerConsistency,
} from "./asyncChecks.js";
import {
  getPropertySafely,
  hasWebGlContext,
  isCanvasNoiseInjected,
  isCanvasTampered,
  isChromeDriver,
  isDefaultAutomationViewport,
  isEmptyPlugins,
  isEngineInconsistent,
  isErrorStackAutomation,
  isGpuPlatformMismatch,
  isIframeInconsistent,
  isLanguageInconsistent,
  isLegacyAutomationArtifacts,
  isMediaQueryInconsistent,
  isMissingChromeObject,
  isMissingGreaseBrand,
  isMissingProprietaryCodecs,
  isNativeFunctionTampered,
  isNavigatorIdentityInconsistent,
  isPlaywright,
  isPluginArrayInconsistent,
  isPluginMimeTypeInconsistent,
  isPuppeteer,
  isScreenGeometryInconsistent,
  isSoftwareRenderer,
  isSeleniumDocumentArtifacts,
  isSuspiciousHardware,
  isSuspiciousWebDriverDescriptor,
  isSuspiciousWindowDimensions,
  isTimezoneInconsistent,
  isUserAgentDataMismatch,
  isZeroConnectionRtt,
} from "./checks.js";
import type {
  ExtendedWindow,
  InstantAsyncChecks,
  InstantClientAsyncResult,
  InstantClientResult,
  InstantConfidenceLevel,
  InstantDetectorOptions,
  InstantSignal,
  InstantSignalChecks,
} from "./types.js";
import {
  getBotUserAgentKind,
  getScriptingUserAgentKind,
  isBotUserAgent,
} from "./userAgent.js";
import { checkShaderF16Support, isChromiumBrowser } from "./webgpu.js";

const DEFAULT_SCORE_THRESHOLD = 0.5;

/**
 * Minimum "modern" browser versions. Bump these as the baseline moves —
 * anything below is flagged (softly) as an outdated or spoofed build.
 */
const MODERN_BROWSER_FLOORS = {
  chrome: 121,
  firefox: 128,
  safari: 16.4,
} as const;

type BooleanChecks = Omit<
  InstantClientResult,
  | "isChromium"
  | "suspicionScore"
  | "confidence"
  | "signals"
  | "isLegitClient"
  | "automation"
>;

interface InstantSignalSpec {
  id: keyof BooleanChecks;
  description: string;
  weight: number;
  confidence: InstantConfidenceLevel;
  /** Positive-health flags (valid UA, WebGL, modern) trigger when the value is `false` */
  triggerWhenFalse?: boolean;
}

/**
 * Weighted instant checks. Definitive automation markers weigh 0.9–1.0 and
 * block on their own; ambiguous checks that also fire on legitimate clients
 * (in-app browsers, F11 fullscreen, GPU-less VMs, older builds) weigh 0.25–0.45
 * so they only cross the default 0.5 threshold in combination.
 */
const INSTANT_SIGNAL_SPECS: InstantSignalSpec[] = [
  { id: "isWebDriver", description: "navigator.webdriver is set", weight: 1, confidence: "high" },
  { id: "isPlaywright", description: "Playwright bindings or init-script artifacts present", weight: 1, confidence: "high" },
  { id: "isPuppeteer", description: "Puppeteer bindings or evaluation artifacts present", weight: 1, confidence: "high" },
  { id: "isChromeDriver", description: "ChromeDriver or WebDriver cache artifacts present", weight: 1, confidence: "high" },
  { id: "isAutomationArtifacts", description: "Framework, legacy automation, or embedded-runtime artifacts present", weight: 0.35, confidence: "low" },
  { id: "isSelenium", description: "Selenium markers on document", weight: 1, confidence: "high" },
  { id: "isPhantomJS", description: "PhantomJS globals present", weight: 1, confidence: "high" },
  { id: "isNightmare", description: "Nightmare.js marker present", weight: 1, confidence: "high" },
  { id: "isDomAutomation", description: "DOM automation controller globals present", weight: 1, confidence: "high" },
  { id: "isHeadless", description: "HeadlessChrome user agent/appVersion or webdriver flag", weight: 0.9, confidence: "high" },
  { id: "isSuspiciousWebDriverDescriptor", description: "navigator.webdriver descriptor was tampered with", weight: 0.9, confidence: "high" },
  { id: "isSuspiciousResolution", description: "Screen smaller than any real device", weight: 0.7, confidence: "medium" },
  { id: "isUserAgentValid", description: "User agent is malformed or identifies a known bot, scripting, or automation client", weight: 0.7, confidence: "high", triggerWhenFalse: true },
  { id: "isSoftwareRenderer", description: "WebGL uses a software renderer (SwiftShader/llvmpipe)", weight: 0.6, confidence: "medium" },
  { id: "isUserAgentDataMismatch", description: "User-Agent conflicts with Client Hints", weight: 0.65, confidence: "high" },
  { id: "isNativeFunctionTampered", description: "Native browser functions or Navigator getters were patched", weight: 0.8, confidence: "high" },
  { id: "isNavigatorIdentityInconsistent", description: "Navigator vendor/platform/product/touch claims conflict with the User-Agent", weight: 0.65, confidence: "high" },
  { id: "isPluginArrayInconsistent", description: "Plugin or MIME-type arrays have non-native prototypes", weight: 0.65, confidence: "high" },
  { id: "isIframeInconsistent", description: "A fresh iframe hands back the page's own realm, or disagrees about navigator.webdriver", weight: 0.8, confidence: "high" },
  { id: "isErrorStackAutomation", description: "Error stack contains an automation source marker", weight: 0.85, confidence: "high" },
  { id: "isEngineInconsistent", description: "JavaScript engine identity conflicts with the browser the User-Agent claims", weight: 0.8, confidence: "high" },
  { id: "isGpuPlatformMismatch", description: "WebGL renderer names a graphics backend the claimed platform cannot run", weight: 0.6, confidence: "high" },
  { id: "isMediaQueryInconsistent", description: "The CSS resolution query contradicts the reported devicePixelRatio", weight: 0.5, confidence: "medium" },
  { id: "isLanguageInconsistent", description: "Navigator language values are inconsistent", weight: 0.45, confidence: "medium" },
  { id: "isScreenGeometryInconsistent", description: "Screen reports impossible geometry or colour depth", weight: 0.45, confidence: "medium" },
  { id: "isTimezoneInconsistent", description: "The resolved IANA time zone contradicts the UTC offset Date reports", weight: 0.5, confidence: "medium" },
  { id: "isMissingProprietaryCodecs", description: "Chromium build without H.264 support (unbranded automation build)", weight: 0.4, confidence: "low" },
  { id: "isMissingGreaseBrand", description: "Client Hints brands omit the GREASE entry every Chromium build injects", weight: 0.4, confidence: "medium" },
  { id: "isCanvasNoiseInjected", description: "Two identical canvas renders read back differently", weight: 0.35, confidence: "medium" },
  { id: "isPluginMimeTypeInconsistent", description: "Plugin and MIME-type arrays are inconsistent", weight: 0.45, confidence: "medium" },
  { id: "isMissingChromeObject", description: "Chromium user agent without window.chrome", weight: 0.35, confidence: "low" },
  { id: "isWebGLSupported", description: "No WebGL context available", weight: 0.35, confidence: "low", triggerWhenFalse: true },
  { id: "isSuspiciousWindowDimensions", description: "Window has zero outer size or no browser chrome at the screen origin", weight: 0.3, confidence: "low" },
  { id: "isModern", description: "Browser build is below the modern baseline", weight: 0.3, confidence: "low", triggerWhenFalse: true },
  { id: "isEmptyPlugins", description: "Desktop Chromium with an empty plugin list", weight: 0.25, confidence: "low" },
  { id: "isSuspiciousHardware", description: "CPU and device-memory values are implausible or contradictory", weight: 0.3, confidence: "low" },
  { id: "isZeroConnectionRtt", description: "Network Information reports a zero RTT outside Android", weight: 0.2, confidence: "low" },
  { id: "isDefaultAutomationViewport", description: "Screen or viewport matches a common automation default", weight: 0.2, confidence: "low" },
  { id: "isCanvasTampered", description: "A deterministic canvas pixel was modified on readback", weight: 0.2, confidence: "low" },
];

interface AsyncSignalSpec {
  id: keyof InstantAsyncChecks;
  description: string;
  weight: number;
  confidence: InstantConfidenceLevel;
  triggerWhenFalse?: boolean;
}

const INSTANT_ASYNC_SIGNAL_SPECS: AsyncSignalSpec[] = [
  { id: "isShaderF16Supported", description: "WebGPU shader-f16 feature is missing on Chromium", weight: 0.3, confidence: "low", triggerWhenFalse: true },
  { id: "isCdpDetected", description: "Chrome DevTools Protocol serialized an Error object", weight: 0.25, confidence: "medium" },
  { id: "isNotificationPermissionInconsistent", description: "Notification and Permissions API states contradict", weight: 0.55, confidence: "high" },
  { id: "isHighEntropyUserAgentDataMismatch", description: "High-entropy Client Hints conflict with the User-Agent", weight: 0.65, confidence: "high" },
  { id: "isWorkerInconsistent", description: "The worker realm names a different operating system than the page", weight: 0.8, confidence: "high" },
  { id: "isWebDriverInWorker", description: "Worker navigator exposes webdriver", weight: 0.9, confidence: "high" },
  { id: "isWorkerWebGLInconsistent", description: "Worker and page WebGL identities disagree", weight: 0.35, confidence: "medium" },
  { id: "isCdpDetectedInWorker", description: "Chrome DevTools Protocol serialized an Error inside a worker", weight: 0.25, confidence: "medium" },
  { id: "isMissingMediaDevices", description: "Desktop Chromium enumerated no audio or video devices", weight: 0.3, confidence: "low" },
  { id: "isVoiceListInconsistent", description: "Installed speech voices contradict the claimed platform or browser brand", weight: 0.35, confidence: "medium" },
];

function parseBrowserVersion(userAgent: string, pattern: RegExp): number {
  const match = userAgent.match(pattern);
  return parseFloat(match?.[1] ?? "0");
}

function hasTruthyProperty(target: object, properties: string[]): boolean {
  return properties.some((property) =>
    Boolean(getPropertySafely(target, property)),
  );
}

function detectSync(context: ExtendedWindow): BooleanChecks {
  // Inspired by Cloudflare https://scrapeops.io/web-scraping-playbook/how-to-bypass-cloudflare/#low-level-bypass
  const isWebDriver = Boolean(
    getPropertySafely(context.navigator, "webdriver"),
  );
  const isPhantomJS = hasTruthyProperty(context, ["callPhantom", "_phantom"]);
  const isNightmare = Boolean(getPropertySafely(context, "__nightmare"));
  const isSelenium =
    hasTruthyProperty(context, [
      "_Selenium_IDE_Recorder",
      "_selenium",
      "calledSelenium",
      "callSelenium",
    ]) ||
    isSeleniumDocumentArtifacts(context);
  const isDomAutomation = hasTruthyProperty(context, [
    "domAutomation",
    "domAutomationController",
  ]);
  const isPlaywrightClient = isPlaywright(context);
  const isPuppeteerClient = isPuppeteer(context);
  const isChromeDriverClient = isChromeDriver(context);
  const hasAutomationArtifacts =
    isPlaywrightClient ||
    isPuppeteerClient ||
    isChromeDriverClient ||
    isLegacyAutomationArtifacts(context);

  // Custom checks by okasi
  const isHeadless = Boolean(
    isWebDriver ||
      context.navigator.userAgent.includes("Headless") ||
      context.navigator.appVersion?.includes("Headless") ||
      context.navigator.userAgentData?.brands.some((brand) =>
        /Headless/i.test(brand.brand),
      ),
  );
  const isSuspiciousResolution =
    context.screen.width < 136 || context.screen.height < 170; // Apple Watch Series 3 (38mm)
  const isUserAgentValid =
    context.navigator.userAgent.startsWith("Mozilla/5.0 (") &&
    getScriptingUserAgentKind(context.navigator.userAgent) === null &&
    !isBotUserAgent(context.navigator.userAgent);
  const isWebGLSupported = hasWebGlContext(context);

  const userAgent = context.navigator.userAgent;
  const isModern =
    (userAgent.includes("Chrome/") &&
      parseBrowserVersion(userAgent, /Chrome\/(\d+\.\d+)/) >=
        MODERN_BROWSER_FLOORS.chrome) ||
    (userAgent.includes("Firefox/") &&
      parseBrowserVersion(userAgent, /Firefox\/(\d+\.\d+)/) >=
        MODERN_BROWSER_FLOORS.firefox) ||
    (userAgent.includes("Safari") &&
      !userAgent.includes("Chrome") &&
      parseBrowserVersion(userAgent, /Version\/(\d+\.\d+)/) >=
        MODERN_BROWSER_FLOORS.safari);

  return {
    isWebDriver,
    isPhantomJS,
    isNightmare,
    isSelenium,
    isDomAutomation,
    isHeadless,
    isSuspiciousResolution,
    isUserAgentValid,
    isWebGLSupported,
    isModern,
    isMissingChromeObject: isMissingChromeObject(context),
    isSoftwareRenderer: isSoftwareRenderer(context),
    isSuspiciousWindowDimensions: isSuspiciousWindowDimensions(context),
    isEmptyPlugins: isEmptyPlugins(context),
    isAutomationArtifacts: hasAutomationArtifacts,
    isPlaywright: isPlaywrightClient,
    isPuppeteer: isPuppeteerClient,
    isChromeDriver: isChromeDriverClient,
    isSuspiciousWebDriverDescriptor: isSuspiciousWebDriverDescriptor(context),
    isUserAgentDataMismatch: isUserAgentDataMismatch(context),
    isLanguageInconsistent: isLanguageInconsistent(context),
    isPluginMimeTypeInconsistent: isPluginMimeTypeInconsistent(context),
    isNativeFunctionTampered: isNativeFunctionTampered(context),
    isNavigatorIdentityInconsistent: isNavigatorIdentityInconsistent(context),
    isPluginArrayInconsistent: isPluginArrayInconsistent(context),
    isIframeInconsistent: isIframeInconsistent(context),
    isErrorStackAutomation: isErrorStackAutomation(context),
    isDefaultAutomationViewport: isDefaultAutomationViewport(context),
    isSuspiciousHardware: isSuspiciousHardware(context),
    isZeroConnectionRtt: isZeroConnectionRtt(context),
    isCanvasTampered: isCanvasTampered(context),
    isEngineInconsistent: isEngineInconsistent(context),
    isGpuPlatformMismatch: isGpuPlatformMismatch(context),
    isMediaQueryInconsistent: isMediaQueryInconsistent(context),
    isScreenGeometryInconsistent: isScreenGeometryInconsistent(context),
    isMissingProprietaryCodecs: isMissingProprietaryCodecs(context),
    isCanvasNoiseInjected: isCanvasNoiseInjected(context),
    isTimezoneInconsistent: isTimezoneInconsistent(context),
    isMissingGreaseBrand: isMissingGreaseBrand(context),
  };
}

function createSignal(
  id: string,
  description: string,
  triggered: boolean,
  weight: number,
  confidence: InstantConfidenceLevel,
): InstantSignal {
  return { id, description, triggered, weight, confidence, score: triggered ? weight : 0 };
}

/**
 * Builds the weighted instant signal list from the boolean checks. Pass
 * `asyncChecks` to include async-only WebGPU, CDP, permission, Client
 * Hints, and worker signals. `null`/`undefined` values are omitted.
 * @internal
 */
export function buildInstantSignals(
  checks: InstantSignalChecks,
  asyncChecks?: Partial<InstantAsyncChecks> | boolean | null,
): InstantSignal[] {
  const resolvedAsyncChecks =
    typeof asyncChecks === "boolean"
      ? { isShaderF16Supported: asyncChecks }
      : asyncChecks;
  const signals = INSTANT_SIGNAL_SPECS.map((spec) => {
    const value = checks[spec.id] ?? false;
    const triggered = spec.triggerWhenFalse ? !value : value;
    return createSignal(spec.id, spec.description, triggered, spec.weight, spec.confidence);
  });

  let hasCdpSignal = false;
  for (const spec of INSTANT_ASYNC_SIGNAL_SPECS) {
    const isCdpSignal =
      spec.id === "isCdpDetected" || spec.id === "isCdpDetectedInWorker";
    if (isCdpSignal && hasCdpSignal) {
      continue;
    }
    const value = resolvedAsyncChecks?.[spec.id];
    if (value === null || value === undefined) {
      continue;
    }
    const triggered = spec.triggerWhenFalse ? !value : value;
    if (triggered) {
      if (isCdpSignal) {
        hasCdpSignal = true;
      }
      signals.push(
        createSignal(
          spec.id,
          spec.description,
          true,
          spec.weight,
          spec.confidence,
        ),
      );
    }
  }

  return signals;
}

function classifyInstantAutomation(
  checks: BooleanChecks,
  isChromium: boolean,
  confidence: InstantConfidenceLevel,
  userAgent: string,
  signals: InstantSignal[],
): AutomationAssessment {
  const exactUaKind: AutomationKind | null =
    getScriptingUserAgentKind(userAgent);
  if (checks.isPlaywright) {
    return createAutomationAssessment(true, "playwright", "medium", [
      "Playwright binding or init-script artifact present",
    ]);
  }
  if (checks.isPuppeteer) {
    return createAutomationAssessment(true, "puppeteer", "medium", [
      "Puppeteer evaluation artifact present",
    ]);
  }
  if (checks.isSelenium) {
    return createAutomationAssessment(true, "selenium", "medium", [
      "Selenium document artifact present",
    ]);
  }
  if (checks.isChromeDriver) {
    return createAutomationAssessment(
      true,
      "browser-automation",
      "medium",
      ["ChromeDriver artifact present"],
      ["selenium"],
    );
  }
  if (checks.isPhantomJS) {
    return createAutomationAssessment(true, "phantomjs", "medium", [
      "PhantomJS global present",
    ]);
  }
  if (checks.isNightmare) {
    return createAutomationAssessment(true, "nightmare", "medium", [
      "Nightmare.js global present",
    ]);
  }

  if (exactUaKind) {
    return createAutomationAssessment(
      true,
      exactUaKind,
      "medium",
      [`User-Agent claims ${exactUaKind}`],
      isChromium ? ["browser-automation"] : [],
    );
  }

  const botUaKind = getBotUserAgentKind(userAgent);
  if (botUaKind) {
    const automationKind: AutomationKind =
      botUaKind === "crawler" || botUaKind === "http-client"
        ? "unknown"
        : botUaKind;
    const alternatives =
      botUaKind === "browser-automation" && isChromium
        ? ["patchright", "playwright", "puppeteer", "selenium"] as const
        : [];
    return createAutomationAssessment(
      true,
      automationKind,
      "high",
      [`User-Agent claims ${botUaKind}`],
      [...alternatives],
    );
  }

  const attributionSignalIds = new Set([
    "isWebDriver",
    "isWebDriverInWorker",
    "isDomAutomation",
    "isHeadless",
    "isSuspiciousWebDriverDescriptor",
  ]);
  const evidence = signals
    .filter(
      (signal) => signal.triggered && attributionSignalIds.has(signal.id),
    )
    .map((signal) => signal.description);

  const isBrowserAutomationPattern =
    checks.isWebDriver ||
    signals.some(
      (signal) => signal.id === "isWebDriverInWorker" && signal.triggered,
    ) ||
    checks.isDomAutomation ||
    checks.isHeadless ||
    checks.isSuspiciousWebDriverDescriptor;

  if (isBrowserAutomationPattern) {
    const alternatives =
      checks.isHeadless &&
      !checks.isWebDriver &&
      !checks.isDomAutomation &&
      !checks.isSuspiciousWebDriverDescriptor &&
      isChromium
        ? ["patchright", "playwright", "puppeteer", "selenium"] as const
        : ["playwright", "puppeteer", "selenium"] as const;
    return createAutomationAssessment(
      true,
      "browser-automation",
      confidence,
      evidence,
      [...alternatives],
    );
  }

  return createAutomationAssessment(false, "unknown", "low", []);
}

/**
 * Aggregates triggered instant signal weights as `1 - Π(1 - weightᵢ)`.
 * @internal
 */
export function aggregateInstantSuspicionScore(signals: InstantSignal[]): number {
  let keep = 1;
  for (const signal of signals) {
    if (signal.triggered) {
      keep *= 1 - signal.weight;
    }
  }
  return 1 - keep;
}

/**
 * Confidence in the verdict based on high-confidence hits and the score.
 * @internal
 */
export function resolveInstantConfidence(
  signals: InstantSignal[],
  suspicionScore: number,
): InstantConfidenceLevel {
  const triggeredHigh = signals.filter(
    (signal) => signal.triggered && signal.confidence === "high",
  ).length;

  if (triggeredHigh >= 1 || suspicionScore >= 0.7) {
    return "high";
  }

  if (suspicionScore >= 0.35) {
    return "medium";
  }

  return "low";
}

function assemble(
  checks: BooleanChecks,
  isChromium: boolean,
  scoreThreshold: number,
  userAgent: string,
  asyncChecks?: Partial<InstantAsyncChecks>,
): InstantClientResult {
  const signals = buildInstantSignals(checks, asyncChecks);
  const suspicionScore = aggregateInstantSuspicionScore(signals);
  const confidence = resolveInstantConfidence(signals, suspicionScore);
  const isLegitClient = suspicionScore < scoreThreshold;

  return {
    ...checks,
    isChromium,
    suspicionScore,
    confidence,
    signals,
    isLegitClient,
    automation: classifyInstantAutomation(
      checks,
      isChromium,
      confidence,
      userAgent,
      signals,
    ),
  };
}

/**
 * Instant environment checks (automation, headless, UA, WebGL, etc.), scored
 * into a weighted `suspicionScore`. For Chromium WebGPU `shader-f16`
 * validation, use {@link detectInstantClientAsync}.
 */
export function detectInstantClient(
  context: ExtendedWindow,
  options: InstantDetectorOptions = {},
): InstantClientResult {
  const scoreThreshold = options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const checks = detectSync(context);
  const isChromium = isChromiumBrowser(context);

  return assemble(
    checks,
    isChromium,
    scoreThreshold,
    context.navigator.userAgent,
  );
}

/**
 * Instant checks plus async WebGPU, CDP, permissions, high-entropy Client
 * Hints, and worker-realm consistency checks.
 */
export async function detectInstantClientAsync(
  context: ExtendedWindow,
  options: InstantDetectorOptions = {},
): Promise<InstantClientAsyncResult> {
  const scoreThreshold = options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  const checks = detectSync(context);
  const isChromium = isChromiumBrowser(context);
  const [
    shaderF16Supported,
    isCdpDetected,
    isNotificationPermissionInconsistent,
    isHighEntropyUserAgentDataMismatch,
    isMissingMediaDevices,
    isVoiceListInconsistent,
    workerChecks,
  ] = await Promise.all([
    isChromium ? checkShaderF16Support(context) : Promise.resolve(null),
    checkCdpRuntime(context),
    checkNotificationPermissionConsistency(context),
    checkHighEntropyUserAgentData(context),
    checkMediaDevices(context),
    checkSpeechVoices(context),
    checkWorkerConsistency(context),
  ]);
  const asyncChecks: InstantAsyncChecks = {
    isShaderF16Supported: shaderF16Supported,
    isCdpDetected,
    isNotificationPermissionInconsistent,
    isHighEntropyUserAgentDataMismatch,
    isMissingMediaDevices,
    isVoiceListInconsistent,
    ...workerChecks,
  };

  return {
    ...assemble(
      checks,
      isChromium,
      scoreThreshold,
      context.navigator.userAgent,
      asyncChecks,
    ),
    ...asyncChecks,
  };
}

/**
 * Returns `true` if the client looks human according to instant checks
 * (i.e. `detectInstantClient(...).isLegitClient`).
 *
 * This is the simplest entry point from the `bot-signal` package for most browser use cases.
 */
export function isHuman(
  context: ExtendedWindow,
  options: InstantDetectorOptions = {},
): boolean {
  return detectInstantClient(context, options).isLegitClient;
}

/**
 * Async version that adds WebGPU, CDP, permissions, high-entropy Client Hints,
 * and worker-realm consistency checks.
 */
export async function isHumanAsync(
  context: ExtendedWindow,
  options: InstantDetectorOptions = {},
): Promise<boolean> {
  const result = await detectInstantClientAsync(context, options);
  return result.isLegitClient;
}

export {
  isAutomationArtifacts,
  isCanvasNoiseInjected,
  isCanvasTampered,
  isChromeDriver,
  isDefaultAutomationViewport,
  isEmptyPlugins,
  isEngineInconsistent,
  isErrorStackAutomation,
  isGpuPlatformMismatch,
  isIframeInconsistent,
  isLanguageInconsistent,
  isMediaQueryInconsistent,
  isMissingChromeObject,
  isMissingGreaseBrand,
  isMissingProprietaryCodecs,
  isNativeFunctionTampered,
  isNavigatorIdentityInconsistent,
  isPlaywright,
  isPluginArrayInconsistent,
  isPluginMimeTypeInconsistent,
  isPuppeteer,
  isScreenGeometryInconsistent,
  isSoftwareRenderer,
  isSuspiciousHardware,
  isSuspiciousWebDriverDescriptor,
  isSuspiciousWindowDimensions,
  isTimezoneInconsistent,
  isUserAgentDataMismatch,
  isZeroConnectionRtt,
} from "./checks.js";
export {
  checkCdpRuntime,
  checkHighEntropyUserAgentData,
  checkMediaDevices,
  checkNotificationPermissionConsistency,
  checkSpeechVoices,
  checkWorkerConsistency,
} from "./asyncChecks.js";
export type { WorkerChecks } from "./asyncChecks.js";
export type {
  AutomationAssessment,
  AutomationConfidence,
  AutomationKind,
} from "./automation.js";
export { isBotUserAgent } from "./userAgent.js";
export { checkShaderF16Support, isChromiumBrowser } from "./webgpu.js";
