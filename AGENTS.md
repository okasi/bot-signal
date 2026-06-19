# AGENTS.md

Guidance for AI agents and contributors working on **detect-bot-client** (npm). GitHub repo: [okasi/anti-bot](https://github.com/okasi/anti-bot).

## Project overview

TypeScript npm library with three detection layers:

| Layer | Entry point | Location |
|-------|-------------|----------|
| Instant (browser) | `detectInstantClient` | `src/detectSuspiciousClient.ts`, `src/checks.ts`, `src/webgpu.ts` |
| Behavioral (browser) | `createBehavioralClientDetector` | `src/behavioral/` |
| Server (Node/edge) | `detectServerClientAsync` | `src/server/` |

Public API is re-exported from `src/index.ts`. Build output: `dist/` (tsup, ESM + CJS).

## Repository layout

```
src/
  detectSuspiciousClient.ts   # instant detection + deprecated aliases
  checks.ts                   # high-value browser checks
  webgpu.ts                   # shader-f16 + isChromiumBrowser
  behavioral/
    analysis.ts               # mouse/scroll/typing heuristics
    scoring.ts                # weighted score aggregation
    detector.ts               # DOM event listener lifecycle
    types.ts
  server/
    geoip.ts                  # doc999tor-fast-geoip wrapper
    ipLists.ts                # abuse/datacenter/icloud CIDR matching
    enrich.ts                 # auto-fill context from clientIp
    analysis.ts               # buildServerSignals
    scoring.ts                # detectServerClient(Async)
    tls.ts                    # JA3 blocklist + UA mismatch
    timezone.ts               # TZ offset + accept-language checks
    types.ts
data/                         # bundled blocklists (shipped in npm package)
docs/                         # GitHub Pages demo site (index.html + app.js)
scripts/build-site.ts         # copies dist/browser.js into docs/
scripts/update-ip-data.ts     # fetches and writes data/*.csv
test/                         # vitest unit + patchright browser tests
  fixtures/harness.html         # DOM fixtures for browser tests
  helpers/                      # test server + patchright harness
  patchright/                   # real Chromium tests via patchright
.github/workflows/
  ci.yml                      # typecheck + unit + patchright + build (Node 22+)
  pages.yml                   # build docs/ and push to gh-pages branch
  publish.yml                 # publish to npm on v* tags
  update-ip-data.yml          # weekly blocklist refresh
```

## Commands

```bash
npm install
npm run typecheck
npm test                    # unit tests (vitest, mocked window)
npm run test:patchright     # browser tests (patchright + real Chromium)
npm run test:all            # unit + patchright
npm run build
npm run build:site            # GitHub Pages demo in docs/
npm run update:ip-data   # refresh data/*.csv from upstream sources
```

Always run `npm run typecheck && npm run test:all && npm run build` before committing.

Patchright browser tests require `npx patchright install chromium` once after install.
The browser bundle (`dist/browser.js`, entry `src/browser.ts`) is injected into Patchright's
isolated execution context via blob URL import — page scripts in the main world are not visible
to `page.evaluate`.

## Conventions

- **Imports at top of file** — no inline imports
- **Exhaustive switch** — use `never` in default case for discriminated unions
- **Minimal scope** — focused diffs, match existing style
- **Tests required** for new signals and non-trivial logic
- **Documentation** — update `README.md` (user-facing) and `AGENTS.md` (architecture) only. Do not add other doc files.

## Adding a detection signal

### Instant (browser)

1. Add check in `src/checks.ts` or `detectSuspiciousClient.ts`
2. Add boolean field to `SuspiciousClientResult` in `src/types.ts`
3. Include in `computeIsLegitClient`
4. Add test in `test/detectSuspiciousClient.test.ts`
5. Document flag in `README.md` signals table

### Behavioral

1. Add heuristic in `src/behavioral/analysis.ts`
2. Register in `buildBehavioralSignals` with `weight` and `confidence`
3. Add test in `test/behavioral.test.ts`
4. Document in `README.md`

### Server

1. Add check in `src/server/analysis.ts` or dedicated module
2. Extend `ServerClientContext` if new input is needed
3. Register signal in `buildServerSignals`
4. Add test in `test/server.test.ts` (use temp `dataDir` fixtures)
5. Document in `README.md`

Prefer low false-positive signals. Use weighted scoring for ambiguous checks.

## IP blocklists

**Do not hand-edit** `data/*.csv`. Update `scripts/update-ip-data.ts` instead.

| File | Source |
|------|--------|
| `abuse_ip_db_30d_ips.csv` | `borestad/blocklist-abuseipdb` (all countries) |
| `icloud_private_relay_ip_ranges.csv` | `mask-api.icloud.com` (all countries, `cidr,country`) |
| `datacenter_ip_ranges.csv` | `client9/ipcat` datacenters.csv |

Weekly refresh: `.github/workflows/update-ip-data.yml`  
Datacenter detection: IP matched against ipcat ranges in `src/server/ipLists.ts`  
GeoIP: `doc999tor-fast-geoip` via `lookupClientIpGeo` when `clientIp` is set

## Scoring formula

Behavioral and server modes:

```
suspicionScore = 1 - Π(1 - weightᵢ)   for each triggered signal
isLegitClient = suspicionScore < scoreThreshold
```

## Testing notes

- Server tests use `createFixtureDataDir()` with temp CSVs and `resetIpListCheckerCache()`
- Browser instant unit tests mock `window` / `navigator` with prototype-based `webdriver`
- Patchright tests (`test/patchright/`) run detection in real Chromium via `test/helpers/patchright-harness.ts`
- GeoIP tests call real `lookup("8.8.8.8")` — requires `doc999tor-fast-geoip` data in node_modules

## Package publishing

`package.json` `files`: `["dist", "data"]`  
Entry: ESM `dist/index.js`, CJS `dist/index.cjs`, types `dist/index.d.ts`

GitHub Actions (`.github/workflows/publish.yml`) publishes via **npm Trusted Publishing** (OIDC).

**First release:** publish as `detect-bot-client`. One-time local `npm publish --access public`, then Trusted publishing: `okasi` / `anti-bot` / `publish.yml`.

## Pull request checklist

- [ ] `npm run typecheck && npm run test:all && npm run build` pass
- [ ] `README.md` updated for user-facing changes
- [ ] `AGENTS.md` updated if architecture or layout changed
- [ ] No new documentation files beyond README.md and AGENTS.md
