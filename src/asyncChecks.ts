import { hasRealmPersonaMismatch, readWebGlIdentity } from "./checks.js";
import type { ExtendedWindow } from "./types.js";
import { isChromiumBrowser } from "./webgpu.js";

// Capture the detector realm's timers once: a caller-supplied context can
// replace its timer methods with no-ops, which must not strand async detection.
const scheduleDetectorTask = globalThis.setTimeout.bind(globalThis);
const cancelDetectorTask = globalThis.clearTimeout.bind(globalThis);

/**
 * Voices that ship only with Apple's speech synthesiser. Two or more of these
 * on a machine claiming another operating system means the platform is spoofed;
 * one alone could be a third-party voice pack borrowing a common first name.
 */
const APPLE_ONLY_VOICES = new Set([
  "Alex",
  "Daniel",
  "Fiona",
  "Fred",
  "Karen",
  "Kyoko",
  "Lekha",
  "Moira",
  "Rishi",
  "Samantha",
  "Sin-ji",
  "Tessa",
  "Ting-Ting",
  "Victoria",
  "Yuna",
]);

/** How long to wait for `voiceschanged` before giving up on the voice list. */
const VOICE_LIST_TIMEOUT_MS = 300;

function bestEffort(action: () => void): void {
  try {
    action();
  } catch {}
}

export interface WorkerChecks {
  isWorkerInconsistent: boolean | null;
  /** Added after the original public shape; optional for producer compatibility. */
  isWebDriverInWorker?: boolean | null;
  /** Added after the original public shape; optional for producer compatibility. */
  isWorkerWebGLInconsistent?: boolean | null;
  isCdpDetectedInWorker: boolean | null;
}

interface WorkerNavigatorSnapshot {
  userAgent: string;
  platform: string;
  webdriver?: unknown;
  webGlVendor?: unknown;
  webGlRenderer?: unknown;
  cdpDetected: boolean;
}

const EMPTY_WORKER_CHECKS: WorkerChecks = {
  isWorkerInconsistent: null,
  isWebDriverInWorker: null,
  isWorkerWebGLInconsistent: null,
  isCdpDetectedInWorker: null,
};

const WORKER_SOURCE = `
  const error = new Error();
  let cdpDetected = false;
  Object.defineProperty(error, "stack", {
    get() {
      cdpDetected = true;
      return "";
    },
  });
  console.debug(error);
  let webGlVendor = null;
  let webGlRenderer = null;
  try {
    if (typeof OffscreenCanvas === "function") {
      const canvas = new OffscreenCanvas(1, 1);
      const gl = canvas.getContext("webgl");
      const debugInfo = gl && gl.getExtension("WEBGL_debug_renderer_info");
      if (gl && debugInfo) {
        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        webGlVendor = typeof vendor === "string" ? vendor : null;
        webGlRenderer = typeof renderer === "string" ? renderer : null;
      }
    }
  } catch {}
  setTimeout(() => {
    self.postMessage({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      webdriver: navigator.webdriver,
      webGlVendor,
      webGlRenderer,
      cdpDetected,
    });
  }, 0);
`;

function platformContradictsUserAgent(platform: string, userAgent: string): boolean {
  if (/Android/i.test(userAgent)) {
    return !/Android/i.test(platform);
  }
  if (/CrOS/i.test(userAgent)) {
    return !/Chrome OS/i.test(platform);
  }
  if (/Windows/i.test(userAgent)) {
    return !/Windows/i.test(platform);
  }
  if (/(?:Macintosh|Mac OS X)/i.test(userAgent)) {
    return !/macOS/i.test(platform);
  }
  if (/Linux/i.test(userAgent)) {
    return !/Linux/i.test(platform);
  }

  return false;
}

/** Detects the CDP Runtime serialization side effect used by Chromium automation. */
export async function checkCdpRuntime(
  context: ExtendedWindow,
): Promise<boolean | null> {
  if (
    !isChromiumBrowser(context) ||
    typeof context.console?.debug !== "function"
  ) {
    return null;
  }

  let accessed = false;
  const error = new Error();
  Object.defineProperty(error, "stack", {
    get() {
      accessed = true;
      return "";
    },
  });

  try {
    context.console.debug(error);
    await new Promise<void>((resolve) => {
      scheduleDetectorTask(resolve, 0);
    });
    return accessed;
  } catch {
    return null;
  }
}

/**
 * Desktop Chromium that enumerates no media devices at all. Headless Chrome
 * ships without audio or video endpoints; a real desktop reports at least one.
 */
