#!/usr/bin/env bash
set -euo pipefail

DB_URL="${1:?usage: $0 postgresql://...}"
PSQL=(psql "$DB_URL" -X -v ON_ERROR_STOP=1)
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ticket-196-concurrency.XXXXXX")"

FLAG_USER="19620000-0000-4000-8000-000000000001"
COMPUTE_USER="19620000-0000-4000-8000-000000000002"
COMPUTE_PROJECT_A="19620000-0000-4000-8000-000000000003"
COMPUTE_PROJECT_B="19620000-0000-4000-8000-000000000004"
SCAN_USER="19620000-0000-4000-8000-000000000005"
SCAN_PROJECT_A="19620000-0000-4000-8000-000000000006"
SCAN_PROJECT_B="19620000-0000-4000-8000-000000000007"
STAGE_USER="19620000-0000-4000-8000-000000000008"
GC_USER="19620000-0000-4000-8000-000000000009"
PROJECT_ID="00000000-0000-0000-0000-000000000000"

log() { echo "[image-moderation-concurrency] $*"; }
fail() { echo "[image-moderation-concurrency] FAIL: $*" >&2; exit 1; }

db_exec() { "${PSQL[@]}" -q -c "$1"; }
db_query() { "${PSQL[@]}" -Atq -c "$1"; }

assert_query() {
  local expected="$1"
  local query="$2"
  local label="$3"
  local actual
  actual="$(db_query "$query")"
  [[ "$actual" == "$expected" ]] || fail "$label (expected $expected, got $actual)"
}

wait_for_count() {
  local query="$1"
  local minimum="$2"
  local label="$3"
  local actual
  for _ in $(seq 1 150); do
    actual="$(db_query "$query")"
    if [[ "$actual" =~ ^[0-9]+$ ]] && (( actual >= minimum )); then
      return 0
    fi
    sleep 0.1
  done
  fail "timed out waiting for $label"
}

start_barrier() {
  local key="$1"
  local app="$2"
  "${PSQL[@]}" -q -c \
    "SET application_name TO '$app'; SELECT pg_advisory_lock($key); SELECT pg_sleep(45);" \
    >"$TMP_DIR/$app.out" 2>"$TMP_DIR/$app.err" &
  BARRIER_PID=$!
  wait_for_count \
    "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='$app' AND wait_event='PgSleep'" \
    1 "$app barrier"
}

release_barrier() {
  local app="$1"
  local pid="$2"
  assert_query "t" \
    "SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE application_name='$app'" \
    "release $app barrier"
  set +e
  wait "$pid"
  set -e
}

start_worker() {
  local label="$1"
  local key="$2"
  local statement="$3"
  "${PSQL[@]}" -q -c \
    "SET application_name TO '$label'; BEGIN; SELECT pg_advisory_xact_lock_shared($key); $statement; COMMIT;" \
    >"$TMP_DIR/$label.out" 2>"$TMP_DIR/$label.err" &
  LAST_PID=$!
}

start_plain_worker() {
  local label="$1"
  local statement="$2"
  "${PSQL[@]}" -q -c "SET application_name TO '$label'; $statement" \
    >"$TMP_DIR/$label.out" 2>"$TMP_DIR/$label.err" &
  LAST_PID=$!
}

wait_two_one_success() {
  local first_pid="$1"
  local second_pid="$2"
  local label="$3"
  local first_rc second_rc successes=0
  set +e
  wait "$first_pid"; first_rc=$?
  wait "$second_pid"; second_rc=$?
  set -e
  (( first_rc == 0 )) && successes=$((successes + 1))
  (( second_rc == 0 )) && successes=$((successes + 1))
  if (( successes != 1 )); then
    find "$TMP_DIR" -name "$label*.err" -maxdepth 1 -print -exec sed -n '1,80p' {} \; >&2 || true
    fail "$label expected exactly one successful concurrent transaction (rcs $first_rc/$second_rc)"
  fi
}

cleanup_db() {
  set +e
  "${PSQL[@]}" -q -c "
    DROP TRIGGER IF EXISTS ticket196_pause_bind ON public.image_object_refs;
    DROP TRIGGER IF EXISTS ticket196_pause_unlink ON public.image_object_refs;
    DROP TRIGGER IF EXISTS ticket196_pause_gc ON public.user_image_objects;
    DROP FUNCTION IF EXISTS public.ticket196_pause_bind();
    DROP FUNCTION IF EXISTS public.ticket196_pause_unlink();
    DROP FUNCTION IF EXISTS public.ticket196_pause_gc();
    DELETE FROM public.image_object_refs WHERE sink_id LIKE 'ticket196:%';
    DELETE FROM public.image_gc_queue
      WHERE sink_id LIKE 'ticket196:%'
         OR object_id::text LIKE '1962%'
         OR user_id = '$GC_USER'
         OR reason = 'ticket196_concurrency';
    DELETE FROM public.image_moderation_notifications WHERE user_id = '$GC_USER';
    DELETE FROM public.user_image_objects WHERE user_id = '$GC_USER';
    DELETE FROM public.staging_reservations WHERE user_id = '$STAGE_USER';
    DELETE FROM public.image_stage_budget WHERE user_id = '$STAGE_USER';
    DELETE FROM public.image_compute_budget
      WHERE subject_id IN ('$COMPUTE_USER','$COMPUTE_PROJECT_A','$COMPUTE_PROJECT_B','$PROJECT_ID');
    DELETE FROM public.image_scan_budget
      WHERE subject_id IN ('$SCAN_USER','$SCAN_PROJECT_A','$SCAN_PROJECT_B','$PROJECT_ID');
    DELETE FROM public.image_moderation_ledger
      WHERE user_id IN ('$SCAN_USER','$SCAN_PROJECT_A','$SCAN_PROJECT_B');
    DELETE FROM public.image_scan_leases WHERE sha256 IN (repeat('7',64), repeat('8',64));
    DELETE FROM public.job_runs WHERE job_name = 'alarm_selftest';
    DELETE FROM public.job_leases WHERE job_name = 'alarm_selftest';
    UPDATE public.moderation_config SET enforce=false WHERE key='image_moderation';
    UPDATE public.moderation_config SET enforce=false WHERE key='grandfather_sweep';
    DELETE FROM public.profiles WHERE user_id IN ('$FLAG_USER','$GC_USER');
    DELETE FROM auth.users WHERE id IN ('$FLAG_USER','$GC_USER');
  " >/dev/null 2>&1
  rm -rf "$TMP_DIR"
}
trap cleanup_db EXIT

