import { describe, expect, it } from "vitest";
import {
  detectServerClient,
  getTimezoneOffsetMinutes,
  isKnownSuspiciousTlsFingerprint,
  isTimezoneMismatch,
  isTlsUserAgentMismatch,
} from "../src/server/index.js";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

describe("server timezone checks", () => {
  it("returns offsets for valid IANA timezones", () => {
    const newYork = getTimezoneOffsetMinutes("America/New_York");
    const berlin = getTimezoneOffsetMinutes("Europe/Berlin");

    expect(newYork).not.toBeNull();
    expect(berlin).not.toBeNull();
    expect(newYork).not.toBe(berlin);
  });

  it("detects timezone mismatch between IP and client", () => {
    expect(
      isTimezoneMismatch("America/New_York", "Europe/Berlin", 60),
    ).toBe(true);
    expect(isTimezoneMismatch("Europe/Berlin", "Europe/Berlin", 60)).toBe(
      false,
    );
  });
});

describe("server TLS checks", () => {
  it("flags known automation TLS fingerprints", () => {
    expect(
      isKnownSuspiciousTlsFingerprint("e7d705a3286e19ea42f587b344ee6865"),
    ).toBe(true);
  });

  it("detects TLS and user-agent family mismatch", () => {
    expect(
      isTlsUserAgentMismatch(
        "e7d705a3286e19ea42f587b344ee6865",
        CHROME_UA,
      ),
    ).toBe(true);
  });
});

describe("detectServerClient", () => {
  it("flags a clean matching request as legit", () => {
    const result = detectServerClient({
      ipTimezone: "Europe/Berlin",
      clientTimezone: "Europe/Berlin",
      tlsFingerprint: "abc123unknownfingerprintnotinblocklist",
      userAgent: CHROME_UA,
      acceptLanguage: "de-DE,de;q=0.9",
      ipCountry: "DE",
      isDatacenterIp: false,
    });

    expect(result.isLegitClient).toBe(true);
    expect(result.suspicionScore).toBeLessThan(0.5);
  });

  it("flags timezone mismatch with high confidence", () => {
    const result = detectServerClient({
      ipTimezone: "America/New_York",
      clientTimezone: "Europe/Berlin",
      userAgent: CHROME_UA,
      acceptLanguage: "en-US,en;q=0.9",
      ipCountry: "US",
    });

    expect(result.isLegitClient).toBe(false);
    expect(
      result.signals.find((signal) => signal.id === "timezone-mismatch")
        ?.triggered,
    ).toBe(true);
    expect(result.confidence).toBe("high");
  });

  it("flags python TLS fingerprint with chrome user agent", () => {
    const result = detectServerClient({
      tlsFingerprint: "e7d705a3286e19ea42f587b344ee6865",
      userAgent: CHROME_UA,
      ipTimezone: "Europe/Berlin",
      clientTimezone: "Europe/Berlin",
    });

    expect(result.isLegitClient).toBe(false);
    expect(result.suspicionScore).toBeGreaterThanOrEqual(0.5);
    expect(
      result.signals.find((signal) => signal.id === "known-suspicious-tls")
        ?.triggered,
    ).toBe(true);
    expect(
      result.signals.find((signal) => signal.id === "tls-user-agent-mismatch")
        ?.triggered,
    ).toBe(true);
  });

  it("flags datacenter IP with browser user agent", () => {
    const result = detectServerClient({
      isDatacenterIp: true,
      userAgent: CHROME_UA,
      ipTimezone: "Europe/Berlin",
      clientTimezone: "Europe/Berlin",
    });

    expect(
      result.signals.find(
        (signal) => signal.id === "datacenter-browser-mismatch",
      )?.triggered,
    ).toBe(true);
  });

  it("supports custom suspicious TLS fingerprints", () => {
    const result = detectServerClient(
      {
        tlsFingerprint: "custombadfingerprint123",
        userAgent: CHROME_UA,
      },
      {
        suspiciousTlsFingerprints: ["custombadfingerprint123"],
      },
    );

    expect(
      result.signals.find((signal) => signal.id === "known-suspicious-tls")
        ?.triggered,
    ).toBe(true);
  });
});
