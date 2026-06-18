# Changelog

All notable changes to this project are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.4.0] - 2026-06-18

### Added

- **Server GeoIP** via `doc999tor-fast-geoip` — auto-fill country/timezone from `clientIp`
- **Bundled IP blocklists** (weekly auto-update via GitHub Actions):
  - Datacenter ranges ([ipcat](https://github.com/client9/ipcat))
  - AbuseIPDB 30-day blocklist (global)
  - iCloud Private Relay egress ranges (global)
- `detectServerClientAsync` and `enrichServerContext`
- `createIpListChecker`, `lookupClientIpGeo`
- Signals: `abuse-listed-ip`, `icloud-private-relay`
- `npm run update:ip-data` script

## [1.3.0] - 2026-06-18

### Added

- **Server detection** (`detectServerClient`) with weighted scoring
- TLS fingerprint validation (JA3 blocklist + UA mismatch)
- IP/timezone mismatch detection
- Datacenter-browser mismatch, Accept-Language geo check

## [1.2.0] - 2026-06-18

### Added

- **Behavioral detection** (`createBehavioralClientDetector`)
- Weighted suspicion scoring for mouse, scroll, typing patterns
- `detectInstantClient` as primary instant API name
- `analyzeBehavioralSamples` for pure analysis

## [1.1.0] - 2026-06-18

### Added

- High-value instant checks: `isMissingChromeObject`, `isSoftwareRenderer`, `isSuspiciousWindowDimensions`, `isEmptyPlugins`, `isAutomationArtifacts`, `isSuspiciousWebDriverDescriptor`

## [1.0.0] - 2026-06-18

### Added

- Initial release
- `detectSuspiciousClient` — sync browser detection
- `detectSuspiciousClientAsync` — WebGPU `shader-f16` on Chromium
- ESM + CJS builds with TypeScript types

[1.4.0]: https://github.com/okasi/is-suspicious-client/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/okasi/is-suspicious-client/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/okasi/is-suspicious-client/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/okasi/is-suspicious-client/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/okasi/is-suspicious-client/releases/tag/v1.0.0
