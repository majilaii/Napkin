#!/usr/bin/env bash
set -euo pipefail

# Real two-session regression for AC6. The canonicalizer holds its transaction
# open after merging the ghost; add_entries starts while that identity change is
# still uncommitted and must block on the shared restaurant-row lock. Once the
# merge commits, the insert must resolve and persist only the canonical id.

database_url="${1:-${DATABASE_URL:-}}"
if [[ -z "$database_url" ]]; then
  echo "usage: $0 <postgresql-database-url>" >&2
  exit 2
fi

owner_id="19500000-0000-4000-8000-000000000401"
ghost_id="19500000-aaaa-4000-8000-000000000401"
canonical_id="19500000-aaaa-4000-8000-000000000402"
list_id="19500000-cccc-4000-8000-000000000401"
media_ghost_id="19500000-aaaa-4000-8000-000000000411"
media_canonical_id="19500000-aaaa-4000-8000-000000000412"
media_claimant_id="19500000-4000-4000-8000-000000000411"
media_contender_id="19500000-4000-4000-8000-000000000412"
media_reference="places/ChIJ195MediaConcurrency/photos/race"
canonicalizer_pid=""

cleanup_background() {
  if [[ -n "$canonicalizer_pid" ]]; then
    kill "$canonicalizer_pid" 2>/dev/null || true
    wait "$canonicalizer_pid" 2>/dev/null || true
  fi
}
trap cleanup_background EXIT

psql "$database_url" -v ON_ERROR_STOP=1 \
  -v owner_id="$owner_id" -v ghost_id="$ghost_id" \
  -v canonical_id="$canonical_id" -v list_id="$list_id" <<'SQL'
begin;
delete from public.list_entries where list_id = :'list_id'::uuid;
delete from public.lists where id = :'list_id'::uuid;
delete from public.restaurant_merges where ghost_id = :'ghost_id'::uuid;
delete from public.restaurants where id in (:'ghost_id'::uuid, :'canonical_id'::uuid);
delete from public.profiles where user_id = :'owner_id'::uuid;
delete from auth.users where id = :'owner_id'::uuid;

insert into auth.users(
  instance_id,id,aud,role,email,created_at,updated_at,
  raw_app_meta_data,raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000', :'owner_id'::uuid,
  'authenticated','authenticated','concurrency@completeness.invalid',now(),now(),
  '{"provider":"email","providers":["email"]}',
  '{"display_name":"Completeness Concurrency"}'
);
insert into public.profiles(user_id,display_name)
values (:'owner_id'::uuid,'Completeness Concurrency')
on conflict (user_id) do update
set display_name = excluded.display_name;
insert into public.restaurants(id,external_id,name,verification,created_by)
values
  (:'ghost_id'::uuid,'ghost_195_concurrency','Concurrent Ghost','unverified',:'owner_id'::uuid),
  (:'canonical_id'::uuid,'ChIJ195Concurrency','Concurrent Canonical','verified',null);
insert into public.lists(id,owner_id,title,ranked,privacy,table_id)
values (:'list_id'::uuid,:'owner_id'::uuid,'Concurrency List',false,'private',null);
commit;
SQL

PGAPPNAME=t195_canonicalizer psql "$database_url" -v ON_ERROR_STOP=1 \
  -v ghost_id="$ghost_id" <<'SQL' &
begin;
select public.fn_canonicalize_ghost(
  :'ghost_id'::uuid,'ChIJ195Concurrency',0,'concurrency-spec'
);
-- Keep the row locks live so the add transaction necessarily overlaps.
select pg_sleep(4);
commit;
SQL
canonicalizer_pid=$!

canonicalizer_ready=false
for _ in $(seq 1 100); do
  if [[ "$(psql "$database_url" -Atqc \
    "select exists (select 1 from pg_catalog.pg_stat_activity where application_name='t195_canonicalizer' and wait_event='PgSleep')")" == "t" ]]; then
    canonicalizer_ready=true
    break
  fi
  sleep 0.05
done

if [[ "$canonicalizer_ready" != "true" ]]; then
  kill "$canonicalizer_pid" 2>/dev/null || true
  wait "$canonicalizer_pid" 2>/dev/null || true
  echo "canonicalizer session did not reach the overlap barrier" >&2
  exit 1
fi

PGAPPNAME=t195_list_adder psql "$database_url" -v ON_ERROR_STOP=1 \
  -v owner_id="$owner_id" -v ghost_id="$ghost_id" -v list_id="$list_id" <<'SQL'
select public.fn_add_list_entries_canonical(
  :'owner_id'::uuid, :'list_id'::uuid, array[:'ghost_id'::uuid]
);
SQL

wait "$canonicalizer_pid"
canonicalizer_pid=""

