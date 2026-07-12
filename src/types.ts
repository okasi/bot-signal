import type { AutomationAssessment } from "./automation.js";

export interface ExtendedDocument extends Document {
  __selenium_unwrapped?: unknown;
  __webdriver_evaluate?: unknown;
  __driver_evaluate?: unknown;
}

export interface ExtendedNavigator extends Omit<Navigator, "gpu"> {
  gpu?: GPU;
  userAgentData?: {
    brands: Array<{ brand: string; version: string }>;
    mobile?: boolean;
    platform?: string;
  };
}

export interface ExtendedWindow extends Omit<Window, "document" | "navigator"> {
  callPhantom?: unknown;
  _phantom?: unknown;
  __nightmare?: unknown;
  __playwright?: unknown;
  __pw_manual?: unknown;
  __playwright__binding__?: unknown;
  __pwInitScripts?: unknown;
  __puppeteer_evaluation_script__?: unknown;
  _WEBDRIVER_ELEM_CACHE?: unknown;
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

export interface InstantClientAsyncResult extends InstantClientResult {
  /** `true`/`false` on Chromium; `null` when the check does not apply */
  isShaderF16Supported: boolean | null;
}
