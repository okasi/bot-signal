import { lookup } from "doc999tor-fast-geoip";

export interface IpGeoResult {
  ipCountry?: string;
  ipTimezone?: string;
  city?: string;
  region?: string;
}

/**
 * Looks up country, timezone, city, and region for an IP using the bundled
 * offline GeoIP database (`doc999tor-fast-geoip`). Returns `null` when the IP
 * is unknown or invalid — never throws.
 */
export async function lookupClientIpGeo(ip: string): Promise<IpGeoResult | null> {
  try {
    const geo = await lookup(ip);

    if (!geo) {
      return null;
    }

    return {
      ipCountry: geo.country || undefined,
      ipTimezone: geo.timezone || undefined,
      city: geo.city || undefined,
      region: geo.region || undefined,
    };
  } catch {
    return null;
  }
}
