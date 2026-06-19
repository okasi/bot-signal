import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ipaddr from "ipaddr.js";

export interface DatacenterRange {
  start: string;
  end: string;
  provider: string;
}

export interface IcloudRelayRange {
  cidr: string;
  country: string;
}

export interface IpListMatchResult {
  isDatacenterIp: boolean;
  isAbuseListedIp: boolean;
  isIcloudPrivateRelay: boolean;
  datacenterProvider?: string;
  icloudRelayCountry?: string;
}

export interface IpListChecker {
  check(ip: string): IpListMatchResult;
  stats: {
    abuseIpCount: number;
    datacenterRangeCount: number;
    icloudRelayRangeCount: number;
  };
}

function getDefaultDataDir(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, "../../data");
}

function ipv4ToNumber(address: string): number {
  const parsed = ipaddr.parse(address);

  if (parsed.kind() !== "ipv4") {
    throw new Error(`Expected IPv4 address: ${address}`);
  }

  const bytes = parsed.toByteArray();
  return (
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  );
}

function parseDatacenterRanges(content: string): DatacenterRange[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [start, end, provider = "unknown"] = line.split(",");
      return { start, end, provider };
    })
    .filter((range) => range.start && range.end);
}

interface IpInterval {
  start: number;
  end: number;
  country: string;
}

function cidrToInterval(cidr: string, country: string): IpInterval | null {
  try {
    const [network, prefix] = ipaddr.parseCIDR(cidr);
    if (network.kind() !== "ipv4") {
      return null;
    }

    const start = ipv4ToNumber(network.toString());
    const size = 2 ** (32 - prefix);

    return {
      start,
      end: start + size - 1,
      country,
    };
  } catch {
    return null;
  }
}

function buildSortedIntervals(ranges: IcloudRelayRange[]): IpInterval[] {
  const intervals: IpInterval[] = [];

  for (const range of ranges) {
    const interval = cidrToInterval(range.cidr, range.country);
    if (interval) {
      intervals.push(interval);
    }
  }

  intervals.sort((left, right) => left.start - right.start);
  return intervals;
}

function findIntervalMatch(
  ipNumber: number,
  intervals: IpInterval[],
): IpInterval | undefined {
  let low = 0;
  let high = intervals.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const interval = intervals[middle];

    if (ipNumber < interval.start) {
      high = middle - 1;
      continue;
    }

    if (ipNumber > interval.end) {
      low = middle + 1;
      continue;
    }

    return interval;
  }

  return undefined;
}

function parseIcloudRelayRanges(content: string): IcloudRelayRange[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [cidr, country = ""] = line.split(",");
      return { cidr, country };
    })
    .filter((range) => range.cidr.includes("/"));
}

function parseAbuseIps(content: string): Set<string> {
  const ips = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  return new Set(ips);
}

function isIpv4InDatacenterRange(
  ipNumber: number,
  ranges: DatacenterRange[],
): DatacenterRange | undefined {
  for (const range of ranges) {
    const start = ipv4ToNumber(range.start);
    const end = ipv4ToNumber(range.end);

    if (ipNumber >= start && ipNumber <= end) {
      return range;
    }
  }

  return undefined;
}

function matchIcloudRelay(
  ip: string,
  intervals: IpInterval[],
): IpInterval | undefined {
  try {
    const ipNumber = ipv4ToNumber(ip);
    return findIntervalMatch(ipNumber, intervals);
  } catch {
    return undefined;
  }
}

function readDataFile(dataDir: string, filename: string): string {
  const filePath = path.join(dataDir, filename);

  if (!fs.existsSync(filePath)) {
    return "";
  }

  return fs.readFileSync(filePath, "utf-8");
}

export function createIpListChecker(dataDir = getDefaultDataDir()): IpListChecker {
  const abuseIps = parseAbuseIps(readDataFile(dataDir, "abuse_ip_db_30d_ips.csv"));
  const datacenterRanges = parseDatacenterRanges(
    readDataFile(dataDir, "datacenter_ip_ranges.csv"),
  );
  const icloudRelayIntervals = buildSortedIntervals(
    parseIcloudRelayRanges(readDataFile(dataDir, "icloud_private_relay_ip_ranges.csv")),
  );

  return {
    stats: {
      abuseIpCount: abuseIps.size,
      datacenterRangeCount: datacenterRanges.length,
      icloudRelayRangeCount: icloudRelayIntervals.length,
    },
    check(ip: string): IpListMatchResult {
      const isAbuseListedIp = abuseIps.has(ip);
      let isDatacenterIp = false;
      let datacenterProvider: string | undefined;
      let isIcloudPrivateRelay = false;
      let icloudRelayCountry: string | undefined;

      try {
        const ipNumber = ipv4ToNumber(ip);
        const datacenterMatch = isIpv4InDatacenterRange(ipNumber, datacenterRanges);

        if (datacenterMatch) {
          isDatacenterIp = true;
          datacenterProvider = datacenterMatch.provider;
        }
      } catch {
        // Non-IPv4 addresses are not matched against datacenter ranges.
      }

      const icloudMatch = matchIcloudRelay(ip, icloudRelayIntervals);
      if (icloudMatch) {
        isIcloudPrivateRelay = true;
        icloudRelayCountry = icloudMatch.country || undefined;
      }

      return {
        isDatacenterIp,
        isAbuseListedIp,
        isIcloudPrivateRelay,
        datacenterProvider,
        icloudRelayCountry,
      };
    },
  };
}

let cachedChecker: IpListChecker | undefined;
let cachedDataDir: string | undefined;

export function getIpListChecker(dataDir?: string): IpListChecker {
  const resolvedDataDir = dataDir ?? getDefaultDataDir();

  if (!cachedChecker || cachedDataDir !== resolvedDataDir) {
    cachedChecker = createIpListChecker(resolvedDataDir);
    cachedDataDir = resolvedDataDir;
  }

  return cachedChecker;
}

export function resetIpListCheckerCache(): void {
  cachedChecker = undefined;
  cachedDataDir = undefined;
}

export function getDefaultIpDataDir(): string {
  return getDefaultDataDir();
}
