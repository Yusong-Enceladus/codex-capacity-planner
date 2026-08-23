# Codex Capacity Planner changelog

Notable user-visible changes are recorded here. The project follows semantic
versioning once the first public release is tagged.

## Unreleased

## 0.1.3 - 2026-08-23

- Deliver one notification for a previously unseen explicit reset announcement
  discovered at Monitor startup when its deadline is still actionable.
- Publish future releases with the official GitHub CLI instead of a deprecated
  third-party release Action runtime.

## 0.1.2 - 2026-08-23

- Recognize an authenticated, explicit reset promise even when the hosted
  lifecycle field lags behind, and parse calendar deadlines from Tibo replies.
- Keep the current account unless it is blocked or learned API-equivalent
  capacity proves another account has materially more capacity at risk.
- Attribute a quota rebuild caused by a paid upgrade before considering the old
  natural-refresh boundary.
- Replace raw reset-credit identifiers with one-way local aliases and omit all
  identifiers from the loopback rendering API.
- Bundle Node.js in the Apple Silicon app and surface a clear startup error if
  the runtime or Monitor resources are missing.
- Include project, CodexBar, and Node.js license notices in binary releases.
- Harden source scanning, pin GitHub Actions, add CodeQL, and align repository
  security settings with the published security policy.
- Clarify that codex-reset.com is an independently operated third-party service.

## 0.1.1 - 2026-08-22

- Build the Swift package and release app on the macOS 26 runner required by
  the selected Swift toolchain.

## 0.1.0 - 2026-08-22

- Prepare the source tree for public development under the MIT License.
- Document the shared decision engine, reset attribution, privacy boundary,
  and public signal-service contract.
- Add a local-only planning fallback when the optional signal service is
  unavailable.
- Remove machine-specific paths, migration metadata, build artifacts, and
  internal explanatory UI copy from the public source boundary.
