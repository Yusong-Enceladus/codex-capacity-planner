#!/bin/zsh
set -euo pipefail

project_root="${0:A:h:h}"
app_root="$project_root/CodexResetApp"
release_dir="$project_root/outputs/release"
archive="$release_dir/Codex-Capacity-Planner-macOS.zip"

"$app_root/build-app.sh"
app_bundle="$app_root/dist/Codex Capacity Planner.app"
for required_path in \
  "$app_bundle/Contents/Resources/node" \
  "$app_bundle/Contents/Resources/Legal/LICENSE" \
  "$app_bundle/Contents/Resources/Legal/NOTICE" \
  "$app_bundle/Contents/Resources/Legal/CodexBar-LICENSE" \
  "$app_bundle/Contents/Resources/Legal/Node.js-LICENSE"
do
  if [[ ! -f "$required_path" ]]; then
    print -u2 -- "missing required release payload: $required_path"
    exit 1
  fi
done
mkdir -p "$release_dir"
ditto -c -k --sequesterRsrc --keepParent \
  "$app_bundle" \
  "$archive"

cd "$release_dir"
shasum -a 256 "${archive:t}" > SHA256SUMS.txt
print -r -- "$archive"
print -r -- "$release_dir/SHA256SUMS.txt"
