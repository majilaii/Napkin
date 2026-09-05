#!/usr/bin/env bash
# Accepts only a local Unix-socket fixture directory, never a network URL.
set -euo pipefail
VISIT_SOCKET="${1:?local PostgreSQL Unix socket directory required}"
[[ -d "$VISIT_SOCKET" && -S "$VISIT_SOCKET/.s.PGSQL.5432" ]] || exit 2
PSQL=(psql -X -h "$VISIT_SOCKET" -U postgres -d postgres -v ON_ERROR_STOP=1)
VISIT_RACE_TMP="$(mktemp -d "${TMPDIR:-/tmp}/napkin-visit-races.XXXXXX")"
trap 'rm -rf "$VISIT_RACE_TMP"' EXIT
query() { "${PSQL[@]}" -Atq -c "$1"; }
wait_query() {
  for _ in $(seq 1 100); do
    if [[ "$(query "$1")" == t ]]; then return; fi
    sleep 0.05
  done
  echo 'Timed out awaiting visit transaction barrier' >&2
  exit 1
}
query "
INSERT INTO auth.users(id) VALUES('95110000-0000-4000-8000-000000000001');
INSERT INTO public.profiles(user_id,display_name) VALUES('95110000-0000-4000-8000-000000000001','Visit race') ON CONFLICT DO NOTHING;
INSERT INTO public.restaurants(id,name) VALUES('95210000-0000-4000-8000-000000000001','Visit race');
INSERT INTO public.tables(id,owner_id,name) VALUES('95310000-0000-4000-8000-000000000001','95110000-0000-4000-8000-000000000001','Visit race table');
" >/dev/null
VISIT_USER=95110000-0000-4000-8000-000000000001
VISIT_RESTAURANT=95210000-0000-4000-8000-000000000001
start_barrier() {
  "${PSQL[@]}" -q -c "SET application_name='visit-race-barrier'; SELECT pg_advisory_lock(95110001); SELECT pg_sleep(20)" >"$VISIT_RACE_TMP/barrier.out" 2>&1 &
  VISIT_BARRIER_PID=$!
  wait_query "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='visit-race-barrier' AND wait_event='PgSleep')"
}
release_barrier() {
  query "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='visit-race-barrier'" >/dev/null
  wait "$VISIT_BARRIER_PID" || true
}

# Both requests overlap while the first holds the actual lifecycle lock.
start_barrier
"${PSQL[@]}" -Atq -c "SET application_name='visit-race-first'; BEGIN;
SELECT public.fn_record_visit('$VISIT_USER','$VISIT_RESTAURANT','95410000-0000-4000-8000-000000000001')->>'id';
SELECT pg_advisory_xact_lock(95110001); COMMIT" >"$VISIT_RACE_TMP/first.out" 2>&1 &
VISIT_FIRST_PID=$!
wait_query "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='visit-race-first' AND wait_event_type='Lock')"
"${PSQL[@]}" -Atq -c "SET application_name='visit-race-second'; SELECT public.fn_record_visit('$VISIT_USER','$VISIT_RESTAURANT','95410000-0000-4000-8000-000000000001')->>'was_dedup'" >"$VISIT_RACE_TMP/second.out" 2>&1 &
VISIT_SECOND_PID=$!
wait_query "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='visit-race-second' AND wait_event_type='Lock')"
release_barrier
wait "$VISIT_FIRST_PID"
wait "$VISIT_SECOND_PID"
[[ "$(query "SELECT count(*) FROM public.entries WHERE user_id='$VISIT_USER'")" == 1 ]]
[[ "$(cat "$VISIT_RACE_TMP/second.out")" == true ]]
echo 'PASS visits concurrency: overlapping same-nonce requests produce exactly one row and a dedup response'

for scenario in scalar share; do
  VISIT_ENTRY="$(query "SELECT public.fn_record_visit('$VISIT_USER','$VISIT_RESTAURANT',gen_random_uuid())->>'id'")"
  if [[ "$scenario" == scalar ]]; then
    VISIT_CHANGE="UPDATE public.entries SET rating=4 WHERE id='$VISIT_ENTRY';"
  else
    VISIT_CHANGE="INSERT INTO public.entry_tables(entry_id,table_id) VALUES('$VISIT_ENTRY','95310000-0000-4000-8000-000000000001');"
  fi
  start_barrier
  "${PSQL[@]}" -q -c "SET application_name='visit-race-enrich'; BEGIN; $VISIT_CHANGE SELECT pg_advisory_xact_lock(95110001); COMMIT" >"$VISIT_RACE_TMP/enrich.out" 2>&1 &
  VISIT_FIRST_PID=$!
  wait_query "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='visit-race-enrich' AND wait_event_type='Lock')"
  "${PSQL[@]}" -q -c "SET application_name='visit-race-undo'; SELECT public.fn_undo_visit('$VISIT_USER','$VISIT_ENTRY')" >"$VISIT_RACE_TMP/undo.out" 2>&1 &
  VISIT_SECOND_PID=$!
  wait_query "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name='visit-race-undo' AND wait_event_type='Lock')"
  release_barrier
  wait "$VISIT_FIRST_PID"
  if wait "$VISIT_SECOND_PID"; then echo "Unsafe undo won after $scenario enrichment" >&2; exit 1; fi
  rg -q 'VISIT_UNDO_REFUSED' "$VISIT_RACE_TMP/undo.out"
  [[ "$(query "SELECT count(*) FROM public.entries WHERE id='$VISIT_ENTRY'")" == 1 ]]
  echo "PASS visits concurrency: undo waits for concurrent $scenario enrichment and refuses deletion"
done
