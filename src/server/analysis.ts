import {
  isAcceptLanguageGeoMismatch,
  isDatacenterBrowserMismatch,
  isTimezoneMismatch,
} from "./timezone.js";
import {
  findTlsFingerprintEntry,
  getUserAgentFamily,
  isBrowserLikeUserAgent,
  isKnownSuspiciousTlsFingerprint,
  isMissingTlsFingerprint,
  isTlsUserAgentMismatch,
} from "./tls.js";
import type {
  ConfidenceLevel,
  ServerClientContext,
  ServerDetectorOptions,
  ServerSignal,
} from "./types.js";

function createSignal(
  id: string,
  description: string,
  triggered: boolean,
  weight: number,
  confidence: ConfidenceLevel,
): ServerSignal {
  return {
    id,
    description,
    triggered,
    weight,
    confidence,
    score: triggered ? weight : 0,
  };
}

/**
 * Explicit scripting-library User-Agent (curl, Python, Go, or Java).
 * @internal
 */
export function isScriptingUserAgent(userAgent: string | undefined): boolean {
  const family = getUserAgentFamily(userAgent);
  return ["curl", "python", "go", "java"].includes(family);
}

/**
 * Chromium UA version disagrees with the `sec-ch-ua` brand/version header.
 * @internal
 */
export function isClientHintsMismatch(
  userAgent: string | undefined,
  secChUa: string | undefined,
): boolean {
  if (!userAgent || !secChUa) {
    return false;
  }

  const family = getUserAgentFamily(userAgent);
  if (family !== "chrome" && family !== "chrome-headless" && family !== "edge") {
    return false;
  }

  const uaMajor = userAgent.match(/(?:Chrome|Chromium)\/(\d+)/)?.[1];
  const hintMajors = Array.from(
    secChUa.matchAll(/"(?:Chromium|Google Chrome|Microsoft Edge)";v="(\d+)/gi),
    (match) => match[1],
  );

  return Boolean(
    uaMajor &&
      hintMajors.length > 0 &&
      hintMajors.some((hintMajor) => hintMajor !== uaMajor),
  );
}

/**
 * Browser UA missing one or more Fetch Metadata headers, when explicitly required.
 * @internal
 */
export function isMissingBrowserHeaders(
  context: ServerClientContext,
  requireBrowserHeaders: boolean,
): boolean {
  return (
    requireBrowserHeaders &&
    isBrowserLikeUserAgent(context.userAgent) &&
    (!context.secFetchSite || !context.secFetchMode || !context.secFetchDest)
  );
}

/**
 * Evaluates every server-side heuristic and returns the weighted signal list.
 * @internal
 */
export function buildServerSignals(
  context: ServerClientContext,
  options: ServerDetectorOptions = {},
): ServerSignal[] {
  const timezoneToleranceMinutes = options.timezoneToleranceMinutes ?? 60;
  const suspiciousTlsFingerprints = options.suspiciousTlsFingerprints ?? [];
  const requireTlsFingerprint = options.requireTlsFingerprint ?? false;
  const requireBrowserHeaders = options.requireBrowserHeaders ?? false;
  const suspiciousTlsEntry = context.tlsFingerprint
    ? findTlsFingerprintEntry(
        context.tlsFingerprint,
        suspiciousTlsFingerprints,
        context.tlsFingerprintType,
      )
    : undefined;

  return [
    createSignal(
      "scripting-user-agent",
      "User-Agent claims a scripting HTTP client",
      isScriptingUserAgent(context.userAgent),
      0.75,
      "medium",
    ),
    createSignal(
      "client-hints-mismatch",
      "User-Agent version conflicts with sec-ch-ua",
      isClientHintsMismatch(context.userAgent, context.secChUa),
      0.65,
      "high",
    ),
    createSignal(
      "missing-browser-headers",
      "Browser-like User-Agent is missing Fetch Metadata headers",
      isMissingBrowserHeaders(context, requireBrowserHeaders),
      0.35,
      "medium",
    ),
    createSignal(
      "timezone-mismatch",
      "Client-reported timezone does not match GeoIP timezone",
      isTimezoneMismatch(
        context.ipTimezone,
        context.clientTimezone,
        timezoneToleranceMinutes,
      ),
      // Below the default 0.5 threshold on purpose: a lone timezone mismatch is
      // routine for VPN users and travelers, so it corroborates rather than
      // blocks on its own.
      0.45,
      "high",
    ),
    createSignal(
      "known-suspicious-tls",
      suspiciousTlsEntry
        ? `TLS fingerprint matches ${suspiciousTlsEntry.label}`
        : "TLS fingerprint matches a known automation/scripting client",
      isKnownSuspiciousTlsFingerprint(
        context.tlsFingerprint,
        suspiciousTlsFingerprints,
        context.tlsFingerprintType,
      ),
      0.55,
      suspiciousTlsEntry?.confidence ?? "high",
    ),
    createSignal(
      "tls-user-agent-mismatch",
      "TLS fingerprint is inconsistent with the declared user agent",
      isTlsUserAgentMismatch(
        context.tlsFingerprint,
        context.userAgent,
        suspiciousTlsFingerprints,
        context.tlsFingerprintType,
      ),
      0.5,
      "high",
    ),
    createSignal(
      "missing-tls-fingerprint",
      "Browser-like user agent without a TLS fingerprint",
      isMissingTlsFingerprint(
        context.tlsFingerprint,
        context.userAgent,
        requireTlsFingerprint,
      ),
      0.25,
      "medium",
    ),
    createSignal(
      "accept-language-geo-mismatch",
      "Accept-Language does not include the GeoIP country",
      isAcceptLanguageGeoMismatch(context.acceptLanguage, context.ipCountry),
      0.2,
      "low",
    ),
    createSignal(
      "datacenter-browser-mismatch",
      "Datacenter/hosting IP with a residential browser user agent",
      isDatacenterBrowserMismatch(context.isDatacenterIp, context.userAgent),
      0.35,
      "medium",
    ),
    createSignal(
      "abuse-listed-ip",
      "IP appears on the AbuseIPDB 30-day blocklist",
      Boolean(context.isAbuseListedIp),
      0.6,
      "high",
    ),
    createSignal(
      "icloud-private-relay",
      "IP is an iCloud Private Relay egress address",
      Boolean(context.isIcloudPrivateRelay),
      0.15,
      "low",
    ),
  ];
}
