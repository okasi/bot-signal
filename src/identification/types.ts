/**
 * Browser components used for device identification. High-entropy values are
 * hashed in the page (`hash64`); short, low-entropy values are sent as-is so
 * the server can also reason about them (time zone, languages, platform).
 * `null` means the component could not be read in this browser.
 */
export const DEVICE_COMPONENT_NAMES = [
  "canvas",
  "webgl",
  "webglParams",
  "audio",
  "fonts",
  "screen",
  "timezone",
  "languages",
  "platform",
  "hardware",
  "touch",
  "math",
  "mediaQueries",
  "intl",
  "vendor",
  "plugins",
  "architecture",
  "browser",
] as const;

export type DeviceComponentName = (typeof DEVICE_COMPONENT_NAMES)[number];

export type DeviceComponents = Record<DeviceComponentName, string | null>;

/** Privacy-focused browser or anti-fingerprinting mode, when recognisable. */
export type PrivacyBrowserKind = "brave" | "firefox-resist-fingerprinting";

export interface ClientSmartSignals {
  /** `true`/`false` when a known storage-quota or OPFS heuristic applies; `null` when unknown. */
  incognito: boolean | null;
  privacyBrowser: PrivacyBrowserKind | null;
  /** WebGL renderer names a hypervisor or software rasteriser. */
  virtualMachine: boolean;
  /** Renderer substring that triggered `virtualMachine`, when it did. */
  virtualMachineEvidence: string | null;
  /** Instant-check ids that indicate the browser's APIs were rewritten. */
  tampering: string[];
}

/** Summary of the in-page instant detection run. Advisory: the server treats it as untrusted. */
export interface ClientDetectionSummary {
  suspicionScore: number;
  signals: string[];
  automationKind: string;
}

export interface DeviceSignalsPayload {
  /** Payload schema version. */
  v: 1;
  components: DeviceComponents;
  smartSignals: ClientSmartSignals;
  detection: ClientDetectionSummary;
  /** Opaque first-party token previously issued by the server, if stored. */
  storageToken: string | null;
  /** Milliseconds spent collecting, for diagnostics. */
  durationMs: number;
}
