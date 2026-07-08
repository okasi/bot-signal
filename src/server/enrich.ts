import { lookupClientIpGeo } from "./geoip.js";
import { getIpListChecker } from "./ipLists.js";
import type { ServerClientContext, ServerDetectorOptions } from "./types.js";

export interface EnrichedServerContext extends ServerClientContext {
  datacenterProvider?: string;
  icloudRelayCountry?: string;
}

/**
 * Fills missing context fields from `clientIp`: GeoIP country/timezone
 * (unless `lookupGeo: false`) and bundled blocklist matches (unless
 * `checkIpLists: false`). Fields already present are never overwritten.
 */
export async function enrichServerContext(
  context: ServerClientContext,
  options: ServerDetectorOptions = {},
): Promise<EnrichedServerContext> {
  const enriched: EnrichedServerContext = { ...context };

  if (context.clientIp) {
    if (options.lookupGeo !== false) {
      const geo = await lookupClientIpGeo(context.clientIp);

      if (geo) {
        enriched.ipCountry = enriched.ipCountry ?? geo.ipCountry;
        enriched.ipTimezone = enriched.ipTimezone ?? geo.ipTimezone;
      }
    }

    if (options.checkIpLists !== false) {
      const checker = getIpListChecker(options.dataDir);
      const match = checker.check(context.clientIp);

      enriched.isDatacenterIp = enriched.isDatacenterIp ?? match.isDatacenterIp;
      enriched.isAbuseListedIp = enriched.isAbuseListedIp ?? match.isAbuseListedIp;
      enriched.isIcloudPrivateRelay =
        enriched.isIcloudPrivateRelay ?? match.isIcloudPrivateRelay;
      enriched.datacenterProvider = match.datacenterProvider;
      enriched.icloudRelayCountry = match.icloudRelayCountry;
    }
  }

  return enriched;
}
