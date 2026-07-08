const MINUTES_PER_HOUR = 60;

/** Current UTC offset in minutes for an IANA timezone, or `null` when unknown. */
export function getTimezoneOffsetMinutes(
  timeZone: string,
  at: Date = new Date(),
): number | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    });
    const parts = formatter.formatToParts(at);
    const offsetPart = parts.find((part) => part.type === "timeZoneName")?.value;

    if (!offsetPart) {
      return null;
    }

    const match = offsetPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!match) {
      return offsetPart === "GMT" ? 0 : null;
    }

    const sign = match[1] === "-" ? -1 : 1;
    const hours = Number(match[2]);
    const minutes = Number(match[3] ?? "0");

    return sign * (hours * MINUTES_PER_HOUR + minutes);
  } catch {
    return null;
  }
}

/**
 * Whether the client-reported timezone disagrees with the GeoIP timezone by
 * more than `toleranceMinutes` of UTC offset. Different zone names with the
 * same offset (e.g. `Europe/Paris` vs `Europe/Berlin`) do not mismatch.
 */
export function isTimezoneMismatch(
  ipTimezone: string | undefined,
  clientTimezone: string | undefined,
  toleranceMinutes = 60,
): boolean {
  if (!ipTimezone || !clientTimezone) {
    return false;
  }

  if (ipTimezone === clientTimezone) {
    return false;
  }

  const ipOffset = getTimezoneOffsetMinutes(ipTimezone);
  const clientOffset = getTimezoneOffsetMinutes(clientTimezone);

  if (ipOffset === null || clientOffset === null) {
    return false;
  }

  return Math.abs(ipOffset - clientOffset) > toleranceMinutes;
}

/** Region subtag of a BCP 47 language tag (`en-US` → `us`, `zh-Hant-TW` → `tw`) */
function getRegionSubtag(languageTag: string): string | undefined {
  return languageTag
    .split("-")
    .slice(1)
    .find((subtag) => /^[a-z]{2}$/.test(subtag) || /^\d{3}$/.test(subtag));
}

/**
 * Whether no Accept-Language region subtag matches the GeoIP country.
 * Region-less headers (plain `en`) and wildcards never mismatch.
 */
export function isAcceptLanguageGeoMismatch(
  acceptLanguage: string | undefined,
  ipCountry: string | undefined,
): boolean {
  if (!acceptLanguage || !ipCountry) {
    return false;
  }

  const country = ipCountry.toLowerCase();
  const tokens = acceptLanguage
    .toLowerCase()
    .split(",")
    .map((part) => part.trim().split(";")[0]);

  if (tokens.includes("*")) {
    return false;
  }

  const regions = tokens
    .map(getRegionSubtag)
    .filter((region): region is string => region !== undefined);

  // Region-less tags like plain `en` carry no location claim — not enough
  // information to call a mismatch.
  if (regions.length === 0) {
    return false;
  }

  return !regions.includes(country);
}

/** Datacenter/hosting IP presenting a residential browser User-Agent. */
export function isDatacenterBrowserMismatch(
  isDatacenterIp: boolean | undefined,
  userAgent: string | undefined,
): boolean {
  if (!isDatacenterIp) {
    return false;
  }

  return /Mozilla\/5\.0 \(/i.test(userAgent ?? "");
}