log "installing isolated fixtures"
db_exec "
  INSERT INTO auth.users (
    instance_id,id,aud,role,email,created_at,updated_at,raw_app_meta_data,raw_user_meta_data
  ) VALUES (
    '$PROJECT_ID','$FLAG_USER','authenticated','authenticated',
    'ticket196-concurrency@invalid.test',now(),now(),'{}','{}'
  ),(
    '$PROJECT_ID','$GC_USER','authenticated','authenticated',
    'ticket196-concurrency-gc@invalid.test',now(),now(),'{}','{}'
  ) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (user_id,display_name,account_privacy)
  VALUES
    ('$FLAG_USER','Concurrency Oracle','private'),
    ('$GC_USER','GC Concurrency Oracle','private')
  ON CONFLICT (user_id) DO UPDATE SET avatar_url=NULL;
  UPDATE public.moderation_config SET enforce=false WHERE key='image_moderation';

  CREATE OR REPLACE FUNCTION public.ticket196_pause_bind()
  RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS \$fn\$
  BEGIN
    IF pg_catalog.current_setting('application_name') = 'ticket196-bind-winner' THEN
      PERFORM pg_catalog.pg_advisory_xact_lock_shared(196211);
    END IF;
    RETURN NEW;
  END;
  \$fn\$;
  CREATE OR REPLACE FUNCTION public.ticket196_pause_gc()
  RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS \$fn\$
  BEGIN
    IF pg_catalog.current_setting('application_name') = 'ticket196-gc-winner'
       AND OLD.state = 'approved' AND NEW.state = 'gc_pending' THEN
      PERFORM pg_catalog.pg_advisory_xact_lock_shared(196212);
    END IF;
    RETURN NEW;
  END;
  \$fn\$;
  CREATE OR REPLACE FUNCTION public.ticket196_pause_unlink()
  RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS \$fn\$
  BEGIN
    IF pg_catalog.current_setting('application_name') = 'ticket196-unlink-winner' THEN
      PERFORM pg_catalog.pg_advisory_xact_lock_shared(196213);
    END IF;
    RETURN OLD;
  END;
  \$fn\$;
  CREATE TRIGGER ticket196_pause_bind BEFORE INSERT ON public.image_object_refs
    FOR EACH ROW EXECUTE FUNCTION public.ticket196_pause_bind();
  CREATE TRIGGER ticket196_pause_unlink BEFORE DELETE ON public.image_object_refs
    FOR EACH ROW EXECUTE FUNCTION public.ticket196_pause_unlink();
  CREATE TRIGGER ticket196_pause_gc BEFORE UPDATE ON public.user_image_objects
    FOR EACH ROW EXECUTE FUNCTION public.ticket196_pause_gc();
"

log "FLAG_INTERLEAVING_ORACLE: OFF writer commits before blocked ON flip; no raw commit follows"
start_plain_worker ticket196-flag-blocker \
  "BEGIN; SELECT public.fn_lock_image_lifecycle('$FLAG_USER'); SELECT pg_sleep(45); COMMIT;"
flag_blocker_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-flag-blocker' AND wait_event='PgSleep'" \
  1 "flag lifecycle blocker"
raw_url="https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/$FLAG_USER/legacy.jpg"
start_plain_worker ticket196-flag-writer \
  "SELECT public.fn_commit_avatar('$FLAG_USER','$raw_url');"
flag_writer_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-flag-writer' AND wait_event_type='Lock' AND wait_event='advisory'" \
  1 "OFF writer after shared flag read"
start_plain_worker ticket196-flag-flip "SELECT public.fn_set_enforcement(true);"
flag_flip_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-flag-flip' AND wait_event_type='Lock'" \
  1 "ON flip blocked behind OFF writer"
assert_query "t" \
  "SELECT pg_catalog.pg_terminate_backend(pid) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-flag-blocker'" \
  "release flag lifecycle blocker"
set +e
wait "$flag_blocker_pid"
set -e
wait "$flag_writer_pid"
wait "$flag_flip_pid"
assert_query "t" "SELECT enforce FROM public.moderation_config WHERE key='image_moderation'" "flag committed ON"
assert_query "$raw_url" "SELECT avatar_url FROM public.profiles WHERE user_id='$FLAG_USER'" "OFF writer committed before flip"
if db_exec "SELECT public.fn_commit_avatar('$FLAG_USER','$raw_url');" >/dev/null 2>&1; then
  fail "raw avatar committed after ON"