export async function checkMediaDevices(
  context: ExtendedWindow,
): Promise<boolean | null> {
  const mediaDevices = context.navigator.mediaDevices;
  if (
    !isChromiumBrowser(context) ||
    /Mobi|Android/i.test(context.navigator.userAgent) ||
    typeof mediaDevices?.enumerateDevices !== "function"
  ) {
    return null;
  }

  try {
    const devices = await mediaDevices.enumerateDevices();
    return devices.length === 0;
  } catch {
    return null;
  }
}

/** Resolves once the voice list is populated, or after a short timeout. */
async function readVoices(
  synthesis: SpeechSynthesis,
): Promise<SpeechSynthesisVoice[]> {
  const voices = synthesis.getVoices();
  if (voices.length > 0 || typeof synthesis.addEventListener !== "function") {
    return voices;
  }

  // Chromium populates the list asynchronously on the first call.
  await new Promise<void>((resolve) => {
    const deadline = scheduleDetectorTask(resolve, VOICE_LIST_TIMEOUT_MS);
    synthesis.addEventListener(
      "voiceschanged",
      () => {
        bestEffort(() => cancelDetectorTask(deadline));
        resolve();
      },
      { once: true },
    );
  });

  return synthesis.getVoices();
}

/**
 * The installed speech voices contradict the platform the client claims.
 *
 * The voice list comes from the operating system and from the browser vendor's
 * own bundle, neither of which a User-Agent rewrite reaches. Anti-detect
 * browsers ship dedicated voice-table spoofing precisely because of this.
 */
export async function checkSpeechVoices(
  context: ExtendedWindow,
): Promise<boolean | null> {
  const synthesis = context.speechSynthesis;
  if (!synthesis || typeof synthesis.getVoices !== "function") {
    return null;
  }

  let voices: SpeechSynthesisVoice[];
  try {
    voices = await readVoices(synthesis);
  } catch {
    return null;
  }
  if (voices.length === 0) {
    return null;
  }

  const names = voices.map((voice) => voice.name);
  const userAgent = context.navigator.userAgent;

  if (!/(?:Macintosh|Mac OS X|iPhone|iPad|iPod)/i.test(userAgent)) {
    const appleVoices = names.filter((name) => APPLE_ONLY_VOICES.has(name));
    if (appleVoices.length >= 2) {
      return true;
    }
  }

  // Google's own voices come from a component that ships in branded Chrome and
  // not in the open-source Chromium builds automation runs. Only Windows and
  // macOS are judged: a Linux desktop can legitimately expose nothing but the
  // local speech-dispatcher voices.
  const claimsGoogleChrome = context.navigator.userAgentData?.brands.some(
    (brand) => /^Google Chrome$/i.test(brand.brand),
  );

  return Boolean(
    claimsGoogleChrome &&
      /(?:Windows|Macintosh|Mac OS X)/i.test(userAgent) &&
      !names.some((name) => name.startsWith("Google ")),
  );
}

/** Notification.permission disagrees with navigator.permissions.query(). */
export async function checkNotificationPermissionConsistency(
  context: ExtendedWindow,
): Promise<boolean | null> {
  const permissions = context.navigator.permissions;
  const notification = context.Notification;
  if (!permissions?.query || !notification) {
    return null;
  }

  try {
    const permission = await permissions.query({ name: "notifications" });
    const expectedState: PermissionState =
      notification.permission === "default"
        ? "prompt"
        : notification.permission;
    return permission.state !== expectedState;
  } catch {
    return null;
  }
}

/** High-entropy UA-CH version, mobile, or platform values contradict the UA. */
export async function checkHighEntropyUserAgentData(
  context: ExtendedWindow,
): Promise<boolean | null> {
  const data = context.navigator.userAgentData;
  const getHighEntropyValues = data?.getHighEntropyValues;
  if (!data || !getHighEntropyValues) {
    return null;
  }

  try {
    const values = await getHighEntropyValues.call(data, [
      "fullVersionList",
      "platform",
      "platformVersion",
      "architecture",
      "bitness",
      "model",
      "formFactors",
    ]);
    const userAgent = context.navigator.userAgent;
    const uaMajor = userAgent.match(/(?:Chrome|Chromium)\/(\d+)/)?.[1];
    const fullVersionMajors = values.fullVersionList
      ?.filter((brand) => /^(?:Chromium|Google Chrome)$/i.test(brand.brand))
      .map((brand) => brand.version.match(/^\d+/)?.[0])
      .filter((version): version is string => version !== undefined);

    if (
      uaMajor &&
      fullVersionMajors &&
      fullVersionMajors.length > 0 &&
      fullVersionMajors.some((version) => version !== uaMajor)
    ) {
      return true;
    }

    if (
      typeof values.mobile === "boolean" &&
      values.mobile !== /Mobi/i.test(userAgent)
    ) {
      return true;
    }

    return Boolean(
      values.platform &&
        platformContradictsUserAgent(values.platform, userAgent),
    );
  } catch {
    return null;
  }
}

