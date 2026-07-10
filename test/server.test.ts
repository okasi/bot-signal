import { describe, expect, it, beforeEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  aggregateServerSuspicionScore,
  buildServerSignals,
  createIpListChecker,
  detectServerClient,
  detectServerClientAsync,
  enrichServerContext,
  findTlsFingerprintEntry,
  getDefaultIpDataDir,
  getIpListChecker,
  getTimezoneOffsetMinutes,
  getUserAgentFamily,
  isAcceptLanguageGeoMismatch,
  isBrowserLikeUserAgent,
  isDatacenterBrowserMismatch,
  isKnownSuspiciousTlsFingerprint,
  isMissingTlsFingerprint,
  isTimezoneMismatch,
  isTlsUserAgentMismatch,
  isValidJa3Hash,
  KNOWN_SUSPICIOUS_TLS_FINGERPRINTS,
  normalizeTlsFingerprint,
  parseIp,
  preloadIpLists,
  resetIpListCheckerCache,
  resolveServerConfidence,
} from "../src/server/index.js";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

function createFixtureDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-bot-client-data-"));
  fs.writeFileSync(
    path.join(dir, "abuse_ip_db_30d_ips.csv"),
    "198.51.100.10\n203.0.113.20      # TH  AS23969   TOT Public Company Limited\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(dir, "icloud_private_relay_ip_ranges.csv"),
    " 172.224.226.0/27 , GB \n2a02:26f7:b000:4000::/64,US\nnot-a-cidr,ZZ\n192.0.2.0/not-a-prefix,ZZ\n192.0.2.0/33,ZZ\n2a02:26f7::/129,ZZ\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(dir, "datacenter_ip_ranges.csv"),
    "3.0.0.0,3.1.255.255,Amazon AWS,http://www.amazon.com/aws/\n 4.0.0.0 , 4.0.0.255 , Google Cloud , https://cloud.google.com/\n5.0.0.255,5.0.0.0,Reversed Range,https://example.com/\n6.0.0.0,2001:db8::1,Mixed Range,https://example.com/\n2001:db8::,2001:db8::ff,IPv6 Host,https://example.com/\n2001:db8::2,2001:db8::1,IPv6 Reversed,https://example.com/\n",
    "utf-8",
  );
  return dir;
}

