# Contributing

Thanks for your interest in improving **is-suspicious-client**!

## Development setup

```bash
git clone https://github.com/okasi/is-suspicious-client.git
cd is-suspicious-client
npm install
npm test
npm run build
```

## Making changes

1. Fork the repo and create a branch from `main`
2. Make focused changes with tests
3. Run `npm run typecheck && npm test && npm run build`
4. Open a pull request with a clear description

## Adding detection signals

New signals should include:

- A clear `id` and `description`
- A `weight` (0–1) and `confidence` level
- Tests with realistic and edge-case fixtures
- Documentation in `docs/SIGNALS.md`

Prefer **low false-positive** signals. Document known limitations.

## Updating IP blocklists

Blocklists are refreshed weekly by CI. To update manually:

```bash
npm run update:ip-data
```

Do not hand-edit generated CSV files — update `scripts/update-ip-data.ts` instead.

## Pull request checklist

- [ ] Tests pass (`npm test`)
- [ ] Types check (`npm run typecheck`)
- [ ] Build succeeds (`npm run build`)
- [ ] README / docs updated if behavior changed
- [ ] CHANGELOG.md updated for user-facing changes

## Reporting issues

Open a [GitHub issue](https://github.com/okasi/is-suspicious-client/issues) with:

- What you expected vs what happened
- Environment (browser, Node version, framework)
- Minimal reproduction if possible

## License

By contributing, you agree your contributions will be licensed under the [MIT License](LICENSE).
