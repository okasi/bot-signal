import {
  createAutomationAssessment,
  type AutomationAssessment,
  type AutomationKind,
} from "./automation.js";
import {
  checkCdpRuntime,
  checkHighEntropyUserAgentData,
  checkNotificationPermissionConsistency,
  checkWorkerConsistency,
} from "./asyncChecks.js";
import {
  isAutomationArtifacts,
  isCanvasTampered,
  isChromeDriver,
  isDefaultAutomationViewport,
  isEmptyPlugins,
  isErrorStackAutomation,
  isIframeInconsistent,
  isLanguageInconsistent,
  isMissingChromeObject,
  isNativeFunctionTampered,
  isNavigatorIdentityInconsistent,
  isPlaywright,
  isPluginArrayInconsistent,
  isPluginMimeTypeInconsistent,
  isPuppeteer,
  isSoftwareRenderer,
  isSuspiciousHardware,
  isSuspiciousWebDriverDescriptor,
  isSuspiciousWindowDimensions,
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
} from "./types.js";
import { getScriptingUserAgentKind } from "./userAgent.js";
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
  { id: "isAutomationArtifacts", description: "Automation framework/runtime artifacts present", weight: 1, confidence: "high" },
  { id: "isSelenium", description: "Selenium markers on document", weight: 1, confidence: "high" },
  { id: "isPhantomJS", description: "PhantomJS globals present", weight: 1, confidence: "high" },
  { id: "isNightmare", description: "Nightmare.js marker present", weight: 1, confidence: "high" },
  { id: "isDomAutomation", description: "DOM automation controller globals present", weight: 1, confidence: "high" },
  { id: "isHeadless", description: "HeadlessChrome user agent/appVersion or webdriver flag", weight: 0.9, confidence: "high" },
  { id: "isSuspiciousWebDriverDescriptor", description: "navigator.webdriver descriptor was tampered with", weight: 0.9, confidence: "high" },
  { id: "isSuspiciousResolution", description: "Screen smaller than any real device", weight: 0.7, confidence: "medium" },
  { id: "isUserAgentValid", description: "User agent is malformed or identifies a scripting client", weight: 0.7, confidence: "high", triggerWhenFalse: true },
  { id: "isSoftwareRenderer", description: "WebGL uses a software renderer (SwiftShader/llvmpipe)", weight: 0.6, confidence: "medium" },
  { id: "isUserAgentDataMismatch", description: "User-Agent conflicts with Client Hints", weight: 0.65, confidence: "high" },
  { id: "isNativeFunctionTampered", description: "Native browser functions or Navigator getters were patched", weight: 0.8, confidence: "high" },
  { id: "isNavigatorIdentityInconsistent", description: "Navigator vendor/platform/product/touch claims conflict with the User-Agent", weight: 0.65, confidence: "high" },
  { id: "isPluginArrayInconsistent", description: "Plugin or MIME-type arrays have non-native prototypes", weight: 0.65, confidence: "high" },
  { id: "isIframeInconsistent", description: "Navigator values differ between the main realm and a fresh iframe", weight: 0.8, confidence: "high" },
  { id: "isErrorStackAutomation", description: "Error stack contains an automation source marker", weight: 0.85, confidence: "high" },
  { id: "isLanguageInconsistent", description: "Navigator language values are inconsistent", weight: 0.45, confidence: "medium" },
  { id: "isPluginMimeTypeInconsistent", description: "Plugin and MIME-type arrays are inconsistent", weight: 0.45, confidence: "medium" },
  { id: "isMissingChromeObject", description: "Chromium user agent without window.chrome", weight: 0.35, confidence: "low" },
  { id: "isWebGLSupported", description: "No WebGL context available", weight: 0.35, confidence: "low", triggerWhenFalse: true },
  { id: "isSuspiciousWindowDimensions", description: "No window chrome and parked at the screen origin", weight: 0.3, confidence: "low" },
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
  { id: "isCdpDetected", description: "Chrome DevTools Protocol serialized an Error object", weight: 0.7, confidence: "medium" },
  { id: "isNotificationPermissionInconsistent", description: "Notification and Permissions API states contradict", weight: 0.55, confidence: "high" },
  { id: "isHighEntropyUserAgentDataMismatch", description: "High-entropy Client Hints conflict with the User-Agent", weight: 0.65, confidence: "high" },
  { id: "isWorkerInconsistent", description: "Worker Navigator values conflict with the main realm", weight: 0.8, confidence: "high" },
  { id: "isCdpDetectedInWorker", description: "Chrome DevTools Protocol serialized an Error inside a worker", weight: 0.7, confidence: "medium" },
];

function parseBrowserVersion(userAgent: string, pattern: RegExp): number {
  const match = userAgent.match(pattern);
  return parseFloat(match?.[1] ?? "0");
}