fi
db_exec "UPDATE public.moderation_config SET enforce=false WHERE key='image_moderation';"

log "COMPUTE_BUCKET_LIMITS: concurrent user and project boundaries"
db_exec "
  DELETE FROM public.image_compute_budget WHERE subject_id IN (
    '$COMPUTE_USER','$COMPUTE_PROJECT_A','$COMPUTE_PROJECT_B','$PROJECT_ID'
  );
  INSERT INTO public.image_compute_budget(scope,subject_id,window_started_at,used) VALUES
    ('user','$COMPUTE_USER',now(),29),('project','$PROJECT_ID',now(),0);
"
start_barrier 196221 ticket196-compute-user-barrier
start_worker ticket196-compute-user-a 196221 "SELECT public.fn_debit_image_compute('$COMPUTE_USER');"
compute_user_a=$LAST_PID
start_worker ticket196-compute-user-b 196221 "SELECT public.fn_debit_image_compute('$COMPUTE_USER');"
compute_user_b=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name IN ('ticket196-compute-user-a','ticket196-compute-user-b') AND wait_event='advisory'" \
  2 "parallel compute user calls"
release_barrier ticket196-compute-user-barrier "$BARRIER_PID"
wait_two_one_success "$compute_user_a" "$compute_user_b" ticket196-compute-user
assert_query "30" "SELECT used FROM public.image_compute_budget WHERE scope='user' AND subject_id='$COMPUTE_USER'" "compute user cap"
assert_query "1" "SELECT used FROM public.image_compute_budget WHERE scope='project' AND subject_id='$PROJECT_ID'" "compute project debit after user race"

db_exec "
  DELETE FROM public.image_compute_budget WHERE subject_id IN (
    '$COMPUTE_PROJECT_A','$COMPUTE_PROJECT_B','$PROJECT_ID'
  );
  INSERT INTO public.image_compute_budget(scope,subject_id,window_started_at,used) VALUES
    ('user','$COMPUTE_PROJECT_A',now(),0),('user','$COMPUTE_PROJECT_B',now(),0),
    ('project','$PROJECT_ID',now(),1999);
"
start_barrier 196222 ticket196-compute-project-barrier
start_worker ticket196-compute-project-a 196222 "SELECT public.fn_debit_image_compute('$COMPUTE_PROJECT_A');"
compute_project_a=$LAST_PID
start_worker ticket196-compute-project-b 196222 "SELECT public.fn_debit_image_compute('$COMPUTE_PROJECT_B');"
compute_project_b=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name IN ('ticket196-compute-project-a','ticket196-compute-project-b') AND wait_event='advisory'" \
  2 "parallel compute project calls"
release_barrier ticket196-compute-project-barrier "$BARRIER_PID"
wait_two_one_success "$compute_project_a" "$compute_project_b" ticket196-compute-project
assert_query "2000" "SELECT used FROM public.image_compute_budget WHERE scope='project' AND subject_id='$PROJECT_ID'" "compute project cap"
assert_query "1" "SELECT sum(used) FROM public.image_compute_budget WHERE scope='user' AND subject_id IN ('$COMPUTE_PROJECT_A','$COMPUTE_PROJECT_B')" "failed project debit rolled back user debit"
db_exec "
  UPDATE public.image_compute_budget SET used=30,window_started_at=now()-interval '3601 seconds'
    WHERE scope='user' AND subject_id='$COMPUTE_USER';
  UPDATE public.image_compute_budget SET used=2000,window_started_at=now()-interval '3601 seconds'
    WHERE scope='project' AND subject_id='$PROJECT_ID';
  SELECT public.fn_debit_image_compute('$COMPUTE_USER');
"
assert_query "1|1" \
  "SELECT u.used||'|'||p.used FROM public.image_compute_budget u JOIN public.image_compute_budget p ON p.scope='project' AND p.subject_id='$PROJECT_ID' WHERE u.scope='user' AND u.subject_id='$COMPUTE_USER'" \
  "compute fixed-window reset"

log "paid scan caps: concurrent user, general-pool, and reserved-canary boundaries"
db_exec "
  DELETE FROM public.image_scan_budget WHERE subject_id IN (
    '$SCAN_USER','$SCAN_PROJECT_A','$SCAN_PROJECT_B','$PROJECT_ID'
  );
  DELETE FROM public.image_moderation_ledger WHERE user_id IN (
    '$SCAN_USER','$SCAN_PROJECT_A','$SCAN_PROJECT_B'
  );
  INSERT INTO public.image_scan_budget(scope,subject_id,utc_day,used) VALUES
    ('user','$SCAN_USER',(now() AT TIME ZONE 'UTC')::date,19),
    ('general','$PROJECT_ID',(now() AT TIME ZONE 'UTC')::date,0);
"
start_barrier 196231 ticket196-scan-user-barrier
start_worker ticket196-scan-user-a 196231 "SELECT public.fn_debit_scan_budget('$SCAN_USER','general');"
scan_user_a=$LAST_PID
start_worker ticket196-scan-user-b 196231 "SELECT public.fn_debit_scan_budget('$SCAN_USER','general');"
scan_user_b=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name IN ('ticket196-scan-user-a','ticket196-scan-user-b') AND wait_event='advisory'" \
  2 "parallel scan user calls"
