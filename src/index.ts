export {
  checkShaderF16Support,
  default,
  detectSuspiciousClientAsync,
  isAutomationArtifacts,
  isChromiumBrowser,
  isEmptyPlugins,
  isMissingChromeObject,
  isSoftwareRenderer,
  isSuspiciousWebDriverDescriptor,
  isSuspiciousWindowDimensions,
} from "./detectSuspiciousClient.js";
export type {
  ExtendedDocument,
  ExtendedNavigator,
  ExtendedWindow,
  SuspiciousClientAsyncResult,
  SuspiciousClientResult,
} from "./types.js";
