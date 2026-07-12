import type { AutomationAssessment } from "../automation.js";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface ServerSignal {
  id: string;
  description: string;
  triggered: boolean;
  weight: number;
  confidence: ConfidenceLevel;
  score: number;
}

export interface ServerClientContext {
  /** Client IP address — enables GeoIP lookup and blocklist checks when set */
  clientIp?: string;
  /** IANA timezone from GeoIP lookup of the client IP (e.g. `America/New_York`) */
  ipTimezone?: string;
  /** Timezone reported by the client via header, cookie, or JS beacon */
  clientTimezone?: string;
  /** JA3/JA4 hash or raw JA3 string from the TLS terminator */
  tlsFingerprint?: string;
  /** Defaults to `ja3` */
  tlsFingerprintType?: "ja3" | "ja4";
  userAgent?: string;
  acceptLanguage?: string;
  /** Chromium User-Agent Client Hints header (`sec-ch-ua`) */
  secChUa?: string;
  secFetchSite?: string;
  secFetchMode?: string;
  secFetchDest?: string;
  /** ISO 3166-1 alpha-2 country code from GeoIP */
  ipCountry?: string;
  /** Whether the IP is a known datacenter/hosting range (auto-detected or manual) */
  isDatacenterIp?: boolean;
  /** Whether the IP appears on the bundled AbuseIPDB 30-day blocklist */
  isAbuseListedIp?: boolean;
  /** Whether the IP is in Apple's iCloud Private Relay egress ranges */
  isIcloudPrivateRelay?: boolean;
}

export interface ServerDetectorOptions {
  /** Offset tolerance in minutes when comparing IP vs client timezone */
  timezoneToleranceMinutes?: number;
  /** Suspicion score threshold below which `isLegitClient` is true */
  scoreThreshold?: number;
  /** Additional JA3/JA4 hashes or raw fingerprint prefixes to treat as suspicious */
  suspiciousTlsFingerprints?: string[];
  /** When true, flags browser-like user agents that omit a TLS fingerprint */
  requireTlsFingerprint?: boolean;
  /** When true, flags browser UAs missing the standard Sec-Fetch metadata headers. */
  requireBrowserHeaders?: boolean;
  /** Directory containing `data/*.csv` blocklists (defaults to package `data/`) */
  dataDir?: string;
  /** When false, skips `doc999tor-fast-geoip` lookup for `clientIp` */
  lookupGeo?: boolean;
  /** When false, skips bundled abuse/datacenter/iCloud relay list checks */
  checkIpLists?: boolean;
}

export interface ServerClientResult {
  suspicionScore: number;
  confidence: ConfidenceLevel;
  signals: ServerSignal[];
  isLegitClient: boolean;
  /** Best-effort request-client attribution with evidence and alternatives. */
  automation: AutomationAssessment;
  context: {
    clientIp?: string;
    ipTimezone?: string;
    clientTimezone?: string;
    tlsFingerprint?: string;
    tlsFingerprintType?: "ja3" | "ja4";
    userAgent?: string;
    acceptLanguage?: string;
    secChUa?: string;
    secFetchSite?: string;
    secFetchMode?: string;
    secFetchDest?: string;
    ipCountry?: string;
    isDatacenterIp?: boolean;
    isAbuseListedIp?: boolean;
    isIcloudPrivateRelay?: boolean;
    datacenterProvider?: string;
    icloudRelayCountry?: string;
  };
}
