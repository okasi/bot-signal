import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Track data dirs for which we've already emitted the "no data" warning.
const warnedAboutMissingData = new Set<string>();

/** Result of matching one IP against the bundled blocklists. */
export interface IpListMatchResult {
  /** IP falls inside a known datacenter/hosting provider range */
  isDatacenterIp: boolean;
  /** IP appears on the AbuseIPDB 30-day blocklist */
  isAbuseListedIp: boolean;
  /** IP is an iCloud Private Relay egress address */
  isIcloudPrivateRelay: boolean;
  /** Provider name when `isDatacenterIp` is true (e.g. `Amazon AWS`) */
  datacenterProvider?: string;
  /** ISO country code of the relay egress when `isIcloudPrivateRelay` is true */
  icloudRelayCountry?: string;
}

/** Pre-parsed blocklist matcher. Create once and reuse — see {@link getIpListChecker}. */
export interface IpListChecker {
  /** Match an IPv4 or IPv6 address against all bundled lists. Invalid input matches nothing. */
  check(ip: string): IpListMatchResult;
  /** Entry counts loaded from the data directory. */
  stats: {
    abuseIpCount: number;
    datacenterRangeCount: number;
    icloudRelayRangeCount: number;
  };
}

// ---------------------------------------------------------------------------
// IP parsing — self-contained so the library stays dependency-light.
// IPv4 addresses become 32-bit numbers; IPv6 addresses become 128-bit bigints.
// ---------------------------------------------------------------------------

export type ParsedIp =
  | { kind: "ipv4"; value: number; canonical: string }
  | { kind: "ipv6"; value: bigint; canonical: string };

const IPV4_MAPPED_PREFIX = 0xffffn << 32n;
const IPV4_MAPPED_MASK = ~0xffffffffn & ((1n << 128n) - 1n);

function parseIpv4(address: string): ParsedIp | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }

  let value = 0;
  for (const part of parts) {
    if (part.length === 0 || part.length > 3 || !/^\d+$/.test(part)) {
      return null;
    }

    const octet = Number(part);
    if (octet > 255 || (part.length > 1 && part.startsWith("0"))) {
      return null;
    }

    value = value * 256 + octet;
  }

  return {
    kind: "ipv4",
    value,
    canonical: `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`,
  };
}

