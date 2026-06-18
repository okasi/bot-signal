import {
  isAutomationArtifacts,
  isEmptyPlugins,
  isMissingChromeObject,
  isSoftwareRenderer,
  isSuspiciousWebDriverDescriptor,
  isSuspiciousWindowDimensions,
} from "./checks.js";
import type {
  ExtendedWindow,
  SuspiciousClientAsyncResult,
  SuspiciousClientResult,
} from "./types.js";
import { checkShaderF16Support, isChromiumBrowser } from "./webgpu.js";

function parseBrowserVersion(
  userAgent: string,
  pattern: RegExp,
): number {
  const match = userAgent.match(pattern);
  return parseFloat(match?.[1] ?? "0");
}

function detectSync(context: ExtendedWindow): Omit<
  SuspiciousClientResult,
  "isChromium" | "isLegitClient"
> {
  // Inspired by Cloudflare https://scrapeops.io/web-scraping-playbook/how-to-bypass-cloudflare/#low-level-bypass
  const isWebDriver = Boolean(context.navigator?.webdriver);
  const isPhantomJS = Boolean(context.callPhantom || context._phantom);
  const isNightmare = Boolean(context.__nightmare);
  const isSelenium = Boolean(
    context.document.__selenium_unwrapped ||
      context.document.__webdriver_evaluate ||
      context.document.__driver_evaluate,
  );
  const isDomAutomation = Boolean(
    context.domAutomation || context.domAutomationController,
  );

  // Custom checks by okasi
  const isHeadless = Boolean(
    context.navigator.webdriver ||
      context.navigator.userAgent.includes("Headless"),
  );
  const isSuspiciousResolution =
    context.screen.width < 136 || context.screen.height < 170; // Apple Watch Series 3 (38mm)
  const isUserAgentValid =
    context.navigator.userAgent.startsWith("Mozilla/5.0 (");
  const isWebGLSupported = Boolean(
    context.document.createElement("canvas").getContext("webgl"),
  );

  const userAgent = context.navigator.userAgent;
  const isModern =
    (userAgent.includes("Chrome/") &&
      parseBrowserVersion(userAgent, /Chrome\/(\d+\.\d+)/) >= 121) ||
    (userAgent.includes("Firefox/") &&
      parseBrowserVersion(userAgent, /Firefox\/(\d+\.\d+)/) >= 128) ||
    (userAgent.includes("Safari") &&
      !userAgent.includes("Chrome") &&
      parseBrowserVersion(userAgent, /Version\/(\d+\.\d+)/) >= 16.4);

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
    isSuspiciousWebDriverDescriptor: isSuspiciousWebDriverDescriptor(context),
  };
}

function computeIsLegitClient(
  checks: Omit<SuspiciousClientResult, "isLegitClient"> & {
    isShaderF16Supported?: boolean | null;
  },
): boolean {
  const shaderF16Passes =
    checks.isShaderF16Supported === undefined ||
    checks.isShaderF16Supported === null ||
    checks.isShaderF16Supported;

  return (
    !checks.isWebDriver &&
    !checks.isPhantomJS &&
    !checks.isNightmare &&
    !checks.isSelenium &&
    !checks.isDomAutomation &&
    !checks.isHeadless &&
    !checks.isSuspiciousResolution &&
    checks.isUserAgentValid &&
    checks.isWebGLSupported &&
    checks.isModern &&
    !checks.isMissingChromeObject &&
    !checks.isSoftwareRenderer &&
    !checks.isSuspiciousWindowDimensions &&
    !checks.isEmptyPlugins &&
    !checks.isAutomationArtifacts &&
    !checks.isSuspiciousWebDriverDescriptor &&
    shaderF16Passes
  );
}

/**
 * Synchronous suspicious-client checks (automation, headless, UA, WebGL, etc.).
 * For Chromium WebGPU `shader-f16` validation, use {@link detectSuspiciousClientAsync}.
 */
export default function detectSuspiciousClient(
  context: ExtendedWindow,
): SuspiciousClientResult {
  const checks = detectSync(context);
  const isChromium = isChromiumBrowser(context);

  return {
    ...checks,
    isChromium,
    isLegitClient: computeIsLegitClient({ ...checks, isChromium }),
  };
}

/**
 * Full detection including async WebGPU `shader-f16` support on Chromium browsers.
 */
export async function detectSuspiciousClientAsync(
  context: ExtendedWindow,
): Promise<SuspiciousClientAsyncResult> {
  const checks = detectSync(context);
  const isChromium = isChromiumBrowser(context);
  const shaderF16Supported = isChromium
    ? await checkShaderF16Support(context)
    : null;

  return {
    ...checks,
    isChromium,
    isShaderF16Supported: shaderF16Supported,
    isLegitClient: computeIsLegitClient({
      ...checks,
      isChromium,
      isShaderF16Supported: shaderF16Supported,
    }),
  };
}

export {
  isAutomationArtifacts,
  isEmptyPlugins,
  isMissingChromeObject,
  isSoftwareRenderer,
  isSuspiciousWebDriverDescriptor,
  isSuspiciousWindowDimensions,
} from "./checks.js";
export { checkShaderF16Support, isChromiumBrowser } from "./webgpu.js";