release_barrier ticket196-scan-user-barrier "$BARRIER_PID"
wait_two_one_success "$scan_user_a" "$scan_user_b" ticket196-scan-user
assert_query "20|1|1" \
  "SELECT u.used||'|'||g.used||'|'||(SELECT count(*) FROM public.image_moderation_ledger WHERE user_id='$SCAN_USER') FROM public.image_scan_budget u JOIN public.image_scan_budget g ON g.scope='general' AND g.subject_id='$PROJECT_ID' AND g.utc_day=u.utc_day WHERE u.scope='user' AND u.subject_id='$SCAN_USER'" \
  "scan user atomic cap and ledger"

db_exec "
  DELETE FROM public.image_scan_budget WHERE subject_id IN ('$SCAN_PROJECT_A','$SCAN_PROJECT_B','$PROJECT_ID');
  DELETE FROM public.image_moderation_ledger WHERE user_id IN ('$SCAN_PROJECT_A','$SCAN_PROJECT_B');
  INSERT INTO public.image_scan_budget(scope,subject_id,utc_day,used) VALUES
    ('user','$SCAN_PROJECT_A',(now() AT TIME ZONE 'UTC')::date,0),
    ('user','$SCAN_PROJECT_B',(now() AT TIME ZONE 'UTC')::date,0),
    ('general','$PROJECT_ID',(now() AT TIME ZONE 'UTC')::date,394);
"
start_barrier 196232 ticket196-scan-project-barrier
start_worker ticket196-scan-project-a 196232 "SELECT public.fn_debit_scan_budget('$SCAN_PROJECT_A','general');"
scan_project_a=$LAST_PID
start_worker ticket196-scan-project-b 196232 "SELECT public.fn_debit_scan_budget('$SCAN_PROJECT_B','general');"
scan_project_b=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name IN ('ticket196-scan-project-a','ticket196-scan-project-b') AND wait_event='advisory'" \
  2 "parallel scan project calls"
release_barrier ticket196-scan-project-barrier "$BARRIER_PID"
wait_two_one_success "$scan_project_a" "$scan_project_b" ticket196-scan-project
assert_query "395|1|1" \
  "SELECT g.used||'|'||(SELECT sum(used) FROM public.image_scan_budget WHERE scope='user' AND subject_id IN ('$SCAN_PROJECT_A','$SCAN_PROJECT_B'))||'|'||(SELECT count(*) FROM public.image_moderation_ledger WHERE user_id IN ('$SCAN_PROJECT_A','$SCAN_PROJECT_B')) FROM public.image_scan_budget g WHERE g.scope='general' AND g.subject_id='$PROJECT_ID'" \
  "scan project atomic cap and rollback"

db_exec "
  DELETE FROM public.image_scan_budget WHERE scope='canary' AND subject_id='$PROJECT_ID';
  DELETE FROM public.image_moderation_ledger WHERE budget_scope='canary' AND user_id IN ('$SCAN_PROJECT_A','$SCAN_PROJECT_B');
  INSERT INTO public.image_scan_budget(scope,subject_id,utc_day,used)
  VALUES ('canary','$PROJECT_ID',(now() AT TIME ZONE 'UTC')::date,4);
"
start_barrier 196233 ticket196-scan-canary-barrier
start_worker ticket196-scan-canary-a 196233 "SELECT public.fn_debit_scan_budget('$SCAN_PROJECT_A','canary');"
scan_canary_a=$LAST_PID
start_worker ticket196-scan-canary-b 196233 "SELECT public.fn_debit_scan_budget('$SCAN_PROJECT_B','canary');"
scan_canary_b=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name IN ('ticket196-scan-canary-a','ticket196-scan-canary-b') AND wait_event='advisory'" \
  2 "parallel canary pool calls"
release_barrier ticket196-scan-canary-barrier "$BARRIER_PID"
wait_two_one_success "$scan_canary_a" "$scan_canary_b" ticket196-scan-canary
assert_query "5|1" \
  "SELECT used||'|'||(SELECT count(*) FROM public.image_moderation_ledger WHERE budget_scope='canary' AND user_id IN ('$SCAN_PROJECT_A','$SCAN_PROJECT_B')) FROM public.image_scan_budget WHERE scope='canary' AND subject_id='$PROJECT_ID'" \
  "reserved canary pool atomic cap"

log "simultaneous 50-live staging quota"
db_exec "
  DELETE FROM public.staging_reservations WHERE user_id='$STAGE_USER';
  DELETE FROM public.image_stage_budget WHERE user_id='$STAGE_USER';
  WITH ids AS (
    SELECT extensions.gen_random_uuid() AS id FROM pg_catalog.generate_series(1,49)
  )
  INSERT INTO public.staging_reservations(id,user_id,staging_path,state,generation,lease_expires)
  SELECT id,'$STAGE_USER','$STAGE_USER/'||id,'staged',1,now()+interval '1 hour' FROM ids;
  INSERT INTO public.image_stage_budget(user_id,window_started_at,used)
  VALUES ('$STAGE_USER',now(),0);
"
start_barrier 196241 ticket196-stage-quota-barrier
start_worker ticket196-stage-quota-a 196241 "SELECT public.fn_begin_stage('$STAGE_USER');"
stage_quota_a=$LAST_PID
start_worker ticket196-stage-quota-b 196241 "SELECT public.fn_begin_stage('$STAGE_USER');"
stage_quota_b=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name IN ('ticket196-stage-quota-a','ticket196-stage-quota-b') AND wait_event='advisory'" \
  2 "parallel stage quota calls"
