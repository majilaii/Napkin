#!/usr/bin/env bash
set -euo pipefail

# A commit that first introduces one of the database bootstrap/recovery objects
# below is forward-only. Once any migration has been deployed, reverting the
# whole SHA would desynchronise migration history; reverting the completeness
# workflow would also remove its operational safety net. Subsequent edits are
# ordinary releases. --no-renames is load-bearing for the TICKET-196 timestamp
# correction: its destination must count as newly introduced even though Git
# can otherwise report the old/new migration paths as a rename.
base_ref="${1:-HEAD~1}"
head_ref="${2:-HEAD}"

git rev-parse --verify "${base_ref}^{commit}" >/dev/null
git rev-parse --verify "${head_ref}^{commit}" >/dev/null

readonly -a forward_only_paths=(
  'supabase/migrations/20260716120000_restaurant_completeness.sql'
  '.github/workflows/restaurant-completeness-cron.yml'
  'supabase/migrations/20260716121000_image_moderation_control_plane.sql'
  'supabase/migrations/20260716122000_image_moderation_workers.sql'
  'supabase/migrations/20260716123000_image_moderation_writers.sql'
)

while IFS=$'\t' read -r status path; do
  [[ "$status" == 'A' ]] || continue
  for forward_only_path in "${forward_only_paths[@]}"; do
    if [[ "$path" == "$forward_only_path" ]]; then
      printf '%s\n' true
      exit 0
    fi
  done
done < <(
  git diff --name-status --no-renames --diff-filter=A \
    "$base_ref" "$head_ref" -- "${forward_only_paths[@]}"
)

printf '%s\n' false
