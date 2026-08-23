# Contributing

Focused bug fixes, tests, connector hardening, accessibility improvements, and
well-supported decision-model changes are welcome.

## Development

Requirements:

- macOS 14 or later
- Swift 6.2 or later
- Node.js 22 or later (for `node:sqlite`)
- a local Codex installation for live use; tests use synthetic data

Run the public-source checks before opening a pull request:

```sh
./scripts/check-public-tree.sh
./scripts/scan-public-content.sh
node codex-reset.test.js
swift test --package-path CodexResetApp
```

Do not run or attach live account probes to an issue. Never commit `.env`
files, authentication material, local databases, usage history, screenshots of
real accounts, app bundles, ZIP releases, or Swift build directories.

## Decision changes

A decision change must include a synthetic test that demonstrates the time
ordering and the evidence used. Do not infer a reset cause from an unexplained
percentage jump when stronger evidence is available. Keep natural refresh,
forced refresh, plan upgrade, and banked-reset redemption distinct.

## Pull requests

Describe the user-visible outcome, the evidence or fixture behind it, and the
commands run. UI changes should use synthetic screenshots only.