release_barrier ticket196-stage-quota-barrier "$BARRIER_PID"
wait_two_one_success "$stage_quota_a" "$stage_quota_b" ticket196-stage-quota
assert_query "50|1" \
  "SELECT count(*)||'|'||(SELECT used FROM public.image_stage_budget WHERE user_id='$STAGE_USER') FROM public.staging_reservations WHERE user_id='$STAGE_USER' AND state IN ('writing','putting','staged')" \
  "staging live quota and rolled-back rate debit"

log "GC fencing: bind-winner, GC-winner, TTL race, and competing workers"
bind_object="1962a000-0000-4000-8000-000000000001"
bind_sha="$(printf '1%.0s' {1..64})"
bind_path="approved/$GC_USER/$bind_sha.jpg"
bind_url="https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/$bind_path"
db_exec "
  INSERT INTO public.user_image_objects(id,user_id,bucket,storage_path,public_url,sha256,state)
  VALUES ('$bind_object','$GC_USER','avatars','$bind_path','$bind_url','$bind_sha','approved');
"
start_barrier 196211 ticket196-bind-winner-barrier
start_plain_worker ticket196-bind-winner \
  "SELECT public.fn_bind_image_ref('$GC_USER','$bind_url','avatars','avatar','ticket196:bind-winner',false);"
bind_winner_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-bind-winner' AND wait_event='advisory'" \
  1 "binder paused while holding object row"
start_plain_worker ticket196-gc-after-bind \
  "SELECT public.fn_claim_image_object_gc('$bind_object','ticket196-gc-after-bind','ticket196_concurrency');"
gc_after_bind_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-gc-after-bind' AND wait_event_type='Lock'" \
  1 "GC blocked behind binder"
release_barrier ticket196-bind-winner-barrier "$BARRIER_PID"
wait "$bind_winner_pid"
wait "$gc_after_bind_pid"
assert_query "approved|1" \
  "SELECT state||'|'||(SELECT count(*) FROM public.image_object_refs WHERE object_id='$bind_object') FROM public.user_image_objects WHERE id='$bind_object'" \
  "bind winner kept bytes approved and GC refused"

gc_object="1962a000-0000-4000-8000-000000000002"
gc_sha="$(printf '2%.0s' {1..64})"
gc_path="approved/$GC_USER/$gc_sha.jpg"
gc_url="https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/$gc_path"
db_exec "
  INSERT INTO public.user_image_objects(id,user_id,bucket,storage_path,public_url,sha256,state)
  VALUES ('$gc_object','$GC_USER','avatars','$gc_path','$gc_url','$gc_sha','approved');
"
start_barrier 196212 ticket196-gc-winner-barrier
start_plain_worker ticket196-gc-winner \
  "SELECT public.fn_claim_image_object_gc('$gc_object','ticket196-gc-winner','ticket196_concurrency');"
gc_winner_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-gc-winner' AND wait_event='advisory'" \
  1 "GC paused while holding object row"
start_plain_worker ticket196-bind-after-gc \
  "SELECT public.fn_bind_image_ref('$GC_USER','$gc_url','avatars','avatar','ticket196:bind-after-gc',false);"
bind_after_gc_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-bind-after-gc' AND wait_event_type='Lock'" \
  1 "binder blocked behind GC"
release_barrier ticket196-gc-winner-barrier "$BARRIER_PID"
wait "$gc_winner_pid"
set +e
wait "$bind_after_gc_pid"; bind_after_gc_rc=$?
set -e
(( bind_after_gc_rc != 0 )) || fail "OFF binder downgraded a known deleting object to a legacy URL"
assert_query "deleting|0" \
  "SELECT state||'|'||(SELECT count(*) FROM public.image_object_refs WHERE object_id='$gc_object') FROM public.user_image_objects WHERE id='$gc_object'" \
  "GC winner left no live ref"

ttl_object="1962a000-0000-4000-8000-000000000003"
ttl_sha="$(printf '3%.0s' {1..64})"
ttl_path="approved/$GC_USER/$ttl_sha.jpg"
ttl_url="https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/$ttl_path"
db_exec "
  INSERT INTO public.user_image_objects(id,user_id,bucket,storage_path,public_url,sha256,state,created_at)
  VALUES ('$ttl_object','$GC_USER','avatars','$ttl_path','$ttl_url','$ttl_sha','approved',now()-interval '49 hours');
"
start_barrier 196211 ticket196-ttl-bind-barrier
start_plain_worker ticket196-bind-winner \
  "SELECT public.fn_bind_image_ref('$GC_USER','$ttl_url','avatars','avatar','ticket196:ttl-bind',false);"
ttl_bind_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-bind-winner' AND wait_event='advisory'" \
  1 "TTL binder paused on object row"
start_plain_worker ticket196-ttl-worker \
  "SELECT public.fn_claim_unbound_image_gc('ticket196-ttl-worker',100);"
ttl_worker_pid=$LAST_PID
release_barrier ticket196-ttl-bind-barrier "$BARRIER_PID"
wait "$ttl_bind_pid"
wait "$ttl_worker_pid"
assert_query "approved|1" \
  "SELECT state||'|'||(SELECT count(*) FROM public.image_object_refs WHERE object_id='$ttl_object') FROM public.user_image_objects WHERE id='$ttl_object'" \
  "TTL worker skipped row locked by successful bind"

race_object="1962a000-0000-4000-8000-000000000004"
race_sha="$(printf '4%.0s' {1..64})"
race_path="approved/$GC_USER/$race_sha.jpg"
race_url="https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/$race_path"
db_exec "
  INSERT INTO public.user_image_objects(id,user_id,bucket,storage_path,public_url,sha256,state,created_at)
  VALUES ('$race_object','$GC_USER','avatars','$race_path','$race_url','$race_sha','approved',now()-interval '49 hours');
