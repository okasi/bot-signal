import {
  createDeviceIntelligence as createEngine,
  type DeviceIntelligence,
} from "../engine/identify.js";
import type { DeviceIntelligenceOptions } from "../engine/types.js";
import { detectServerClientAsync } from "./scoring.js";

/**
 * Node flavour of the device-intelligence engine: request scoring is enriched
 * with the bundled GeoIP database and IP lists (datacenter, AbuseIPDB, iCloud
 * Private Relay). On edge runtimes import it from `bot-signal/edge` instead.
 */
export function createDeviceIntelligence(
  options: DeviceIntelligenceOptions,
): DeviceIntelligence {
  return createEngine({
    ...options,
    detectServer:
      options.detectServer ??
      ((context) => detectServerClientAsync(context, options.serverDetection)),
  });
}
