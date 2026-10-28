import {
  DEVICE_COMPONENT_NAMES,
  type ClientSmartSignals,
  type DeviceComponents,
  type DeviceSignalsPayload,
  type PrivacyBrowserKind,
} from "../identification/types.js";

export class InvalidPayloadError extends Error {
  constructor(message: string) {
    super(`Invalid bot-signal payload: ${message}`);
    this.name = "InvalidPayloadError";
  }
}

const MAX_COMPONENT_LENGTH = 256;
const MAX_SIGNAL_COUNT = 100;
const MAX_ID_LENGTH = 64;
const SIGNAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const PRIVACY_BROWSERS: readonly PrivacyBrowserKind[] = [
  "brave",
  "firefox-resist-fingerprinting",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new InvalidPayloadError(`${field} must be an object`);
  }
  return value;
}

function parseIdList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_SIGNAL_COUNT) {
    throw new InvalidPayloadError(`${field} must be an array of at most ${MAX_SIGNAL_COUNT} ids`);
  }
  return value.map((item) => {
    if (typeof item !== "string" || !SIGNAL_ID_PATTERN.test(item)) {
      throw new InvalidPayloadError(`${field} contains an invalid id`);
    }
    return item;
  });
}

function parseComponents(value: unknown): DeviceComponents {
  const record = requireRecord(value, "components");
  const components = {} as DeviceComponents;

  for (const name of DEVICE_COMPONENT_NAMES) {
    const component = record[name];
    if (component === null || component === undefined) {
      components[name] = null;
    } else if (typeof component === "string" && component.length <= MAX_COMPONENT_LENGTH) {
      components[name] = component;
    } else {
      throw new InvalidPayloadError(`components.${name} must be a short string or null`);
    }
  }

  return components;
}

function parseSmartSignals(value: unknown): ClientSmartSignals {
  const record = requireRecord(value, "smartSignals");
  const { incognito, privacyBrowser, virtualMachine, virtualMachineEvidence } = record;

  if (incognito !== null && typeof incognito !== "boolean") {
    throw new InvalidPayloadError("smartSignals.incognito must be boolean or null");
  }
  if (
    privacyBrowser !== null &&
    !PRIVACY_BROWSERS.includes(privacyBrowser as PrivacyBrowserKind)
  ) {
    throw new InvalidPayloadError("smartSignals.privacyBrowser is not recognised");
  }
  if (typeof virtualMachine !== "boolean") {
    throw new InvalidPayloadError("smartSignals.virtualMachine must be boolean");
  }
  if (
    virtualMachineEvidence !== null &&
    (typeof virtualMachineEvidence !== "string" ||
      virtualMachineEvidence.length > MAX_ID_LENGTH)
  ) {
    throw new InvalidPayloadError("smartSignals.virtualMachineEvidence must be a short string or null");
  }

  return {
    incognito,
    privacyBrowser: privacyBrowser as PrivacyBrowserKind | null,
    virtualMachine,
    virtualMachineEvidence,
    tampering: parseIdList(record.tampering, "smartSignals.tampering"),
  };
}

/**
 * Validates an untrusted client payload. Throws {@link InvalidPayloadError}
 * on anything unexpected, so oversized or malformed input never reaches
 * matching or storage.
 */
export function parseDevicePayload(input: unknown): DeviceSignalsPayload {
  const record = requireRecord(input, "payload");
  if (record.v !== 1) {
    throw new InvalidPayloadError("unsupported version");
  }

  const detection = requireRecord(record.detection, "detection");
  const { suspicionScore, automationKind } = detection;
  if (
    typeof suspicionScore !== "number" ||
    !Number.isFinite(suspicionScore) ||
    suspicionScore < 0 ||
    suspicionScore > 1
  ) {
    throw new InvalidPayloadError("detection.suspicionScore must be between 0 and 1");
  }
  if (typeof automationKind !== "string" || !SIGNAL_ID_PATTERN.test(automationKind)) {
    throw new InvalidPayloadError("detection.automationKind is invalid");
  }

  const { storageToken, durationMs } = record;
  if (storageToken !== null && (typeof storageToken !== "string" || !TOKEN_PATTERN.test(storageToken))) {
    throw new InvalidPayloadError("storageToken is invalid");
  }
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    throw new InvalidPayloadError("durationMs must be a non-negative number");
  }

  return {
    v: 1,
    components: parseComponents(record.components),
    smartSignals: parseSmartSignals(record.smartSignals),
    detection: {
      suspicionScore,
      signals: parseIdList(detection.signals, "detection.signals"),
      automationKind,
    },
    storageToken,
    durationMs,
  };
}