function detectSync(context: ExtendedWindow): BooleanChecks {
  // Inspired by Cloudflare https://scrapeops.io/web-scraping-playbook/how-to-bypass-cloudflare/#low-level-bypass
  const isWebDriver = Boolean(context.navigator?.webdriver);
  const isPhantomJS = Boolean(context.callPhantom || context._phantom);
  const isNightmare = Boolean(context.__nightmare);
  const isSelenium = Boolean(
    context._Selenium_IDE_Recorder ||
      context._selenium ||
      context.calledSelenium ||
      context.document.__selenium_evaluate ||
      context.document.__selenium_unwrapped ||
      context.document.__webdriver_evaluate ||
      context.document.__driver_evaluate ||
      context.document.__fxdriver_evaluate ||
      context.document.__driver_unwrapped ||
      context.document.__webdriver_unwrapped,
  );
  const isDomAutomation = Boolean(
    context.domAutomation || context.domAutomationController,
  );

  // Custom checks by okasi
  const isHeadless = Boolean(
    context.navigator.webdriver ||
      context.navigator.userAgent.includes("Headless") ||
      context.navigator.appVersion?.includes("Headless"),
  );
  const isSuspiciousResolution =
    context.screen.width < 136 || context.screen.height < 170; // Apple Watch Series 3 (38mm)
  const isUserAgentValid =
    context.navigator.userAgent.startsWith("Mozilla/5.0 (") &&
    getScriptingUserAgentKind(context.navigator.userAgent) === null;
  const isWebGLSupported = Boolean(
    context.document.createElement("canvas").getContext("webgl"),
  );

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
    isAutomationArtifacts: isAutomationArtifacts(context),
    isPlaywright: isPlaywright(context),
    isPuppeteer: isPuppeteer(context),
    isChromeDriver: isChromeDriver(context),
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
 * Pass `asyncChecks` to include async-only WebGPU, CDP, permission, Client
 * Hints, and worker signals. `null`/`undefined` values are omitted.
 * @internal
 */
export function buildInstantSignals(
  checks: BooleanChecks,
  asyncChecks?: Partial<InstantAsyncChecks> | boolean | null,
): InstantSignal[] {
  const resolvedAsyncChecks =
    typeof asyncChecks === "boolean"
      ? { isShaderF16Supported: asyncChecks }
      : asyncChecks;
  const signals = INSTANT_SIGNAL_SPECS.map((spec) => {
    const value = checks[spec.id];
    const triggered = spec.triggerWhenFalse ? !value : value;
    return createSignal(spec.id, spec.description, triggered, spec.weight, spec.confidence);
  });

  for (const spec of INSTANT_ASYNC_SIGNAL_SPECS) {
    const value = resolvedAsyncChecks?.[spec.id];
    if (value === null || value === undefined) {
      continue;
    }
    const triggered = spec.triggerWhenFalse ? !value : value;
    if (triggered) {
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

  const attributionSignalIds = new Set([
    "isWebDriver",
    "isAutomationArtifacts",
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
    checks.isAutomationArtifacts ||
    checks.isDomAutomation ||
    checks.isHeadless ||
    checks.isSuspiciousWebDriverDescriptor;

  if (isBrowserAutomationPattern) {
    const alternatives =
      checks.isHeadless &&
      !checks.isWebDriver &&
      !checks.isDomAutomation &&
      !checks.isSuspiciousWebDriverDescriptor &&
      !checks.isAutomationArtifacts &&
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
  const shaderF16Supported = isChromium
    ? await checkShaderF16Support(context)
    : null;
  const [
    isCdpDetected,
    isNotificationPermissionInconsistent,
    isHighEntropyUserAgentDataMismatch,
    workerChecks,
  ] = await Promise.all([
    checkCdpRuntime(context),
    checkNotificationPermissionConsistency(context),
    checkHighEntropyUserAgentData(context),
    checkWorkerConsistency(context),
  ]);
  const asyncChecks: InstantAsyncChecks = {
    isShaderF16Supported: shaderF16Supported,
    isCdpDetected,
    isNotificationPermissionInconsistent,
    isHighEntropyUserAgentDataMismatch,
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
 * Async version (from the `bot-signal` package) that also runs the WebGPU `shader-f16` check on Chromium.
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
  isCanvasTampered,
  isChromeDriver,
  isDefaultAutomationViewport,
  isEmptyPlugins,
  isErrorStackAutomation,
  isIframeInconsistent,
  isLanguageInconsistent,
  isMissingChromeObject,
  isNativeFunctionTampered,
  isNavigatorIdentityInconsistent,
  isPlaywright,
  isPluginArrayInconsistent,
  isPluginMimeTypeInconsistent,
  isPuppeteer,
  isSoftwareRenderer,
  isSuspiciousHardware,
  isSuspiciousWebDriverDescriptor,
  isSuspiciousWindowDimensions,
  isUserAgentDataMismatch,
  isZeroConnectionRtt,
} from "./checks.js";
export {
  checkCdpRuntime,
  checkHighEntropyUserAgentData,
  checkNotificationPermissionConsistency,
  checkWorkerConsistency,
} from "./asyncChecks.js";
export type { WorkerChecks } from "./asyncChecks.js";
export type {
  AutomationAssessment,
  AutomationConfidence,
  AutomationKind,
} from "./automation.js";
export { checkShaderF16Support, isChromiumBrowser } from "./webgpu.js";
