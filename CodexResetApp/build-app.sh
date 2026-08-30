#!/bin/zsh
set -euo pipefail

app_root="${0:A:h}"
cd "$app_root"
swift build -c release

bundle="$app_root/dist/Codex Capacity Planner.app"
rm -rf "$bundle"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
cp "$app_root/.build/release/CodexReset" "$bundle/Contents/MacOS/CodexReset"
cp "$app_root/Info.plist" "$bundle/Contents/Info.plist"
cp "$app_root/Assets/AppIcon.icns" "$bundle/Contents/Resources/AppIcon.icns"
cp "$app_root/Assets/StatusIcon.png" "$bundle/Contents/Resources/StatusIcon.png"
cp "$app_root/Assets/CardIcon.png" "$bundle/Contents/Resources/CardIcon.png"
project_root="$app_root/.."
if [[ ! -d "$project_root/CodexBar-upstream/.git" ]]; then
  "$project_root/scripts/bootstrap-codexbar.sh"
fi
if [[ ! -x "$project_root/CodexBar-upstream/.build/release/CodexBarCLI" ]]; then
  swift build -c release --product CodexBarCLI --package-path "$project_root/CodexBar-upstream"
fi
for source in \
  codex-reset.js \
  codex-reset-monitor.js \
  codex-reset-history.js \
  codex-reset-behavior.js \
  codex-reset-short-load.js \
  codex-reset-workload-eval.js
do
  cp "$project_root/$source" "$bundle/Contents/Resources/$source"
done
mkdir -p "$bundle/Contents/Resources/receiver"
cp "$project_root"/receiver/* "$bundle/Contents/Resources/receiver/"
cp "$project_root/CodexBar-upstream/.build/release/CodexBarCLI" "$bundle/Contents/Resources/CodexBarCLI"
node_runtime=$("$project_root/scripts/fetch-node-runtime.sh")
cp "$node_runtime/bin/node" "$bundle/Contents/Resources/node"
chmod 0755 "$bundle/Contents/Resources/node"
mkdir -p "$bundle/Contents/Resources/Legal"
cp "$project_root/LICENSE" "$bundle/Contents/Resources/Legal/LICENSE"
cp "$project_root/NOTICE" "$bundle/Contents/Resources/Legal/NOTICE"
cp "$project_root/CodexBar-upstream/LICENSE" "$bundle/Contents/Resources/Legal/CodexBar-LICENSE"
cp "$node_runtime/LICENSE" "$bundle/Contents/Resources/Legal/Node.js-LICENSE"
codesign --force --deep --sign - "$bundle"
print -r -- "$bundle"
