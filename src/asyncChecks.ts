import type { ExtendedWindow } from "./types.js";

export interface WorkerChecks {
  isWorkerInconsistent: boolean | null;
  isCdpDetectedInWorker: boolean | null;
}

interface WorkerNavigatorSnapshot {
  userAgent: string;
  language: string;
  languages: string[];
  platform: string;
  hardwareConcurrency: number;
  cdpDetected: boolean;
}

const EMPTY_WORKER_CHECKS: WorkerChecks = {
  isWorkerInconsistent: null,
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
  setTimeout(() => {
    self.postMessage({
      userAgent: navigator.userAgent,
      language: navigator.language,
      languages: Array.from(navigator.languages || []),
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
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
  if (typeof context.console?.debug !== "function") {
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
    await Promise.resolve();
    return accessed;
  } catch {
    return null;
  }
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

function compareWorkerSnapshot(
  context: ExtendedWindow,
  snapshot: WorkerNavigatorSnapshot,
): boolean {
  const navigator = context.navigator;
  return (
    navigator.userAgent !== snapshot.userAgent ||
    navigator.language !== snapshot.language ||
    JSON.stringify(Array.from(navigator.languages ?? [])) !==
      JSON.stringify(snapshot.languages) ||
    navigator.platform !== snapshot.platform ||
    navigator.hardwareConcurrency !== snapshot.hardwareConcurrency
  );
}

/** Compares Navigator values and the CDP side effect in a dedicated worker. */
export async function checkWorkerConsistency(
  context: ExtendedWindow,
): Promise<WorkerChecks> {
  if (!context.Worker || !context.Blob || !context.URL?.createObjectURL) {
    return EMPTY_WORKER_CHECKS;
  }

  const urlConstructor = context.URL;
  let objectUrl: string;
  try {
    const blob = new context.Blob([WORKER_SOURCE], {
      type: "text/javascript",
    });
    objectUrl = urlConstructor.createObjectURL(blob);
  } catch {
    return EMPTY_WORKER_CHECKS;
  }

  let worker: Worker;
  try {
    worker = new context.Worker(objectUrl);
  } catch {
    urlConstructor.revokeObjectURL(objectUrl);
    return EMPTY_WORKER_CHECKS;
  }

  return new Promise((resolve) => {
    const finish = (result: WorkerChecks) => {
      context.clearTimeout(timeout);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      urlConstructor.revokeObjectURL(objectUrl);
      resolve(result);
    };
    const timeout = context.setTimeout(
      () => finish(EMPTY_WORKER_CHECKS),
      500,
    );

    worker.onmessage = (event: MessageEvent<WorkerNavigatorSnapshot>) => {
      const snapshot = event.data;
      finish({
        isWorkerInconsistent: compareWorkerSnapshot(context, snapshot),
        isCdpDetectedInWorker:
          typeof snapshot.cdpDetected === "boolean"
            ? snapshot.cdpDetected
            : null,
      });
    };
    worker.onerror = () => finish(EMPTY_WORKER_CHECKS);
  });
}
