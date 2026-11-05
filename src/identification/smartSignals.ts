import { getPropertySafely, readWebGlIdentity } from "../checks.js";
import type { ExtendedWindow, InstantClientResult } from "../types.js";
import type { ClientSmartSignals, PrivacyBrowserKind } from "./types.js";

/** Instant-check ids that mean the page's APIs were rewritten by an extension, spoofer or framework. */
export const TAMPERING_SIGNAL_IDS = [
  "isNativeFunctionTampered",
  "isCanvasNoiseInjected",
  "isCanvasTampered",
  "isNavigatorIdentityInconsistent",
  "isIframeInconsistent",
  "isUserAgentDataMismatch",
  "isEngineInconsistent",
  "isTimezoneInconsistent",
  "isPluginArrayInconsistent",
  "isSuspiciousWebDriverDescriptor",
] as const;

const VIRTUAL_MACHINE_RENDERERS =
  /VMware|VirtualBox|Parallels|Hyper-V|QEMU|Virtio|virgl|Red Hat|Citrix|Microsoft Basic Render|llvmpipe|SwiftShader|softpipe/i;

/** Fallback heap limit (1 GiB) when `performance.memory` is unavailable. */
const DEFAULT_HEAP_LIMIT = 1_073_741_824;

interface StorageManagerLike {
  estimate?: () => Promise<{ quota?: number }>;
  getDirectory?: () => Promise<unknown>;
}

function getEngine(userAgent: string): "chromium" | "gecko" | "webkit" | null {
  if (/Firefox\//.test(userAgent)) {
    return "gecko";
  }
  if (/Chrome\/|CriOS\/|Edg\//.test(userAgent)) {
    return "chromium";
  }
  if (/AppleWebKit\//.test(userAgent)) {
    return "webkit";
  }
  return null;
}

async function opfsRejectsAsPrivate(
  storage: StorageManagerLike,
  pattern: RegExp,
): Promise<boolean | null> {
  if (typeof storage.getDirectory !== "function") {
    return null;
  }
  try {
    await storage.getDirectory();
    return false;
  } catch (error) {
    return pattern.test(String((error as Error | undefined)?.message ?? error));
  }
}

/**
 * Best-effort private-browsing detection.
 *
 * Chromium caps incognito storage quota to a fraction of memory instead of
 * disk; Firefox and Safari refuse the origin-private file system in private
 * windows with recognisable errors. Returns `null` when no heuristic applies.
 */
export async function detectIncognito(
  context: ExtendedWindow,
): Promise<boolean | null> {
  try {
    const storage = getPropertySafely(context.navigator, "storage") as
      | StorageManagerLike
      | undefined;
    if (!storage) {
      return null;
    }

    const engine = getEngine(context.navigator.userAgent ?? "");
    if (engine === "gecko") {
      return await opfsRejectsAsPrivate(storage, /security/i);
    }
    if (engine === "webkit") {
      return await opfsRejectsAsPrivate(storage, /unknown transient reason/i);
    }
    if (engine === null || typeof storage.estimate !== "function") {
      return null;
    }

    const { quota } = await storage.estimate();
    if (typeof quota !== "number") {
      return null;
    }
    const memory = getPropertySafely(context.performance ?? {}, "memory") as
      | { jsHeapSizeLimit?: number }
      | undefined;
    const heapLimit = memory?.jsHeapSizeLimit ?? DEFAULT_HEAP_LIMIT;
    return quota < heapLimit * 2;
  } catch {
    return null;
  }
}

/**
 * Recognises Brave (self-identifies via `navigator.brave`) and Firefox's
 * resistFingerprinting mode, which pins the time zone to UTC and reports
 * exactly two logical cores.
 */
export function detectPrivacyBrowser(
  context: ExtendedWindow,
): PrivacyBrowserKind | null {
  try {
    const brave = getPropertySafely(context.navigator, "brave") as
      | { isBrave?: unknown }
      | undefined;
    if (brave && typeof brave.isBrave === "function") {
      return "brave";
    }

    const intl = context.Intl ?? Intl;
    const zone = intl.DateTimeFormat().resolvedOptions().timeZone;
    if (
      /Firefox\//.test(context.navigator.userAgent ?? "") &&
      (zone === "UTC" || zone === "Etc/UTC") &&
      context.navigator.hardwareConcurrency === 2
    ) {
      return "firefox-resist-fingerprinting";
    }

    return null;
  } catch {
    return null;
  }
}

/** WebGL renderer names a hypervisor GPU or software rasteriser. */
export function detectVirtualMachine(
  context: ExtendedWindow,
): { detected: boolean; evidence: string | null } {
  const identity = readWebGlIdentity(context);
  const match = identity
    ? `${identity.vendor} ${identity.renderer}`.match(VIRTUAL_MACHINE_RENDERERS)
    : null;
  return match
    ? { detected: true, evidence: match[0] }
    : { detected: false, evidence: null };
}

/** Triggered instant signals that indicate API tampering. */
export function getTamperingSignals(result: InstantClientResult): string[] {
  const triggered = new Set(
    result.signals.filter((signal) => signal.triggered).map((signal) => signal.id),
  );
  return TAMPERING_SIGNAL_IDS.filter((id) => triggered.has(id));
}

export async function collectClientSmartSignals(
  context: ExtendedWindow,
  instant: InstantClientResult,
): Promise<ClientSmartSignals> {
  const virtualMachine = detectVirtualMachine(context);
  return {
    incognito: await detectIncognito(context),
    privacyBrowser: detectPrivacyBrowser(context),
    virtualMachine: virtualMachine.detected,
    virtualMachineEvidence: virtualMachine.evidence,
    tampering: getTamperingSignals(instant),
  };
}
