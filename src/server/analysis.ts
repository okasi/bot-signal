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

/** HTTP User-Agent disagrees with the value observed by browser JavaScript. */
export function isClientUserAgentMismatch(
  userAgent: string | undefined,
  clientUserAgent: string | undefined,
): boolean {
  return Boolean(
    userAgent && clientUserAgent && userAgent.trim() !== clientUserAgent.trim(),
  );
}

function firstAcceptedLanguage(acceptLanguage: string): string | undefined {
  for (const part of acceptLanguage.split(",")) {
    const [language, ...parameters] = part.trim().split(";");
    const quality = parameters
      .map((parameter) => parameter.trim().match(/^q=([01](?:\.\d+)?)$/i)?.[1])
      .find((value) => value !== undefined);
    if (language && (quality === undefined || Number(quality) > 0)) {
      return language.toLowerCase();
    }
  }

  return undefined;
}

/** Accept-Language's preferred value disagrees with Navigator language data. */
export function isClientLanguageMismatch(
  acceptLanguage: string | undefined,
  clientLanguage: string | undefined,
  clientLanguages: string[] | undefined,
): boolean {
  if (!acceptLanguage || (!clientLanguage && !clientLanguages?.length)) {
    return false;
  }

  const preferred = firstAcceptedLanguage(acceptLanguage);
  if (!preferred) {
    return false;
  }

  return Boolean(
    (clientLanguage && clientLanguage.toLowerCase() !== preferred) ||
      (clientLanguages?.[0] && clientLanguages[0].toLowerCase() !== preferred),
  );
}

function claimedPlatform(userAgent: string): string | undefined {
  if (/Android/i.test(userAgent)) return "android";
  if (/CrOS/i.test(userAgent)) return "chrome os";
  if (/Windows/i.test(userAgent)) return "windows";
  if (/(?:iPhone|iPad|iPod)/i.test(userAgent)) return "ios";
  if (/(?:Macintosh|Mac OS X)/i.test(userAgent)) return "macos";
  if (/Linux/i.test(userAgent)) return "linux";
  return undefined;
}

function normalizePlatform(platform: string): string | undefined {
  const value = platform.replace(/^"|"$/g, "").toLowerCase();
  if (/android/.test(value)) return "android";
  if (/cros|chrome os/.test(value)) return "chrome os";
  if (/win/.test(value)) return "windows";
  if (/iphone|ipad|ipod|ios/.test(value)) return "ios";
  if (/mac/.test(value)) return "macos";
  if (/linux/.test(value)) return "linux";
  return undefined;
}

function platformMatches(
  actual: string | undefined,
  expected: string,
): boolean {
  return actual === undefined ||
    actual === expected ||
    (expected === "android" && actual === "linux") ||
    (expected === "ios" && actual === "macos");
}

/** UA operating-system claim conflicts with JS platform or Client Hints. */
export function isClientPlatformMismatch(
  userAgent: string | undefined,
  clientPlatform: string | undefined,
  secChUaPlatform: string | undefined,
): boolean {
  if (!userAgent) {
    return false;
  }

  const expected = claimedPlatform(userAgent);
  if (!expected) {
    return false;
  }

  const client = clientPlatform ? normalizePlatform(clientPlatform) : undefined;
  const hint = secChUaPlatform
    ? normalizePlatform(secChUaPlatform)
    : undefined;
  return !platformMatches(client, expected) || !platformMatches(hint, expected);
}

/** sec-ch-ua-mobile conflicts with the User-Agent's mobile claim. */
export function isClientHintsMobileMismatch(
  userAgent: string | undefined,
  secChUaMobile: string | undefined,
): boolean {
  if (!userAgent || !secChUaMobile || !/^\?[01]$/.test(secChUaMobile.trim())) {
    return false;
  }

  return (secChUaMobile.trim() === "?1") !==
    /(?:Mobi|Android|iPhone|iPad)/i.test(userAgent);
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
      "client-user-agent-mismatch",
      "HTTP User-Agent conflicts with the browser-reported User-Agent",
      isClientUserAgentMismatch(context.userAgent, context.clientUserAgent),
      0.8,
      "high",
    ),
    createSignal(
      "client-language-mismatch",
      "Accept-Language conflicts with browser-reported languages",
      isClientLanguageMismatch(
        context.acceptLanguage,
        context.clientLanguage,
        context.clientLanguages,
      ),
      0.45,
      "medium",
    ),
    createSignal(
      "client-platform-mismatch",
      "User-Agent OS conflicts with browser or Client Hints platform",
      isClientPlatformMismatch(
        context.userAgent,
        context.clientPlatform,
        context.secChUaPlatform,
      ),
      0.55,
      "high",
    ),
    createSignal(
      "client-hints-mobile-mismatch",
      "sec-ch-ua-mobile conflicts with the User-Agent",
      isClientHintsMobileMismatch(context.userAgent, context.secChUaMobile),
      0.55,
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
