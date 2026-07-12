import { createAutomationAssessment } from "../automation.js";
import { enrichServerContext } from "./enrich.js";
import { buildServerSignals } from "./analysis.js";
import type {
  ConfidenceLevel,
  ServerClientContext,
  ServerClientResult,
  ServerDetectorOptions,
  ServerSignal,
} from "./types.js";
import type { EnrichedServerContext } from "./enrich.js";
import { findTlsFingerprintEntry, getUserAgentFamily } from "./tls.js";

/**
 * Combines triggered signal weights into one score:
 * `1 - Π(1 - weightᵢ)` — independent-probability union, so extra signals
 * always raise the score but never past 1.
 * @internal
 */
export function aggregateServerSuspicionScore(signals: ServerSignal[]): number {
  const triggered = signals.filter((signal) => signal.triggered);

  if (triggered.length === 0) {
    return 0;
  }

  let score = 1;

  for (const signal of triggered) {
    score *= 1 - signal.weight;
  }

  return 1 - score;
}

/**
 * Confidence in the verdict based on high-confidence signal hits and score.
 * @internal
 */
export function resolveServerConfidence(
  signals: ServerSignal[],
  suspicionScore: number,
): ConfidenceLevel {
  const triggeredHigh = signals.filter(
    (signal) => signal.triggered && signal.confidence === "high",
  ).length;

  if (triggeredHigh >= 1 || suspicionScore >= 0.7) {
    return "high";
  }

  if (suspicionScore >= 0.35) {
    return "medium";
  }

  return "low";
}

function buildResultContext(
  context: EnrichedServerContext,
): ServerClientResult["context"] {
  return {
    clientIp: context.clientIp,
    ipTimezone: context.ipTimezone,
    clientTimezone: context.clientTimezone,
    tlsFingerprint: context.tlsFingerprint,
    tlsFingerprintType: context.tlsFingerprintType,
    userAgent: context.userAgent,
    acceptLanguage: context.acceptLanguage,
    secChUa: context.secChUa,
    secFetchSite: context.secFetchSite,
    secFetchMode: context.secFetchMode,
    secFetchDest: context.secFetchDest,
    ipCountry: context.ipCountry,
    isDatacenterIp: context.isDatacenterIp,
    isAbuseListedIp: context.isAbuseListedIp,
    isIcloudPrivateRelay: context.isIcloudPrivateRelay,
    datacenterProvider: context.datacenterProvider,
    icloudRelayCountry: context.icloudRelayCountry,
  };
}

function classifyServerAutomation(
  context: ServerClientContext,
  suspiciousTlsFingerprints: string[],
) {
  const uaFamily = getUserAgentFamily(context.userAgent);
  const tlsEntry = context.tlsFingerprint
    ? findTlsFingerprintEntry(
        context.tlsFingerprint,
        suspiciousTlsFingerprints,
        context.tlsFingerprintType,
      )
    : undefined;
  if (["curl", "python", "go", "java"].includes(uaFamily)) {
    const tlsSupportsUa = tlsEntry?.families.includes(uaFamily);
    return createAutomationAssessment(
      true,
      uaFamily as "curl" | "python" | "go" | "java",
      "medium",
      [
        `User-Agent claims ${uaFamily}`,
        ...(tlsSupportsUa ? [`TLS fingerprint is compatible with ${uaFamily}`] : []),
      ],
    );
  }

  return createAutomationAssessment(false, "unknown", "low", []);
}

/**
 * Scores an already-enriched request context synchronously. Use this when you
 * have your own GeoIP/blocklist pipeline; otherwise prefer
 * {@link detectServerClientAsync}, which fills the context from `clientIp`.
 */
export function detectServerClient(
  context: ServerClientContext,
  options: ServerDetectorOptions = {},
): ServerClientResult {
  const scoreThreshold = options.scoreThreshold ?? 0.5;
  const signals = buildServerSignals(context, options);
  const suspicionScore = aggregateServerSuspicionScore(signals);
  const confidence = resolveServerConfidence(signals, suspicionScore);
  const isLegitClient = suspicionScore < scoreThreshold;

  return {
    suspicionScore,
    confidence,
    signals,
    isLegitClient,
    automation: classifyServerAutomation(
      context,
      options.suspiciousTlsFingerprints ?? [],
    ),
    context: buildResultContext(context),
  };
}

/**
 * Scores a request in one call. When `clientIp` is set, the context is
 * auto-enriched with GeoIP country/timezone and bundled blocklist matches
 * (datacenter ranges, AbuseIPDB, iCloud Private Relay) before scoring.
 *
 * @example
 * const result = await detectServerClientAsync({
 *   clientIp: req.ip,
 *   clientTimezone: req.headers["x-timezone"],
 *   userAgent: req.headers["user-agent"],
 *   tlsFingerprint: req.headers["x-ja3-hash"],
 * });
 * if (!result.isLegitClient) return res.status(403).end();
 */
export async function detectServerClientAsync(
  context: ServerClientContext,
  options: ServerDetectorOptions = {},
): Promise<ServerClientResult> {
  const enriched = await enrichServerContext(context, options);
  return detectServerClient(enriched, options);
}