"
start_barrier 196242 ticket196-gc-race-barrier
start_worker ticket196-gc-race-a 196242 "SELECT public.fn_claim_unbound_image_gc('ticket196-gc-race-a',1);"
gc_race_a=$LAST_PID
start_worker ticket196-gc-race-b 196242 "SELECT public.fn_claim_unbound_image_gc('ticket196-gc-race-b',1);"
gc_race_b=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name IN ('ticket196-gc-race-a','ticket196-gc-race-b') AND wait_event='advisory'" \
  2 "competing GC workers"
release_barrier ticket196-gc-race-barrier "$BARRIER_PID"
wait "$gc_race_a"
wait "$gc_race_b"
assert_query "1" \
  "SELECT count(*) FROM public.user_image_objects WHERE id='$race_object' AND state='deleting' AND gc_claimed_by IN ('ticket196-gc-race-a','ticket196-gc-race-b')" \
  "exactly one GC worker owns the object"

log "concurrent bind/unlink: a later bind survives an in-flight unlink and fences object GC"
unlink_object="1962a000-0000-4000-8000-000000000005"
unlink_sha="$(printf '5%.0s' {1..64})"
unlink_path="approved/$GC_USER/$unlink_sha.jpg"
unlink_url="https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/$unlink_path"
unlink_sink="ticket196:unlink-bind"
db_exec "
  INSERT INTO public.user_image_objects(id,user_id,bucket,storage_path,public_url,sha256,state)
  VALUES ('$unlink_object','$GC_USER','avatars','$unlink_path','$unlink_url','$unlink_sha','approved');
  SELECT public.fn_bind_image_ref(
    '$GC_USER','$unlink_url','avatars','avatar','$unlink_sink',false
  );
"
start_barrier 196213 ticket196-unlink-winner-barrier
start_plain_worker ticket196-unlink-winner \
  "SELECT public.fn_unbind_image_ref('avatar','$unlink_sink','ticket196_concurrency');"
unlink_winner_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-unlink-winner' AND wait_event='advisory'" \
  1 "unlink paused while deleting the exact ref"
start_plain_worker ticket196-bind-after-unlink \
  "SELECT public.fn_bind_image_ref('$GC_USER','$unlink_url','avatars','avatar','$unlink_sink',false);"
bind_after_unlink_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-bind-after-unlink' AND wait_event_type='Lock'" \
  1 "binder blocked behind exact-ref unlink"
release_barrier ticket196-unlink-winner-barrier "$BARRIER_PID"
wait "$unlink_winner_pid"
wait "$bind_after_unlink_pid"
assert_query "approved|1" \
  "SELECT state||'|'||(SELECT count(*) FROM public.image_object_refs WHERE object_id='$unlink_object' AND sink_kind='avatar' AND sink_id='$unlink_sink') FROM public.user_image_objects WHERE id='$unlink_object'" \
  "later bind was lost across concurrent unlink"
assert_query "f" \
  "SELECT (public.fn_claim_image_object_gc('$unlink_object','ticket196-unlink-gc','ticket196_concurrency')->>'claimed')::boolean" \
  "object GC ignored the ref recreated after concurrent unlink"

log "bind vs reconcile: shared lifecycle fencing avoids deadlock and approved-URL downgrade"
reconcile_object="1962a000-0000-4000-8000-000000000006"
reconcile_sha="$(printf '6%.0s' {1..64})"
reconcile_path="approved/$GC_USER/$reconcile_sha.jpg"
reconcile_url="https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/$reconcile_path"
db_exec "
  INSERT INTO public.user_image_objects(id,user_id,bucket,storage_path,public_url,sha256,state)
  VALUES ('$reconcile_object','$GC_USER','avatars','$reconcile_path','$reconcile_url','$reconcile_sha','approved');
  SELECT public.fn_bind_image_ref(
    '$GC_USER','$reconcile_url','avatars','avatar','$GC_USER',false
  );
  UPDATE public.profiles SET avatar_url='$reconcile_url' WHERE user_id='$GC_USER';
"
start_barrier 196214 ticket196-reconcile-bind-barrier
start_plain_worker ticket196-reconcile-object-gate \
  "BEGIN; SELECT 1 FROM public.user_image_objects WHERE id='$reconcile_object' FOR UPDATE; SELECT pg_advisory_xact_lock_shared(196214); COMMIT;"
reconcile_gate_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-reconcile-object-gate' AND wait_event='advisory'" \
  1 "object gate paused ahead of reconcile"
start_plain_worker ticket196-reconcile-winner \
  "SELECT public.fn_reconcile_registry_object('$reconcile_object',false);"
reconcile_winner_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-reconcile-winner' AND wait_event_type='Lock'" \
  1 "actual reconcile paused on object after taking lifecycle"
start_plain_worker ticket196-bind-after-reconcile \
  "SELECT public.fn_bind_image_ref('$GC_USER','$reconcile_url','avatars','avatar','$GC_USER',false);"
bind_after_reconcile_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-bind-after-reconcile' AND wait_event='advisory'" \
  1 "binder waiting behind reconcile lifecycle fence"