function createSparseDataDir(files: {
  abuse?: string;
  datacenter?: string;
  icloud?: string;
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-bot-sparse-"));

  fs.writeFileSync(
    path.join(dir, "abuse_ip_db_30d_ips.csv"),
    files.abuse ?? "",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(dir, "datacenter_ip_ranges.csv"),
    files.datacenter ?? "",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(dir, "icloud_private_relay_ip_ranges.csv"),
    files.icloud ?? "",
    "utf-8",
  );

  return dir;
}

describe("ip list checker", () => {
  let dataDir: string;

  beforeEach(() => {
    resetIpListCheckerCache();
    dataDir = createFixtureDataDir();
  });

  it("detects abuse-listed IPs", () => {
    const checker = createIpListChecker(dataDir);
    expect(checker.check("198.51.100.10").isAbuseListedIp).toBe(true);
    expect(checker.check("8.8.8.8").isAbuseListedIp).toBe(false);
  });

  it("parses abuse entries with trailing annotations", () => {
    const checker = createIpListChecker(dataDir);
    expect(checker.check("203.0.113.20").isAbuseListedIp).toBe(true);
    expect(checker.stats.abuseIpCount).toBe(2);
  });

  it("detects datacenter ranges", () => {
    const checker = createIpListChecker(dataDir);
    const match = checker.check("3.0.0.1");

    expect(match.isDatacenterIp).toBe(true);
    expect(match.datacenterProvider).toBe("Amazon AWS");
  });

  it("trims datacenter CSV columns and ignores reversed ranges", () => {
    const checker = createIpListChecker(dataDir);
    const trimmedMatch = checker.check("4.0.0.1");
    const reversedMatch = checker.check("5.0.0.100");

    expect(trimmedMatch.isDatacenterIp).toBe(true);
    expect(trimmedMatch.datacenterProvider).toBe("Google Cloud");
    expect(reversedMatch.isDatacenterIp).toBe(false);
    expect(checker.stats.datacenterRangeCount).toBe(3);
  });

  it("detects IPv6 datacenter ranges", () => {
    const checker = createIpListChecker(dataDir);
    const match = checker.check("2001:db8::42");

    expect(match.isDatacenterIp).toBe(true);
    expect(match.datacenterProvider).toBe("IPv6 Host");
  });

  it("detects iCloud Private Relay ranges", () => {
    const checker = createIpListChecker(dataDir);
    const match = checker.check("172.224.226.1");

    expect(match.isIcloudPrivateRelay).toBe(true);
    expect(match.icloudRelayCountry).toBe("GB");
  });

  it("detects IPv6 iCloud Private Relay ranges", () => {
    const checker = createIpListChecker(dataDir);
    const match = checker.check("2a02:26f7:b000:4000::1f3");

    expect(match.isIcloudPrivateRelay).toBe(true);
    expect(match.icloudRelayCountry).toBe("US");
    expect(checker.check("2a02:26f7:b000:4001::1").isIcloudPrivateRelay).toBe(false);
  });

  it("matches IPv4-mapped IPv6 addresses against IPv4 lists", () => {
    const checker = createIpListChecker(dataDir);

    expect(checker.check("::ffff:198.51.100.10").isAbuseListedIp).toBe(true);
    expect(checker.check("::ffff:3.0.0.1").isDatacenterIp).toBe(true);
    expect(checker.check("::ffff:172.224.226.1").isIcloudPrivateRelay).toBe(true);
  });

  it("matches nothing for invalid input", () => {
    const checker = createIpListChecker(dataDir);
    const match = checker.check("not-an-ip");

    expect(match.isDatacenterIp).toBe(false);
    expect(match.isAbuseListedIp).toBe(false);
    expect(match.isIcloudPrivateRelay).toBe(false);
  });

  it("returns cached checkers per data directory", () => {
    const first = getIpListChecker(dataDir);
    const second = getIpListChecker(dataDir);
    const otherDir = createFixtureDataDir();
    const third = getIpListChecker(otherDir);

    expect(second).toBe(first);
    expect(third).not.toBe(first);
  });

  it("creates a cached checker from the default data directory", () => {
    resetIpListCheckerCache();

    const checker = getIpListChecker();

    expect(checker.stats.datacenterRangeCount).toBeGreaterThan(0);
  });

  it("preloads list data into the shared cache", () => {
    resetIpListCheckerCache();

    const stats = preloadIpLists(dataDir);

    expect(stats.datacenterRangeCount).toBeGreaterThan(0);
    // Subsequent access reuses the primed checker.
    expect(getIpListChecker(dataDir).stats).toBe(stats);
  });

  it("sorts descending and duplicate ranges", () => {
    const sortedDir = createSparseDataDir({
      datacenter:
        "10.0.0.0,10.0.0.255,Ten\n9.0.0.0,9.0.0.255,Nine\n9.0.0.0,9.0.0.255,Nine Duplicate\n",
      icloud:
        "2001:db8:2::/64,US\n2001:db8:1::/64,CA\n2001:db8:1::/64,CA\n",
    });
    const checker = createIpListChecker(sortedDir);

    expect(checker.check("9.0.0.1").isDatacenterIp).toBe(true);
    expect(checker.check("2001:db8:1::1").isIcloudPrivateRelay).toBe(true);
  });

  it("warns and matches nothing when list data is missing", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "detect-bot-empty-"));
    const warning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});

    try {
      const checker = createIpListChecker(emptyDir);

      expect(checker.stats).toEqual({
        abuseIpCount: 0,
        datacenterRangeCount: 0,
        icloudRelayRangeCount: 0,
      });
      expect(checker.check("8.8.8.8")).toMatchObject({
        isDatacenterIp: false,
        isAbuseListedIp: false,
        isIcloudPrivateRelay: false,
      });
      expect(warning).toHaveBeenCalledOnce();
    } finally {
      warning.mockRestore();
    }
  });

  it("exposes the bundled default data directory", () => {
    expect(getDefaultIpDataDir()).toContain("data");
  });

  it("falls back to the package-relative data path when probing misses", () => {
    const exists = vi.spyOn(fs, "existsSync").mockReturnValue(false);

    try {
      expect(getDefaultIpDataDir()).toContain("data");
    } finally {
      exists.mockRestore();
    }
  });
});

