# is-suspicious-client

Detect headless browsers, automation frameworks, and suspicious client behavior in the browser and on the server.

## Install

```bash
npm install is-suspicious-client
```

## Detection modes

| Mode | API | Environment | What it checks |
| --- | --- | --- | --- |
| **Instant** | `detectInstantClient` | Browser | Environment/fingerprint signals (WebDriver, WebGL, UA, plugins, etc.) |
| **Behavioral** | `createBehavioralClientDetector` | Browser | Mouse, scroll, and typing patterns with weighted suspicion scoring |
| **Server** | `detectServerClient` | Node/server | IP/timezone mismatch, TLS fingerprint, datacenter IP, Accept-Language geo |

---

## Instant detection

Runs synchronously against `window` — use this for first-pass gating on page load.

```ts
import { detectInstantClient } from "is-suspicious-client";

const result = detectInstantClient(window);

if (!result.isLegitClient) {
  console.warn("Suspicious environment", result);
}
```

### Instant + WebGPU (async)

On Chromium browsers, also validates WebGPU [`shader-f16`](https://scrapfly.io/web-scraping-tools/gpu-fingerprint/webgpu/shader-f16) support:

```ts
import { detectInstantClientAsync } from "is-suspicious-client";

const result = await detectInstantClientAsync(window);
console.log(result.isShaderF16Supported); // true | false | null
```

### Instant signals

| Flag | Description |
| --- | --- |
| `isWebDriver` | `navigator.webdriver` is set |
| `isPhantomJS` | PhantomJS globals detected |
| `isNightmare` | Nightmare.js marker detected |
| `isSelenium` | Selenium document markers detected |
| `isDomAutomation` | Chrome DOM automation globals detected |
| `isHeadless` | WebDriver or HeadlessChrome user agent |
| `isSuspiciousResolution` | Viewport smaller than Apple Watch Series 3 (38mm) |
| `isUserAgentValid` | User agent starts with `Mozilla/5.0 (` |
| `isWebGLSupported` | WebGL context can be created |
| `isModern` | Chrome ≥ 121, Firefox ≥ 128, or Safari ≥ 16.4 |
| `isMissingChromeObject` | Chromium UA without `window.chrome.runtime` |
| `isSoftwareRenderer` | WebGL reports SwiftShader, llvmpipe, or similar |
| `isSuspiciousWindowDimensions` | No browser chrome and window at screen origin |
| `isEmptyPlugins` | Chromium with zero `navigator.plugins` |
| `isAutomationArtifacts` | ChromeDriver, Puppeteer, or Playwright markers |
| `isSuspiciousWebDriverDescriptor` | `navigator.webdriver` patched or own-property tampering |
| `isChromium` | Chrome/Edge/Chromium user agent |
| `isShaderF16Supported` | WebGPU `shader-f16` feature (async, Chromium only) |
| `isLegitClient` | Combined pass/fail across applicable checks |

---

## Behavioral detection

Observes user interaction over time and produces a **weighted suspicion score** (0–1) with per-signal confidence. Use this after instant checks pass, or in parallel while the user interacts with the page.

```ts
import { createBehavioralClientDetector } from "is-suspicious-client";

const detector = createBehavioralClientDetector({
  context: window,
  minObservationMs: 5_000,
  scoreThreshold: 0.55,
  onUpdate: (result) => {
    console.log(result.suspicionScore, result.confidence, result.signals);
  },
});

// Option A: observe for a fixed duration
const result = await detector.observe(8_000);
console.log(result.isLegitClient, result.suspicionScore);

// Option B: manual lifecycle
detector.start();
// ... later
const live = detector.getResult();
detector.stop();
```

### Behavioral signals

Each signal has a `weight` (0–1) and `confidence` (`high` | `medium` | `low`). The overall `suspicionScore` aggregates triggered weights as `1 - Π(1 - weight)`.

| Signal | Weight | Confidence | Description |
| --- | --- | --- | --- |
| `no-mouse-activity` | 0.20 | low | Clicks without any mouse movement |
| `click-without-mouse-movement` | 0.35 | high | Click with no recent mouse path |
| `linear-mouse-movement` | 0.25 | medium | Unusually straight path, uniform speed |
| `teleport-mouse` | 0.40 | high | Implausible cursor jumps |
| `linear-scroll` | 0.30 | medium | Uniform scroll deltas and timing |
| `linear-typing` | 0.35 | high | Robotic or superhuman key intervals |
| `synthetic-events` | 0.50 | high | `isTrusted === false` on input events |

### Behavioral result

```ts
interface BehavioralClientResult {
  suspicionScore: number;       // 0–1
  confidence: "high" | "medium" | "low";
  signals: BehavioralSignal[];  // per-signal breakdown
  sampleCounts: {
    mouseMoves: number;
    scrolls: number;
    keyPresses: number;
    clicks: number;
    syntheticEvents: number;
  };
  observationMs: number;
  isLegitClient: boolean;       // suspicionScore < threshold
}
```

### Pure analysis (no listeners)

For testing or server-side replay of captured event samples:

```ts
import { analyzeBehavioralSamples } from "is-suspicious-client";

const result = analyzeBehavioralSamples({
  mouseMoves: [{ x: 0, y: 0, t: 0, isTrusted: true }, /* ... */],
  scrolls: [],
  keyPresses: [],
  clicks: [],
  observationMs: 5_000,
});
```

---

## Server detection

Pure functions for Node.js, edge workers, or API gateways. No browser APIs required — pass request metadata your infrastructure already collects.

```ts
import { detectServerClient } from "is-suspicious-client";

// In an Express/Fastify/hono handler:
const result = detectServerClient({
  ipTimezone: geo.timezone,              // from GeoIP e.g. MaxMind
  clientTimezone: req.headers["x-timezone"], // from client beacon/header
  tlsFingerprint: req.headers["x-ja3-hash"], // from nginx/Cloudflare/envoy
  userAgent: req.headers["user-agent"],
  acceptLanguage: req.headers["accept-language"],
  ipCountry: geo.country,
  isDatacenterIp: geo.isHosting,
});

if (!result.isLegitClient) {
  return res.status(403).json({ reason: result.signals });
}
```

### Where to get inputs

| Field | Typical source |
| --- | --- |
| `ipTimezone` / `ipCountry` / `isDatacenterIp` | GeoIP database (MaxMind, ipinfo, Cloudflare `CF-IPCountry`) |
| `clientTimezone` | Client beacon (`Intl.DateTimeFormat().resolvedOptions().timeZone`) via `X-Timezone` header or cookie |
| `tlsFingerprint` | Reverse proxy JA3/JA4 (`ssl_ja3_hash` in nginx, Cloudflare `cf.tls_cipher`, etc.) |

### Server signals

| Signal | Weight | Confidence | Description |
| --- | --- | --- | --- |
| `timezone-mismatch` | 0.45 | high | Client timezone offset differs from GeoIP timezone |
| `known-suspicious-tls` | 0.55 | high | JA3 matches Python, curl, Go, or other scripting clients |
| `tls-user-agent-mismatch` | 0.50 | high | TLS fingerprint family conflicts with User-Agent |
| `missing-tls-fingerprint` | 0.25 | medium | Browser UA without TLS fingerprint (when `requireTlsFingerprint: true`) |
| `accept-language-geo-mismatch` | 0.20 | low | Accept-Language missing GeoIP country code |
| `datacenter-browser-mismatch` | 0.35 | medium | Hosting/datacenter IP with residential browser UA |

### Server result

```ts
interface ServerClientResult {
  suspicionScore: number;
  confidence: "high" | "medium" | "low";
  signals: ServerSignal[];
  isLegitClient: boolean;
  context: { ipTimezone?, clientTimezone?, tlsFingerprint?, userAgent?, ipCountry? };
}
```

### Custom TLS blocklist

```ts
detectServerClient(context, {
  suspiciousTlsFingerprints: ["abc123..."],
  timezoneToleranceMinutes: 90,
  scoreThreshold: 0.5,
  requireTlsFingerprint: true,
});
```

Built-in suspicious TLS fingerprints are exported as `KNOWN_SUSPICIOUS_TLS_FINGERPRINTS`.

---

## API reference

```ts
import {
  // Instant (browser)
  detectInstantClient,
  detectInstantClientAsync,

  // Behavioral (browser)
  createBehavioralClientDetector,
  analyzeBehavioralSamples,

  // Server (Node/edge)
  detectServerClient,
  isTimezoneMismatch,
  isTlsUserAgentMismatch,
  KNOWN_SUSPICIOUS_TLS_FINGERPRINTS,

  // Helpers
  checkShaderF16Support,
  isChromiumBrowser,
  isSoftwareRenderer,
  isAutomationArtifacts,
} from "is-suspicious-client";
```

`detectSuspiciousClient` and `detectSuspiciousClientAsync` remain as deprecated aliases for backward compatibility.

## License

MIT