release_barrier ticket196-reconcile-bind-barrier "$BARRIER_PID"
set +e
wait "$reconcile_gate_pid"; reconcile_gate_rc=$?
wait "$reconcile_winner_pid"; reconcile_winner_rc=$?
wait "$bind_after_reconcile_pid"; bind_after_reconcile_rc=$?
set -e
(( reconcile_gate_rc == 0 )) || fail "reconcile object gate failed"
(( reconcile_winner_rc == 0 )) || fail "reconcile lost bind interleaving"
(( bind_after_reconcile_rc != 0 )) || fail "OFF binder downgraded a reconciled approved URL to legacy raw"
if rg -q "deadlock detected" \
  "$TMP_DIR/ticket196-reconcile-object-gate.err" \
  "$TMP_DIR/ticket196-reconcile-winner.err" \
  "$TMP_DIR/ticket196-bind-after-reconcile.err"; then
  fail "bind vs reconcile hit a lifecycle/object/ref lock-order deadlock"
fi
assert_query "|0|0" \
  "SELECT COALESCE(avatar_url,'')||'|'||(SELECT count(*) FROM public.user_image_objects WHERE id='$reconcile_object')||'|'||(SELECT count(*) FROM public.image_object_refs WHERE object_id='$reconcile_object') FROM public.profiles WHERE user_id='$GC_USER'" \
  "reconcile terminal state after blocked bind"

log "grandfather rebind vs quick-swap: lifecycle precedes sink lock"
quick_object="1962a000-0000-4000-8000-000000000007"
quick_sha="$(printf '7%.0s' {1..64})"
quick_path="approved/$GC_USER/$quick_sha.jpg"
quick_url="https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/$quick_path"
sweep_object="1962a000-0000-4000-8000-000000000008"
sweep_sha="$(printf '8%.0s' {1..64})"
sweep_path="approved/$GC_USER/$sweep_sha.jpg"
sweep_url="https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/$sweep_path"
legacy_rebind_url="https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/$GC_USER/legacy-rebind.jpg"
db_exec "
  INSERT INTO public.user_image_objects(id,user_id,bucket,storage_path,public_url,sha256,state) VALUES
    ('$quick_object','$GC_USER','avatars','$quick_path','$quick_url','$quick_sha','approved'),
    ('$sweep_object','$GC_USER','avatars','$sweep_path','$sweep_url','$sweep_sha','approved');
  UPDATE public.profiles SET avatar_url='$legacy_rebind_url' WHERE user_id='$GC_USER';
  UPDATE public.moderation_config SET enforce=true WHERE key='grandfather_sweep';
"
start_barrier 196215 ticket196-quick-rebind-barrier
start_plain_worker ticket196-quick-swap \
  "BEGIN; SELECT public.fn_lock_image_lifecycle('$GC_USER'); SELECT pg_advisory_xact_lock_shared(196215); SELECT public.fn_commit_avatar('$GC_USER','$quick_url'); COMMIT;"
quick_swap_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-quick-swap' AND wait_event='advisory'" \
  1 "quick-swap paused while holding lifecycle"
start_plain_worker ticket196-grandfather-rebind \
  "SELECT public.fn_rebind_legacy_image('avatar','$GC_USER','$GC_USER','$legacy_rebind_url','$sweep_url');"
grandfather_rebind_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-grandfather-rebind' AND wait_event='advisory'" \
  1 "grandfather rebind waiting on lifecycle"
release_barrier ticket196-quick-rebind-barrier "$BARRIER_PID"
set +e
wait "$quick_swap_pid"; quick_swap_rc=$?
wait "$grandfather_rebind_pid"; grandfather_rebind_rc=$?
set -e
(( quick_swap_rc == 0 && grandfather_rebind_rc == 0 )) || \
  fail "quick-swap/grandfather rebind interleaving did not serialize"
if rg -q "deadlock detected" \
  "$TMP_DIR/ticket196-quick-swap.err" \
  "$TMP_DIR/ticket196-grandfather-rebind.err"; then
  fail "quick-swap vs grandfather rebind hit lifecycle/sink deadlock"
fi
assert_query "$quick_url|1|0" \
  "SELECT avatar_url||'|'||(SELECT count(*) FROM public.image_object_refs WHERE object_id='$quick_object' AND sink_kind='avatar' AND sink_id='$GC_USER')||'|'||(SELECT count(*) FROM public.image_object_refs WHERE object_id='$sweep_object') FROM public.profiles WHERE user_id='$GC_USER'" \
  "quick-swap wins before stale grandfather rebind"
db_exec "UPDATE public.moderation_config SET enforce=false WHERE key='grandfather_sweep';"

log "trigger-style GC unlink vs reconcile: lifecycle prevents queue/ref inversion"
unlink_reconcile_object="1962a000-0000-4000-8000-000000000009"
unlink_reconcile_queue="1962c000-0000-4000-8000-000000000009"
unlink_reconcile_sink="1962b000-0000-4000-8000-000000000009"
unlink_reconcile_sha="$(printf '9%.0s' {1..64})"
unlink_reconcile_path="approved/$GC_USER/$unlink_reconcile_sha.jpg"
unlink_reconcile_url="https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/$unlink_reconcile_path"
db_exec "
  INSERT INTO public.user_image_objects(id,user_id,bucket,storage_path,public_url,sha256,state)
  VALUES (
    '$unlink_reconcile_object','$GC_USER','entry-photos',
    '$unlink_reconcile_path','$unlink_reconcile_url','$unlink_reconcile_sha','approved'
  );
  INSERT INTO public.image_object_refs(object_id,sink_kind,sink_id)
  VALUES ('$unlink_reconcile_object','entry_hero','$unlink_reconcile_sink');
  INSERT INTO public.image_gc_queue(
    id,user_id,reason,sink_kind,sink_id,bucket,path,state,claimed_by,lease_expires
  ) VALUES (
    '$unlink_reconcile_queue','$GC_USER','entry_hero_delete','entry_hero',
    '$unlink_reconcile_sink','entry-photos','$unlink_reconcile_url','claimed',
    'ticket196-unlink-reconcile',now()+interval '5 minutes'
  );
