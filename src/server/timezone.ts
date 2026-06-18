const MINUTES_PER_HOUR = 60;

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

  return !tokens.some((token) => {
    if (token === "*") {
      return true;
    }

    const region = token.split("-")[1];
    return region === country;
  });
}

export function isDatacenterBrowserMismatch(
  isDatacenterIp: boolean | undefined,
  userAgent: string | undefined,
): boolean {
  if (!isDatacenterIp) {
    return false;
  }

  return /Mozilla\/5\.0 \(/i.test(userAgent ?? "");
}
