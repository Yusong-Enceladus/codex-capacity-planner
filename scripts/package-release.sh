#!/bin/zsh
set -euo pipefail

project_root="${0:A:h:h}"
app_root="$project_root/CodexResetApp"
release_dir="$project_root/outputs/release"
archive="$release_dir/Codex-Capacity-Planner-macOS.zip"
disk_image="$release_dir/Codex-Capacity-Planner-macOS.dmg"
staging_dir=$(mktemp -d)
trap 'rm -rf "$staging_dir"' EXIT

app_version=$(/usr/libexec/PlistBuddy \
  -c 'Print :CFBundleShortVersionString' \
  "$app_root/Info.plist")
if [[ -n "${GITHUB_REF_NAME:-}" && "$GITHUB_REF_NAME" != "v$app_version" ]]; then
  print -u2 -- "release tag $GITHUB_REF_NAME does not match app version v$app_version"
  exit 1
fi

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
codesign --verify --deep --strict "$app_bundle"
machine_arch=$(uname -m)
for executable in \
  "$app_bundle/Contents/MacOS/CodexReset" \
  "$app_bundle/Contents/Resources/node" \
  "$app_bundle/Contents/Resources/CodexBarCLI"
do
  if ! lipo -archs "$executable" | tr ' ' '\n' | grep -qx "$machine_arch"; then
    print -u2 -- "release executable does not contain $machine_arch: $executable"
    exit 1
  fi
done
mkdir -p "$release_dir"
rm -f "$archive" "$disk_image" "$release_dir/SHA256SUMS.txt"
ditto -c -k --sequesterRsrc --keepParent \
  "$app_bundle" \
  "$archive"

dmg_root="$staging_dir/Codex Capacity Planner"
mkdir -p "$dmg_root"
ditto "$app_bundle" "$dmg_root/Codex Capacity Planner.app"
ln -s /Applications "$dmg_root/Applications"
cp "$app_root/Assets/Install.txt" "$dmg_root/安装说明 · Install.txt"
hdiutil create \
  -volname "Codex Capacity Planner" \
  -srcfolder "$dmg_root" \
  -format UDZO \
  -ov \
  "$disk_image"
hdiutil verify "$disk_image"

cd "$release_dir"
shasum -a 256 "${disk_image:t}" "${archive:t}" > SHA256SUMS.txt
print -r -- "$disk_image"
print -r -- "$archive"
print -r -- "$release_dir/SHA256SUMS.txt"