/**
 * Worker and document describe different operating systems. Only the OS is
 * compared: everything softer is something fingerprint protection legitimately
 * rewrites in the document without rewriting it in the worker.
 */
function compareWorkerSnapshot(
  context: ExtendedWindow,
  snapshot: WorkerNavigatorSnapshot,
): boolean {
  return hasRealmPersonaMismatch(context.navigator, snapshot);
}

/** Compares WebGL only when both realms expose complete unmasked identities. */
function compareWorkerWebGl(
  context: ExtendedWindow,
  snapshot: WorkerNavigatorSnapshot,
): boolean | null {
  const main = readWebGlIdentity(context);
  if (
    !main?.vendor ||
    !main.renderer ||
    typeof snapshot.webGlVendor !== "string" ||
    !snapshot.webGlVendor ||
    typeof snapshot.webGlRenderer !== "string" ||
    !snapshot.webGlRenderer
  ) {
    return null;
  }

  return (
    snapshot.webGlVendor !== main.vendor ||
    snapshot.webGlRenderer !== main.renderer
  );
}

/** Compares Navigator values and the CDP side effect in a dedicated worker. */
export async function checkWorkerConsistency(
  context: ExtendedWindow,
): Promise<WorkerChecks> {
  let workerConstructor: typeof Worker | undefined;
  let blobConstructor: typeof Blob | undefined;
  let urlConstructor: typeof URL | undefined;
  let createObjectUrl: typeof URL.createObjectURL | undefined;
  let revokeObjectUrl: typeof URL.revokeObjectURL | undefined;
  try {
    workerConstructor = context.Worker;
    blobConstructor = context.Blob;
    urlConstructor = context.URL;
    createObjectUrl = urlConstructor?.createObjectURL;
    revokeObjectUrl = urlConstructor?.revokeObjectURL;
  } catch {
    return EMPTY_WORKER_CHECKS;
  }
  if (
    !workerConstructor ||
    !blobConstructor ||
    !urlConstructor ||
    typeof createObjectUrl !== "function"
  ) {
    return EMPTY_WORKER_CHECKS;
  }

  let objectUrl: string;
  try {
    const blob = new blobConstructor([WORKER_SOURCE], {
      type: "text/javascript",
    });
    objectUrl = createObjectUrl.call(urlConstructor, blob);
  } catch {
    return EMPTY_WORKER_CHECKS;
  }

  let worker: Worker;
  try {
    worker = new workerConstructor(objectUrl);
  } catch {
    bestEffort(() => {
      revokeObjectUrl?.call(urlConstructor, objectUrl);
    });
    return EMPTY_WORKER_CHECKS;
  }

  return new Promise((resolve) => {
    let settled = false;
    let deadline: ReturnType<typeof scheduleDetectorTask> | undefined;
    const finish = (result: WorkerChecks) => {
      if (settled) {
        return;
      }
      settled = true;
      bestEffort(() => cancelDetectorTask(deadline));
      bestEffort(() => {
        worker.onmessage = null;
      });
      bestEffort(() => {
        worker.onerror = null;
      });
      bestEffort(() => {
        worker.terminate();
      });
      bestEffort(() => {
        revokeObjectUrl?.call(urlConstructor, objectUrl);
      });
      resolve(result);
    };
    try {
      deadline = scheduleDetectorTask(
        () => finish(EMPTY_WORKER_CHECKS),
        500,
      );
      worker.onmessage = (event: MessageEvent<WorkerNavigatorSnapshot>) => {
        try {
          const snapshot = event.data;
          if (!snapshot || typeof snapshot !== "object") {
            finish(EMPTY_WORKER_CHECKS);
            return;
          }
          finish({
            isWorkerInconsistent: compareWorkerSnapshot(context, snapshot),
            isWebDriverInWorker:
              snapshot.webdriver === true
                ? true
                : snapshot.webdriver === false
                  ? false
                  : null,
            isWorkerWebGLInconsistent: compareWorkerWebGl(context, snapshot),
            isCdpDetectedInWorker:
              isChromiumBrowser(context) &&
              typeof snapshot.cdpDetected === "boolean"
                ? snapshot.cdpDetected
                : null,
          });
        } catch {
          finish(EMPTY_WORKER_CHECKS);
        }
      };
      worker.onerror = () => finish(EMPTY_WORKER_CHECKS);
    } catch {
      finish(EMPTY_WORKER_CHECKS);
    }
  });
}
