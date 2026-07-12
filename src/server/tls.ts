import type { ConfidenceLevel } from "./types.js";
import { getScriptingUserAgentKind } from "../userAgent.js";

export interface TlsFingerprintEntry {
  id: string;
  label: string;
  hash?: string;
  prefix?: string;
  families: UserAgentFamily[];
  confidence: ConfidenceLevel;
}

export type UserAgentFamily =
  | "chrome"
  | "chrome-headless"
  | "edge"
  | "firefox"
  | "safari"
  | "curl"
  | "python"
  | "go"
  | "java"
  | "scripting"
  | "unknown";

/** Curated automation and scripting TLS fingerprints (JA3 hash or prefix) */
export const KNOWN_SUSPICIOUS_TLS_FINGERPRINTS: TlsFingerprintEntry[] = [];

const JA3_HASH_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Whether a string is a well-formed JA3 hash (32-character lowercase MD5).
 * A hash of any other length can never match a real JA3 and is almost always
 * a typo or a truncated/expanded copy-paste.
 */
export function isValidJa3Hash(value: string): boolean {
  return JA3_HASH_PATTERN.test(value.trim().toLowerCase());
}

const BROWSER_UA_FAMILIES: UserAgentFamily[] = [
  "chrome",
  "chrome-headless",
  "edge",
  "firefox",
  "safari",
];

const UA_FAMILY_COMPATIBILITY: Record<UserAgentFamily, UserAgentFamily[]> = {
  chrome: ["chrome", "chrome-headless", "edge"],
  "chrome-headless": ["chrome", "chrome-headless", "edge"],
  edge: ["chrome", "edge", "chrome-headless"],
  firefox: ["firefox"],
  safari: ["safari"],
  curl: ["curl", "scripting"],
  python: ["python", "scripting"],
  go: ["go", "scripting"],
  java: ["java", "scripting"],
  scripting: ["scripting", "python", "curl", "go", "java"],
  unknown: [],
};

/** Lowercases and trims a JA3/JA4 fingerprint for comparison. */
export function normalizeTlsFingerprint(fingerprint: string): string {
  return fingerprint.trim().toLowerCase();
}

/** Coarse client family from a User-Agent string (`chrome`, `curl`, `python`, …). */
export function getUserAgentFamily(userAgent: string | undefined): UserAgentFamily {
  if (!userAgent) {
    return "unknown";
  }

  const scriptingFamily = getScriptingUserAgentKind(userAgent);
  if (scriptingFamily) {
    return scriptingFamily;
  }

  if (/HeadlessChrome/i.test(userAgent)) {
    return "chrome-headless";
  }

  if (/Edg\//i.test(userAgent)) {
    return "edge";
  }

  if (/Chrome\//i.test(userAgent)) {
    return "chrome";
  }

  if (/Firefox\//i.test(userAgent)) {
    return "firefox";
  }

  if (/Safari\//i.test(userAgent) && !/Chrome/i.test(userAgent)) {
    return "safari";
  }

  return "unknown";
}

/** Whether the User-Agent claims to be a real browser (Chrome/Edge/Firefox/Safari). */
export function isBrowserLikeUserAgent(userAgent: string | undefined): boolean {
  const family = getUserAgentFamily(userAgent);
  return BROWSER_UA_FAMILIES.includes(family);
}

/** Finds the curated (or caller-supplied) entry matching a TLS fingerprint. */
export function findTlsFingerprintEntry(
  fingerprint: string,
  extraFingerprints: string[] = [],
  fingerprintType: "ja3" | "ja4" = "ja3",
): TlsFingerprintEntry | undefined {
  const normalized = normalizeTlsFingerprint(fingerprint);

  if (fingerprintType === "ja3") {
    for (const entry of KNOWN_SUSPICIOUS_TLS_FINGERPRINTS) {
      if (entry.hash && normalized === entry.hash) {
        return entry;
      }

      if (entry.prefix && normalized.startsWith(entry.prefix)) {
        return entry;
      }
    }
  }

  for (const extra of extraFingerprints) {
    const normalizedExtra = normalizeTlsFingerprint(extra);
    if (!normalizedExtra) {
      continue;
    }

    if (
      normalized === normalizedExtra ||
      normalized.startsWith(normalizedExtra)
    ) {
      return {
        id: "custom",
        label: "Custom suspicious TLS fingerprint",
        families: ["scripting"],
        confidence: "high",
      };
    }
  }

  return undefined;
}

/** Whether the fingerprint matches a known automation/scripting TLS client. */
export function isKnownSuspiciousTlsFingerprint(
  fingerprint: string | undefined,
  extraFingerprints: string[] = [],
  fingerprintType: "ja3" | "ja4" = "ja3",
): boolean {
  if (!fingerprint) {
    return false;
  }

  return (
    findTlsFingerprintEntry(fingerprint, extraFingerprints, fingerprintType) !==
    undefined
  );
}

/**
 * Whether a recognized TLS fingerprint contradicts the declared User-Agent —
 * e.g. a curl JA3 hash presented alongside a Chrome UA.
 */
export function isTlsUserAgentMismatch(
  fingerprint: string | undefined,
  userAgent: string | undefined,
  extraFingerprints: string[] = [],
  fingerprintType: "ja3" | "ja4" = "ja3",
): boolean {
  if (!fingerprint || !userAgent) {
    return false;
  }

  const entry = findTlsFingerprintEntry(
    fingerprint,
    extraFingerprints,
    fingerprintType,
  );
  if (!entry) {
    return false;
  }
  if (entry.id === "custom") {
    return false;
  }

  const uaFamily = getUserAgentFamily(userAgent);
  if (uaFamily === "unknown") {
    return false;
  }

  const compatibleFamilies = UA_FAMILY_COMPATIBILITY[uaFamily];
  return !entry.families.some((family) => compatibleFamilies.includes(family));
}

/** Browser-like UA arriving without a TLS fingerprint (only when `requireTlsFingerprint`). */
export function isMissingTlsFingerprint(
  fingerprint: string | undefined,
  userAgent: string | undefined,
  requireTlsFingerprint: boolean,
): boolean {
  if (!requireTlsFingerprint) {
    return false;
  }

  return isBrowserLikeUserAgent(userAgent) && !fingerprint;
}
