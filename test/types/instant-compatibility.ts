import { buildInstantSignals } from "../../src/browser.js";
import type {
  AutomationKind,
  InstantAsyncChecks,
  WorkerChecks,
} from "../../src/browser.js";

// Exact pre-2.0.4 input shape: newly added checks must remain optional so
// existing typed callers continue to compile after a patch upgrade.
const legacyChecks = {
  isWebDriver: false,
  isPhantomJS: false,
  isNightmare: false,
  isSelenium: false,
  isDomAutomation: false,
  isHeadless: false,
  isSuspiciousResolution: false,
  isUserAgentValid: true,
  isWebGLSupported: true,
  isModern: true,
  isMissingChromeObject: false,
  isSoftwareRenderer: false,
  isSuspiciousWindowDimensions: false,
  isEmptyPlugins: false,
  isAutomationArtifacts: false,
  isPlaywright: false,
  isPuppeteer: false,
  isChromeDriver: false,
  isSuspiciousWebDriverDescriptor: false,
  isUserAgentDataMismatch: false,
  isLanguageInconsistent: false,
  isPluginMimeTypeInconsistent: false,
};

buildInstantSignals(legacyChecks, false);

// Exact async/worker shapes from before worker WebGL comparison was added.
const legacyAsyncChecks: InstantAsyncChecks = {
  isShaderF16Supported: null,
  isCdpDetected: null,
  isNotificationPermissionInconsistent: null,
  isHighEntropyUserAgentDataMismatch: null,
  isWorkerInconsistent: null,
  isCdpDetectedInWorker: null,
  isMissingMediaDevices: null,
};
const legacyWorkerChecks: WorkerChecks = {
  isWorkerInconsistent: null,
  isCdpDetectedInWorker: null,
};

buildInstantSignals(legacyChecks, legacyAsyncChecks);
void legacyWorkerChecks;

function exhaustLegacyAutomationKind(kind: AutomationKind): string {
  switch (kind) {
    case "unknown":
    case "browser-automation":
    case "playwright":
    case "patchright":
    case "puppeteer":
    case "selenium":
    case "phantomjs":
    case "nightmare":
    case "curl":
    case "python":
    case "go":
    case "java":
      return kind;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

exhaustLegacyAutomationKind("unknown");