"
start_barrier 196216 ticket196-unlink-reconcile-barrier
start_plain_worker ticket196-unlink-reconcile-queue-gate \
  "BEGIN; SELECT 1 FROM public.image_gc_queue WHERE id='$unlink_reconcile_queue' FOR UPDATE; SELECT pg_advisory_xact_lock_shared(196216); COMMIT;"
unlink_reconcile_gate_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-unlink-reconcile-queue-gate' AND wait_event='advisory'" \
  1 "queue gate paused ahead of trigger-style GC unlink"
start_plain_worker ticket196-unlink-reconcile-worker \
  "SELECT public.fn_unlink_gc_ref('$unlink_reconcile_queue','ticket196-unlink-reconcile');"
unlink_reconcile_worker_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-unlink-reconcile-worker' AND wait_event_type='Lock'" \
  1 "actual GC unlink paused on queue after taking lifecycle"
start_plain_worker ticket196-reconcile-after-unlink \
  "SELECT public.fn_reconcile_registry_object('$unlink_reconcile_object',false);"
reconcile_after_unlink_pid=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='ticket196-reconcile-after-unlink' AND wait_event='advisory'" \
  1 "reconcile waiting behind trigger-style GC lifecycle fence"
release_barrier ticket196-unlink-reconcile-barrier "$BARRIER_PID"
set +e
wait "$unlink_reconcile_gate_pid"; unlink_reconcile_gate_rc=$?
wait "$unlink_reconcile_worker_pid"; unlink_reconcile_worker_rc=$?
wait "$reconcile_after_unlink_pid"; reconcile_after_unlink_rc=$?
set -e
(( unlink_reconcile_gate_rc == 0 )) || fail "trigger-style GC queue gate failed"
(( unlink_reconcile_worker_rc == 0 && reconcile_after_unlink_rc == 0 )) || \
  fail "trigger-style GC unlink/reconcile interleaving did not serialize"
if rg -q "deadlock detected" \
  "$TMP_DIR/ticket196-unlink-reconcile-queue-gate.err" \
  "$TMP_DIR/ticket196-unlink-reconcile-worker.err" \
  "$TMP_DIR/ticket196-reconcile-after-unlink.err"; then
  fail "trigger-style GC unlink vs reconcile hit a queue/ref lock-order deadlock"
fi
assert_query "0|0|done" \
  "SELECT (SELECT count(*) FROM public.user_image_objects WHERE id='$unlink_reconcile_object')||'|'||(SELECT count(*) FROM public.image_object_refs WHERE object_id='$unlink_reconcile_object')||'|'||(SELECT state FROM public.image_gc_queue WHERE id='$unlink_reconcile_queue')" \
  "trigger-style GC unlink/reconcile terminal state"

log "competing scan and job workers are single-owner fenced"
db_exec "DELETE FROM public.image_scan_leases WHERE sha256=repeat('7',64);"
start_barrier 196251 ticket196-scan-lease-barrier
start_worker ticket196-scan-lease-a 196251 "SELECT public.fn_acquire_scan_lease(repeat('7',64),'ticket196-scan-a');"
scan_lease_a=$LAST_PID
start_worker ticket196-scan-lease-b 196251 "SELECT public.fn_acquire_scan_lease(repeat('7',64),'ticket196-scan-b');"
scan_lease_b=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name IN ('ticket196-scan-lease-a','ticket196-scan-lease-b') AND wait_event='advisory'" \
  2 "competing scan lease workers"
release_barrier ticket196-scan-lease-barrier "$BARRIER_PID"
wait_two_one_success "$scan_lease_a" "$scan_lease_b" ticket196-scan-lease
assert_query "1" "SELECT count(*) FROM public.image_scan_leases WHERE sha256=repeat('7',64)" "single scan lease"

db_exec "
  DELETE FROM public.job_runs WHERE job_name='alarm_selftest';
  DELETE FROM public.job_leases WHERE job_name='alarm_selftest';
"
start_barrier 196252 ticket196-job-barrier
start_worker ticket196-job-a 196252 "SELECT public.fn_claim_moderation_job('alarm_selftest','ticket196-job-a',60,'ops@example.invalid');"
job_a=$LAST_PID
start_worker ticket196-job-b 196252 "SELECT public.fn_claim_moderation_job('alarm_selftest','ticket196-job-b',60,'ops@example.invalid');"
job_b=$LAST_PID
wait_for_count \
  "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name IN ('ticket196-job-a','ticket196-job-b') AND wait_event='advisory'" \
  2 "competing job claimers"
release_barrier ticket196-job-barrier "$BARRIER_PID"
wait "$job_a"
wait "$job_b"
assert_query "1|1" \
  "SELECT (SELECT count(*) FROM public.job_runs WHERE job_name='alarm_selftest' AND status='running')||'|'||(SELECT count(*) FROM public.job_leases WHERE job_name='alarm_selftest' AND holder IN ('ticket196-job-a','ticket196-job-b'))" \
  "single fenced moderation job owner"

log "all multi-session moderation invariants passed"
