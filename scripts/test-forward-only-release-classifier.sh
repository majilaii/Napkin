#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
classifier="$repo_root/scripts/classify-forward-only-release.sh"
fixture=$(mktemp -d "${TMPDIR:-/tmp}/forward-only-release.XXXXXX")
trap 'rm -rf "$fixture"' EXIT

git -C "$fixture" init -q
git -C "$fixture" config user.name 'classifier-test'
git -C "$fixture" config user.email 'classifier-test@example.invalid'

commit_file() {
  local path="$1"
  local content="$2"
  mkdir -p "$fixture/$(dirname "$path")"
  printf '%s\n' "$content" > "$fixture/$path"
  git -C "$fixture" add "$path"
  git -C "$fixture" commit -qm "fixture: $path"
}

assert_classification() {
  local expected="$1"
  local label="$2"
  local actual
  actual=$(cd "$fixture" && bash "$classifier" HEAD~1 HEAD)
  if [[ "$actual" != "$expected" ]]; then
    printf 'classifier test failed: %s (expected %s, got %s)\n' \
      "$label" "$expected" "$actual" >&2
    exit 1
  fi
}

commit_file README.md baseline
commit_file ordinary.txt ordinary
assert_classification false 'ordinary commit'

commit_file supabase/migrations/20260716120000_restaurant_completeness.sql initial
assert_classification true 'migration addition'

commit_file supabase/migrations/20260716120000_restaurant_completeness.sql modified
assert_classification false 'migration modification'

commit_file .github/workflows/restaurant-completeness-cron.yml initial
assert_classification true 'workflow addition'

commit_file .github/workflows/restaurant-completeness-cron.yml modified
assert_classification false 'workflow modification'

printf '%s\n' 'forward-only release classifier: ok'
