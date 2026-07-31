import type { AutomationAssessment } from "./automation.js";

export interface ExtendedDocument extends Document {
  __selenium_evaluate?: unknown;
  __selenium_unwrapped?: unknown;
  __webdriver_evaluate?: unknown;
  __driver_evaluate?: unknown;
  __fxdriver_evaluate?: unknown;
  __driver_unwrapped?: unknown;
  __webdriver_unwrapped?: unknown;
}

export interface ExtendedNavigator extends Omit<Navigator, "gpu"> {
  gpu?: GPU;
  deviceMemory?: number;
  connection?: { rtt?: number };
  userAgentData?: {
    brands: Array<{ brand: string; version: string }>;
    mobile?: boolean;
    platform?: string;
    getHighEntropyValues?: (hints: string[]) => Promise<{
      brands?: Array<{ brand: string; version: string }>;
      fullVersionList?: Array<{ brand: string; version: string }>;
      mobile?: boolean;
      platform?: string;
      platformVersion?: string;
      architecture?: string;
      bitness?: string;
      model?: string;
      formFactors?: string[];
    }>;
  };
}

export interface ExtendedWindow extends Omit<Window, "document" | "navigator"> {
  Blob?: typeof Blob;
  Error?: ErrorConstructor;
  Function?: FunctionConstructor;
  MimeType?: { prototype: MimeType; new (): MimeType };
  MimeTypeArray?: { prototype: MimeTypeArray; new (): MimeTypeArray };
  Notification?: typeof Notification;
  Plugin?: { prototype: Plugin; new (): Plugin };
  PluginArray?: { prototype: PluginArray; new (): PluginArray };
  URL?: typeof URL;
  Worker?: typeof Worker;
  console?: Console;
  callPhantom?: unknown;
  callSelenium?: unknown;
  _phantom?: unknown;
  __nightmare?: unknown;
  __playwright?: unknown;
  __pw_manual?: unknown;
  __playwright__binding__?: unknown;
  __pwInitScripts?: unknown;
  __puppeteer_evaluation_script__?: unknown;
  _WEBDRIVER_ELEM_CACHE?: unknown;
  _Selenium_IDE_Recorder?: unknown;
  _selenium?: unknown;
  calledSelenium?: unknown;
  awesomium?: unknown;
  RunPerfTest?: unknown;
  CefSharp?: unknown;
  fmget_targets?: unknown;
  geb?: unknown;
  nightmare?: unknown;
  __phantomas?: unknown;
  wdioElectron?: unknown;
  process?: {
    type?: string;
    versions?: { electron?: string };
  };
  chrome?: { runtime?: unknown };
  domAutomation?: unknown;
  domAutomationController?: unknown;
  document: ExtendedDocument;
  navigator: ExtendedNavigator;
}

export type InstantConfidenceLevel = "high" | "medium" | "low";

/** One weighted instant check, mirroring behavioral and server signals. */
export interface InstantSignal {
  /** Matches the corresponding boolean field on {@link InstantClientResult} */
  id: string;
  description: string;
  triggered: boolean;
  weight: number;
  confidence: InstantConfidenceLevel;
  /** `weight` when triggered, else 0 */
  score: number;
}

export interface InstantDetectorOptions {
  /**
   * Suspicion score at/above which `isLegitClient` becomes false.
   * Defaults to 0.5. Definitive automation markers weigh 0.9–1.0 (blocking on
   * their own); ambiguous, false-positive-prone checks weigh 0.25–0.45 so they
   * only block in combination.
   */
  scoreThreshold?: number;
}

