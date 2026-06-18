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
  /** ISO 3166-1 alpha-2 country code from GeoIP */
  ipCountry?: string;
  /** Whether GeoIP/ASN data classifies the IP as datacenter or hosting */
  isDatacenterIp?: boolean;
}

export interface ServerDetectorOptions {
  /** Offset tolerance in minutes when comparing IP vs client timezone */
  timezoneToleranceMinutes?: number;
  /** Suspicion score threshold below which `isLegitClient` is true */
  scoreThreshold?: number;
  /** Additional TLS fingerprint hashes or raw JA3 prefixes to treat as suspicious */
  suspiciousTlsFingerprints?: string[];
  /** When true, flags browser-like user agents that omit a TLS fingerprint */
  requireTlsFingerprint?: boolean;
}

export interface ServerClientResult {
  suspicionScore: number;
  confidence: ConfidenceLevel;
  signals: ServerSignal[];
  isLegitClient: boolean;
  context: {
    ipTimezone?: string;
    clientTimezone?: string;
    tlsFingerprint?: string;
    userAgent?: string;
    ipCountry?: string;
  };
}
