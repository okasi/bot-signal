# API Reference

## Browser — Instant

### `detectInstantClient(context)`

Synchronous environment and fingerprint checks.

```ts
function detectInstantClient(context: ExtendedWindow): SuspiciousClientResult
```

**Returns** `SuspiciousClientResult` with boolean flags and `isLegitClient`.

### `detectInstantClientAsync(context)`

Instant checks plus async WebGPU `shader-f16` validation on Chromium.

```ts
function detectInstantClientAsync(context: ExtendedWindow): Promise<SuspiciousClientAsyncResult>
```

**Additional field:** `isShaderF16Supported: boolean | null` (`null` = not Chromium).

### Deprecated aliases

- `detectSuspiciousClient` → `detectInstantClient`
- `detectSuspiciousClientAsync` → `detectInstantClientAsync`
- `default` export → `detectInstantClient`

### Standalone instant helpers

| Export | Description |
|--------|-------------|
| `isChromiumBrowser(context)` | Chrome/Edge/Chromium UA |
| `isAutomationArtifacts(context)` | ChromeDriver / Playwright markers |
| `isSoftwareRenderer(context)` | SwiftShader / llvmpipe WebGL |
| `isMissingChromeObject(context)` | Missing `chrome.runtime` on Chromium |
| `isSuspiciousWindowDimensions(context)` | Headless-like window sizing |
| `isEmptyPlugins(context)` | Zero plugins on Chromium |
| `isSuspiciousWebDriverDescriptor(context)` | Patched `navigator.webdriver` |
| `checkShaderF16Support(context)` | WebGPU `shader-f16` async check |

---

## Browser — Behavioral

### `createBehavioralClientDetector(options?)`

Creates a long-running interaction observer.

```ts
function createBehavioralClientDetector(
  options?: BehavioralDetectorOptions,
): BehavioralClientDetector
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `context` | `globalThis` | Window to attach listeners |
| `minObservationMs` | `3000` | Default `observe()` duration |
| `scoreThreshold` | `0.55` | Score below = `isLegitClient` |
| `pollIntervalMs` | `1000` | `onUpdate` interval |
| `onUpdate` | — | Callback with live results |

**Detector methods:**

| Method | Description |
|--------|-------------|
| `start()` | Attach event listeners |
| `stop()` | Detach listeners |
| `reset()` | Clear samples and stop |
| `getResult()` | Current score without waiting |
| `observe(ms?)` | `start()` → wait → `stop()` → result |

### `analyzeBehavioralSamples(samples, scoreThreshold?)`

Pure analysis without DOM listeners. Useful for tests and replay.

```ts
function analyzeBehavioralSamples(
  samples: BehavioralSamples,
  scoreThreshold?: number,
): BehavioralClientResult
```

### Behavioral analysis exports

`buildBehavioralSignals`, `aggregateSuspicionScore`, `resolveConfidence`, `hasLinearMouseMovement`, `hasTeleportMouse`, `hasLinearScroll`, `hasLinearTyping`, `hasSyntheticEvents`, `hasClickWithoutMouseMovement`, `hasNoMouseActivity`

---

## Server

### `detectServerClient(context, options?)`

Synchronous server checks. Use when GeoIP fields are already populated.

```ts
function detectServerClient(
  context: ServerClientContext,
  options?: ServerDetectorOptions,
): ServerClientResult
```

### `detectServerClientAsync(context, options?)`

Enriches context from `clientIp` (GeoIP + blocklists), then runs detection.

```ts
function detectServerClientAsync(
  context: ServerClientContext,
  options?: ServerDetectorOptions,
): Promise<ServerClientResult>
```

### `enrichServerContext(context, options?)`

GeoIP lookup and blocklist checks only — no scoring.

```ts
function enrichServerContext(
  context: ServerClientContext,
  options?: ServerDetectorOptions,
): Promise<EnrichedServerContext>
```

### `ServerClientContext`

| Field | Type | Description |
|-------|------|-------------|
| `clientIp` | `string?` | Enables GeoIP + blocklist auto-detection |
| `ipTimezone` | `string?` | IANA timezone from GeoIP |
| `clientTimezone` | `string?` | Client-reported timezone |
| `ipCountry` | `string?` | ISO 3166-1 alpha-2 |
| `tlsFingerprint` | `string?` | JA3 hash or raw string |
| `tlsFingerprintType` | `"ja3" \| "ja4"?` | Default `"ja3"` |
| `userAgent` | `string?` | Request User-Agent |
| `acceptLanguage` | `string?` | Accept-Language header |
| `isDatacenterIp` | `boolean?` | Auto or manual override |
| `isAbuseListedIp` | `boolean?` | Auto from AbuseIPDB list |
| `isIcloudPrivateRelay` | `boolean?` | Auto from Apple relay ranges |

### `ServerDetectorOptions`

| Option | Default | Description |
|--------|---------|-------------|
| `dataDir` | package `data/` | Blocklist CSV directory |
| `lookupGeo` | `true` | Run `doc999tor-fast-geoip` |
| `checkIpLists` | `true` | Check bundled blocklists |
| `timezoneToleranceMinutes` | `60` | TZ offset tolerance |
| `scoreThreshold` | `0.5` | Below = legit |
| `requireTlsFingerprint` | `false` | Flag browser UA without JA3 |
| `suspiciousTlsFingerprints` | `[]` | Custom JA3 blocklist |

### Server helpers

| Export | Description |
|--------|-------------|
| `lookupClientIpGeo(ip)` | Country + timezone lookup |
| `createIpListChecker(dataDir?)` | Abuse / datacenter / iCloud checker |
| `getIpListChecker(dataDir?)` | Cached checker singleton |
| `getDefaultIpDataDir()` | Package data path |
| `resetIpListCheckerCache()` | Clear checker cache (tests) |
| `isTimezoneMismatch(ipTz, clientTz, tolerance?)` | Timezone comparison |
| `isTlsUserAgentMismatch(ja3, ua, extras?)` | TLS vs UA family |
| `isKnownSuspiciousTlsFingerprint(ja3, extras?)` | Known bad JA3 |
| `KNOWN_SUSPICIOUS_TLS_FINGERPRINTS` | Built-in JA3 database |
| `getUserAgentFamily(ua)` | Parse UA family |
| `buildServerSignals(context, options?)` | Signal array without scoring |
| `aggregateServerSuspicionScore(signals)` | Weighted score |

---

## Types

Exported TypeScript types:

- `SuspiciousClientResult`, `SuspiciousClientAsyncResult`
- `ExtendedWindow`, `ExtendedDocument`, `ExtendedNavigator`
- `BehavioralClientResult`, `BehavioralSignal`, `BehavioralSamples`, `BehavioralDetectorOptions`, `BehavioralClientDetector`
- `ServerClientResult`, `ServerSignal`, `ServerClientContext`, `ServerDetectorOptions`
- `ConfidenceLevel`, `TlsFingerprintEntry`, `UserAgentFamily`
