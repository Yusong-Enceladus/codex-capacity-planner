#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  scan_paths=$(git ls-files)
else
  scan_paths="README.md CodexResetApp codex-reset.js codex-reset-monitor.js codex-reset-history.js codex-reset-behavior.js codex-reset-short-load.js codex-reset-workload-eval.js codex-reset.test.js receiver docs scripts patches"
fi

if [ -z "$scan_paths" ]; then
  echo "no public files available to scan" >&2
  exit 1
fi

secret_pattern='-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9_-]{20,}|Bearer[[:space:]]+[A-Za-z0-9._~+/-]{24,}'
secret_files=$(rg -l --hidden -e "$secret_pattern" $scan_paths 2>/dev/null || true)
if [ -n "$secret_files" ]; then
  echo "secret-shaped content found in:" >&2
  printf '%s\n' "$secret_files" >&2
  exit 1
fi

absolute_user_path='/Users'"/"
temporary_item_path='Temporary'"Items/"
private_path_files=$(rg -l --hidden -e "$absolute_user_path|$temporary_item_path" $scan_paths 2>/dev/null || true)
if [ -n "$private_path_files" ]; then
  echo "machine-specific private paths found in:" >&2
  printf '%s\n' "$private_path_files" >&2
  exit 1
fi

sensitive_names=$(printf '%s\n' $scan_paths | rg -i '(^|/)(auth\.json|\.env($|\.)|.*\.(pem|p12|key|mobileprovision)|.*credential.*|.*secret.*)$' || true)
if [ -n "$sensitive_names" ]; then
  echo "sensitive file names found in public files:" >&2
  printf '%s\n' "$sensitive_names" >&2
  exit 1
fi

echo "public secret scan passed"