describe("parseIp", () => {
  it("parses IPv4 addresses", () => {
    expect(parseIp("192.168.1.1")).toEqual({
      kind: "ipv4",
      value: (192 << 24 | 168 << 16 | 1 << 8 | 1) >>> 0,
      canonical: "192.168.1.1",
    });
    expect(parseIp("0.0.0.0")?.value).toBe(0);
    expect(parseIp("255.255.255.255")?.value).toBe(0xffffffff);
  });

  it("rejects malformed IPv4 addresses", () => {
    expect(parseIp("256.1.1.1")).toBeNull();
    expect(parseIp("1.2.3")).toBeNull();
    expect(parseIp("1.2.3.4.5")).toBeNull();
    expect(parseIp("01.2.3.4")).toBeNull();
    expect(parseIp("1.2.3.x")).toBeNull();
    expect(parseIp("")).toBeNull();
    expect(parseIp("not-an-ip")).toBeNull();
  });

  it("parses IPv6 addresses with compression", () => {
    expect(parseIp("::1")).toEqual({ kind: "ipv6", value: 1n, canonical: "0:0:0:0:0:0:0:1" });
    expect(parseIp("2a02:26f7::")?.value).toBe(0x2a02_26f7n << 96n);
    expect(parseIp("2001:db8:0:0:0:0:0:1")?.canonical).toBe("2001:db8:0:0:0:0:0:1");
    expect(parseIp("FE80::1%eth0")?.canonical).toBe("fe80:0:0:0:0:0:0:1");
  });

  it("rejects malformed IPv6 addresses", () => {
    expect(parseIp(":::1")).toBeNull();
    expect(parseIp("2001:db8")).toBeNull();
    expect(parseIp("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(parseIp("2001:db8::fffff")).toBeNull();
    expect(parseIp("1:2:3:4:5:6:7:8::")).toBeNull();
    expect(parseIp("2001::db8::1")).toBeNull();
    expect(parseIp("::ffff:999.1.1.1")).toBeNull();
    expect(parseIp("2001:db8::gggg")).toBeNull();
  });

  it("normalizes IPv4-mapped IPv6 to IPv4", () => {
    expect(parseIp("::ffff:198.51.100.10")).toEqual({
      kind: "ipv4",
      value: (198 << 24 | 51 << 16 | 100 << 8 | 10) >>> 0,
      canonical: "198.51.100.10",
    });
    expect(parseIp("::ffff:c633:640a")?.canonical).toBe("198.51.100.10");
  });
});

describe("detectServerClient with IP lists", () => {
  let dataDir: string;

  beforeEach(() => {
    resetIpListCheckerCache();
    dataDir = createFixtureDataDir();
  });

  it("flags abuse-listed IPs", async () => {
    const result = await detectServerClientAsync(
      {
        clientIp: "198.51.100.10",
        userAgent: CHROME_UA,
      },
      { dataDir, lookupGeo: false },
    );

    expect(
      result.signals.find((signal) => signal.id === "abuse-listed-ip")?.triggered,
    ).toBe(true);
    expect(result.isLegitClient).toBe(false);
  });

  it("flags datacenter IPs with browser user agents", async () => {
    const result = await detectServerClientAsync(
      {
        clientIp: "3.0.0.1",
        userAgent: CHROME_UA,
      },
      { dataDir, lookupGeo: false },
    );

    expect(result.context.isDatacenterIp).toBe(true);
    expect(
      result.signals.find((signal) => signal.id === "datacenter-browser-mismatch")
        ?.triggered,
    ).toBe(true);
  });
});

describe("detectServerClient sync", () => {
  it("does not block on a lone timezone mismatch (VPN/traveler)", () => {
    const result = detectServerClient({
      ipTimezone: "America/New_York",
      clientTimezone: "Europe/Berlin",
      userAgent: CHROME_UA,
      acceptLanguage: "en-US,en;q=0.9",
      ipCountry: "US",
    });

    expect(
      result.signals.find((s) => s.id === "timezone-mismatch")?.triggered,
    ).toBe(true);
    expect(result.confidence).toBe("high");
    // Strong but sub-threshold on its own.
    expect(result.suspicionScore).toBeCloseTo(0.45);
    expect(result.isLegitClient).toBe(true);
  });

  it("blocks a timezone mismatch that stacks with another signal", () => {
    const result = detectServerClient({
      ipTimezone: "America/New_York",
      clientTimezone: "Europe/Berlin",
      userAgent: CHROME_UA,
      isDatacenterIp: true,
      acceptLanguage: "en-US,en;q=0.9",
      ipCountry: "US",
    });

    expect(result.suspicionScore).toBeGreaterThanOrEqual(0.5);
    expect(result.isLegitClient).toBe(false);
  });

  it("keeps clean requests legit and honors custom thresholds", () => {
    const clean = detectServerClient({ userAgent: CHROME_UA });
    const strict = detectServerClient(
      {
        acceptLanguage: "en-GB,en;q=0.9",
        ipCountry: "US",
      },
      { scoreThreshold: 0.1 },
    );

    expect(clean.suspicionScore).toBe(0);
    expect(clean.confidence).toBe("low");
    expect(clean.isLegitClient).toBe(true);
    expect(strict.isLegitClient).toBe(false);
  });
});

describe("server scoring helpers", () => {
  const mediumSignal = {
    id: "medium",
    description: "medium",
    triggered: true,
    weight: 0.4,
    confidence: "medium" as const,
    score: 0.4,
  };
  const highSignal = {
    id: "high",
    description: "high",
    triggered: true,
    weight: 0.2,
    confidence: "high" as const,
    score: 0.2,
  };

  it("aggregates empty and triggered signal sets", () => {
    expect(aggregateServerSuspicionScore([])).toBe(0);
    expect(
      aggregateServerSuspicionScore([
        { ...mediumSignal, triggered: false, score: 0 },
      ]),
    ).toBe(0);
    expect(
      aggregateServerSuspicionScore([mediumSignal, highSignal]),
    ).toBeCloseTo(0.52);
  });

  it("resolves low, medium, and high confidence verdicts", () => {
    expect(resolveServerConfidence([], 0)).toBe("low");
    expect(resolveServerConfidence([mediumSignal], 0.4)).toBe("medium");
    expect(resolveServerConfidence([], 0.72)).toBe("high");
    expect(resolveServerConfidence([highSignal], 0.2)).toBe("high");
  });

  it("builds descriptions and confidences for custom TLS matches", () => {
    const signals = buildServerSignals(
      {
        tlsFingerprint: "custom-prefix-extra",
        userAgent: CHROME_UA,
      },
      { suspiciousTlsFingerprints: ["custom-prefix"] },
    );
    const known = signals.find((signal) => signal.id === "known-suspicious-tls");

    expect(known).toMatchObject({
      triggered: true,
      confidence: "high",
      description: "TLS fingerprint matches Custom suspicious TLS fingerprint",
    });
  });
});

describe("TLS helpers", () => {
  const CURL_HASH = "b2114619bfb604579bbb31b673619900";
  const GO_HASH = "71a02c3315cd8182f8a3e8b2f8b3f6de";

  it("normalizes and classifies user agents", () => {
    expect(normalizeTlsFingerprint(` ${CURL_HASH.toUpperCase()} `)).toBe(
      CURL_HASH,
    );
    expect(getUserAgentFamily(undefined)).toBe("unknown");
    expect(getUserAgentFamily("curl/8.0.1")).toBe("curl");
    expect(getUserAgentFamily("python-requests/2.31.0")).toBe("python");
    expect(getUserAgentFamily("HeadlessChrome/121.0.0.0")).toBe(
      "chrome-headless",
    );
    expect(getUserAgentFamily("Edg/121.0.0.0")).toBe("edge");
    expect(getUserAgentFamily(CHROME_UA)).toBe("chrome");
    expect(getUserAgentFamily("Firefox/128.0")).toBe("firefox");
    expect(getUserAgentFamily("Version/17.0 Safari/605.1.15")).toBe("safari");
    expect(getUserAgentFamily("Go-http-client/2.0")).toBe("go");
    expect(getUserAgentFamily("okhttp/4.12.0")).toBe("java");
    expect(getUserAgentFamily("unknown-client")).toBe("unknown");
    expect(isBrowserLikeUserAgent(CHROME_UA)).toBe(true);
    expect(isBrowserLikeUserAgent("curl/8.0.1")).toBe(false);
  });

  it("finds known, custom, and absent TLS fingerprint entries", () => {
    expect(findTlsFingerprintEntry(CURL_HASH)?.id).toBe("curl");
    expect(findTlsFingerprintEntry("custom-hash-extra", ["custom-hash"])?.id).toBe(
      "custom",
    );
    expect(findTlsFingerprintEntry("missing")).toBeUndefined();
    expect(isKnownSuspiciousTlsFingerprint(undefined)).toBe(false);
    expect(isKnownSuspiciousTlsFingerprint(CURL_HASH)).toBe(true);
  });

  it("matches known TLS fingerprint prefixes", () => {
    KNOWN_SUSPICIOUS_TLS_FINGERPRINTS.push({
      id: "raw-ja3-prefix",
      label: "Raw JA3 prefix",
      prefix: "771,",
      families: ["scripting"],
      confidence: "medium",
    });

    try {
      expect(findTlsFingerprintEntry("771,4865-4866")?.id).toBe(
        "raw-ja3-prefix",
      );
    } finally {
      KNOWN_SUSPICIOUS_TLS_FINGERPRINTS.pop();
    }
  });

  it("detects and ignores TLS/user-agent mismatches appropriately", () => {
    expect(isTlsUserAgentMismatch(undefined, CHROME_UA)).toBe(false);
    expect(isTlsUserAgentMismatch(CURL_HASH, undefined)).toBe(false);
    expect(isTlsUserAgentMismatch("missing", CHROME_UA)).toBe(false);
    expect(isTlsUserAgentMismatch(CURL_HASH, "unknown-client")).toBe(false);
    expect(isTlsUserAgentMismatch(CURL_HASH, CHROME_UA)).toBe(true);
    expect(isTlsUserAgentMismatch(CURL_HASH, "curl/8.0.1")).toBe(false);
    expect(isTlsUserAgentMismatch(GO_HASH, "Go-http-client/2.0")).toBe(false);
  });

  it("detects missing TLS fingerprints only when required for browser UAs", () => {
    expect(isMissingTlsFingerprint(undefined, CHROME_UA, false)).toBe(false);
    expect(isMissingTlsFingerprint("abc", CHROME_UA, true)).toBe(false);
    expect(isMissingTlsFingerprint(undefined, "curl/8.0.1", true)).toBe(false);
    expect(isMissingTlsFingerprint(undefined, CHROME_UA, true)).toBe(true);
  });

  it("validates JA3 hash format", () => {
    expect(isValidJa3Hash(CURL_HASH)).toBe(true);
    expect(isValidJa3Hash(` ${CURL_HASH.toUpperCase()} `)).toBe(true);
    expect(isValidJa3Hash("3b5074b1b5d032e5620f6fbd716347afd")).toBe(false); // 33 chars
    expect(isValidJa3Hash("b2114619")).toBe(false); // too short
    expect(isValidJa3Hash("771,4865-4866-4867")).toBe(false); // raw JA3 string
    expect(isValidJa3Hash("g2114619bfb604579bbb31b673619900")).toBe(false); // non-hex
  });

  it("ships only well-formed hash/prefix fingerprint entries", () => {
    for (const entry of KNOWN_SUSPICIOUS_TLS_FINGERPRINTS) {
      const hasValidHash = entry.hash !== undefined && isValidJa3Hash(entry.hash);
      const hasPrefix = typeof entry.prefix === "string" && entry.prefix.length > 0;

      expect(
        hasValidHash || hasPrefix,
        `entry ${entry.id} must have a 32-hex hash or a prefix`,
      ).toBe(true);
    }
  });
});

describe("timezone helpers", () => {
  it("parses UTC, signed, and invalid timezone offsets", () => {
    expect(getTimezoneOffsetMinutes("UTC")).toBe(0);
    expect(
      getTimezoneOffsetMinutes(
        "Asia/Kathmandu",
        new Date("2026-01-01T00:00:00Z"),
      ),
    ).toBe(345);
    expect(getTimezoneOffsetMinutes("Not/AZone")).toBeNull();
  });

  it("handles formatter output without numeric offsets", () => {
    const formatter = vi.spyOn(Intl, "DateTimeFormat");

    try {
      formatter.mockImplementationOnce(
        () =>
          ({
            formatToParts: () => [{ type: "literal", value: "no offset" }],
          }) as unknown as Intl.DateTimeFormat,
      );
      formatter.mockImplementationOnce(
        () =>
          ({
            formatToParts: () => [{ type: "timeZoneName", value: "GMT" }],
          }) as unknown as Intl.DateTimeFormat,
      );
      formatter.mockImplementationOnce(
        () =>
          ({
            formatToParts: () => [{ type: "timeZoneName", value: "PST" }],
          }) as unknown as Intl.DateTimeFormat,
      );

      expect(getTimezoneOffsetMinutes("UTC")).toBeNull();
      expect(getTimezoneOffsetMinutes("UTC")).toBe(0);
      expect(getTimezoneOffsetMinutes("UTC")).toBeNull();
    } finally {
      formatter.mockRestore();
    }
  });

  it("handles timezone mismatch false paths", () => {
    expect(isTimezoneMismatch(undefined, "UTC")).toBe(false);
    expect(isTimezoneMismatch("UTC", undefined)).toBe(false);
    expect(isTimezoneMismatch("UTC", "UTC")).toBe(false);
    expect(isTimezoneMismatch("Not/AZone", "UTC")).toBe(false);
    expect(isTimezoneMismatch("UTC", "Not/AZone")).toBe(false);
    expect(isTimezoneMismatch("UTC", "Europe/Berlin", 120)).toBe(false);
  });

  it("checks datacenter/browser mismatch inputs", () => {
    expect(isDatacenterBrowserMismatch(false, CHROME_UA)).toBe(false);
    expect(isDatacenterBrowserMismatch(true, undefined)).toBe(false);
    expect(isDatacenterBrowserMismatch(true, "curl/8.0.1")).toBe(false);
    expect(isDatacenterBrowserMismatch(true, CHROME_UA)).toBe(true);
  });
});

describe("isAcceptLanguageGeoMismatch", () => {
  it("flags a region mismatch", () => {
    expect(isAcceptLanguageGeoMismatch("en-GB,en;q=0.9", "US")).toBe(true);
  });

  it("passes when a region matches the GeoIP country", () => {
    // Arrange
    const acceptLanguages = [
      "en-US,en;q=0.9",
      "fr-FR,en-US;q=0.8",
      "en_US,en;q=0.9",
    ];

    // Act
    const results = acceptLanguages.map((header) =>
      isAcceptLanguageGeoMismatch(header, "US"),
    );

    // Assert
    expect(results).toEqual([false, false, false]);
  });

  it("ignores unacceptable or invalid q-value entries", () => {
    // Arrange
    const acceptLanguages = [
      "en-US;q=0,fr-FR;q=1",
      "en-US;q=bogus,fr-FR",
      "en-US;q=0.000,fr-FR;q=1.000",
      "en-US;q=0.1234,fr-FR",
      "en-US;q=0,*;q=0",
      "fr-FR,*;q=0",
      "en-US;Q=0,fr-FR",
      "fr-FR,en-US;q=0.001",
    ];

    // Act
    const results = acceptLanguages.map((header) =>
      isAcceptLanguageGeoMismatch(header, "US"),
    );

    // Assert
    expect(results).toEqual([true, true, true, true, false, true, true, false]);
  });

  it("does not flag region-less language tags", () => {
    expect(isAcceptLanguageGeoMismatch("en", "US")).toBe(false);
    expect(isAcceptLanguageGeoMismatch("en,fr;q=0.8", "DE")).toBe(false);
  });

  it("handles script subtags like zh-Hant-TW", () => {
    expect(isAcceptLanguageGeoMismatch("zh-Hant-TW", "TW")).toBe(false);
    expect(isAcceptLanguageGeoMismatch("zh-Hant-TW", "US")).toBe(true);
  });

  it("ignores extension, private-use, numeric, and invalid regions", () => {
    // Arrange
    const acceptLanguages = ["en-u-ca-gregory", "en-x-us", "es-419", "bogus-@@"];

    // Act
    const results = acceptLanguages.map((header) =>
      isAcceptLanguageGeoMismatch(header, "US"),
    );

    // Assert
    expect(results).toEqual([false, false, false, false]);
  });

  it("treats wildcard as a pass", () => {
    expect(isAcceptLanguageGeoMismatch("*", "US")).toBe(false);
  });
});

describe("enrichServerContext", () => {
  let dataDir: string;

  beforeEach(() => {
    resetIpListCheckerCache();
    dataDir = createFixtureDataDir();
  });

  it("enriches context from client IP and blocklists", async () => {
    const enriched = await enrichServerContext(
      { clientIp: "3.0.0.1" },
      { dataDir, lookupGeo: false },
    );

    expect(enriched.isDatacenterIp).toBe(true);
    expect(enriched.datacenterProvider).toBe("Amazon AWS");
  });

  it("fills geo fields from doc999tor-fast-geoip", async () => {
    const enriched = await enrichServerContext(
      { clientIp: "8.8.8.8" },
      { dataDir, checkIpLists: false },
    );

    expect(enriched.ipCountry).toBe("US");
    expect(enriched.ipTimezone).toBeTruthy();
  });
});
