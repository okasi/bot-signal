import { hmac } from "./crypto.js";
import {
  DEVICE_COMPONENT_NAMES,
  type DeviceComponentName,
  type DeviceComponents,
} from "../identification/types.js";

/** Salted per-component digests. Raw values are never stored. */
export type ComponentDigests = Partial<Record<DeviceComponentName, string>>;

/**
 * Matching weight per component: higher for components that are both
 * high-entropy and stable for a device; lower for ones users change
 * (external monitors, language settings) or that carry little entropy.
 */
export const COMPONENT_WEIGHTS: Record<DeviceComponentName, number> = {
  canvas: 3,
  webgl: 3,
  webglParams: 2,
  audio: 2,
  fonts: 3,
  screen: 1,
  timezone: 1.5,
  languages: 1,
  platform: 2,
  hardware: 1.5,
  touch: 1,
  math: 2,
  mediaQueries: 0.5,
  intl: 1,
  vendor: 1,
  plugins: 0.5,
  architecture: 1,
  browser: 2,
};

/**
 * Index groups. A stored visitor is a match candidate when any one group is
 * unchanged, so identity survives a change in any other group (driver update,
 * new font, browser update, different monitor).
 */
const INDEX_GROUPS: ReadonlyArray<readonly DeviceComponentName[]> = [
  ["webgl", "platform", "architecture", "math"],
  ["canvas", "fonts", "browser"],
  ["audio", "hardware", "timezone", "webglParams"],
];

/** Minimum total weight two payloads must share before similarity is meaningful. */
export const MIN_COMPARABLE_WEIGHT = 10;

/** Re-keys every present component with the deployment salt (HMAC-SHA-256, 128-bit truncation). */
export async function digestComponents(
  components: DeviceComponents,
  salt: string,
): Promise<ComponentDigests> {
  const digests: ComponentDigests = {};
  await Promise.all(
    DEVICE_COMPONENT_NAMES.map(async (name) => {
      const value = components[name];
      if (value !== null) {
        digests[name] = (await hmac(salt, `${name}\u0000${value}`)).slice(0, 22);
      }
    }),
  );
  return digests;
}

/** Index keys for candidate lookup. Groups with a missing component are skipped. */
export function buildIndexKeys(digests: ComponentDigests): string[] {
  const keys: string[] = [];
  INDEX_GROUPS.forEach((group, index) => {
    const values = group.map((name) => digests[name]);
    if (values.every((value) => value !== undefined)) {
      keys.push(`g${index}:${values.join(".")}`);
    }
  });
  return keys;
}

export interface Similarity {
  /** Weighted share of comparable components that match, 0–1. */
  score: number;
  /** Total weight of components present on both sides. */
  comparableWeight: number;
  matched: DeviceComponentName[];
  changed: DeviceComponentName[];
}

export function compareDigests(a: ComponentDigests, b: ComponentDigests): Similarity {
  let matchedWeight = 0;
  let comparableWeight = 0;
  const matched: DeviceComponentName[] = [];
  const changed: DeviceComponentName[] = [];

  for (const name of DEVICE_COMPONENT_NAMES) {
    const left = a[name];
    const right = b[name];
    if (left === undefined || right === undefined) {
      continue;
    }
    comparableWeight += COMPONENT_WEIGHTS[name];
    if (left === right) {
      matchedWeight += COMPONENT_WEIGHTS[name];
      matched.push(name);
    } else {
      changed.push(name);
    }
  }

  return {
    score: comparableWeight === 0 ? 0 : matchedWeight / comparableWeight,
    comparableWeight,
    matched,
    changed,
  };
}
