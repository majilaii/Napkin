#!/usr/bin/env bash
# Isolated SQL integration verification when Docker/Supabase local is unavailable.
# Requires PostgreSQL 17 binaries and Python 3. No network or production DB access.
# Real RPC definitions are imported from their effective repository migrations;
# only their dependency table schema is reduced. CI still owns full replay.
set -euo pipefail
cd "$(dirname "$0")/.."
VISIT_PG_BIN="${VISIT_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
if [[ ! -x "$VISIT_PG_BIN/initdb" ]]; then
  VISIT_PG_BIN="$(pg_config --bindir)"
fi
VISIT_TMP="$(mktemp -d "${TMPDIR:-/tmp}/napkin-visit-sql.XXXXXX")"
cleanup() {
  "$VISIT_PG_BIN/pg_ctl" -D "$VISIT_TMP/db" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$VISIT_TMP"
}
trap cleanup EXIT INT TERM
"$VISIT_PG_BIN/initdb" -D "$VISIT_TMP/db" -A trust -U postgres >/dev/null
# Unix socket only, random isolated directory. Never bind a production/network host.
"$VISIT_PG_BIN/pg_ctl" -D "$VISIT_TMP/db" -l "$VISIT_TMP/postgres.log" \
  -o "-F -k '$VISIT_TMP' -c listen_addresses=''" -w start >/dev/null
PSQL=("$VISIT_PG_BIN/psql" -X -h "$VISIT_TMP" -U postgres -d postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -q -f supabase/tests/visit_fixture_schema.sql
python3 - "$VISIT_TMP/dependencies.sql" <<'PY'
import pathlib, re, sys
migrations = pathlib.Path('supabase/migrations')
control = (migrations / '20260716121000_image_moderation_control_plane.sql').read_text()
writers = (migrations / '20260716123000_image_moderation_writers.sql').read_text()
def function(source, name):
    match = re.search(r'create or replace function public\.' + name + r'\s*\([^;]*?\bas\s+(\$\w*\$).*?\1;', source, re.I | re.S)
    if not match:
        raise RuntimeError('Missing real function definition: ' + name)
    return match.group()
out = []
for name in ['moderation_config', 'image_storage_origins', 'user_image_objects', 'image_object_refs', 'image_gc_queue']:
    match = re.search(r'CREATE TABLE public\.' + name + r' \(.*?\n\);', control, re.S)
    if not match:
        raise RuntimeError('Missing real dependency table: ' + name)
    out.append(match.group())
out.append("CREATE UNIQUE INDEX image_gc_queue_live_sink_idx ON public.image_gc_queue (sink_kind,sink_id) WHERE sink_kind IS NOT NULL AND sink_id IS NOT NULL AND state <> 'done';")
out.append("INSERT INTO public.moderation_config(key,enforce) VALUES ('image_moderation',true),('grandfather_sweep',false);")
out.append("INSERT INTO public.image_storage_origins(origin,environment) VALUES ('https://visit.test','local');")
out.append(function(control, 'fn_lock_image_lifecycle'))
for name in ['fn_lock_moderation_enforcement','fn_unbind_image_ref','fn_bind_image_ref',
             'append_entry_photo','fn_set_entry_hero','fn_delete_entry_photo','fn_delete_entry']:
    out.append(function(writers, name))
out.append(function((migrations / '20260826155643_ticket_217_restaurant_privacy_gates.sql').read_text(), 'fn_create_entry_with_tables'))
out.append(function((migrations / '20260716120000_restaurant_completeness.sql').read_text(), 'fn_resolve_canonical'))
for name in ['trg_entry_photos_gc','trg_entries_hero_gc','trg_entries_photo_owner_gc']:
    out.append(function(control, name))
out += [
    'CREATE TRIGGER entry_photos_after_delete_gc AFTER DELETE ON public.entry_photos FOR EACH ROW EXECUTE FUNCTION public.trg_entry_photos_gc();',
    'CREATE TRIGGER entries_before_delete_photo_owner_gc BEFORE DELETE ON public.entries FOR EACH ROW EXECUTE FUNCTION public.trg_entries_photo_owner_gc();',
    'CREATE TRIGGER entries_after_delete_hero_gc AFTER DELETE ON public.entries FOR EACH ROW EXECUTE FUNCTION public.trg_entries_hero_gc();',
]
pathlib.Path(sys.argv[1]).write_text('\n'.join(out))
PY
"${PSQL[@]}" -q -f "$VISIT_TMP/dependencies.sql"
"${PSQL[@]}" -q -f supabase/migrations/20260905210957_reviews_visit_actions.sql
"${PSQL[@]}" -q -f supabase/migrations/20260905210936_undated_visit_merge_guard.sql
# Then EVERY later migration that redefines a visit RPC, in filename (version)
# order. Without this the harness silently tested the definitions above while
# the spec asserted the behaviour of a newer migration, and the abort skipped
# supabase/tests/visits.concurrency.sh below -- the repo's only invocation of it.
# Bounded to migrations newer than the pair above: earlier ones (image
# moderation) are already reduced into dependencies.sql and must not be re-run.
while IFS= read -r visit_migration; do
  visit_version="$(basename "$visit_migration")"
  # Compare the bare version, not the filename: the full name sorts AFTER its own
  # timestamp prefix, which would re-apply the CREATE FUNCTION migration above.
  [[ "${visit_version%%_*}" > '20260905210957' ]] || continue
  "${PSQL[@]}" -q -f "$visit_migration"
done < <(grep -lE 'fn_record_visit|fn_visit_entry_result|fn_save_visit|fn_undo_visit' \
  supabase/migrations/*.sql | sort)
"${PSQL[@]}" -q -f supabase/tests/visits.spec.sql
if [[ -f supabase/tests/undated_visit_merge.spec.sql ]]; then
  "${PSQL[@]}" -q -f supabase/tests/undated_visit_merge.spec.sql
fi
for fixture in "$@"; do "${PSQL[@]}" -q -f "$fixture"; done
PATH="$VISIT_PG_BIN:$PATH" bash supabase/tests/visits.concurrency.sh "$VISIT_TMP"
echo 'Visit SQL integration passed (isolated native PostgreSQL; actual writer definitions).'
