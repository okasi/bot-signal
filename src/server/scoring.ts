import { enrichServerContext } from "./enrich.js";
import { detectServerClient } from "./scoreCore.js";
import type {
  ServerClientContext,
  ServerClientResult,
  ServerDetectorOptions,
} from "./types.js";

export {
  aggregateServerSuspicionScore,
  detectServerClient,
  resolveServerConfidence,
} from "./scoreCore.js";

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
