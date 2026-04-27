#!/usr/bin/env bash
# Fails if any migration files share a timestamp prefix.
#
# Why: `supabase db push` records ONE row per version in `schema_migrations`,
# so when two files share the same `YYYYMMDDHHMMSS_` prefix, the second one
# is silently dropped on push — no error, no log, just missing schema in prod.
# We've hit this in TICKET-002 (rate_round + maybe_reveal_round) and TICKET-001
# (entries_add_client_nonce). This guard makes that class of bug impossible.
#
# Usage:
#   bash scripts/check-migration-timestamps.sh                    # default dir
#   bash scripts/check-migration-timestamps.sh path/to/migrations
#
# Portable across macOS bash 3.2 and Linux bash 5+.
set -euo pipefail

MIGRATIONS_DIR="${1:-supabase/migrations}"

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
    echo "✓ no migrations dir at $MIGRATIONS_DIR — skipping check"
    exit 0
fi

# Extract YYYYMMDDHHMMSS prefix from each .sql filename, sorted.
all_prefixes=$(
    find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' -type f -print0 \
        | xargs -0 -n1 basename 2>/dev/null \
        | sed -nE 's/^([0-9]{14})_.*\.sql$/\1/p' \
        | sort
)

count=$(printf '%s\n' "$all_prefixes" | sed '/^$/d' | wc -l | tr -d ' ')

if [[ "$count" -eq 0 ]]; then
    echo "✓ no timestamped migration files in $MIGRATIONS_DIR"
    exit 0
fi

duplicates=$(printf '%s\n' "$all_prefixes" | sed '/^$/d' | uniq -d)

if [[ -n "$duplicates" ]]; then
    echo "✗ duplicate migration timestamp(s) — supabase db push will silently drop these:" >&2
    while IFS= read -r ts; do
        [[ -z "$ts" ]] && continue
        echo "" >&2
        echo "  timestamp $ts:" >&2
        find "$MIGRATIONS_DIR" -maxdepth 1 -name "${ts}_*.sql" -type f \
            | sed 's|^|    |' >&2
    done <<< "$duplicates"
    echo "" >&2
    echo "fix: rename one of each pair to a unique YYYYMMDDHHMMSS prefix." >&2
    echo "see prior incidents: TICKET-001 client_nonce, TICKET-002 round RPCs." >&2
    exit 1
fi

echo "✓ migration timestamps are unique ($count files)"
