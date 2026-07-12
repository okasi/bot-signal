# AGENTS.md

Guidance for AI agents and contributors working on the **bot-signal** package (npm name: `bot-signal`, GitHub: okasi/bot-signal). It exports `isHuman()` etc. as the simple entry points plus full detection APIs.

## Project overview

TypeScript npm library with three detection layers:

| Layer | Entry point | Location |
|-------|-------------|----------|
| Instant (browser) | `detectInstantClient` | `src/detectInstantClient.ts`, `src/checks.ts`, `src/webgpu.ts` |
| Behavioral (browser) | `createBehavioralClientDetector` | `src/behavioral/` |
| Server (Node) | `detectServerClientAsync` | `src/server/` |

`src/automation.ts` contains the shared best-effort attribution result types.
Instant and server results expose `automation` (`kind`, confidence, evidence,
and alternatives); stealth framework names are probabilistic, not definitive.

Entry points: `src/index.ts` (full API), `src/browser.ts` (browser-only),
`src/server.ts` (server-only). The package.json `exports` map routes the root
import to the browser build under the `browser` condition so browser bundlers
never see `node:fs`. `src/version.ts` provides `VERSION`. Build output: `dist/` (tsup — ESM + CJS + IIFE
`browser.global.js` for CDNs).

## Repository layout

```
src/
  index.ts                    # root entry (full API)
  browser.ts                  # browser entry (instant + behavioral)
  server.ts                   # server entry (server detection only)
  automation.ts               # shared automation attribution types/helper
  userAgent.ts                # shared scripting User-Agent token parser
  detectInstantClient.ts      # instant detection entry
  checks.ts                   # high-value browser checks
  webgpu.ts                   # shader-f16 + isChromiumBrowser
  behavioral/
    analysis.ts               # mouse/scroll/typing/touch heuristics
    scoring.ts                # weighted score aggregation
    index.ts                  # detector (DOM event listener lifecycle)
    types.ts
  server/
    geoip.ts                  # doc999tor-fast-geoip wrapper
    ipLists.ts                # parseIp + interval matching (IPv4/IPv6, binary search)
    enrich.ts                 # auto-fill context from clientIp
    analysis.ts               # buildServerSignals
    scoring.ts                # detectServerClient(Async)
    tls.ts                    # JA3 blocklist + UA mismatch
    timezone.ts               # TZ offset + accept-language checks
    types.ts
data/                         # bundled blocklists (shipped in npm package)
docs/                         # GitHub Pages demo source (index.html + app.js)
scripts/build-site.ts         # builds .pages/ with dist/browser.js + stamped asset URLs
scripts/update-ip-data.ts     # fetches and writes data/*.csv
test/                         # vitest unit + patchright browser tests
  fixtures/harness.html         # DOM fixtures for browser tests
  helpers/                      # test server + patchright harness
  patchright/                   # real Chromium tests via patchright
.github/workflows/
  ci.yml                      # typecheck + unit + patchright + build (Node 22+)
  pages.yml                   # build .pages/ and deploy via GitHub Pages Actions
  publish.yml                 # publish to npm on v* tags
  update-ip-data.yml          # weekly blocklist refresh
```

## Commands

```bash
npm install
npm run typecheck
npm test                    # unit tests (vitest, mocked window)
npm run test:coverage       # unit tests + 100% coverage gate
npm run test:patchright     # browser tests (patchright + real Chromium)
npm run test:all            # unit + patchright
npm run build
npm run lint:package        # publint + Are The Types Wrong
npm run check               # typecheck + coverage + patchright + build + package lint
npm run build:site        # GitHub Pages artifact in .pages/
npm run update:ip-data    # refresh data/*.csv from upstream sources
```

Always run `npm run check` before committing.

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

