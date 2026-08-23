#!/bin/zsh
set -euo pipefail

project_root="${0:A:h:h}"
app_root="$project_root/CodexResetApp"
release_dir="$project_root/outputs/release"
archive="$release_dir/Codex-Capacity-Planner-macOS.zip"

"$app_root/build-app.sh"
mkdir -p "$release_dir"
ditto -c -k --sequesterRsrc --keepParent \
  "$app_root/dist/Codex Capacity Planner.app" \
  "$archive"

cd "$release_dir"
shasum -a 256 "${archive:t}" > SHA256SUMS.txt
print -r -- "$archive"
print -r -- "$release_dir/SHA256SUMS.txt"
