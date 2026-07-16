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

rename_file() {
  local old_path="$1"
  local new_path="$2"
  mkdir -p "$fixture/$(dirname "$new_path")"
  git -C "$fixture" mv "$old_path" "$new_path"
  git -C "$fixture" commit -qm "fixture: rename $old_path to $new_path"
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

for version_pair in \
  '20260716100000:20260716121000:control_plane' \
  '20260716101000:20260716122000:workers' \
  '20260716102000:20260716123000:writers'
do
  IFS=: read -r old_version new_version suffix <<<"$version_pair"
  old_path="supabase/migrations/${old_version}_image_moderation_${suffix}.sql"
  new_path="supabase/migrations/${new_version}_image_moderation_${suffix}.sql"

  commit_file "$old_path" initial
  assert_classification false "legacy $suffix migration addition"

  rename_file "$old_path" "$new_path"
  assert_classification true "$suffix migration timestamp correction"

  commit_file "$new_path" modified
  assert_classification false "$suffix migration modification"
done

printf '%s\n' 'forward-only release classifier: ok'
