# Signal Reference

Every detection mode returns explainable signals. Use them for logging, adaptive challenges, or custom thresholds.

## Scoring

**Behavioral** and **server** modes use weighted aggregation:

```
suspicionScore = 1 - Π(1 - weightᵢ)   for each triggered signal i
```

`isLegitClient = suspicionScore < scoreThreshold`

---

## Instant signals

Boolean flags on `SuspiciousClientResult`. Any `true` suspicious flag fails `isLegitClient`.

| Flag | What triggers it |
|------|------------------|
| `isWebDriver` | `navigator.webdriver === true` |
| `isPhantomJS` | `window.callPhantom` or `window._phantom` |
| `isNightmare` | `window.__nightmare` |
| `isSelenium` | `document.__selenium_unwrapped`, `__webdriver_evaluate`, `__driver_evaluate` |
| `isDomAutomation` | `domAutomation` or `domAutomationController` globals |
| `isHeadless` | WebDriver or `Headless` in user agent |
| `isSuspiciousResolution` | Screen smaller than Apple Watch 38mm (136×170) |
| `isUserAgentValid` | UA does **not** start with `Mozilla/5.0 (` |
| `isWebGLSupported` | Cannot create WebGL context |
| `isModern` | Below Chrome 121 / Firefox 128 / Safari 16.4 |
| `isMissingChromeObject` | Chromium UA without `window.chrome.runtime` |
| `isSoftwareRenderer` | WebGL renderer is SwiftShader, llvmpipe, etc. |
| `isSuspiciousWindowDimensions` | `outerWidth === innerWidth` and `screenX/Y === 0` on wide window |
| `isEmptyPlugins` | Chromium with `navigator.plugins.length === 0` |
| `isAutomationArtifacts` | `cdc_*`, `$cdc_*`, `__playwright`, `__pw_*` markers |
| `isSuspiciousWebDriverDescriptor` | `webdriver` as own property or removed from prototype |
| `isChromium` | Informational — Chrome/Edge UA |
| `isShaderF16Supported` | Async only — WebGPU `shader-f16` on Chromium |

---

## Behavioral signals

Returned in `result.signals[]` with `weight` and `confidence`.

| ID | Weight | Confidence | Description |
|----|--------|------------|-------------|
| `no-mouse-activity` | 0.20 | low | Clicks recorded, zero mouse moves |
| `click-without-mouse-movement` | 0.35 | high | Click with no mouse path in prior 2s |
| `linear-mouse-movement` | 0.25 | medium | Straight path + uniform speed (≥6 points) |
| `teleport-mouse` | 0.40 | high | >200px jump in ≤20ms, or >600px jump |
| `linear-scroll` | 0.30 | medium | Uniform scroll deltas and timing (≥4 events) |
| `linear-typing` | 0.35 | high | CV(intervals) < 0.08 or avg interval < 25ms |
| `synthetic-events` | 0.50 | high | `event.isTrusted === false` |

---

## Server signals

Returned in `result.signals[]` with `weight` and `confidence`.

| ID | Weight | Confidence | Description |
|----|--------|------------|-------------|
| `timezone-mismatch` | 0.50 | high | Client TZ offset differs from GeoIP TZ by >60min |
| `known-suspicious-tls` | 0.55 | high | JA3 matches Python, curl, Go, Java, or custom list |
| `tls-user-agent-mismatch` | 0.50 | high | JA3 family conflicts with User-Agent family |
| `missing-tls-fingerprint` | 0.25 | medium | Browser UA without JA3 (when `requireTlsFingerprint`) |
| `accept-language-geo-mismatch` | 0.20 | low | Accept-Language missing GeoIP country |
| `datacenter-browser-mismatch` | 0.35 | medium | Datacenter IP + `Mozilla/5.0 (` user agent |
| `abuse-listed-ip` | 0.60 | high | IP on AbuseIPDB 30-day blocklist |
| `icloud-private-relay` | 0.15 | low | IP in Apple Private Relay egress ranges |

### Built-in suspicious TLS fingerprints

| Label | JA3 hash |
|-------|----------|
| Python urllib3/requests | `e7d705a3286e19ea42f587b344ee6865` |
| Python urllib3 alt | `b32309a26951912be7daeacb6aea7969` |
| curl | `b2114619bfb604579bbb31b673619900` |
| curl alt | `3b5074b1b5d032e5620f6fbd716347afd` |
| Go net/http | `71a02c3315cd8182f8a3e8b2f8b3f6de` |
| Java HTTP client | `6734f5e2a5b8d3fe9f3f4ef4e5d0f7b1` |

Full export: `KNOWN_SUSPICIOUS_TLS_FINGERPRINTS`

### Bundled IP data sources

| File | Records | Source |
|------|---------|--------|
| `datacenter_ip_ranges.csv` | ~3,400 | [ipcat](https://github.com/client9/ipcat) |
| `abuse_ip_db_30d_ips.csv` | ~139,000 | [AbuseIPDB blocklist](https://github.com/borestad/blocklist-abuseipdb) |
| `icloud_private_relay_ip_ranges.csv` | ~287,000 | [Apple mask API](https://mask-api.icloud.com/egress-ip-ranges.csv) |