psql "$database_url" -v ON_ERROR_STOP=1 <<'SQL'
do $assert$
begin
  assert (
    select merged_into = '19500000-aaaa-4000-8000-000000000402'::uuid
    from public.restaurants
    where id = '19500000-aaaa-4000-8000-000000000401'::uuid
  ), 'FAIL: concurrent canonicalization did not tombstone the ghost';
  assert (
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         restaurant_id = '19500000-aaaa-4000-8000-000000000402'::uuid
       )
    from public.list_entries
    where list_id = '19500000-cccc-4000-8000-000000000401'::uuid
  ), 'FAIL: add_entries racing canonicalization did not land once on the canonical id';
end;
$assert$;
SQL

# Mandatory builder delta 1: the canonical media key does not exist when these
# sessions begin. Canonicalization transfers the live ghost-key lease while a
# contender starts fn_claim_media against the canonical identity. Both paths
# lock the same always-present restaurant rows, so the contender must observe
# the transferred live lease as pending rather than create a second key.
psql "$database_url" -v ON_ERROR_STOP=1 \
  -v owner_id="$owner_id" -v ghost_id="$media_ghost_id" \
  -v canonical_id="$media_canonical_id" -v claimant_id="$media_claimant_id" \
  -v photo_reference="$media_reference" <<'SQL'
begin;
delete from public.media_claims
where restaurant_id in (:'ghost_id'::uuid, :'canonical_id'::uuid);
delete from public.restaurant_merges where ghost_id = :'ghost_id'::uuid;
delete from public.restaurants where id in (:'ghost_id'::uuid, :'canonical_id'::uuid);

insert into public.restaurants(id,external_id,name,verification,created_by)
values
  (:'ghost_id'::uuid,'ghost_195_media_concurrency','Media Race Ghost','unverified',:'owner_id'::uuid),
  (:'canonical_id'::uuid,'ChIJ195MediaConcurrency','Media Race Canonical','verified',null);
insert into public.media_claims(
  claim_key,restaurant_id,claim_owner,claim_until
) values (
  'media:' || :'ghost_id' || ':' ||
    pg_catalog.encode(extensions.digest(:'photo_reference','sha1'),'hex'),
  :'ghost_id'::uuid, :'claimant_id'::uuid, pg_catalog.now() + interval '5 minutes'
);
commit;
SQL

PGAPPNAME=t195_media_canonicalizer psql "$database_url" -v ON_ERROR_STOP=1 \
  -v ghost_id="$media_ghost_id" <<'SQL' &
begin;
select public.fn_canonicalize_ghost(
  :'ghost_id'::uuid,'ChIJ195MediaConcurrency',0,'media-concurrency-spec'
);
-- The transfer is complete inside this still-uncommitted transaction. Keep
-- both restaurant/key locks live while the competing claim starts.
select pg_sleep(4);
commit;
SQL
canonicalizer_pid=$!

canonicalizer_ready=false
for _ in $(seq 1 100); do
  if [[ "$(psql "$database_url" -Atqc \
    "select exists (select 1 from pg_catalog.pg_stat_activity where application_name='t195_media_canonicalizer' and wait_event='PgSleep')")" == "t" ]]; then
    canonicalizer_ready=true
    break
  fi
  sleep 0.05
done

if [[ "$canonicalizer_ready" != "true" ]]; then
  kill "$canonicalizer_pid" 2>/dev/null || true
  wait "$canonicalizer_pid" 2>/dev/null || true
  echo "media canonicalizer session did not reach the overlap barrier" >&2
  exit 1
fi

media_outcome=$(PGAPPNAME=t195_media_contender psql "$database_url" \
  -v ON_ERROR_STOP=1 -At \
  -v canonical_id="$media_canonical_id" -v contender_id="$media_contender_id" \
  -v photo_reference="$media_reference" <<'SQL'
select outcome
from public.fn_claim_media(
  :'canonical_id'::uuid, :'photo_reference', :'contender_id'::uuid, 120
);
SQL
)

wait "$canonicalizer_pid"
canonicalizer_pid=""

if [[ "$media_outcome" != "pending" ]]; then
  echo "media race expected pending, got: $media_outcome" >&2
  exit 1
fi

psql "$database_url" -v ON_ERROR_STOP=1 <<'SQL'
do $assert$
begin
  assert (
    select pg_catalog.count(*) = 1
       and pg_catalog.bool_and(
         restaurant_id = '19500000-aaaa-4000-8000-000000000412'::uuid
       )
       and pg_catalog.bool_and(
         claim_owner = '19500000-4000-4000-8000-000000000411'::uuid
       )
       and pg_catalog.bool_and(
         claim_key = 'media:19500000-aaaa-4000-8000-000000000412:' ||
           pg_catalog.encode(
             extensions.digest('places/ChIJ195MediaConcurrency/photos/race','sha1'),
             'hex'
           )
       )
    from public.media_claims
    where restaurant_id in (
      '19500000-aaaa-4000-8000-000000000411'::uuid,
      '19500000-aaaa-4000-8000-000000000412'::uuid
    )
  ), 'FAIL: absent canonical media key race created a duplicate or lost the transferred lease';
end;
$assert$;
SQL

trap - EXIT
echo "PASS restaurant_completeness concurrency: add_entries + absent-key media transfer serialized"
