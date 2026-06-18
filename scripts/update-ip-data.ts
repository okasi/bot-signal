import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "undici";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");

const ABUSE_IP_URL =
  "https://raw.githubusercontent.com/borestad/blocklist-abuseipdb/main/abuseipdb-s100-30d.ipv4";
const ICLOUD_RELAY_URL = "https://mask-api.icloud.com/egress-ip-ranges.csv";
const DATACENTER_URL =
  "https://raw.githubusercontent.com/client9/ipcat/master/datacenters.csv";

async function fetchText(url: string): Promise<string> {
  const { body, statusCode } = await request(url);

  if (statusCode && statusCode >= 400) {
    throw new Error(`Failed to fetch ${url}: HTTP ${statusCode}`);
  }

  return body.text();
}

async function updateAbuseIps(): Promise<number> {
  console.log("Fetching AbuseIPDB blocklist...");
  const text = await fetchText(ABUSE_IP_URL);
  const ips = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const outputPath = path.join(DATA_DIR, "abuse_ip_db_30d_ips.csv");
  fs.writeFileSync(outputPath, `${ips.join("\n")}\n`, "utf-8");
  console.log(`Wrote ${ips.length} abuse IPs to ${outputPath}`);

  return ips.length;
}

async function updateIcloudRelayRanges(): Promise<number> {
  console.log("Fetching iCloud Private Relay ranges...");
  const text = await fetchText(ICLOUD_RELAY_URL);
  const rows = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const columns = line.split(",");
      return `${columns[0]},${columns[1] ?? ""}`;
    })
    .filter((line) => line.includes("/"));

  const outputPath = path.join(DATA_DIR, "icloud_private_relay_ip_ranges.csv");
  fs.writeFileSync(outputPath, `${rows.join("\n")}\n`, "utf-8");
  console.log(`Wrote ${rows.length} iCloud relay ranges to ${outputPath}`);

  return rows.length;
}

async function updateDatacenterRanges(): Promise<number> {
  console.log("Fetching datacenter IP ranges (ipcat)...");
  const text = await fetchText(DATACENTER_URL);
  const rows = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const outputPath = path.join(DATA_DIR, "datacenter_ip_ranges.csv");
  fs.writeFileSync(outputPath, `${rows.join("\n")}\n`, "utf-8");
  console.log(`Wrote ${rows.length} datacenter ranges to ${outputPath}`);

  return rows.length;
}

async function main(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const [abuseCount, icloudCount, datacenterCount] = await Promise.all([
    updateAbuseIps(),
    updateIcloudRelayRanges(),
    updateDatacenterRanges(),
  ]);

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
