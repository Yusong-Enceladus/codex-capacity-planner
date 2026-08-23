# Security policy

## Supported code

Security fixes target the latest commit and the latest published release.

## Reporting a vulnerability

Do not open a public issue containing credentials, account identifiers, raw
Codex responses, local database contents, private project names, or screenshots
of real account usage. Report vulnerabilities privately through GitHub's
private vulnerability reporting for this repository.

Include only the minimum reproduction needed. Replace account IDs, emails,
reset-credit IDs, paths, tokens, and session titles with synthetic values.

## Trust boundary

- Authentication remains owned by the user's installed Codex/CodexBar tools.
- Codex Capacity Planner must not log or persist access tokens, refresh tokens, cookies,
  raw authentication responses, or reset-credit IDs.
- Personal quota, account, task, and prediction data stays on the Mac and is
  served only over loopback.
- External requests must never include account email, quota percentages,
  refresh times, session titles, project paths, or decision output.
- A displayed recommendation never authorizes redeeming a reset, switching an
  account, changing a subscription, or starting a task.

See [docs/privacy.md](docs/privacy.md) for the complete data flow.
