# macOS distribution and installation boundary

The public release is intended to require no developer tooling:

1. Download `Codex-Capacity-Planner-macOS.dmg` from GitHub Releases.
2. Open it and drag the app onto the Applications shortcut.
3. Confirm the first launch once through Finder's **Control-click → Open** flow.

The DMG and ZIP contain the same self-contained app. Node.js, the local monitor,
the quota helper, JavaScript planner sources, and required third-party licenses
are bundled. A user does not install CodexBar, Node.js, a LaunchAgent, or enter a
loopback service address. `SHA256SUMS.txt` covers both downloadable containers.

## Why the first-launch confirmation remains

The repository currently has no Apple Developer ID signing or notarization
credentials. The release is therefore ad-hoc signed so its nested executables
remain internally consistent, but Gatekeeper cannot identify it as software
from a registered developer. The project does not ship a script that removes
quarantine or disables Gatekeeper.

Apple's supported route to a normal double-click launch outside the Mac App
Store is a Developer ID signature followed by notarization and ticket stapling:

- [Signing Mac software with Developer ID](https://developer.apple.com/developer-id/)
- [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

When those credentials become available, the release workflow should import
them through GitHub Actions secrets, enable the hardened runtime, sign every
nested executable with a secure timestamp, notarize the DMG with `notarytool`,
staple the ticket, and verify it with `spctl`. Secret material must never be
committed to this repository.

## Release contract

Pushing a `v*` tag runs `.github/workflows/release.yml`. The workflow builds on
an Apple Silicon macOS runner, verifies the bundled payload, creates both the
DMG and ZIP, verifies the disk image, writes checksums, and publishes all three
files to the matching GitHub Release. Current prebuilt releases require macOS
14 or later on Apple Silicon; Intel users can build the matching architecture
from source.
