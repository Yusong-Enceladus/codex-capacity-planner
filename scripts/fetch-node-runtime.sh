#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
node_version="22.23.2"
machine_arch=$(uname -m)

case "$machine_arch" in
  arm64)
    archive="node-v${node_version}-darwin-arm64.tar.gz"
    expected_sha256="61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6"
    ;;
  x86_64)
    archive="node-v${node_version}-darwin-x64.tar.gz"
    expected_sha256="58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026"
    ;;
  *)
    echo "unsupported macOS architecture: $machine_arch" >&2
    exit 1
    ;;
esac

runtime_root="$project_root/CodexResetApp/.build/node-runtime"
runtime_dir="$runtime_root/${archive%.tar.gz}"
if [ ! -x "$runtime_dir/bin/node" ] || [ ! -f "$runtime_dir/LICENSE" ]; then
  mkdir -p "$runtime_root"
  archive_path="$runtime_root/$archive"
  curl -fsSL "https://nodejs.org/dist/v${node_version}/$archive" -o "$archive_path"
  actual_sha256=$(shasum -a 256 "$archive_path" | awk '{print $1}')
  if [ "$actual_sha256" != "$expected_sha256" ]; then
    echo "Node.js runtime checksum mismatch" >&2
    exit 1
  fi
  tar -xzf "$archive_path" -C "$runtime_root"
  rm -f "$archive_path"
fi

printf '%s\n' "$runtime_dir"
