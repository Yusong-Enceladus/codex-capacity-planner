#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"

required_files="LICENSE NOTICE README.md CHANGELOG.md SECURITY.md CONTRIBUTING.md CODE_OF_CONDUCT.md docs/architecture.md docs/distribution.md docs/privacy.md docs/signal-contract.md patches/codexbar/0001-Add-Codex-Reset-provider-presentation.patch"
for required_file in $required_files; do
  if [ ! -f "$required_file" ]; then
    echo "missing required public file: $required_file" >&2
    exit 1
  fi
done

owned_paths="README.md CodexResetApp codex-reset.js codex-reset-monitor.js codex-reset-history.js codex-reset-behavior.js codex-reset-short-load.js codex-reset-workload-eval.js codex-reset-usage-history.js codex-reset-usage-pricing.js codex-reset-usage-history.test.js codex-reset.test.js receiver docs scripts patches"
absolute_user_path='/Users'"/"
temporary_item_path='Temporary'"Items/"

if rg -n --hidden \
  -g '!CodexResetApp/.build/**' \
  -g '!CodexResetApp/dist/**' \
  -g '!CodexResetApp/qa/**' \
  -g '!CodexResetApp/design-qa.md' \
  -g '!**/*.png' -g '!**/*.jpg' \
  "$absolute_user_path|$temporary_item_path" \
  $owned_paths; then
  echo "public-source check found a machine-specific or migration-only value" >&2
  exit 1
fi

if find . -maxdepth 3 -type f \( -name '*.p12' -o -name '*.pem' -o -name '*.key' \) -print | grep -q .; then
  echo "public-source check found a private-key-shaped file" >&2
  exit 1
fi

echo "public-source checks passed"