1. Add check in `src/checks.ts` or `detectInstantClient.ts`
2. Add boolean field to `InstantClientResult` in `src/types.ts`
3. Add a spec (weight + confidence) to `INSTANT_SIGNAL_SPECS` in
   `detectInstantClient.ts` — use `triggerWhenFalse` for positive-health flags.
   Definitive markers weigh 1.0; false-positive-prone checks weigh 0.25–0.45 so
   they only block in combination (score `≥ scoreThreshold`, default 0.5).
4. Add test in `test/detectInstantClient.test.ts`
5. Document flag + weight in `README.md` signals table

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
Matching: `src/server/ipLists.ts` parses lists once into sorted numeric
intervals (IPv4 as numbers, IPv6 as bigints) and binary-searches per lookup.
IPv4-mapped IPv6 input normalizes to IPv4. Abuse entries may carry trailing
`# country AS provider` annotations — only the first token is the IP.
GeoIP: `doc999tor-fast-geoip` via `lookupClientIpGeo` when `clientIp` is set
(IPv4-only, like the ipcat datacenter list). Call `preloadIpLists()` at boot to
pay the one-off parse cost up front. `scripts/update-ip-data.ts` validates row
shapes with `parseIp`, rejects HTML error pages, and refuses to overwrite a list
whose row count collapses (`--force` to override).

## Scoring formula

All three modes:

```
suspicionScore = 1 - Π(1 - weightᵢ)   for each triggered signal
isLegitClient = suspicionScore < scoreThreshold
```

Instant now uses this too (previously a hard boolean AND) — see
`INSTANT_SIGNAL_SPECS`. Default thresholds: instant 0.5, behavioral 0.55,
server 0.5.

## Testing notes

- **Coverage gate is 100%** (statements/branches/functions/lines) on `src/**`
  except `types.ts`; patchright tests are excluded from coverage, so every
  branch needs a unit test. Run `npm run test:coverage`.
- Server tests use `createFixtureDataDir()` with temp CSVs and `resetIpListCheckerCache()`
- Browser instant unit tests mock `window` / `navigator` with prototype-based `webdriver`
- Patchright tests (`test/patchright/`) run detection in real Chromium via `test/helpers/patchright-harness.ts`; `runInstantDetection(page, { scoreThreshold })` passes options through
- GeoIP tests call real `lookup("8.8.8.8")` — requires `doc999tor-fast-geoip` data in node_modules

## Package publishing

`package.json` `files`: `["dist", "data"]`  
Exports: `.` (browser condition → `dist/browser.*`), `./browser`, `./server`,
each with ESM + CJS + split `.d.ts`/`.d.cts`. CDN: `unpkg`/`jsdelivr` point at
`dist/browser.global.js` (IIFE, global `BotSignal`). Keep `publint` and
`@arethetypeswrong/cli` green when touching the exports map.

GitHub Actions (`.github/workflows/publish.yml`) publishes via **npm Trusted Publishing** (OIDC). Every push to `main` automatically creates a patch release: the workflow increments `package.json`, `package-lock.json`, and `src/version.ts`, commits the release version, creates the matching `v*` tag, and publishes it to npm. The workflow uses a concurrency group so main pushes release serially, and GitHub's built-in token prevents the generated release commit/tag from recursively starting another workflow.

**First release:** publish as `bot-signal`. One-time local `npm publish --access public`, then Trusted publishing: `okasi` / `bot-signal` / `publish.yml`.

Every user-facing release must also be published to npm. The normal release process is:

1. Run `npm run check`, commit the user-facing change, and push it to `main`.
2. Let `.github/workflows/publish.yml` create the patch version commit and matching `v*` tag and publish through OIDC. Do not manually bump the version for an ordinary main-branch release.
3. Verify `npm view bot-signal version` reports the new version; do not consider the release complete until it is available on npmjs.com.

## Pull request checklist

- [ ] `npm run check` passes
- [ ] `README.md` updated for user-facing changes
- [ ] `AGENTS.md` updated if architecture or layout changed
- [ ] User-facing releases are versioned, tagged, published, and verified on npmjs.com
- [ ] No new documentation files beyond README.md and AGENTS.md
