import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "undici";
import { parseIp } from "../src/server/ipLists.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");

const ABUSE_IP_URL =
  "https://raw.githubusercontent.com/borestad/blocklist-abuseipdb/main/abuseipdb-s100-30d.ipv4";
const ICLOUD_RELAY_URL = "https://mask-api.icloud.com/egress-ip-ranges.csv";
const DATACENTER_URL =
  "https://raw.githubusercontent.com/client9/ipcat/master/datacenters.csv";

/**
 * Refuse to overwrite a list when the fresh copy has fewer than this fraction
 * of the rows currently on disk — a sharp drop almost always means the upstream
 * served an error page or a partial response, not a legitimate shrink.
 */
const MIN_RETAIN_RATIO = 0.5;

const FORCE = process.argv.includes("--force");

interface PreparedList {
  filename: string;
  label: string;
  rows: string[];
}

async function fetchText(url: string): Promise<string> {
  const { body, statusCode } = await request(url);

  if (statusCode && statusCode >= 400) {
    throw new Error(`Failed to fetch ${url}: HTTP ${statusCode}`);
  }

  const text = await body.text();

  // A 200 response that is actually an HTML error/interstitial page.
  if (/^\s*<(?:!doctype|html|\?xml)/i.test(text)) {
    throw new Error(`Refusing ${url}: response looks like HTML, not list data`);
  }

  return text;
}

function dataLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

/** CIDR range that the runtime loader will accept. */
function isValidCidr(cidr: string): boolean {
  const parts = cidr.split("/");
  if (parts.length !== 2) {
    return false;
  }

  const [network, prefixText] = parts;
  const parsed = parseIp(network.trim());
  if (!parsed || !/^\d+$/.test(prefixText.trim())) {
    return false;
  }

  const prefix = Number(prefixText);
  const maxPrefix = parsed.kind === "ipv4" ? 32 : 128;
  return Number.isInteger(prefix) && prefix >= 0 && prefix <= maxPrefix;
}

/** IP range that the runtime loader will accept. */
function isValidIpRange(startIp: string, endIp: string): boolean {
  const start = parseIp(startIp.trim());
  const end = parseIp(endIp.trim());
  if (!start || !end || start.kind !== end.kind) {
    return false;
  }

  if (start.kind === "ipv4" && end.kind === "ipv4") {
    return start.value <= end.value;
  }

  if (start.kind === "ipv6" && end.kind === "ipv6") {
    return start.value <= end.value;
  }

  return false;
}

async function prepareAbuseIps(): Promise<PreparedList> {
  console.log("Fetching AbuseIPDB blocklist...");
  const text = await fetchText(ABUSE_IP_URL);
  const rows = dataLines(text).filter(
    (line) => parseIp(line.split(/[\s#,]/)[0]) !== null,
  );
  return { filename: "abuse_ip_db_30d_ips.csv", label: "abuse IP", rows };
}

async function prepareIcloudRelayRanges(): Promise<PreparedList> {
  console.log("Fetching iCloud Private Relay ranges...");
  const text = await fetchText(ICLOUD_RELAY_URL);
  const rows = dataLines(text)
    .map((line) => {
      const columns = line.split(",");
      return `${columns[0]?.trim() ?? ""},${columns[1]?.trim() ?? ""}`;
    })
    .filter((line) => isValidCidr(line.split(",")[0]));
  return {
    filename: "icloud_private_relay_ip_ranges.csv",
    label: "iCloud relay range",
    rows,
  };
}

async function prepareDatacenterRanges(): Promise<PreparedList> {
  console.log("Fetching datacenter IP ranges (ipcat)...");
  const text = await fetchText(DATACENTER_URL);
  const rows = dataLines(text).filter((line) => {
    const [start, end] = line.split(",");
    return start !== undefined && end !== undefined && isValidIpRange(start, end);
  });
  return {
    filename: "datacenter_ip_ranges.csv",
    label: "datacenter range",
    rows,
  };
}

/** Counts the writable rows already on disk so we can guard against collapse. */
function existingRowCount(outputPath: string): number {
  if (!fs.existsSync(outputPath)) {
    return 0;
  }
  return dataLines(fs.readFileSync(outputPath, "utf-8")).length;
}

/** Validates a prepared list against the copy on disk without writing. */
function assertSane({ filename, label, rows }: PreparedList): void {
  if (rows.length === 0) {
    throw new Error(`Refusing to write empty ${label} list`);
  }

  const existing = existingRowCount(path.join(DATA_DIR, filename));
  if (!FORCE && existing > 0 && rows.length < existing * MIN_RETAIN_RATIO) {
    throw new Error(
      `Refusing to overwrite ${label}: ${rows.length} rows is a sharp drop from ` +
        `${existing} on disk (pass --force to override)`,
    );
  }
}

function writeList({ filename, label, rows }: PreparedList): number {
  const outputPath = path.join(DATA_DIR, filename);
  fs.writeFileSync(outputPath, `${rows.join("\n")}\n`, "utf-8");
  console.log(`Wrote ${rows.length} ${label} rows to ${outputPath}`);
  return rows.length;
}

async function main(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Fetch + validate every source before writing anything, so a single bad
  // response never leaves the bundled data half-updated.
  const prepared = await Promise.all([
    prepareAbuseIps(),
    prepareIcloudRelayRanges(),
    prepareDatacenterRanges(),
  ]);

  for (const list of prepared) {
    assertSane(list);
  }

  const [abuseCount, icloudCount, datacenterCount] = prepared.map(writeList);

  const manifest = {
    updatedAt: new Date().toISOString(),
    abuseIpCount: abuseCount,
    icloudRelayRangeCount: icloudCount,
    datacenterRangeCount: datacenterCount,
  };

  fs.writeFileSync(
    path.join(DATA_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );

  console.log("IP data update complete:", manifest);
}

main().catch((error: unknown) => {
  console.error("IP data update failed:", error);
  process.exit(1);
});
