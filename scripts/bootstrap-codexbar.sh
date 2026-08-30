#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
destination="$project_root/CodexBar-upstream"
upstream_url="https://github.com/steipete/CodexBar.git"
upstream_tag="v0.49.3"
upstream_commit="fc57a317cee4a8f84962c62c45e4502085f6fc79"
patch_file="$project_root/patches/codexbar/0001-Add-Codex-Reset-provider-presentation.patch"
history_patch="$project_root/patches/codexbar/0002-Isolate-planner-history-cache.patch"
report_patch="$project_root/patches/codexbar/0003-Reconcile-planner-history-with-native-reports.patch"

apply_history_patch() {
  if git -C "$1" apply --reverse --check "$report_patch" 2>/dev/null; then return; fi
  if ! git -C "$1" apply --reverse --check "$history_patch" 2>/dev/null; then
    git -C "$1" apply --check "$history_patch"
    git -C "$1" apply "$history_patch"
  fi
  git -C "$1" apply --check "$report_patch"
  git -C "$1" apply "$report_patch"
}

if [ -d "$destination/.git" ]; then
  if git -C "$destination" merge-base --is-ancestor "$upstream_commit" HEAD 2>/dev/null; then
    apply_history_patch "$destination"
    echo "CodexBar workspace already present"
    exit 0
  fi
  echo "existing CodexBar workspace does not descend from the pinned upstream commit" >&2
  exit 1
fi

if [ -e "$destination" ]; then
  echo "CodexBar destination exists but is not a Git repository: $destination" >&2
  exit 1
fi
if [ ! -f "$patch_file" ]; then
  echo "missing CodexBar integration patch: $patch_file" >&2
  exit 1
fi

temporary="$project_root/.codexbar-bootstrap-$$"
cleanup() {
  if [ -d "$temporary" ]; then
    find "$temporary" -depth -delete
  fi
}
trap cleanup EXIT HUP INT TERM

git clone --depth 1 --branch "$upstream_tag" "$upstream_url" "$temporary"
actual_commit=$(git -C "$temporary" rev-parse HEAD)
if [ "$actual_commit" != "$upstream_commit" ]; then
  echo "CodexBar tag moved: expected $upstream_commit, got $actual_commit" >&2
  exit 1
fi

GIT_COMMITTER_NAME="Yusong-Enceladus" \
GIT_COMMITTER_EMAIL="175666848+Yusong-Enceladus@users.noreply.github.com" \
  git -C "$temporary" am "$patch_file"
apply_history_patch "$temporary"
mv "$temporary" "$destination"
trap - EXIT HUP INT TERM
echo "CodexBar workspace created at $destination"
