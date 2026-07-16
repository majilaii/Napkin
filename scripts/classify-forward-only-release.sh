#!/usr/bin/env bash
set -euo pipefail

# A commit that first introduces either half of the TICKET-195 bootstrap is
# forward-only. Once either object has been deployed, reverting the whole SHA
# would try to remove an already-applied migration and/or the worker's safety
# workflow. Subsequent edits are ordinary releases; only an added file marks
# the one-time bootstrap boundary.
base_ref="${1:-HEAD~1}"
head_ref="${2:-HEAD}"

git rev-parse --verify "${base_ref}^{commit}" >/dev/null
git rev-parse --verify "${head_ref}^{commit}" >/dev/null

readonly completeness_migration='supabase/migrations/20260716120000_restaurant_completeness.sql'
readonly completeness_workflow='.github/workflows/restaurant-completeness-cron.yml'

while IFS=$'\t' read -r status path; do
  if [[ "$status" == 'A' ]] &&
     [[ "$path" == "$completeness_migration" || "$path" == "$completeness_workflow" ]]; then
    printf '%s\n' true
    exit 0
  fi
done < <(
  git diff --name-status --diff-filter=A "$base_ref" "$head_ref" -- \
    "$completeness_migration" \
    "$completeness_workflow"
)

printf '%s\n' false