function parseIpv6(address: string): ParsedIp | null {
  // Strip zone index (fe80::1%eth0) — irrelevant for list matching.
  let input = address.split("%")[0].toLowerCase();

  // Embedded IPv4 tail (::ffff:192.0.2.1) → two trailing hex groups.
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    const tail = parseIpv4(input.slice(lastColon + 1));
    if (!tail || tail.kind !== "ipv4") {
      return null;
    }

    const high = (tail.value >>> 16) & 0xffff;
    const low = tail.value & 0xffff;
    input = `${input.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }

  const doubleColonSplit = input.split("::");
  if (doubleColonSplit.length > 2) {
    return null;
  }

  const splitGroups = (segment: string): string[] | null => {
    if (segment === "") {
      return [];
    }
    const groups = segment.split(":");
    return groups.every((group) => /^[0-9a-f]{1,4}$/.test(group)) ? groups : null;
  };

  const head = splitGroups(doubleColonSplit[0]);
  const tail = doubleColonSplit.length === 2 ? splitGroups(doubleColonSplit[1]) : [];
  if (!head || !tail) {
    return null;
  }

  const missing = 8 - head.length - tail.length;
  if (doubleColonSplit.length === 2 ? missing < 1 : missing !== 0) {
    return null;
  }

  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  let value = 0n;
  for (const group of groups) {
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }

  // IPv4-mapped (::ffff:a.b.c.d) → canonical IPv4 so all lists apply.
  if ((value & IPV4_MAPPED_MASK) === IPV4_MAPPED_PREFIX) {
    const v4 = Number(value & 0xffffffffn);
    return {
      kind: "ipv4",
      value: v4,
      canonical: `${(v4 >>> 24) & 0xff}.${(v4 >>> 16) & 0xff}.${(v4 >>> 8) & 0xff}.${v4 & 0xff}`,
    };
  }

  const canonicalGroups: string[] = [];
  for (let index = 7; index >= 0; index -= 1) {
    canonicalGroups.push(((value >> BigInt(index * 16)) & 0xffffn).toString(16));
  }

  return { kind: "ipv6", value, canonical: canonicalGroups.join(":") };
}

/**
 * Parses an IPv4 or IPv6 address. IPv4-mapped IPv6 addresses (`::ffff:1.2.3.4`)
 * normalize to IPv4 so proxies handing over mapped addresses still match.
 * Returns `null` for anything that is not a valid address.
 */
export function parseIp(address: string): ParsedIp | null {
  const trimmed = address.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.includes(":") ? parseIpv6(trimmed) : parseIpv4(trimmed);
}

// ---------------------------------------------------------------------------
// Interval matching — lists are parsed once into sorted arrays, lookups are
// binary searches. IPv4 and IPv6 live in separate arrays (different spaces).
// ---------------------------------------------------------------------------

interface Interval<T extends number | bigint> {
  start: T;
  end: T;
  payload: string;
}

function sortIntervals<T extends number | bigint>(intervals: Interval<T>[]): Interval<T>[] {
  intervals.sort((left, right) => (left.start < right.start ? -1 : left.start > right.start ? 1 : 0));
  return intervals;
}

function findInterval<T extends number | bigint>(
  value: T,
  intervals: Interval<T>[],
): Interval<T> | undefined {
  let low = 0;
  let high = intervals.length - 1;

  while (low <= high) {
    const middle = (low + high) >>> 1;
    const interval = intervals[middle];

    if (value < interval.start) {
      high = middle - 1;
    } else if (value > interval.end) {
      low = middle + 1;
    } else {
      return interval;
    }
  }

  return undefined;
}

interface IntervalSet {
  v4: Interval<number>[];
  v6: Interval<bigint>[];
  size: number;
}

function createIntervalSet(): IntervalSet {
  return { v4: [], v6: [], size: 0 };
}

function addCidr(set: IntervalSet, cidr: string, payload: string): void {
  const [address, prefixText] = cidr.split("/");
  if (prefixText === undefined) {
    return;
  }

  const prefix = Number(prefixText);
  const parsed = parseIp(address);
  if (!parsed || !Number.isInteger(prefix) || prefix < 0) {
    return;
  }

  if (parsed.kind === "ipv4") {
    if (prefix > 32) {
      return;
    }
    const size = 2 ** (32 - prefix);
    const start = Math.floor(parsed.value / size) * size;
    set.v4.push({ start, end: start + size - 1, payload });
  } else {
    if (prefix > 128) {
      return;
    }
    const hostBits = BigInt(128 - prefix);
    const start = (parsed.value >> hostBits) << hostBits;
    set.v6.push({ start, end: start + (1n << hostBits) - 1n, payload });
  }

  set.size += 1;
}

function addRange(set: IntervalSet, startIp: string, endIp: string, payload: string): void {
  const start = parseIp(startIp);
  const end = parseIp(endIp);
  if (!start || !end || start.kind !== end.kind) {
    return;
  }

  if (start.kind === "ipv4" && end.kind === "ipv4") {
    if (start.value > end.value) {
      return;
    }

    set.v4.push({ start: start.value, end: end.value, payload });
    set.size += 1;
  } else if (start.kind === "ipv6" && end.kind === "ipv6") {
    if (start.value > end.value) {
      return;
    }

    set.v6.push({ start: start.value, end: end.value, payload });
    set.size += 1;
  }
}

function finalizeIntervalSet(set: IntervalSet): IntervalSet {
  sortIntervals(set.v4);
  sortIntervals(set.v6);
  return set;
}

function matchIntervalSet(set: IntervalSet, parsed: ParsedIp): string | undefined {
  const match =
    parsed.kind === "ipv4"
      ? findInterval(parsed.value, set.v4)
      : findInterval(parsed.value, set.v6);

  return match?.payload;
}

// ---------------------------------------------------------------------------
// Bundled CSV loading
// ---------------------------------------------------------------------------

function getDefaultDataDir(): string {
  // Walk up from the module (src/server/ in development, dist/ when packaged)
  // to the package root containing the bundled data/ directory.
  let dir = path.dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = path.join(dir, "data");
    if (fs.existsSync(path.join(candidate, "datacenter_ip_ranges.csv"))) {
      return candidate;
    }
    dir = path.dirname(dir);
  }

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
}

function readDataFile(dataDir: string, filename: string): string {
  const filePath = path.join(dataDir, filename);

  if (!fs.existsSync(filePath)) {
    return "";
  }

  return fs.readFileSync(filePath, "utf-8");
}

function eachDataLine(content: string, visit: (line: string) => void): void {
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line && !line.startsWith("#")) {
      visit(line);
    }
  }
}

/** Bare IPs, optionally annotated (`1.2.3.4  # TH AS23969 provider`) */
function loadAbuseIps(content: string): Set<string> {
  const ips = new Set<string>();

  eachDataLine(content, (line) => {
    const spaceIndex = line.search(/[\s#]/);
    const parsed = parseIp(spaceIndex === -1 ? line : line.slice(0, spaceIndex));
    if (parsed) {
      ips.add(parsed.canonical);
    }
  });

  return ips;
}

/** `start,end,provider,url` rows from ipcat datacenters.csv */
function loadDatacenterRanges(content: string): IntervalSet {
  const set = createIntervalSet();

  eachDataLine(content, (line) => {
    const [start, end, provider = "unknown"] = line
      .split(",")
      .map((column) => column.trim());
    if (start && end) {
      addRange(set, start, end, provider);
    }
  });

  return finalizeIntervalSet(set);
}

/** `cidr,country` rows from Apple's egress-ip-ranges.csv (IPv4 and IPv6) */
function loadIcloudRelayRanges(content: string): IntervalSet {
  const set = createIntervalSet();

  eachDataLine(content, (line) => {
    const [cidr, country = ""] = line
      .split(",")
      .map((column) => column.trim());
    addCidr(set, cidr, country);
  });

  return finalizeIntervalSet(set);
}

/**
 * Builds a blocklist matcher from the CSVs in `dataDir` (defaults to the
 * package's bundled `data/`). Parsing happens once here; `check` calls are
 * then O(log n) binary searches. Prefer {@link getIpListChecker}, which caches
 * the parsed lists per data directory.
 */
export function createIpListChecker(dataDir = getDefaultDataDir()): IpListChecker {
  const abuseIps = loadAbuseIps(readDataFile(dataDir, "abuse_ip_db_30d_ips.csv"));
  const datacenterRanges = loadDatacenterRanges(
    readDataFile(dataDir, "datacenter_ip_ranges.csv"),
  );
  const icloudRelayRanges = loadIcloudRelayRanges(
    readDataFile(dataDir, "icloud_private_relay_ip_ranges.csv"),
  );

  if (abuseIps.size + datacenterRanges.size + icloudRelayRanges.size === 0) {
    // One-time warning so it doesn't spam on every request if misconfigured.
    if (!warnedAboutMissingData.has(dataDir)) {
      warnedAboutMissingData.add(dataDir);
      process.emitWarning(
        `bot-signal: no IP list data found in ${dataDir} — ` +
          "abuse/datacenter/iCloud relay checks will match nothing",
      );
    }
  }

  return {
    stats: {
      abuseIpCount: abuseIps.size,
      datacenterRangeCount: datacenterRanges.size,
      icloudRelayRangeCount: icloudRelayRanges.size,
    },
    check(ip: string): IpListMatchResult {
      const parsed = parseIp(ip);

      if (!parsed) {
        return {
          isDatacenterIp: false,
          isAbuseListedIp: false,
          isIcloudPrivateRelay: false,
        };
      }

      const datacenterProvider = matchIntervalSet(datacenterRanges, parsed);
      const icloudRelayCountry = matchIntervalSet(icloudRelayRanges, parsed);

      return {
        isDatacenterIp: datacenterProvider !== undefined,
        isAbuseListedIp: abuseIps.has(parsed.canonical),
        isIcloudPrivateRelay: icloudRelayCountry !== undefined,
        datacenterProvider,
        icloudRelayCountry: icloudRelayCountry || undefined,
      };
    },
  };
}

let cachedChecker: IpListChecker | undefined;
let cachedDataDir: string | undefined;

/**
 * Returns a cached {@link IpListChecker} for `dataDir`, creating it on first use.
 *
 * Note: Because of how ESM/CJS interop works, different module instances
 * (e.g. a mix of import vs require, or multiple copies of the package)
 * may each have their own cache. For most server apps this is fine.
 * Call `preloadIpLists()` early at boot.
 */
export function getIpListChecker(dataDir?: string): IpListChecker {
  const resolvedDataDir = dataDir ?? getDefaultDataDir();

  if (!cachedChecker || cachedDataDir !== resolvedDataDir) {
    cachedChecker = createIpListChecker(resolvedDataDir);
    cachedDataDir = resolvedDataDir;
  }

  return cachedChecker;
}

/**
 * Eagerly parses the bundled IP lists into the shared cache so the first
 * request-time check doesn't pay the one-off parse cost (~0.5s for the full
 * bundled data). Call once at server boot. Returns the loaded entry counts.
 *
 * See {@link getIpListChecker} for notes on module caching across ESM/CJS.
 */
export function preloadIpLists(dataDir?: string): IpListChecker["stats"] {
  return getIpListChecker(dataDir).stats;
}

/**
 * Clears the cached checker — used by tests that swap data directories.
 * @internal
 */
export function resetIpListCheckerCache(): void {
  cachedChecker = undefined;
  cachedDataDir = undefined;
  warnedAboutMissingData.clear();
}

/**
 * Absolute path of the package's bundled `data/` directory.
 * @internal
 */
export function getDefaultIpDataDir(): string {
  return getDefaultDataDir();
}
