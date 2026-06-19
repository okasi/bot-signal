import {
  isAcceptLanguageGeoMismatch,
  isDatacenterBrowserMismatch,
  isTimezoneMismatch,
} from "./timezone.js";
import {
  findTlsFingerprintEntry,
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

export function buildServerSignals(
  context: ServerClientContext,
  options: ServerDetectorOptions = {},
): ServerSignal[] {
  const timezoneToleranceMinutes = options.timezoneToleranceMinutes ?? 60;
  const suspiciousTlsFingerprints = options.suspiciousTlsFingerprints ?? [];
  const requireTlsFingerprint = options.requireTlsFingerprint ?? false;
  const suspiciousTlsEntry = context.tlsFingerprint
    ? findTlsFingerprintEntry(
        context.tlsFingerprint,
        suspiciousTlsFingerprints,
      )
    : undefined;

  return [
    createSignal(
      "timezone-mismatch",
      "Client-reported timezone does not match GeoIP timezone",
      isTimezoneMismatch(
        context.ipTimezone,
        context.clientTimezone,
        timezoneToleranceMinutes,
      ),
      0.5,
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