export interface InstantClientResult {
  isWebDriver: boolean;
  isPhantomJS: boolean;
  isNightmare: boolean;
  isSelenium: boolean;
  isDomAutomation: boolean;
  isHeadless: boolean;
  isSuspiciousResolution: boolean;
  isUserAgentValid: boolean;
  isWebGLSupported: boolean;
  isModern: boolean;
  isMissingChromeObject: boolean;
  isSoftwareRenderer: boolean;
  isSuspiciousWindowDimensions: boolean;
  isEmptyPlugins: boolean;
  isAutomationArtifacts: boolean;
  isPlaywright: boolean;
  isPuppeteer: boolean;
  isChromeDriver: boolean;
  isSuspiciousWebDriverDescriptor: boolean;
  isUserAgentDataMismatch: boolean;
  isLanguageInconsistent: boolean;
  isPluginMimeTypeInconsistent: boolean;
  isNativeFunctionTampered: boolean;
  isNavigatorIdentityInconsistent: boolean;
  isPluginArrayInconsistent: boolean;
  isIframeInconsistent: boolean;
  isErrorStackAutomation: boolean;
  isDefaultAutomationViewport: boolean;
  isSuspiciousHardware: boolean;
  isZeroConnectionRtt: boolean;
  isCanvasTampered: boolean;
  isEngineInconsistent: boolean;
  isGpuPlatformMismatch: boolean;
  isMediaQueryInconsistent: boolean;
  isScreenGeometryInconsistent: boolean;
  isMissingProprietaryCodecs: boolean;
  isChromium: boolean;
  /**
   * 0 (human) to 1 (definitely automated), aggregated as `1 - Π(1 - weightᵢ)`
   * over triggered signals — the same formula the behavioral and server layers use.
   */
  suspicionScore: number;
  confidence: InstantConfidenceLevel;
  /** Per-check breakdown with weights, for explainability */
  signals: InstantSignal[];
  isLegitClient: boolean;
  /** Best-effort family attribution with evidence and plausible alternatives. */
  automation: AutomationAssessment;
}

type InstantResultMetadata =
  | "isChromium"
  | "suspicionScore"
  | "confidence"
  | "signals"
  | "isLegitClient"
  | "automation";

type ExtendedInstantCheck =
  | "isNativeFunctionTampered"
  | "isNavigatorIdentityInconsistent"
  | "isPluginArrayInconsistent"
  | "isIframeInconsistent"
  | "isErrorStackAutomation"
  | "isDefaultAutomationViewport"
  | "isSuspiciousHardware"
  | "isZeroConnectionRtt"
  | "isCanvasTampered"
  | "isEngineInconsistent"
  | "isGpuPlatformMismatch"
  | "isMediaQueryInconsistent"
  | "isScreenGeometryInconsistent"
  | "isMissingProprietaryCodecs";

/** Boolean inputs accepted by {@link buildInstantSignals}. */
export type InstantSignalChecks =
  Omit<InstantClientResult, InstantResultMetadata | ExtendedInstantCheck> &
  Partial<Pick<InstantClientResult, ExtendedInstantCheck>>;

export interface InstantClientAsyncResult extends InstantClientResult {
  /** `true`/`false` on Chromium; `null` when the check does not apply */
  isShaderF16Supported: boolean | null;
  /** CDP serialized a diagnostic object; `null` when console probing is unavailable */
  isCdpDetected: boolean | null;
  /** Notification and Permissions API states contradict; `null` when unavailable */
  isNotificationPermissionInconsistent: boolean | null;
  /** High-entropy Client Hints contradict the User-Agent; `null` when unavailable */
  isHighEntropyUserAgentDataMismatch: boolean | null;
  /** Worker navigator values contradict the main realm; `null` when unavailable */
  isWorkerInconsistent: boolean | null;
  /** CDP serialized a diagnostic object inside a worker; `null` when unavailable */
  isCdpDetectedInWorker: boolean | null;
  /** Desktop Chromium enumerated no media devices at all; `null` when unavailable */
  isMissingMediaDevices: boolean | null;
}

/** Async-only values accepted by {@link buildInstantSignals}. */
export type InstantAsyncChecks = Pick<
  InstantClientAsyncResult,
  | "isShaderF16Supported"
  | "isCdpDetected"
  | "isNotificationPermissionInconsistent"
  | "isHighEntropyUserAgentDataMismatch"
  | "isWorkerInconsistent"
  | "isCdpDetectedInWorker"
  | "isMissingMediaDevices"
>;
