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

const ACCEPT_LANGUAGE_Q_VALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/** Quality (`q`) parameter from an Accept-Language item; invalid q-values mean not usable. */
function getAcceptLanguageQuality(parameters: string[]): number {
  const qualityParameter = parameters
    .map((parameter) => parameter.trim())
    .find((parameter) => parameter.toLowerCase().startsWith("q="));

  if (!qualityParameter) {
    return 1;
  }

  const qualityText = qualityParameter.slice(2).trim();

  return ACCEPT_LANGUAGE_Q_VALUE.test(qualityText) ? Number(qualityText) : 0;
}

function parseAcceptLanguageTags(acceptLanguage: string): string[] {
  return acceptLanguage
    .split(",")
    .map((part) => {
      const [rawTag, ...parameters] = part.trim().split(";");
      const tag = rawTag.trim().toLowerCase().replace(/_/g, "-");
      const quality = getAcceptLanguageQuality(parameters);

      return tag.length > 0 && quality > 0 ? tag : undefined;
    })
    .filter((tag): tag is string => tag !== undefined);
}

/** Alpha-2 country region from a BCP 47 tag; numeric macroregions are not country claims. */
function getRegionSubtag(languageTag: string): string | undefined {
  try {
    const region = new Intl.Locale(languageTag).region?.toLowerCase();

    return region && /^[a-z]{2}$/.test(region) ? region : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether no Accept-Language alpha-2 country region matches the GeoIP country.
 * Region-less headers (plain `en`) and acceptable wildcards never mismatch.
 */
export function isAcceptLanguageGeoMismatch(
  acceptLanguage: string | undefined,
  ipCountry: string | undefined,
): boolean {
  if (!acceptLanguage || !ipCountry) {
    return false;
  }

  const country = ipCountry.toLowerCase();
  const tags = parseAcceptLanguageTags(acceptLanguage);

  if (tags.includes("*")) {
    return false;
  }

  const regions = tags
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
