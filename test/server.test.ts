import { describe, expect, it, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  createIpListChecker,
  detectServerClient,
  detectServerClientAsync,
  enrichServerContext,
  resetIpListCheckerCache,
} from "../src/server/index.js";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

function createFixtureDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anti-bot-data-"));
  fs.writeFileSync(
    path.join(dir, "abuse_ip_db_30d_ips.csv"),
    "198.51.100.10\n203.0.113.20\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(dir, "icloud_private_relay_ip_ranges.csv"),
    "172.224.226.0/27,GB\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(dir, "datacenter_ip_ranges.csv"),
    "3.0.0.0,3.1.255.255,Amazon AWS,http://www.amazon.com/aws/\n",
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

  it("detects datacenter ranges", () => {
    const checker = createIpListChecker(dataDir);
    const match = checker.check("3.0.0.1");

    expect(match.isDatacenterIp).toBe(true);
    expect(match.datacenterProvider).toBe("Amazon AWS");
  });

  it("detects iCloud Private Relay ranges", () => {
    const checker = createIpListChecker(dataDir);
    const match = checker.check("172.224.226.1");

    expect(match.isIcloudPrivateRelay).toBe(true);
    expect(match.icloudRelayCountry).toBe("GB");
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
  it("flags timezone mismatch with high confidence", () => {
    const result = detectServerClient({
      ipTimezone: "America/New_York",
      clientTimezone: "Europe/Berlin",
      userAgent: CHROME_UA,
      acceptLanguage: "en-US,en;q=0.9",
      ipCountry: "US",
    });

    expect(result.suspicionScore).toBeGreaterThanOrEqual(0.5);
    expect(result.isLegitClient).toBe(false);
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
