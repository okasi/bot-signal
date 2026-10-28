/**
 * `bot-signal/edge` — the device-intelligence engine with no Node built-ins:
 * Cloudflare Workers, Vercel Edge, Deno, Bun and Node. Uses WebCrypto only.
 * Request scoring uses headers you pass in; add IP data via `detectServer`
 * or your edge's own geo/ASN headers (`ipCountry`, `isDatacenterIp`, …).
 */
export { createDeviceIntelligence } from "./engine/identify.js";
export * from "./engine/index.js";
export { detectServerClient } from "./server/scoreCore.js";
export type {
  ServerClientContext,
  ServerClientResult,
  ServerDetectorOptions,
} from "./server/types.js";
export { VERSION } from "./version.js";
