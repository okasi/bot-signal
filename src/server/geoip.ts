import { lookup } from "doc999tor-fast-geoip";

export interface IpGeoResult {
  ipCountry?: string;
  ipTimezone?: string;
  city?: string;
  region?: string;
}

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
