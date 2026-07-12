# Contributing

Thanks for improving `bot-signal`. The project is small enough that direct, well-tested changes are preferred over heavy process.

## Development setup

```bash
npm install
npx patchright install chromium
npm run check
```

Use Node 22 or newer. Patchright is used for real Chromium browser coverage and needs the browser install step once per machine.

## Change guidelines

- Keep browser-only code in the browser entry points so browser bundlers never include Node-only modules.
- Keep server-only code under `src/server/` and covered by the `bot-signal/server` entry point.
- Prefer low false-positive detection signals. Use weighted scoring for ambiguous browser, behavioral, and server checks.
- Add focused tests for new signals, scoring changes, exports, and data parsing behavior.
- Do not hand-edit `data/*.csv`; update `scripts/update-ip-data.ts` instead.
- Keep generated build output, coverage output, and local tooling files out of Git unless the repo already tracks them.

## Pull request checklist

- `npm run typecheck` passes.
- `npm run test:coverage` passes with 100% coverage.
- `npm run test:patchright` passes.
- `npm run build` passes.
- `npm run lint:package` passes.
- README is updated for user-facing behavior changes.
- AGENTS.md is updated when architecture or repo layout changes.
