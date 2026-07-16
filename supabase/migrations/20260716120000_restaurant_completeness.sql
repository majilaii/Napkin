-- TICKET-195: durable restaurant completeness, provenance, paid-SKU budgets,
-- canonical aliases, and exactly-once destination routing.
--
-- This release is intentionally ADDITIVE.  In particular, the deployed
-- fn_save_import_spot signature remains available while a required-argument
-- overload is introduced for the dual-compatible Edge rollout.

-- ---------------------------------------------------------------------------
-- Core service-owned tables (dependency order matters for zero replay)
-- ---------------------------------------------------------------------------

create table public.place_attestations (
    place_id                       text primary key,
    display_name                   text,
    formatted_address              text,
    address_components             jsonb,
    lat                            double precision,
    lng                            double precision,
    photo_reference                text,
    photo_attribution_html         text,
    fetched_at                     timestamptz,
    claim_owner                    uuid,
    claim_until                    timestamptz,
    constraint place_attestations_coordinate_pair check (
        (lat is null and lng is null)
        or (
            lat is not null and lng is not null
            and lat between -90::double precision and 90::double precision
            and lng between -180::double precision and 180::double precision
        )
    ),
    constraint place_attestations_photo_pair check (
        photo_reference is null
        or nullif(pg_catalog.btrim(photo_attribution_html), '') is not null
    ),
    constraint place_attestations_lease_pair check (
        (claim_owner is null and claim_until is null)
        or (claim_owner is not null and claim_until is not null)
    )
);

create table public.import_resolutions (
    resolution_id                  uuid primary key default gen_random_uuid(),
    user_id                        uuid not null references public.profiles(user_id) on delete cascade,
    import_nonce                   uuid,
    candidate_evidence             jsonb not null,
    decision                       text not null check (decision in (
        'matched', 'no_result', 'name_reject', 'locality_reject',
        'ambiguous', 'transient', 'unattempted_budget'
    )),
    matched_external_id            text,
    scores                         jsonb,
    created_at                     timestamptz not null default now(),
    constraint import_resolutions_match_shape check (
        (decision = 'matched' and nullif(pg_catalog.btrim(matched_external_id), '') is not null)
        or (decision <> 'matched' and matched_external_id is null)
    )
);

alter table public.import_jobs
    add column sealed_at             timestamptz,
    add column expected_items        integer check (expected_items is null or expected_items >= 0),
    add column expected_destinations integer check (expected_destinations is null or expected_destinations > 0),
    add column protocol_generation   text check (protocol_generation is null or protocol_generation in ('legacy', 'v2')),
    add column done_emitted_at       timestamptz;

-- Every pre-rollout job is legacy.  This closes the NULL-generation race on
-- resume and is deliberately performed before the immutability trigger exists.
update public.import_jobs
set protocol_generation = 'legacy'
where protocol_generation is null;

create table public.restaurant_completeness_queue (
    id                              uuid primary key default gen_random_uuid(),
    owner_id                        uuid not null references public.profiles(user_id) on delete cascade,
    job_id                          uuid not null references public.import_jobs(job_id) on delete cascade,
    item_nonce                      uuid not null,
    item_hash                       text not null,
    restaurant_id                   uuid references public.restaurants(id) on delete set null,
    external_id                     text,
    resolution_id                   uuid references public.import_resolutions(resolution_id),
    client_facts                    jsonb not null default '{}'::jsonb,
    state                           text not null default 'pending' check (state in (
        'pending', 'leased', 'deferred', 'verified', 'resolved', 'exhausted'
    )),
    attempts                        integer not null default 0 check (attempts >= 0),
    next_attempt_at                 timestamptz not null default (now() + interval '15 minutes'),
    lease_owner                     uuid,
    lease_token                     uuid,
    lease_until                     timestamptz,
    last_error                      text,
    dismissed_at                    timestamptz,
    created_at                      timestamptz not null default now(),
    updated_at                      timestamptz not null default now(),
    constraint restaurant_completeness_queue_lease_shape check (
        (state = 'leased' and lease_owner is not null and lease_token is not null and lease_until is not null)
        or (state <> 'leased' and lease_owner is null and lease_token is null and lease_until is null)
    ),
    unique (owner_id, job_id, item_nonce)
);

create index restaurant_completeness_queue_due_idx
    on public.restaurant_completeness_queue (next_attempt_at, created_at)
    where state in ('pending', 'deferred');

create index restaurant_completeness_queue_expired_lease_idx
    on public.restaurant_completeness_queue (lease_until)
    where state = 'leased';

create index restaurant_completeness_queue_job_terminal_idx
    on public.restaurant_completeness_queue (job_id, state);

create index restaurant_completeness_queue_owner_exhausted_idx
    on public.restaurant_completeness_queue (owner_id, created_at desc, id desc)
    where state = 'exhausted' and dismissed_at is null;

create table public.completeness_destinations (
    id                              uuid primary key default gen_random_uuid(),
    owner_id                        uuid not null,
    job_id                          uuid not null,
    item_nonce                      uuid not null,
    destination_kind                text not null check (destination_kind in ('wishlist', 'table', 'list', 'new_list')),
    target_table_id                 uuid references public.tables(id) on delete restrict,
    target_list_id                  uuid references public.lists(id) on delete restrict,
    target_list_title               text,
    title_nonce                     uuid,
    destination_nonce               uuid not null,
    payload_hash                    text not null,
    notify_done                     boolean not null default false,
    outcome                         text not null default 'pending' check (outcome in ('pending', 'fulfilled', 'rejected')),
    created_at                      timestamptz not null default now(),
    constraint completeness_destinations_target_shape check (
        (destination_kind = 'wishlist'
            and target_table_id is null and target_list_id is null
            and target_list_title is null and title_nonce is null)
        or (destination_kind = 'table'
            and target_table_id is not null and target_list_id is null
            and target_list_title is null and title_nonce is null)
        or (destination_kind = 'list'
            and target_table_id is null and target_list_id is not null
            and target_list_title is null and title_nonce is null)
        or (destination_kind = 'new_list'
            and target_table_id is null and target_list_id is null
            and nullif(pg_catalog.btrim(target_list_title), '') is not null
            and pg_catalog.char_length(pg_catalog.btrim(target_list_title)) <= 60
            and title_nonce is not null)
    ),
    unique (owner_id, job_id, item_nonce, destination_nonce),
    foreign key (owner_id, job_id, item_nonce)
        references public.restaurant_completeness_queue(owner_id, job_id, item_nonce)
        on delete cascade
);

create index completeness_destinations_item_outcome_idx
    on public.completeness_destinations (job_id, item_nonce, outcome);

create table public.destination_nonce_ledger (
    ledger_key                      text primary key,
    owner_id                        uuid not null references public.profiles(user_id) on delete cascade,
    job_id                          uuid not null references public.import_jobs(job_id) on delete cascade,
    payload                         jsonb not null,
    payload_hash                    text not null,
    result                          jsonb,
    acked_at                        timestamptz,
    created_at                      timestamptz not null default now(),
    constraint destination_nonce_ledger_ack_pair check (
        (acked_at is null and result is null) or acked_at is not null
    )
);

alter table public.restaurants
    add column merged_into uuid references public.restaurants(id) on delete restrict,
    add column completeness_version integer not null default 0 check (completeness_version >= 0);

create index restaurants_merged_into_idx
    on public.restaurants (merged_into)
    where merged_into is not null;

create table public.restaurant_merges (
    ghost_id                        uuid primary key references public.restaurants(id) on delete cascade,
    canonical_id                    uuid not null references public.restaurants(id) on delete restrict,
    created_at                      timestamptz not null default now(),
    constraint restaurant_merges_not_self check (ghost_id <> canonical_id)
);

create index restaurant_merges_canonical_idx
    on public.restaurant_merges(canonical_id);

create table public.media_claims (
    claim_key                       text primary key,
    restaurant_id                   uuid not null references public.restaurants(id) on delete cascade,
    claim_owner                     uuid,
    claim_until                     timestamptz,
    committed_at                    timestamptz,
    committed_reference             text,
    committed_url                   text,
    constraint media_claims_key_shape check (
        claim_key like 'media:' || restaurant_id::text || ':%'
    ),
    constraint media_claims_lease_pair check (
        (claim_owner is null and claim_until is null)
        or (claim_owner is not null and claim_until is not null)
    ),
    constraint media_claims_commit_shape check (
        (committed_at is null and committed_reference is null and committed_url is null)
        or (
            committed_at is not null
            and nullif(pg_catalog.btrim(committed_reference), '') is not null
            and nullif(pg_catalog.btrim(committed_url), '') is not null
            and claim_owner is null and claim_until is null
        )
    )
);

create index media_claims_restaurant_idx
    on public.media_claims(restaurant_id, claim_key);

create table public.sku_budget_config (
    sku                             text primary key,
    weight_units                    integer not null check (weight_units > 0),
    per_user_daily                  integer not null check (per_user_daily > 0),
    project_daily                   integer not null check (project_daily > 0),
    constraint sku_budget_config_known_sku check (sku in (
        'places_details_pro', 'places_text_search', 'places_photo'
    ))
);

create table public.sku_budget_usage (
    scope                           text not null,
    sku                             text not null references public.sku_budget_config(sku) on delete restrict,
    window_start                    timestamptz not null,
    used_units                      integer not null default 0 check (used_units >= 0),
    primary key (scope, sku, window_start),
    constraint sku_budget_usage_scope check (scope = 'project' or scope like 'user:%')
);

create table public.completeness_control (
    id                              boolean primary key default true check (id),
    frozen                          boolean not null default true,
    frozen_reason                   text,
    updated_at                      timestamptz not null default now()
);

insert into public.sku_budget_config(sku, weight_units, per_user_daily, project_daily)
values
    ('places_details_pro', 17, 1700, 85000),
    ('places_text_search', 32, 3200, 160000),
    ('places_photo',        7,  700, 35000);

insert into public.completeness_control(id, frozen, frozen_reason)
values (true, true, 'seeded frozen; cleared only by the post-deploy gate');

create index import_jobs_completeness_sweep_idx
    on public.import_jobs(sealed_at, job_id)
    where sealed_at is not null and done_emitted_at is null;

-- ---------------------------------------------------------------------------
-- RLS + privilege boundary.  No client policy exists on any new table.
-- ---------------------------------------------------------------------------

alter table public.place_attestations enable row level security;
alter table public.import_resolutions enable row level security;
alter table public.restaurant_completeness_queue enable row level security;
alter table public.completeness_destinations enable row level security;
alter table public.destination_nonce_ledger enable row level security;
alter table public.restaurant_merges enable row level security;
alter table public.media_claims enable row level security;
alter table public.sku_budget_config enable row level security;
alter table public.sku_budget_usage enable row level security;
alter table public.completeness_control enable row level security;

revoke all on table public.place_attestations from public, anon, authenticated;
revoke all on table public.import_resolutions from public, anon, authenticated;
revoke all on table public.restaurant_completeness_queue from public, anon, authenticated;
revoke all on table public.completeness_destinations from public, anon, authenticated;
revoke all on table public.destination_nonce_ledger from public, anon, authenticated;
revoke all on table public.restaurant_merges from public, anon, authenticated;
revoke all on table public.media_claims from public, anon, authenticated;
revoke all on table public.sku_budget_config from public, anon, authenticated;
revoke all on table public.sku_budget_usage from public, anon, authenticated;
revoke all on table public.completeness_control from public, anon, authenticated;

grant all on table public.place_attestations to service_role;
grant all on table public.import_resolutions to service_role;
grant all on table public.restaurant_completeness_queue to service_role;
grant all on table public.completeness_destinations to service_role;
grant all on table public.destination_nonce_ledger to service_role;
grant all on table public.restaurant_merges to service_role;
grant all on table public.media_claims to service_role;
grant all on table public.sku_budget_config to service_role;
grant all on table public.sku_budget_usage to service_role;
grant all on table public.completeness_control to service_role;

-- Harden the pre-existing limiter as part of the same atomic rollout.
alter table public.rate_limit_buckets enable row level security;
revoke all on table public.rate_limit_buckets from public, anon, authenticated;
grant all on table public.rate_limit_buckets to service_role;

-- ---------------------------------------------------------------------------
-- Immutability and version triggers
-- ---------------------------------------------------------------------------

create or replace function public.restaurant_completeness_reject_resolution_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
    if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
        -- A parent-row FK cascade is lifecycle cleanup, not provenance
        -- rewriting.  Direct deletes execute at depth 1 and remain forbidden.
        return old;
    end if;
    raise exception using errcode = '55000', message = 'import resolutions are append-only';
end;
$fn$;

create trigger import_resolutions_append_only
    before update or delete on public.import_resolutions
    for each row execute function public.restaurant_completeness_reject_resolution_mutation();

create or replace function public.restaurant_completeness_destination_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
    if new.id is distinct from old.id
       or new.owner_id is distinct from old.owner_id
       or new.job_id is distinct from old.job_id
       or new.item_nonce is distinct from old.item_nonce
       or new.destination_kind is distinct from old.destination_kind
       or new.target_table_id is distinct from old.target_table_id
       or new.target_list_id is distinct from old.target_list_id
       or new.target_list_title is distinct from old.target_list_title
       or new.title_nonce is distinct from old.title_nonce
       or new.destination_nonce is distinct from old.destination_nonce
       or new.payload_hash is distinct from old.payload_hash
       or new.notify_done is distinct from old.notify_done
       or new.created_at is distinct from old.created_at
    then
        raise exception using errcode = '55000', message = 'destination intent is immutable';
    end if;

    if old.outcome <> 'pending' and new.outcome is distinct from old.outcome then
        raise exception using errcode = '55000', message = 'destination outcome is terminal';
    end if;
    if old.outcome = 'pending' and new.outcome not in ('pending', 'fulfilled', 'rejected') then
        raise exception using errcode = '55000', message = 'invalid destination transition';
    end if;
    return new;
end;
$fn$;

create trigger completeness_destinations_immutable
    before update on public.completeness_destinations
    for each row execute function public.restaurant_completeness_destination_guard();

create or replace function public.restaurant_completeness_queue_dismissal_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
    if old.dismissed_at is not null
       and new.dismissed_at is distinct from old.dismissed_at
    then
        raise exception using errcode = '55000', message = 'dismissed completeness item is immutable';
    end if;
    if old.dismissed_at is null and new.dismissed_at is not null
       and (old.state <> 'exhausted' or new.state <> 'exhausted')
    then
        raise exception using errcode = '55000', message = 'only an exhausted item can be dismissed';
    end if;
    if old.dismissed_at is not null and new.state <> 'exhausted' then
        raise exception using errcode = '55000', message = 'dismissed completeness item is terminal';
    end if;
    return new;
end;
$fn$;

create trigger restaurant_completeness_queue_dismissal_immutable
    before update on public.restaurant_completeness_queue
    for each row execute function public.restaurant_completeness_queue_dismissal_guard();

create or replace function public.restaurant_completeness_ledger_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
    if tg_op = 'DELETE' then
        if pg_catalog.pg_trigger_depth() > 1 then
            return old;
        end if;
        raise exception using errcode = '55000', message = 'destination ledger is append-only';
    end if;
    if new.ledger_key is distinct from old.ledger_key
       or new.owner_id is distinct from old.owner_id
       or new.job_id is distinct from old.job_id
       or new.payload is distinct from old.payload
       or new.payload_hash is distinct from old.payload_hash
       or new.created_at is distinct from old.created_at
    then
        raise exception using errcode = '55000', message = 'destination ledger payload is immutable';
    end if;
    if old.acked_at is not null
       and (new.acked_at is distinct from old.acked_at or new.result is distinct from old.result)
    then
        raise exception using errcode = '55000', message = 'destination ledger acknowledgement is immutable';
    end if;
    return new;
end;
$fn$;

create trigger destination_nonce_ledger_append_only
    before update or delete on public.destination_nonce_ledger
    for each row execute function public.restaurant_completeness_ledger_guard();

create or replace function public.restaurant_completeness_freeze_job_contract()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
    if old.protocol_generation is not null
       and new.protocol_generation is distinct from old.protocol_generation then
        raise exception using errcode = '55000', message = 'PROTOCOL_GENERATION_MISMATCH';
    end if;
    if old.expected_destinations is not null
       and new.expected_destinations is distinct from old.expected_destinations then
        raise exception using errcode = '55000', message = 'EXPECTED_MISMATCH';
    end if;
    if old.sealed_at is not null and new.sealed_at is distinct from old.sealed_at then
        raise exception using errcode = '55000', message = 'sealed import job cannot be reopened';
    end if;
    if old.expected_items is not null and new.expected_items is distinct from old.expected_items then
        raise exception using errcode = '55000', message = 'sealed item cardinality is immutable';
    end if;
    if old.done_emitted_at is not null and new.done_emitted_at is distinct from old.done_emitted_at then
        raise exception using errcode = '55000', message = 'import_done emission is immutable';
    end if;
    return new;
end;
$fn$;

create trigger import_jobs_completeness_contract_immutable
    before update on public.import_jobs
    for each row execute function public.restaurant_completeness_freeze_job_contract();

create or replace function public.restaurants_bump_completeness_version()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
    if (new.name, new.city, new.address, new.country, new.lat, new.lng, new.external_id, new.merged_into)
       is distinct from
       (old.name, old.city, old.address, old.country, old.lat, old.lng, old.external_id, old.merged_into)
    then
        new.completeness_version := old.completeness_version + 1;
    else
        new.completeness_version := old.completeness_version;
    end if;
    return new;
end;
$fn$;

create trigger restaurants_bump_completeness_version_trg
    before update on public.restaurants
    for each row execute function public.restaurants_bump_completeness_version();

revoke all on function public.restaurant_completeness_reject_resolution_mutation() from public, anon, authenticated;
revoke all on function public.restaurant_completeness_destination_guard() from public, anon, authenticated;
revoke all on function public.restaurant_completeness_queue_dismissal_guard() from public, anon, authenticated;
revoke all on function public.restaurant_completeness_ledger_guard() from public, anon, authenticated;
revoke all on function public.restaurant_completeness_freeze_job_contract() from public, anon, authenticated;
revoke all on function public.restaurants_bump_completeness_version() from public, anon, authenticated;
grant execute on function public.restaurant_completeness_reject_resolution_mutation() to service_role;
grant execute on function public.restaurant_completeness_destination_guard() to service_role;
grant execute on function public.restaurant_completeness_queue_dismissal_guard() to service_role;
grant execute on function public.restaurant_completeness_ledger_guard() to service_role;
grant execute on function public.restaurant_completeness_freeze_job_contract() to service_role;
grant execute on function public.restaurants_bump_completeness_version() to service_role;

-- ---------------------------------------------------------------------------
-- Spend controls and provider-fetch single flight
-- ---------------------------------------------------------------------------

create or replace function public.check_and_increment_rate_limit(
    p_user_id uuid,
    p_bucket_key text,
    p_max integer,
    p_window_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_now timestamptz := pg_catalog.now();
    v_window_start timestamptz;
    v_window_end timestamptz;
    v_count integer;
begin
    if p_user_id is null
       or nullif(pg_catalog.btrim(p_bucket_key), '') is null
       or p_max < 1 or p_window_seconds < 1 or p_window_seconds > 86400
    then
        return query select false, pg_catalog.greatest(p_window_seconds, 1);
        return;
    end if;

    v_window_start := pg_catalog.to_timestamp(
        pg_catalog.floor(pg_catalog.date_part('epoch', v_now) / p_window_seconds) * p_window_seconds
    );
    v_window_end := v_window_start + (p_window_seconds * interval '1 second');

    insert into public.rate_limit_buckets(user_id, bucket_key, window_start, count)
    values (p_user_id, p_bucket_key, v_window_start, 1)
    on conflict (user_id, bucket_key, window_start)
    do update set count = public.rate_limit_buckets.count + 1
    returning count into v_count;

    return query select
        v_count <= p_max,
        case when v_count <= p_max then 0
             else pg_catalog.greatest(0, pg_catalog.date_part('epoch', v_window_end - v_now)::integer)
        end;
end;
$fn$;

revoke all on function public.check_and_increment_rate_limit(uuid, text, integer, integer)
    from public, anon, authenticated;
grant execute on function public.check_and_increment_rate_limit(uuid, text, integer, integer)
    to service_role;

create or replace function public.fn_set_completeness_freeze(
    p_frozen boolean,
    p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
    if p_frozen is null then
        raise exception using errcode = '22023', message = 'frozen is required';
    end if;
    insert into public.completeness_control(id, frozen, frozen_reason, updated_at)
    values (true, p_frozen, nullif(pg_catalog.btrim(p_reason), ''), pg_catalog.now())
    on conflict (id) do update
    set frozen = excluded.frozen,
        frozen_reason = excluded.frozen_reason,
        updated_at = excluded.updated_at;
    return p_frozen;
end;
$fn$;

revoke all on function public.fn_set_completeness_freeze(boolean, text)
    from public, anon, authenticated;
grant execute on function public.fn_set_completeness_freeze(boolean, text)
    to service_role;

create or replace function public.fn_charge_sku_budget(
    p_user_id uuid,
    p_sku text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_cfg public.sku_budget_config%rowtype;
    v_window timestamptz := pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'UTC') at time zone 'UTC';
    v_user_scope text;
    v_user_used integer;
    v_project_used integer;
begin
    if p_user_id is null or nullif(pg_catalog.btrim(p_sku), '') is null then
        return false;
    end if;

    -- One lock serializes both scope rows; there is no half-charge window.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('completeness-budget:' || p_sku || ':' || v_window::text, 195)
    );

    if coalesce((select frozen from public.completeness_control where id), true) then
        return false;
    end if;

    select * into v_cfg
    from public.sku_budget_config
    where sku = p_sku
    for update;
    if not found then
        return false;
    end if;

    v_user_scope := 'user:' || p_user_id::text;
    select used_units into v_user_used
    from public.sku_budget_usage
    where scope = v_user_scope and sku = p_sku and window_start = v_window
    for update;
    v_user_used := coalesce(v_user_used, 0);

    select used_units into v_project_used
    from public.sku_budget_usage
    where scope = 'project' and sku = p_sku and window_start = v_window
    for update;
    v_project_used := coalesce(v_project_used, 0);

    if v_user_used + v_cfg.weight_units > v_cfg.per_user_daily
       or v_project_used + v_cfg.weight_units > v_cfg.project_daily
    then
        return false;
    end if;

    insert into public.sku_budget_usage(scope, sku, window_start, used_units)
    values (v_user_scope, p_sku, v_window, v_cfg.weight_units)
    on conflict (scope, sku, window_start) do update
    set used_units = public.sku_budget_usage.used_units + excluded.used_units;

    insert into public.sku_budget_usage(scope, sku, window_start, used_units)
    values ('project', p_sku, v_window, v_cfg.weight_units)
    on conflict (scope, sku, window_start) do update
    set used_units = public.sku_budget_usage.used_units + excluded.used_units;

    return true;
exception when others then
    -- PL/pgSQL exception blocks roll back their statements to the implicit
    -- savepoint, so a provider call is never authorized after a half-charge.
    return false;
end;
$fn$;

revoke all on function public.fn_charge_sku_budget(uuid, text)
    from public, anon, authenticated;
grant execute on function public.fn_charge_sku_budget(uuid, text)
    to service_role;

create or replace function public.fn_claim_place_attestation(
    p_place_id text,
    p_claimant uuid,
    p_lease_seconds integer
)
returns table(outcome text, projection jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_row public.place_attestations%rowtype;
    v_lease integer;
begin
    if nullif(pg_catalog.btrim(p_place_id), '') is null or p_claimant is null then
        raise exception using errcode = '22023', message = 'place_id and claimant are required';
    end if;
    v_lease := pg_catalog.least(pg_catalog.greatest(coalesce(p_lease_seconds, 120), 15), 900);

    -- The advisory key covers the initially-absent row, which FOR UPDATE cannot.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('place-attestation:' || p_place_id, 195)
    );
    select * into v_row
    from public.place_attestations
    where place_id = p_place_id
    for update;

    if found and v_row.fetched_at > pg_catalog.now() - interval '24 hours' then
        outcome := 'hit';
        projection := pg_catalog.jsonb_build_object(
            'display_name', v_row.display_name,
            'formatted_address', v_row.formatted_address,
            'address_components', v_row.address_components,
            'lat', v_row.lat,
            'lng', v_row.lng,
            'photo_reference', v_row.photo_reference,
            'photo_attribution_html', v_row.photo_attribution_html,
            'fetched_at', v_row.fetched_at
        );
        return next;
        return;
    end if;

    if found and v_row.claim_until >= pg_catalog.now() and v_row.claim_owner <> p_claimant then
        outcome := 'pending';
        projection := null;
        return next;
        return;
    end if;

    insert into public.place_attestations(place_id, claim_owner, claim_until)
    values (p_place_id, p_claimant, pg_catalog.now() + (v_lease * interval '1 second'))
    on conflict (place_id) do update
    set claim_owner = excluded.claim_owner,
        claim_until = excluded.claim_until;

    outcome := 'claimed';
    projection := null;
    return next;
end;
$fn$;

create or replace function public.fn_commit_place_attestation(
    p_place_id text,
    p_claimant uuid,
    p_projection jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_lat double precision;
    v_lng double precision;
    v_display_name text;
    v_ref text;
    v_attr text;
begin
    if pg_catalog.jsonb_typeof(p_projection) <> 'object' then
        raise exception using errcode = '22023', message = 'projection must be an object';
    end if;
    v_lat := nullif(p_projection->>'lat', '')::double precision;
    v_lng := nullif(p_projection->>'lng', '')::double precision;
    v_display_name := nullif(pg_catalog.btrim(p_projection->>'display_name'), '');
    v_ref := nullif(pg_catalog.btrim(p_projection->>'photo_reference'), '');
    v_attr := nullif(pg_catalog.btrim(p_projection->>'photo_attribution_html'), '');

    if v_display_name is null
       or v_lat is null or v_lng is null
       or v_lat not between -90 and 90
       or v_lng not between -180 and 180
       or (v_ref is null) <> (v_attr is null)
    then
        raise exception using errcode = '22023', message = 'attestation requires name, finite coordinates, and a paired photo attribution';
    end if;

    update public.place_attestations
    set display_name = v_display_name,
        formatted_address = nullif(pg_catalog.btrim(p_projection->>'formatted_address'), ''),
        address_components = p_projection->'address_components',
        lat = v_lat,
        lng = v_lng,
        photo_reference = v_ref,
        photo_attribution_html = v_attr,
        fetched_at = pg_catalog.now(),
        claim_owner = null,
        claim_until = null
    where place_id = p_place_id
      and claim_owner = p_claimant
      and claim_until >= pg_catalog.now();
    return found;
end;
$fn$;

revoke all on function public.fn_claim_place_attestation(text, uuid, integer)
    from public, anon, authenticated;
revoke all on function public.fn_commit_place_attestation(text, uuid, jsonb)
    from public, anon, authenticated;
grant execute on function public.fn_claim_place_attestation(text, uuid, integer)
    to service_role;
grant execute on function public.fn_commit_place_attestation(text, uuid, jsonb)
    to service_role;

-- ---------------------------------------------------------------------------
-- Canonical identity lookup and reclaimable photo-media claim
-- ---------------------------------------------------------------------------

create or replace function public.fn_resolve_canonical(p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_current uuid := p_id;
    v_next uuid;
    v_seen uuid[] := '{}'::uuid[];
begin
    if p_id is null then
        return null;
    end if;
    loop
        if v_current = any(v_seen) then
            raise exception using errcode = '23514', message = 'ALIAS_CYCLE';
        end if;
        v_seen := pg_catalog.array_append(v_seen, v_current);
        select merged_into into v_next
        from public.restaurants
        where id = v_current;
        if not found then
            return null;
        end if;
        if v_next is null then
            return v_current;
        end if;
        v_current := v_next;
        if pg_catalog.cardinality(v_seen) > 64 then
            raise exception using errcode = '54001', message = 'alias chain exceeds safety bound';
        end if;
    end loop;
end;
$fn$;

revoke all on function public.fn_resolve_canonical(uuid)
    from public, anon, authenticated;
grant execute on function public.fn_resolve_canonical(uuid)
    to service_role;

create or replace function public.fn_claim_media(
    p_canonical_restaurant_id uuid,
    p_photo_reference text,
    p_claimant uuid,
    p_lease_seconds integer
)
returns table(outcome text, committed_url text)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_restaurant_id uuid;
    v_key text;
    v_row public.media_claims%rowtype;
    v_restaurant public.restaurants%rowtype;
    v_lease integer;
begin
    if p_canonical_restaurant_id is null
       or nullif(pg_catalog.btrim(p_photo_reference), '') is null
       or p_claimant is null
    then
        raise exception using errcode = '22023', message = 'restaurant, photo reference, and claimant are required';
    end if;
    v_lease := pg_catalog.least(pg_catalog.greatest(coalesce(p_lease_seconds, 180), 15), 900);

    -- Resolve internally, then lock the always-present identity row.  The merge
    -- function takes the same restaurant locks before touching media_claims, so
    -- an absent canonical-key claim cannot race a transfer.
    v_restaurant_id := public.fn_resolve_canonical(p_canonical_restaurant_id);
    if v_restaurant_id is null then
        raise exception using errcode = '23503', message = 'restaurant does not exist';
    end if;
    perform 1 from public.restaurants where id = v_restaurant_id for update;
    v_restaurant_id := public.fn_resolve_canonical(v_restaurant_id);
    select * into v_restaurant
    from public.restaurants
    where id = v_restaurant_id and merged_into is null
    for update;
    if not found then
        raise exception using errcode = '40001', message = 'canonical restaurant moved; retry';
    end if;

    -- Hero and coordinate completion are independent. The restaurant lock is
    -- also the final race check before a media lease can authorize spend: an
    -- already-complete user/Table/none hero satisfies every reference without
    -- replacement spend. Places satisfies only the exact reference: a NEW
    -- reference must retain the AC2 reference-keyed fresh-claim contract.
    if (
        v_restaurant.photo_source = 'none'
        and v_restaurant.photo_url is null
    ) or (
        v_restaurant.photo_source in ('user','table')
        and nullif(pg_catalog.btrim(v_restaurant.photo_url), '') is not null
    ) or (
        v_restaurant.photo_source = 'places'
        and nullif(pg_catalog.btrim(v_restaurant.photo_url), '') is not null
        and nullif(pg_catalog.btrim(v_restaurant.places_photo_attribution_html), '') is not null
        and v_restaurant.photo_reference = pg_catalog.btrim(p_photo_reference)
    ) then
        outcome := 'satisfied';
        committed_url := v_restaurant.photo_url;
        return next;
        return;
    end if;

    v_key := 'media:' || v_restaurant_id::text || ':' ||
        pg_catalog.encode(extensions.digest(p_photo_reference, 'sha1'), 'hex');
    select * into v_row
    from public.media_claims
    where claim_key = v_key
    for update;

    if found and v_row.committed_at is not null then
        outcome := 'done';
        committed_url := v_row.committed_url;
        return next;
        return;
    end if;
    if found and v_row.claim_until >= pg_catalog.now() and v_row.claim_owner <> p_claimant then
        outcome := 'pending';
        committed_url := null;
        return next;
        return;
    end if;

    insert into public.media_claims(
        claim_key, restaurant_id, claim_owner, claim_until
    ) values (
        v_key, v_restaurant_id, p_claimant,
        pg_catalog.now() + (v_lease * interval '1 second')
    )
    on conflict (claim_key) do update
    set claim_owner = excluded.claim_owner,
        claim_until = excluded.claim_until,
        committed_at = null,
        committed_reference = null,
        committed_url = null;

    outcome := 'claimed';
    committed_url := null;
    return next;
end;
$fn$;

create or replace function public.fn_commit_media(
    p_canonical_restaurant_id uuid,
    p_photo_reference text,
    p_claimant uuid,
    p_committed_url text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_restaurant_id uuid;
    v_key text;
    v_attr text;
    v_restaurant public.restaurants%rowtype;
    v_claim public.media_claims%rowtype;
begin
    if p_canonical_restaurant_id is null
       or nullif(pg_catalog.btrim(p_photo_reference), '') is null
       or p_claimant is null
       or nullif(pg_catalog.btrim(p_committed_url), '') is null
    then
        raise exception using errcode = '22023', message = 'restaurant, reference, claimant, and committed URL are required';
    end if;

    v_restaurant_id := public.fn_resolve_canonical(p_canonical_restaurant_id);
    if v_restaurant_id is null then
        return false;
    end if;
    perform 1 from public.restaurants where id = v_restaurant_id for update;
    v_restaurant_id := public.fn_resolve_canonical(v_restaurant_id);
    perform 1 from public.restaurants where id = v_restaurant_id for update;

    v_key := 'media:' || v_restaurant_id::text || ':' ||
        pg_catalog.encode(extensions.digest(p_photo_reference, 'sha1'), 'hex');
    select * into v_claim
    from public.media_claims
    where claim_key = v_key
      and restaurant_id = v_restaurant_id
    for update;
    if not found
       or v_claim.claim_owner is distinct from p_claimant
       or v_claim.claim_until < pg_catalog.now()
       or v_claim.committed_at is not null
    then
        return false;
    end if;

    select photo_attribution_html into v_attr
    from public.place_attestations
    where photo_reference = p_photo_reference
      and nullif(pg_catalog.btrim(photo_attribution_html), '') is not null
    order by fetched_at desc nulls last
    limit 1;
    if v_attr is null then
        raise exception using errcode = '23514', message = 'photo attribution is required';
    end if;

    select * into v_restaurant
    from public.restaurants
    where id = v_restaurant_id and merged_into is null
    for update;
    if not found then
        return false;
    end if;

    -- Commit acknowledgement and the live restaurant's exact URL are one
    -- transaction. A user/table hero that wins after the Edge pre-install is
    -- never overwritten, and its losing media claim remains uncommitted.
    if v_restaurant.photo_url is not null
       and v_restaurant.photo_url is distinct from p_committed_url
    then
        return false;
    end if;
    update public.restaurants
    set photo_url = p_committed_url,
        photo_reference = p_photo_reference,
        photo_source = 'places',
        places_photo_attribution_html = v_attr
    where id = v_restaurant_id
      and merged_into is null
      and (photo_url is null or photo_url = p_committed_url);
    if not found then
        return false;
    end if;

    update public.media_claims
    set committed_at = pg_catalog.now(),
        committed_reference = p_photo_reference,
        committed_url = p_committed_url,
        claim_owner = null,
        claim_until = null
    where claim_key = v_key
      and restaurant_id = v_restaurant_id
      and claim_owner = p_claimant
      and claim_until >= pg_catalog.now()
      and committed_at is null;
    if not found then
        raise exception using errcode = '40001', message = 'media lease changed while locked';
    end if;
    return true;
end;
$fn$;

revoke all on function public.fn_claim_media(uuid, text, uuid, integer)
    from public, anon, authenticated;
revoke all on function public.fn_commit_media(uuid, text, uuid, text)
    from public, anon, authenticated;
grant execute on function public.fn_claim_media(uuid, text, uuid, integer)
    to service_role;
grant execute on function public.fn_commit_media(uuid, text, uuid, text)
    to service_role;

-- ---------------------------------------------------------------------------
-- Transactional owner/import-nonce enqueue and fenced leasing
-- ---------------------------------------------------------------------------

create or replace function public.fn_enqueue_completeness(
    p_owner uuid,
    p_import_nonce uuid,
    p_protocol_generation text,
    p_items jsonb,
    p_destinations jsonb,
    p_expected_destinations integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_job public.import_jobs%rowtype;
    v_item jsonb;
    v_destination jsonb;
    v_item_nonce uuid;
    v_destination_nonce uuid;
    v_resolution_id uuid;
    v_restaurant_id uuid;
    v_existing_hash text;
    v_hash text;
    v_payload jsonb;
    v_kind text;
    v_table_id uuid;
    v_list_id uuid;
    v_title text;
    v_title_nonce uuid;
    v_count integer;
    v_item_count integer;
begin
    if p_owner is null or p_import_nonce is null then
        raise exception using errcode = '22023', message = 'owner and import_nonce are required';
    end if;
    if p_protocol_generation is distinct from 'v2' then
        raise exception using errcode = '22023', message = 'fn_enqueue_completeness requires protocol_generation=v2';
    end if;
    if pg_catalog.jsonb_typeof(p_items) <> 'array'
       or pg_catalog.jsonb_typeof(p_destinations) <> 'array'
    then
        raise exception using errcode = '22023', message = 'items and destinations must be arrays';
    end if;
    if pg_catalog.jsonb_array_length(p_items) < 1
       or pg_catalog.jsonb_array_length(p_items) > 500
       or pg_catalog.jsonb_array_length(p_destinations) < 1
       or pg_catalog.jsonb_array_length(p_destinations) > 2000
       or p_expected_destinations < 1
       or p_expected_destinations > 2000
    then
        raise exception using errcode = '22023', message = 'completeness cardinality limit exceeded';
    end if;

    insert into public.import_jobs(user_id, import_nonce, status, protocol_generation)
    values (p_owner, p_import_nonce, 'resolved', 'v2')
    on conflict (user_id, import_nonce) where import_nonce is not null do nothing;

    select * into v_job
    from public.import_jobs
    where user_id = p_owner and import_nonce = p_import_nonce
    for update;
    if not found then
        raise exception using errcode = '23503', message = 'import job could not be bound';
    end if;
    if v_job.user_id <> p_owner then
        raise exception using errcode = '42501', message = 'import job owner mismatch';
    end if;
    if v_job.protocol_generation is null then
        update public.import_jobs set protocol_generation = 'v2' where job_id = v_job.job_id;
        v_job.protocol_generation := 'v2';
    elsif v_job.protocol_generation <> 'v2' then
        raise exception using errcode = '55000', message = 'PROTOCOL_GENERATION_MISMATCH';
    end if;
    if v_job.expected_destinations is null then
        update public.import_jobs
        set expected_destinations = p_expected_destinations
        where job_id = v_job.job_id;
        v_job.expected_destinations := p_expected_destinations;
    elsif v_job.expected_destinations <> p_expected_destinations then
        raise exception using errcode = '55000', message = 'EXPECTED_MISMATCH';
    end if;

    for v_item in
        select value from pg_catalog.jsonb_array_elements(p_items)
    loop
        if pg_catalog.jsonb_typeof(v_item) <> 'object' then
            raise exception using errcode = '22023', message = 'each completeness item must be an object';
        end if;
        begin
            v_item_nonce := (v_item->>'item_nonce')::uuid;
            v_resolution_id := nullif(v_item->>'resolution_id', '')::uuid;
            v_restaurant_id := nullif(v_item->>'restaurant_id', '')::uuid;
        exception when invalid_text_representation then
            raise exception using errcode = '22023', message = 'invalid UUID in completeness item';
        end;
        if v_item_nonce is null then
            raise exception using errcode = '22023', message = 'item_nonce is required';
        end if;

        -- Every real v2 save carries authoritative server-minted provenance.
        -- The sole exception is the deploy gate's no-provider-call sentinel,
        -- which may target only an already-verified restaurant.
        if v_resolution_id is null
           and not (
               coalesce((v_item->'client_facts'->>'deploy_gate')::boolean, false)
               and v_restaurant_id is not null
               and exists (
                   select 1 from public.restaurants gate_r
                   where gate_r.id = v_restaurant_id
                     and gate_r.verification = 'verified'
                     and gate_r.merged_into is null
                     and (
                         nullif(v_item->>'external_id', '') is null
                         or gate_r.external_id = nullif(v_item->>'external_id', '')
                     )
               )
           )
        then
            raise exception using errcode = '42501', message = 'BOUND_RESOLUTION_REQUIRED';
        end if;

        if v_resolution_id is not null and not exists (
            select 1 from public.import_resolutions ir
            where ir.resolution_id = v_resolution_id
              and ir.user_id = p_owner
              and (ir.import_nonce is null or ir.import_nonce = p_import_nonce)
              and (
                  (
                      ir.decision = 'matched'
                      and ir.matched_external_id = nullif(v_item->>'external_id', '')
                  )
                  or (
                      ir.decision <> 'matched'
                      and nullif(v_item->>'external_id', '') is null
                  )
              )
        ) then
            raise exception using errcode = '42501', message = 'resolution is not bound to owner/import evidence';
        end if;

        if v_restaurant_id is not null then
            if not exists (
                select 1 from public.restaurants r
                where r.id = v_restaurant_id
                  and (r.verification = 'verified' or r.created_by = p_owner)
            ) then
                raise exception using errcode = '42501', message = 'restaurant is not caller-reachable';
            end if;
            v_restaurant_id := public.fn_resolve_canonical(v_restaurant_id);

            -- A verified global row is never a canonicalization source.  It
            -- may only be queued for the exact authoritative external id that
            -- it already represents.  Only an owner-created unverified ghost
            -- may be paired with a newly matched external identity.
            if v_resolution_id is not null and not exists (
                select 1
                from public.restaurants bound_r
                where bound_r.id = v_restaurant_id
                  and (
                      (
                          bound_r.verification = 'verified'
                          and bound_r.external_id = nullif(v_item->>'external_id', '')
                      )
                      or (
                          bound_r.verification = 'unverified'
                          and bound_r.created_by = p_owner
                      )
                  )
            ) then
                raise exception using errcode = '42501', message = 'restaurant does not match bound external identity';
            end if;
        else
            -- Persist a stable owner/item ghost so a deferred Text Search can
            -- canonicalize it transactionally after process death.  When an
            -- authoritative matched external id is already known, retain that
            -- identity but keep verification unverified until Details commits.
            insert into public.restaurants(
                external_id, name, city, verification, created_by
            ) values (
                coalesce(
                    nullif(v_item->>'external_id', ''),
                    'ghost_' || p_owner::text || '_' || v_item_nonce::text
                ),
                coalesce(
                    nullif(pg_catalog.btrim(v_item->'client_facts'->>'name'), ''),
                    'Unknown restaurant'
                ),
                nullif(pg_catalog.btrim(v_item->'client_facts'->>'city'), ''),
                'unverified',
                p_owner
            )
            on conflict (external_id) do update
            set external_id = public.restaurants.external_id
            returning id into v_restaurant_id;
            v_restaurant_id := public.fn_resolve_canonical(v_restaurant_id);
        end if;

        v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'restaurant_id', v_restaurant_id,
            'external_id', nullif(v_item->>'external_id', ''),
            'resolution_id', v_resolution_id,
            'client_facts', coalesce(v_item->'client_facts', '{}'::jsonb)
        ));
        v_hash := pg_catalog.encode(extensions.digest(v_payload::text, 'sha256'), 'hex');

        select item_hash into v_existing_hash
        from public.restaurant_completeness_queue
        where owner_id = p_owner and job_id = v_job.job_id and item_nonce = v_item_nonce;
        if found then
            if v_existing_hash <> v_hash then
                raise exception using errcode = '23505', message = 'NONCE_REUSE_CONFLICT';
            end if;
        else
            if v_job.sealed_at is not null then
                raise exception using errcode = '55000', message = 'SEALED';
            end if;
            insert into public.restaurant_completeness_queue(
                owner_id, job_id, item_nonce, item_hash, restaurant_id,
                external_id, resolution_id, client_facts, next_attempt_at
            ) values (
                p_owner, v_job.job_id, v_item_nonce, v_hash, v_restaurant_id,
                nullif(v_item->>'external_id', ''), v_resolution_id,
                coalesce(v_item->'client_facts', '{}'::jsonb),
                pg_catalog.now() + interval '15 minutes'
            );
        end if;
    end loop;

    for v_destination in
        select value from pg_catalog.jsonb_array_elements(p_destinations)
    loop
        if pg_catalog.jsonb_typeof(v_destination) <> 'object' then
            raise exception using errcode = '22023', message = 'each destination must be an object';
        end if;
        begin
            v_item_nonce := (v_destination->>'item_nonce')::uuid;
            v_destination_nonce := (v_destination->>'destination_nonce')::uuid;
            v_table_id := nullif(v_destination->>'target_table_id', '')::uuid;
            v_list_id := nullif(v_destination->>'target_list_id', '')::uuid;
            v_title_nonce := nullif(v_destination->>'title_nonce', '')::uuid;
        exception when invalid_text_representation then
            raise exception using errcode = '22023', message = 'invalid UUID in destination';
        end;
        v_kind := v_destination->>'destination_kind';
        v_title := nullif(pg_catalog.btrim(v_destination->>'target_list_title'), '');
        if v_item_nonce is null or v_destination_nonce is null
           or v_kind not in ('wishlist', 'table', 'list', 'new_list')
        then
            raise exception using errcode = '22023', message = 'destination identity/kind is required';
        end if;
        if not exists (
            select 1 from public.restaurant_completeness_queue q
            where q.owner_id = p_owner and q.job_id = v_job.job_id and q.item_nonce = v_item_nonce
        ) then
            raise exception using errcode = '23503', message = 'destination item does not exist';
        end if;
        if (
            select pg_catalog.count(*)
            from public.completeness_destinations d
            where d.owner_id = p_owner and d.job_id = v_job.job_id and d.item_nonce = v_item_nonce
        ) >= 20 and not exists (
            select 1 from public.completeness_destinations d
            where d.owner_id = p_owner and d.job_id = v_job.job_id
              and d.item_nonce = v_item_nonce and d.destination_nonce = v_destination_nonce
        ) then
            raise exception using errcode = '54000', message = 'per-item destination cap exceeded';
        end if;

        if v_kind = 'wishlist' then
            if v_table_id is not null or v_list_id is not null or v_title is not null or v_title_nonce is not null then
                raise exception using errcode = '22023', message = 'invalid wishlist destination';
            end if;
        elsif v_kind = 'table' then
            if v_table_id is null or v_list_id is not null or v_title is not null or v_title_nonce is not null
               or not exists (
                   select 1 from public.table_members tm
                   where tm.table_id = v_table_id and tm.member_id = p_owner
               )
            then
                raise exception using errcode = '42501', message = 'invalid or foreign table destination';
            end if;
        elsif v_kind = 'list' then
            if v_list_id is null or v_table_id is not null or v_title is not null or v_title_nonce is not null
               or not exists (
                   select 1 from public.lists l
                   where l.id = v_list_id
                     and (
                         l.owner_id = p_owner
                         or (l.table_id is not null and exists (
                             select 1 from public.table_members tm
                             where tm.table_id = l.table_id and tm.member_id = p_owner
                         ))
                     )
               )
            then
                raise exception using errcode = '42501', message = 'invalid or foreign list destination';
            end if;
        else
            if v_title is null or pg_catalog.char_length(v_title) > 60 or v_title_nonce is null
               or v_table_id is not null or v_list_id is not null
            then
                raise exception using errcode = '22023', message = 'invalid new-list destination';
            end if;
        end if;

        v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'destination_kind', v_kind,
            'target_table_id', v_table_id,
            'target_list_id', v_list_id,
            'target_list_title', v_title,
            'title_nonce', v_title_nonce,
            'notify_done', coalesce((v_destination->>'notify_done')::boolean, false)
        ));
        v_hash := pg_catalog.encode(extensions.digest(v_payload::text, 'sha256'), 'hex');

        select payload_hash into v_existing_hash
        from public.completeness_destinations
        where owner_id = p_owner and job_id = v_job.job_id
          and item_nonce = v_item_nonce and destination_nonce = v_destination_nonce;
        if found then
            if v_existing_hash <> v_hash then
                raise exception using errcode = '23505', message = 'NONCE_REUSE_CONFLICT';
            end if;
        else
            if v_job.sealed_at is not null then
                raise exception using errcode = '55000', message = 'SEALED';
            end if;
            insert into public.completeness_destinations(
                owner_id, job_id, item_nonce, destination_kind, target_table_id,
                target_list_id, target_list_title, title_nonce, destination_nonce,
                payload_hash, notify_done
            ) values (
                p_owner, v_job.job_id, v_item_nonce, v_kind, v_table_id,
                v_list_id, v_title, v_title_nonce, v_destination_nonce,
                v_hash, coalesce((v_destination->>'notify_done')::boolean, false)
            );
        end if;
    end loop;

    select pg_catalog.count(*) into v_count
    from public.completeness_destinations
    where owner_id = p_owner and job_id = v_job.job_id;
    if v_count > p_expected_destinations then
        raise exception using errcode = '22023', message = 'EXPECTED_MISMATCH';
    end if;
    if v_count = p_expected_destinations and v_job.sealed_at is null then
        if exists (
            select 1 from public.restaurant_completeness_queue q
            where q.owner_id = p_owner and q.job_id = v_job.job_id
              and not exists (
                  select 1 from public.completeness_destinations d
                  where d.owner_id = q.owner_id and d.job_id = q.job_id and d.item_nonce = q.item_nonce
              )
        ) then
            raise exception using errcode = '23514', message = 'sealed item is missing destination intent';
        end if;
        select pg_catalog.count(*) into v_item_count
        from public.restaurant_completeness_queue
        where owner_id = p_owner and job_id = v_job.job_id;
        update public.import_jobs
        set sealed_at = pg_catalog.now(), expected_items = v_item_count
        where job_id = v_job.job_id;
        v_job.sealed_at := pg_catalog.now();
    end if;

    return pg_catalog.jsonb_build_object(
        'job_id', v_job.job_id,
        'sealed', (select sealed_at is not null from public.import_jobs where job_id = v_job.job_id),
        'items', (
            select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'item_nonce', q.item_nonce, 'id', q.id
            ) order by q.created_at, q.id), '[]'::jsonb)
            from public.restaurant_completeness_queue q
            where q.owner_id = p_owner and q.job_id = v_job.job_id
              and exists (
                  select 1
                  from pg_catalog.jsonb_array_elements(p_items) as submitted(value)
                  where (submitted.value->>'item_nonce')::uuid = q.item_nonce
              )
        ),
        'destinations', (
            select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'destination_nonce', d.destination_nonce, 'id', d.id
            ) order by d.created_at, d.id), '[]'::jsonb)
            from public.completeness_destinations d
            where d.owner_id = p_owner and d.job_id = v_job.job_id
              and exists (
                  select 1
                  from pg_catalog.jsonb_array_elements(p_destinations) as submitted(value)
                  where (submitted.value->>'item_nonce')::uuid = d.item_nonce
                    and (submitted.value->>'destination_nonce')::uuid = d.destination_nonce
              )
        )
    );
end;
$fn$;

revoke all on function public.fn_enqueue_completeness(uuid, uuid, text, jsonb, jsonb, integer)
    from public, anon, authenticated;
grant execute on function public.fn_enqueue_completeness(uuid, uuid, text, jsonb, jsonb, integer)
    to service_role;

create or replace function public.fn_claim_completeness_batch(
    p_worker_id uuid,
    p_limit integer,
    p_lease_seconds integer
)
returns table(
    id uuid, owner_id uuid, job_id uuid, item_nonce uuid,
    restaurant_id uuid, external_id text, resolution_id uuid, client_facts jsonb,
    state text, attempts integer, next_attempt_at timestamptz, lease_token uuid
)
language sql
security definer
set search_path = public, pg_temp
as $fn$
    with candidates as (
        select q.id
        from public.restaurant_completeness_queue q
        join public.import_jobs j
          on j.job_id = q.job_id and j.user_id = q.owner_id
        where j.sealed_at is not null
          and (
              (q.state in ('pending', 'deferred') and q.next_attempt_at <= pg_catalog.now())
              or (q.state = 'leased' and q.lease_until < pg_catalog.now())
          )
        order by coalesce(q.lease_until, q.next_attempt_at), q.created_at, q.id
        for update of q skip locked
        limit pg_catalog.least(pg_catalog.greatest(coalesce(p_limit, 25), 1), 100)
    ), claimed as (
        update public.restaurant_completeness_queue q
        set state = 'leased',
            lease_owner = p_worker_id,
            lease_token = gen_random_uuid(),
            lease_until = pg_catalog.now() + (
                pg_catalog.least(pg_catalog.greatest(coalesce(p_lease_seconds, 180), 15), 900)
                * interval '1 second'
            ),
            updated_at = pg_catalog.now()
        from candidates c
        where q.id = c.id and p_worker_id is not null
        returning q.*
    )
    select c.id, c.owner_id, c.job_id, c.item_nonce,
           c.restaurant_id, c.external_id, c.resolution_id, c.client_facts,
           c.state, c.attempts, c.next_attempt_at, c.lease_token
    from claimed c
    order by c.created_at, c.id;
$fn$;

create or replace function public.fn_claim_completeness_item(
    p_item_id uuid,
    p_worker_id uuid,
    p_lease_seconds integer
)
returns table(
    id uuid, owner_id uuid, job_id uuid, item_nonce uuid,
    restaurant_id uuid, external_id text, resolution_id uuid, client_facts jsonb,
    state text, attempts integer, next_attempt_at timestamptz, lease_token uuid
)
language sql
security definer
set search_path = public, pg_temp
as $fn$
    with candidate as (
        select q.id
        from public.restaurant_completeness_queue q
        join public.import_jobs j
          on j.job_id = q.job_id
         and j.user_id = q.owner_id
         and j.sealed_at is not null
        where q.id = p_item_id
          and (
              q.state in ('pending', 'deferred')
              or (q.state = 'leased' and q.lease_until < pg_catalog.now())
          )
        for update of q
    ), claimed as (
        update public.restaurant_completeness_queue q
        set state = 'leased', lease_owner = p_worker_id, lease_token = gen_random_uuid(),
            lease_until = pg_catalog.now() + (
                pg_catalog.least(pg_catalog.greatest(coalesce(p_lease_seconds, 180), 15), 900)
                * interval '1 second'
            ), updated_at = pg_catalog.now()
        from candidate c
        where q.id = c.id and p_worker_id is not null
        returning q.*
    )
    select c.id, c.owner_id, c.job_id, c.item_nonce,
           c.restaurant_id, c.external_id, c.resolution_id, c.client_facts,
           c.state, c.attempts, c.next_attempt_at, c.lease_token
    from claimed c;
$fn$;

revoke all on function public.fn_claim_completeness_batch(uuid, integer, integer)
    from public, anon, authenticated;
revoke all on function public.fn_claim_completeness_item(uuid, uuid, integer)
    from public, anon, authenticated;
grant execute on function public.fn_claim_completeness_batch(uuid, integer, integer)
    to service_role;
grant execute on function public.fn_claim_completeness_item(uuid, uuid, integer)
    to service_role;

create or replace function public.fn_record_completeness_resolution(
    p_item_id uuid,
    p_lease_token uuid,
    p_decision text,
    p_candidate_evidence jsonb,
    p_matched_external_id text,
    p_scores jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_item public.restaurant_completeness_queue%rowtype;
    v_import_nonce uuid;
    v_resolution_id uuid;
begin
    if p_decision not in (
        'matched', 'no_result', 'name_reject', 'locality_reject',
        'ambiguous', 'transient', 'unattempted_budget'
    ) or pg_catalog.jsonb_typeof(p_candidate_evidence) <> 'object'
    then
        raise exception using errcode = '22023', message = 'invalid resolution decision/evidence';
    end if;
    if (p_decision = 'matched' and nullif(pg_catalog.btrim(p_matched_external_id), '') is null)
       or (p_decision <> 'matched' and p_matched_external_id is not null)
    then
        raise exception using errcode = '22023', message = 'resolution decision/external-id mismatch';
    end if;

    select * into v_item
    from public.restaurant_completeness_queue
    where id = p_item_id
    for update;
    if not found or v_item.state <> 'leased' or v_item.lease_token is distinct from p_lease_token then
        raise exception using errcode = '55000', message = 'STALE_LEASE';
    end if;
    select import_nonce into v_import_nonce
    from public.import_jobs where job_id = v_item.job_id;

    insert into public.import_resolutions(
        user_id, import_nonce, candidate_evidence, decision,
        matched_external_id, scores
    ) values (
        v_item.owner_id, v_import_nonce, p_candidate_evidence, p_decision,
        case when p_decision = 'matched' then pg_catalog.btrim(p_matched_external_id) else null end,
        p_scores
    ) returning resolution_id into v_resolution_id;

    update public.restaurant_completeness_queue
    set resolution_id = v_resolution_id,
        external_id = case when p_decision = 'matched'
                           then pg_catalog.btrim(p_matched_external_id)
                           else external_id end,
        updated_at = pg_catalog.now()
    where id = p_item_id and state = 'leased' and lease_token = p_lease_token;
    if not found then
        raise exception using errcode = '55000', message = 'STALE_LEASE';
    end if;
    return v_resolution_id;
end;
$fn$;

revoke all on function public.fn_record_completeness_resolution(uuid, uuid, text, jsonb, text, jsonb)
    from public, anon, authenticated;
grant execute on function public.fn_record_completeness_resolution(uuid, uuid, text, jsonb, text, jsonb)
    to service_role;

create or replace function public.fn_apply_restaurant_attestation(
    p_item_id uuid,
    p_lease_token uuid,
    p_restaurant_id uuid,
    p_expected_version integer,
    p_projection jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_item public.restaurant_completeness_queue%rowtype;
    v_canonical uuid;
    v_lat double precision;
    v_lng double precision;
    v_ref text;
    v_attr text;
    v_city text;
    v_country text;
    v_projection_place_id text;
    v_bound_external_id text;
    v_evidence_external_id text;
    v_row public.restaurants%rowtype;
begin
    if pg_catalog.jsonb_typeof(p_projection) <> 'object' then
        raise exception using errcode = '22023', message = 'projection must be an object';
    end if;
    begin
        v_lat := nullif(p_projection->>'lat', '')::double precision;
        v_lng := nullif(p_projection->>'lng', '')::double precision;
    exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception using errcode = '22023', message = 'attested coordinates are invalid';
    end;
    v_ref := nullif(pg_catalog.btrim(p_projection->>'photo_reference'), '');
    v_attr := nullif(pg_catalog.btrim(p_projection->>'photo_attribution_html'), '');
    v_projection_place_id := nullif(pg_catalog.btrim(p_projection->>'place_id'), '');
    if v_projection_place_id is null or v_lat is null or v_lng is null
       or v_lat not between -90 and 90 or v_lng not between -180 and 180
       or (v_ref is not null and v_attr is null)
       or (v_ref is null and v_attr is not null)
    then
        raise exception using errcode = '22023', message = 'attested coordinate/photo pair is invalid';
    end if;

    select nullif(pg_catalog.btrim(component->>'longText'), '') into v_city
    from pg_catalog.jsonb_array_elements(coalesce(p_projection->'address_components', '[]'::jsonb)) component
    where (component->'types') ?| array['locality','postal_town','administrative_area_level_2']
    order by case
        when (component->'types') ? 'locality' then 1
        when (component->'types') ? 'postal_town' then 2
        else 3
    end
    limit 1;
    select nullif(pg_catalog.btrim(component->>'longText'), '') into v_country
    from pg_catalog.jsonb_array_elements(coalesce(p_projection->'address_components', '[]'::jsonb)) component
    where (component->'types') ? 'country'
    limit 1;

    select * into v_item
    from public.restaurant_completeness_queue
    where id = p_item_id
    for update;
    if not found or v_item.state <> 'leased' or v_item.lease_token is distinct from p_lease_token then
        raise exception using errcode = '55000', message = 'STALE_LEASE';
    end if;
    if p_restaurant_id is distinct from v_item.restaurant_id
       and p_restaurant_id is distinct from public.fn_resolve_canonical(v_item.restaurant_id)
    then
        raise exception using errcode = '42501', message = 'restaurant is not the leased item target';
    end if;

    v_bound_external_id := nullif(pg_catalog.btrim(v_item.external_id), '');
    if v_bound_external_id is null and v_item.resolution_id is not null then
        select nullif(pg_catalog.btrim(ir.candidate_evidence #>> '{candidate,attempted_external_id}'), '')
        into v_evidence_external_id
        from public.import_resolutions ir
        where ir.resolution_id = v_item.resolution_id
          and ir.user_id = v_item.owner_id
          and ir.decision in ('transient','unattempted_budget')
          and exists (
              select 1
              from public.place_attestations pa
              where pa.place_id = nullif(pg_catalog.btrim(
                        ir.candidate_evidence #>> '{candidate,attempted_external_id}'
                    ), '')
                and pa.fetched_at > pg_catalog.now() - interval '24 hours'
          );
        if v_evidence_external_id is not null
           and nullif(pg_catalog.btrim(v_item.client_facts->>'attempted_external_id'), '')
               is not distinct from v_evidence_external_id
        then
            v_bound_external_id := v_evidence_external_id;
        end if;
    end if;
    if v_projection_place_id is distinct from v_bound_external_id then
        raise exception using errcode = '42501', message = 'attestation place is not bound to the leased resolution';
    end if;

    v_canonical := public.fn_resolve_canonical(p_restaurant_id);
    if v_canonical is null then
        raise exception using errcode = '23503', message = 'restaurant does not exist';
    end if;
    select * into v_row from public.restaurants where id = v_canonical for update;
    if v_row.merged_into is not null then
        raise exception using errcode = '40001', message = 'canonical identity changed; retry';
    end if;
    if nullif(pg_catalog.btrim(v_row.external_id), '') is distinct from v_projection_place_id then
        raise exception using errcode = '40001', message = 'canonical identity no longer matches attestation';
    end if;
    if v_row.completeness_version <> p_expected_version then
        raise exception using errcode = '40001', message = 'COMPLETENESS_CAS_MISMATCH';
    end if;

    update public.restaurants
    set name = coalesce(nullif(pg_catalog.btrim(p_projection->>'display_name'), ''), name),
        address = coalesce(nullif(pg_catalog.btrim(p_projection->>'formatted_address'), ''), address),
        city = coalesce(v_city, city),
        country = coalesce(v_country, country),
        lat = v_lat,
        lng = v_lng,
        verification = 'verified',
        photo_source = case
            when v_ref is null and photo_url is null and photo_source is null then 'none'
            else photo_source
        end
    where id = v_canonical
      and merged_into is null
      and completeness_version = p_expected_version
    returning * into v_row;
    if not found then
        raise exception using errcode = '40001', message = 'COMPLETENESS_CAS_MISMATCH';
    end if;

    update public.restaurant_completeness_queue
    set restaurant_id = v_canonical, updated_at = pg_catalog.now()
    where id = p_item_id and state = 'leased' and lease_token = p_lease_token;
    if not found then
        raise exception using errcode = '55000', message = 'STALE_LEASE';
    end if;

    return pg_catalog.jsonb_build_object(
        'restaurant_id', v_canonical,
        'completeness_version', v_row.completeness_version,
        'photo_reference', v_ref,
        'photo_attribution_html', v_attr,
        'photo_source', v_row.photo_source
    );
end;
$fn$;

revoke all on function public.fn_apply_restaurant_attestation(uuid, uuid, uuid, integer, jsonb)
    from public, anon, authenticated;
grant execute on function public.fn_apply_restaurant_attestation(uuid, uuid, uuid, integer, jsonb)
    to service_role;

-- ---------------------------------------------------------------------------
-- Atomic canonicalization.  Notifications deliberately remain on tombstones.
-- ---------------------------------------------------------------------------

create or replace function public.fn_canonicalize_ghost(
    p_ghost_id uuid,
    p_canonical_external_id text,
    p_expected_version integer,
    p_context text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_ghost public.restaurants%rowtype;
    v_canonical public.restaurants%rowtype;
    v_canonical_id uuid;
    v_row record;
    v_other record;
    v_target record;
    v_found boolean;
    v_ghost_wins boolean;
    v_target_key text;
    v_survivor uuid;
    v_loser uuid;
begin
    if p_ghost_id is null
       or nullif(pg_catalog.btrim(p_canonical_external_id), '') is null
       or p_expected_version is null
    then
        raise exception using errcode = '22023', message = 'ghost, canonical external id, and expected version are required';
    end if;

    select * into v_ghost from public.restaurants where id = p_ghost_id;
    if not found then
        raise exception using errcode = '23503', message = 'ghost restaurant does not exist';
    end if;
    if v_ghost.merged_into is not null then
        return public.fn_resolve_canonical(v_ghost.merged_into);
    end if;

    select * into v_canonical
    from public.restaurants
    where external_id = pg_catalog.btrim(p_canonical_external_id)
      and merged_into is null
    limit 1;

    -- No competing canonical row: promote this row in place under the CAS.
    if not found then
        perform 1 from public.restaurants where id = p_ghost_id for update;
        update public.restaurants
        set external_id = pg_catalog.btrim(p_canonical_external_id)
        where id = p_ghost_id
          and merged_into is null
          and completeness_version = p_expected_version;
        if not found then
            raise exception using errcode = '40001', message = 'COMPLETENESS_CAS_MISMATCH';
        end if;
        return p_ghost_id;
    end if;

    v_canonical_id := public.fn_resolve_canonical(v_canonical.id);
    if v_canonical_id = p_ghost_id then
        return p_ghost_id;
    end if;

    -- UUID-ordered row locks serialize both canonicalization and the
    -- initially-absent media key.  fn_claim_media locks the same rows.
    perform 1
    from public.restaurants r
    where r.id in (p_ghost_id, v_canonical_id)
    order by r.id
    for update;

    select * into v_ghost from public.restaurants where id = p_ghost_id;
    if v_ghost.merged_into is not null then
        return public.fn_resolve_canonical(v_ghost.merged_into);
    end if;
    if v_ghost.completeness_version <> p_expected_version then
        raise exception using errcode = '40001', message = 'COMPLETENESS_CAS_MISMATCH';
    end if;
    select * into v_canonical from public.restaurants where id = v_canonical_id;
    if v_canonical.merged_into is not null then
        raise exception using errcode = '40001', message = 'canonical identity moved; retry';
    end if;

    -- Fail closed if a future migration adds a restaurant FK without a named
    -- merge policy.  This query is the executable exhaustive inventory.
    if exists (
        select 1
        from pg_catalog.pg_constraint c
        join pg_catalog.pg_class cl on cl.oid = c.conrelid
        join pg_catalog.pg_namespace n on n.oid = cl.relnamespace
        join pg_catalog.pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        where c.contype = 'f'
          and c.confrelid = 'public.restaurants'::pg_catalog.regclass
          and pg_catalog.cardinality(c.conkey) = 1
          and (n.nspname, cl.relname, a.attname) not in (
              ('public','list_items','restaurant_id'),
              ('public','visits','restaurant_id'),
              ('public','entries','restaurant_id'),
              ('public','wishlist_items','restaurant_id'),
              ('public','user_restaurant_status','restaurant_id'),
              ('public','table_nights','restaurant_id'),
              ('public','table_top_4','restaurant_id'),
              ('public','table_top_4_history','prev_restaurant_id'),
              ('public','table_top_4_history','next_restaurant_id'),
              ('public','professional_critic_reviews','restaurant_id'),
              ('public','critic_scrape_attempts','restaurant_id'),
              ('public','import_jobs','restaurant_id'),
              ('public','table_shares','restaurant_id'),
              ('public','table_float_state','restaurant_id'),
              ('public','user_top_4','restaurant_id'),
              ('public','user_profile_top_4','restaurant_id'),
              ('public','suppers','restaurant_id'),
              ('public','gatherings','restaurant_id'),
              ('public','user_profile_takes','restaurant_id'),
              ('public','notifications','subject_restaurant_id'),
              ('public','list_entries','restaurant_id'),
              ('public','restaurants','merged_into'),
              ('public','restaurant_merges','ghost_id'),
              ('public','restaurant_merges','canonical_id'),
              ('public','restaurant_completeness_queue','restaurant_id'),
              ('public','media_claims','restaurant_id')
          )
    ) then
        raise exception using errcode = '55000', message = 'UNMAPPED_RESTAURANT_FK';
    end if;

    -- Lock all extant media rows after the restaurant locks.  The restaurant
    -- lock is the serialization primitive for an absent target-key row.
    perform 1
    from public.media_claims m
    where m.restaurant_id in (p_ghost_id, v_canonical_id)
    order by m.restaurant_id, m.claim_key
    for update;

    -- Settled storage trade: PATH RELAXATION, never object copy.  The claim key
    -- moves to the canonical identity while committed_url may keep the immutable
    -- ghost-prefixed object path.  The canonical row references that exact URL.
    for v_row in
        select * from public.media_claims where restaurant_id = p_ghost_id order by claim_key
    loop
        v_target_key := 'media:' || v_canonical_id::text || ':' || pg_catalog.split_part(v_row.claim_key, ':', 3);
        select * into v_target from public.media_claims where claim_key = v_target_key for update;
        v_found := found;

        if v_row.committed_at is null and (v_row.claim_until is null or v_row.claim_until < pg_catalog.now()) then
            delete from public.media_claims where claim_key = v_row.claim_key;
        elsif not v_found then
            update public.media_claims
            set claim_key = v_target_key, restaurant_id = v_canonical_id
            where claim_key = v_row.claim_key;
        elsif v_target.committed_at is not null then
            -- A canonical committed claim wins every collision.
            delete from public.media_claims where claim_key = v_row.claim_key;
        elsif v_row.committed_at is not null then
            -- A committed ghost claim fences/cancels an uncommitted canonical
            -- claimant, then transfers without re-fetching or copying bytes.
            delete from public.media_claims where claim_key = v_target_key;
            update public.media_claims
            set claim_key = v_target_key, restaurant_id = v_canonical_id
            where claim_key = v_row.claim_key;
        elsif v_target.claim_until >= pg_catalog.now() then
            -- Both are live: current canonical identity wins; deleting the
            -- ghost row fences its stale claimant's later commit.
            delete from public.media_claims where claim_key = v_row.claim_key;
        else
            -- Expired target: preserve the live ghost token under canonical key.
            delete from public.media_claims where claim_key = v_target_key;
            update public.media_claims
            set claim_key = v_target_key, restaurant_id = v_canonical_id
            where claim_key = v_row.claim_key;
        end if;
    end loop;

    -- Never copy client/ghost identity or completeness facts into the target.
    -- Only a committed media claim, paired to server-held attribution, may fill
    -- the exact hero tuple. Coordinates/name/address/verification are promoted
    -- exclusively by fn_apply_restaurant_attestation after a committed Details
    -- projection. This also keeps a pre-existing unverified target unverified.
    update public.restaurants c
    set photo_url = m.committed_url,
        photo_reference = m.committed_reference,
        photo_source = 'places',
        places_photo_attribution_html = pa.photo_attribution_html
    from public.media_claims m
    join public.place_attestations pa
      on pa.photo_reference = m.committed_reference
     and nullif(pg_catalog.btrim(pa.photo_attribution_html), '') is not null
    where c.id = v_canonical_id
      and c.photo_url is null
      and m.restaurant_id = v_canonical_id
      and m.committed_at is not null
      and nullif(pg_catalog.btrim(m.committed_url), '') is not null;

    -- wishlist_items: live beats deleted, then older created_at, then lower id.
    for v_row in select * from public.wishlist_items where restaurant_id = p_ghost_id order by id
    loop
        select * into v_other from public.wishlist_items
        where user_id = v_row.user_id and restaurant_id = v_canonical_id
        limit 1 for update;
        v_found := found;
        if not v_found then
            update public.wishlist_items set restaurant_id = v_canonical_id where id = v_row.id;
        else
            v_ghost_wins :=
                (v_row.deleted_at is null and v_other.deleted_at is not null)
                or ((v_row.deleted_at is null) = (v_other.deleted_at is null) and (
                    v_row.created_at < v_other.created_at
                    or (v_row.created_at = v_other.created_at and v_row.id < v_other.id)
                ));
            if v_ghost_wins then
                update public.wishlist_items
                set note = coalesce(v_row.note, v_other.note),
                    source = coalesce(v_row.source, v_other.source)
                where id = v_row.id;
                delete from public.wishlist_items where id = v_other.id;
                update public.wishlist_items set restaurant_id = v_canonical_id where id = v_row.id;
            else
                update public.wishlist_items
                set note = coalesce(v_other.note, v_row.note),
                    source = coalesce(v_other.source, v_row.source)
                where id = v_other.id;
                delete from public.wishlist_items where id = v_row.id;
            end if;
        end if;
    end loop;

    -- list_entries: older row wins note/added_by conflicts; minimum position.
    for v_row in select * from public.list_entries where restaurant_id = p_ghost_id order by id
    loop
        select * into v_other from public.list_entries
        where list_id = v_row.list_id and restaurant_id = v_canonical_id
        limit 1 for update;
        v_found := found;
        if not v_found then
            update public.list_entries set restaurant_id = v_canonical_id where id = v_row.id;
        else
            v_ghost_wins := v_row.created_at < v_other.created_at
                or (v_row.created_at = v_other.created_at and v_row.id < v_other.id);
            if v_ghost_wins then
                update public.list_entries
                set note = coalesce(v_row.note, v_other.note),
                    added_by = coalesce(v_row.added_by, v_other.added_by),
                    position = pg_catalog.least(v_row.position, v_other.position),
                    created_at = pg_catalog.least(v_row.created_at, v_other.created_at)
                where id = v_row.id;
                delete from public.list_entries where id = v_other.id;
                update public.list_entries set restaurant_id = v_canonical_id where id = v_row.id;
            else
                update public.list_entries
                set note = coalesce(v_other.note, v_row.note),
                    added_by = coalesce(v_other.added_by, v_row.added_by),
                    position = pg_catalog.least(v_other.position, v_row.position),
                    created_at = pg_catalog.least(v_other.created_at, v_row.created_at)
                where id = v_other.id;
                delete from public.list_entries where id = v_row.id;
            end if;
        end if;
    end loop;

    -- Legacy list_items has no timestamp: canonical row survives collisions.
    for v_row in select * from public.list_items where restaurant_id = p_ghost_id
    loop
        select * into v_other from public.list_items
        where list_id = v_row.list_id and restaurant_id = v_canonical_id
        for update;
        v_found := found;
        if v_found then
            update public.list_items
            set note = coalesce(v_other.note, v_row.note),
                position = case
                    when v_other.position is null then v_row.position
                    when v_row.position is null then v_other.position
                    else pg_catalog.least(v_other.position, v_row.position)
                end
            where list_id = v_other.list_id and restaurant_id = v_canonical_id;
            delete from public.list_items
            where list_id = v_row.list_id and restaurant_id = p_ghost_id;
        else
            update public.list_items set restaurant_id = v_canonical_id
            where list_id = v_row.list_id and restaurant_id = p_ghost_id;
        end if;
    end loop;

    update public.visits set restaurant_id = v_canonical_id where restaurant_id = p_ghost_id;
    update public.entries set restaurant_id = v_canonical_id where restaurant_id = p_ghost_id;

    -- Per-user boolean union.
    for v_row in select * from public.user_restaurant_status where restaurant_id = p_ghost_id
    loop
        select * into v_other from public.user_restaurant_status
        where user_id = v_row.user_id and restaurant_id = v_canonical_id
        for update;
        v_found := found;
        if v_found then
            update public.user_restaurant_status
            set been = coalesce(v_other.been, false) or coalesce(v_row.been, false),
                liked = coalesce(v_other.liked, false) or coalesce(v_row.liked, false),
                want_to_try = coalesce(v_other.want_to_try, false) or coalesce(v_row.want_to_try, false),
                created_at = pg_catalog.least(v_other.created_at, v_row.created_at),
                updated_at = pg_catalog.greatest(v_other.updated_at, v_row.updated_at)
            where user_id = v_row.user_id and restaurant_id = v_canonical_id;
            delete from public.user_restaurant_status
            where user_id = v_row.user_id and restaurant_id = p_ghost_id;
        else
            update public.user_restaurant_status set restaurant_id = v_canonical_id
            where user_id = v_row.user_id and restaurant_id = p_ghost_id;
        end if;
    end loop;

    update public.table_shares set restaurant_id = v_canonical_id where restaurant_id = p_ghost_id;
    update public.table_nights set restaurant_id = v_canonical_id where restaurant_id = p_ghost_id;
    update public.import_jobs set restaurant_id = v_canonical_id where restaurant_id = p_ghost_id;
    update public.table_top_4 set restaurant_id = v_canonical_id where restaurant_id = p_ghost_id;
    update public.table_top_4_history set prev_restaurant_id = v_canonical_id where prev_restaurant_id = p_ghost_id;
    update public.table_top_4_history set next_restaurant_id = v_canonical_id where next_restaurant_id = p_ghost_id;
    update public.user_profile_takes set restaurant_id = v_canonical_id where restaurant_id = p_ghost_id;
    update public.suppers set restaurant_id = v_canonical_id where restaurant_id = p_ghost_id;

    -- table_float_state: keep ONE real row under the locked deterministic
    -- order; never synthesize a hybrid that never existed.
    for v_row in select * from public.table_float_state where restaurant_id = p_ghost_id order by id
    loop
        select * into v_other from public.table_float_state
        where table_id = v_row.table_id and restaurant_id = v_canonical_id
          and saver_set_hash = v_row.saver_set_hash
        limit 1 for update;
        v_found := found;
        if v_found then
            v_ghost_wins := case
                when v_row.suppressed_until is distinct from v_other.suppressed_until then
                    v_other.suppressed_until is null
                    or (v_row.suppressed_until is not null and v_row.suppressed_until > v_other.suppressed_until)
                when v_row.dismissed_at is distinct from v_other.dismissed_at then
                    v_other.dismissed_at is null
                    or (v_row.dismissed_at is not null and v_row.dismissed_at > v_other.dismissed_at)
                when v_row.surfaced_at is distinct from v_other.surfaced_at then
                    v_other.surfaced_at is null
                    or (v_row.surfaced_at is not null and v_row.surfaced_at > v_other.surfaced_at)
                else v_row.id < v_other.id
            end;
            if v_ghost_wins then
                delete from public.table_float_state where id = v_other.id;
                update public.table_float_state
                set restaurant_id = v_canonical_id where id = v_row.id;
            else
                delete from public.table_float_state where id = v_row.id;
            end if;
        else
            update public.table_float_state set restaurant_id = v_canonical_id where id = v_row.id;
        end if;
    end loop;

    -- Proposed gatherings can collide.  Keep earlier gather_on, then lower id;
    -- merge child RSVPs with latest updated_at; on equality the RSVP already
    -- attached to the canonical restaurant wins, even when the ghost proposal
    -- itself wins the earlier-gather_on survivor order.
    update public.gatherings
    set restaurant_id = v_canonical_id
    where restaurant_id = p_ghost_id and status <> 'proposed';
    for v_row in
        select * from public.gatherings
        where restaurant_id = p_ghost_id and status = 'proposed'
        order by id
    loop
        select * into v_other from public.gatherings
        where table_id = v_row.table_id and restaurant_id = v_canonical_id and status = 'proposed'
        limit 1 for update;
        v_found := found;
        if not v_found then
            update public.gatherings set restaurant_id = v_canonical_id where id = v_row.id;
        else
            v_ghost_wins := v_row.gather_on < v_other.gather_on
                or (v_row.gather_on = v_other.gather_on and v_row.id < v_other.id);
            if v_ghost_wins then
                v_survivor := v_row.id;
                v_loser := v_other.id;
            else
                v_survivor := v_other.id;
                v_loser := v_row.id;
            end if;
            insert into public.gathering_rsvps(
                gathering_id, user_id, response, counter_on, created_at, updated_at
            )
            select v_survivor, gr.user_id, gr.response, gr.counter_on, gr.created_at, gr.updated_at
            from public.gathering_rsvps gr where gr.gathering_id = v_loser
            on conflict (gathering_id, user_id) do update
            set response = excluded.response,
                counter_on = excluded.counter_on,
                created_at = pg_catalog.least(gathering_rsvps.created_at, excluded.created_at),
                updated_at = excluded.updated_at
            where excluded.updated_at > gathering_rsvps.updated_at
               or (excluded.updated_at = gathering_rsvps.updated_at and v_ghost_wins);
            delete from public.gathering_rsvps where gathering_id = v_loser;
            delete from public.gatherings where id = v_loser;
            if v_ghost_wins then
                update public.gatherings set restaurant_id = v_canonical_id where id = v_survivor;
            end if;
        end if;
    end loop;

    -- Unique-bearing curated picks: canonical row survives a collision.
    for v_row in select * from public.user_top_4 where restaurant_id = p_ghost_id
    loop
        if exists (
            select 1 from public.user_top_4 x
            where x.user_id = v_row.user_id and x.city = v_row.city and x.restaurant_id = v_canonical_id
        ) then
            delete from public.user_top_4
            where user_id = v_row.user_id and city = v_row.city and position = v_row.position;
        else
            update public.user_top_4 set restaurant_id = v_canonical_id
            where user_id = v_row.user_id and city = v_row.city and position = v_row.position;
        end if;
    end loop;
    for v_row in select * from public.user_profile_top_4 where restaurant_id = p_ghost_id
    loop
        if exists (
            select 1 from public.user_profile_top_4 x
            where x.user_id = v_row.user_id and x.restaurant_id = v_canonical_id
        ) then
            delete from public.user_profile_top_4
            where user_id = v_row.user_id and position = v_row.position;
        else
            update public.user_profile_top_4 set restaurant_id = v_canonical_id
            where user_id = v_row.user_id and position = v_row.position;
        end if;
    end loop;

    -- Critics: compare captured pre-update timestamps; suppression always wins.
    for v_row in
        select * from public.professional_critic_reviews where restaurant_id = p_ghost_id order by id
    loop
        select * into v_other from public.professional_critic_reviews
        where restaurant_id = v_canonical_id and publication = v_row.publication
        limit 1 for update;
        v_found := found;
        if not v_found then
            update public.professional_critic_reviews set restaurant_id = v_canonical_id where id = v_row.id;
        else
            v_ghost_wins :=
                (v_row.suppressed and not v_other.suppressed)
                or (v_row.suppressed = v_other.suppressed and (
                    v_row.updated_at > v_other.updated_at
                    or (v_row.updated_at = v_other.updated_at and v_row.id < v_other.id)
                ));
            if v_ghost_wins then
                if v_row.suppressed and v_other.suppressed then
                    update public.professional_critic_reviews
                    set suppression_reason = nullif(pg_catalog.concat_ws(
                        ' | ', v_row.suppression_reason, v_other.suppression_reason
                    ), '') where id = v_row.id;
                end if;
                delete from public.professional_critic_reviews where id = v_other.id;
                update public.professional_critic_reviews set restaurant_id = v_canonical_id where id = v_row.id;
            else
                if v_row.suppressed and v_other.suppressed then
                    update public.professional_critic_reviews
                    set suppression_reason = nullif(pg_catalog.concat_ws(
                        ' | ', v_other.suppression_reason, v_row.suppression_reason
                    ), '') where id = v_other.id;
                end if;
                delete from public.professional_critic_reviews where id = v_row.id;
            end if;
        end if;
    end loop;

    for v_row in select * from public.critic_scrape_attempts where restaurant_id = p_ghost_id
    loop
        select * into v_other from public.critic_scrape_attempts
        where restaurant_id = v_canonical_id and publication = v_row.publication
        for update;
        v_found := found;
        if v_found then
            update public.critic_scrape_attempts
            set status = case when v_row.last_attempted_at > v_other.last_attempted_at
                              then v_row.status else v_other.status end,
                last_attempted_at = pg_catalog.greatest(v_other.last_attempted_at, v_row.last_attempted_at)
            where restaurant_id = v_canonical_id and publication = v_row.publication;
            delete from public.critic_scrape_attempts
            where restaurant_id = p_ghost_id and publication = v_row.publication;
        else
            update public.critic_scrape_attempts set restaurant_id = v_canonical_id
            where restaurant_id = p_ghost_id and publication = v_row.publication;
        end if;
    end loop;

    update public.restaurant_completeness_queue
    set restaurant_id = v_canonical_id, updated_at = pg_catalog.now()
    where restaurant_id = p_ghost_id;

    -- Notifications are intentionally NOT repointed.  Their immutable FK stays
    -- on this tombstone; hydrators call fn_resolve_canonical.
    update public.restaurants
    set merged_into = v_canonical_id,
        external_id = 'merged_' || gen_random_uuid()::text,
        verification = 'unverified'
    where id = p_ghost_id and completeness_version = p_expected_version;
    if not found then
        raise exception using errcode = '40001', message = 'COMPLETENESS_CAS_MISMATCH';
    end if;

    update public.restaurants set merged_into = v_canonical_id where merged_into = p_ghost_id;
    update public.restaurant_merges set canonical_id = v_canonical_id where canonical_id = p_ghost_id;
    insert into public.restaurant_merges(ghost_id, canonical_id)
    values (p_ghost_id, v_canonical_id)
    on conflict (ghost_id) do update set canonical_id = excluded.canonical_id;

    return v_canonical_id;
end;
$fn$;

revoke all on function public.fn_canonicalize_ghost(uuid, text, integer, text)
    from public, anon, authenticated;
grant execute on function public.fn_canonicalize_ghost(uuid, text, integer, text)
    to service_role;

-- Worker-only canonicalization fence.  The generic primitive above is also
-- used by synchronous attested persistence and list repair, so its signature
-- cannot require queue identity.  Worker commits go through this wrapper and
-- hold the queue lease row until the entire merge transaction commits.
create or replace function public.fn_canonicalize_completeness_item(
    p_item_id uuid,
    p_lease_token uuid,
    p_ghost_id uuid,
    p_canonical_external_id text,
    p_expected_version integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_item public.restaurant_completeness_queue%rowtype;
    v_item_restaurant_id uuid;
    v_supplied_restaurant_id uuid;
    v_current_external_id text;
    v_bound_external_id text;
    v_evidence_external_id text;
    v_external_id text := nullif(pg_catalog.btrim(p_canonical_external_id), '');
begin
    if p_item_id is null or p_lease_token is null or p_ghost_id is null
       or v_external_id is null or p_expected_version is null
    then
        raise exception using errcode = '22023', message = 'item lease, restaurant, external id, and version are required';
    end if;

    select * into v_item
    from public.restaurant_completeness_queue
    where id = p_item_id
    for update;
    if not found or v_item.state <> 'leased' or v_item.lease_token is distinct from p_lease_token then
        raise exception using errcode = '55000', message = 'STALE_LEASE';
    end if;
    v_bound_external_id := nullif(pg_catalog.btrim(v_item.external_id), '');
    if v_bound_external_id is null and v_item.resolution_id is not null then
        select nullif(pg_catalog.btrim(ir.candidate_evidence #>> '{candidate,attempted_external_id}'), '')
        into v_evidence_external_id
        from public.import_resolutions ir
        where ir.resolution_id = v_item.resolution_id
          and ir.user_id = v_item.owner_id
          and ir.decision in ('transient','unattempted_budget')
          and exists (
              select 1
              from public.place_attestations pa
              where pa.place_id = nullif(pg_catalog.btrim(
                        ir.candidate_evidence #>> '{candidate,attempted_external_id}'
                    ), '')
                and pa.fetched_at > pg_catalog.now() - interval '24 hours'
          );
        if v_evidence_external_id is not null
           and nullif(pg_catalog.btrim(v_item.client_facts->>'attempted_external_id'), '')
               is not distinct from v_evidence_external_id
        then
            v_bound_external_id := v_evidence_external_id;
        end if;
    end if;
    if v_bound_external_id is distinct from v_external_id then
        raise exception using errcode = '42501', message = 'external id is not bound to the leased item';
    end if;

    v_item_restaurant_id := public.fn_resolve_canonical(v_item.restaurant_id);
    v_supplied_restaurant_id := public.fn_resolve_canonical(p_ghost_id);
    if v_item_restaurant_id is null
       or v_supplied_restaurant_id is distinct from v_item_restaurant_id
    then
        raise exception using errcode = '42501', message = 'restaurant is not the leased item target';
    end if;

    select external_id into v_current_external_id
    from public.restaurants
    where id = v_item_restaurant_id and merged_into is null;
    if not found then
        raise exception using errcode = '40001', message = 'canonical identity changed; retry';
    end if;
    if nullif(pg_catalog.btrim(v_current_external_id), '') is distinct from v_external_id
       and v_current_external_id not like 'ghost\_%' escape '\'
       and v_current_external_id not like 'merged\_%' escape '\'
    then
        raise exception using errcode = '40001', message = 'canonical identity no longer matches the leased resolution';
    end if;

    return public.fn_canonicalize_ghost(
        p_ghost_id,
        v_external_id,
        p_expected_version,
        'restaurant-completeness'
    );
end;
$fn$;

revoke all on function public.fn_canonicalize_completeness_item(uuid, uuid, uuid, text, integer)
    from public, anon, authenticated;
grant execute on function public.fn_canonicalize_completeness_item(uuid, uuid, uuid, text, integer)
    to service_role;

-- ---------------------------------------------------------------------------
-- Exactly-once routing, terminalization barrier, bounded recovery sweep
-- ---------------------------------------------------------------------------

create or replace function public.fn_route_destination(
    p_item_id uuid,
    p_lease_token uuid,
    p_destination_id uuid,
    p_restaurant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_item public.restaurant_completeness_queue%rowtype;
    v_destination public.completeness_destinations%rowtype;
    v_restaurant_id uuid;
    v_ledger_key text;
    v_payload jsonb;
    v_hash text;
    v_existing public.destination_nonce_ledger%rowtype;
    v_inserted boolean;
    v_authorized boolean := true;
    v_result jsonb;
    v_wishlist_id uuid;
    v_already_pinned boolean := false;
    v_share_id uuid;
    v_list_id uuid;
    v_list_owner uuid;
    v_list_table_id uuid;
    v_list_found boolean;
    v_entry_id uuid;
    v_position integer;
    v_newlist_key text;
    v_newlist_payload jsonb;
    v_newlist_hash text;
    v_effect_nonce uuid;
begin
    select * into v_item
    from public.restaurant_completeness_queue
    where id = p_item_id
    for update;
    if not found or v_item.state <> 'leased' or v_item.lease_token is distinct from p_lease_token then
        raise exception using errcode = '55000', message = 'STALE_LEASE';
    end if;

    select * into v_destination
    from public.completeness_destinations
    where id = p_destination_id
      and owner_id = v_item.owner_id
      and job_id = v_item.job_id
      and item_nonce = v_item.item_nonce
    for update;
    if not found then
        raise exception using errcode = '23503', message = 'destination does not belong to leased item';
    end if;

    v_restaurant_id := public.fn_resolve_canonical(v_item.restaurant_id);
    if p_restaurant_id is null
       or public.fn_resolve_canonical(p_restaurant_id) is distinct from v_restaurant_id
    then
        raise exception using errcode = '42501', message = 'restaurant is not the leased item target';
    end if;
    if v_restaurant_id is null
       or not exists (
           select 1 from public.restaurants r
           where r.id = v_restaurant_id
             and r.merged_into is null
             and r.verification = 'verified'
             and r.lat between -90::double precision and 90::double precision
             and r.lng between -180::double precision and 180::double precision
             and (
                 (r.photo_source = 'none' and r.photo_url is null)
                 or (
                     r.photo_source in ('user','table')
                     and nullif(pg_catalog.btrim(r.photo_url), '') is not null
                 )
                 or (
                     r.photo_source = 'places'
                     and nullif(pg_catalog.btrim(r.photo_url), '') is not null
                     and nullif(pg_catalog.btrim(r.places_photo_attribution_html), '') is not null
                 )
             )
       )
    then
        raise exception using errcode = '23514', message = 'routing requires a complete verified canonical restaurant';
    end if;

    v_ledger_key := 'route:' || v_item.owner_id::text || ':' || v_item.job_id::text || ':' ||
        v_item.item_nonce::text || ':' || v_destination.destination_nonce::text;
    v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'owner_id', v_item.owner_id,
        'job_id', v_item.job_id,
        'item_nonce', v_item.item_nonce,
        'destination_nonce', v_destination.destination_nonce,
        'destination_kind', v_destination.destination_kind,
        'target_table_id', v_destination.target_table_id,
        'target_list_id', v_destination.target_list_id,
        'target_list_title', v_destination.target_list_title,
        'title_nonce', v_destination.title_nonce,
        'restaurant_id', v_restaurant_id
    ));
    v_hash := pg_catalog.encode(extensions.digest(v_payload::text, 'sha256'), 'hex');
    -- Downstream legacy nonce indexes are not owner+job+item scoped. Derive a
    -- fresh UUID from the full route key so legal nonce reuse in another job
    -- cannot alias a wishlist/table side effect.
    v_effect_nonce := (
        pg_catalog.substr(v_hash, 1, 8) || '-' ||
        pg_catalog.substr(v_hash, 9, 4) || '-' ||
        pg_catalog.substr(v_hash, 13, 4) || '-' ||
        pg_catalog.substr(v_hash, 17, 4) || '-' ||
        pg_catalog.substr(v_hash, 21, 12)
    )::uuid;

    insert into public.destination_nonce_ledger(
        ledger_key, owner_id, job_id, payload, payload_hash
    ) values (
        v_ledger_key, v_item.owner_id, v_item.job_id, v_payload, v_hash
    ) on conflict (ledger_key) do nothing
    returning true into v_inserted;

    if not coalesce(v_inserted, false) then
        select * into v_existing
        from public.destination_nonce_ledger
        where ledger_key = v_ledger_key
        for update;
        if v_existing.payload_hash <> v_hash then
            raise exception using errcode = '23505', message = 'LEDGER_PAYLOAD_CONFLICT';
        end if;
        if v_existing.acked_at is null then
            raise exception using errcode = '40001', message = 'unacknowledged routing claim; retry';
        end if;
        if v_destination.outcome = 'pending' then
            update public.completeness_destinations
            set outcome = coalesce(v_existing.result->>'outcome', 'rejected')
            where id = v_destination.id;
        end if;
        return v_existing.result;
    end if;

    if v_destination.destination_kind = 'wishlist' then
        select wi.id, wi.deleted_at is null
        into v_wishlist_id, v_already_pinned
        from public.wishlist_items wi
        where wi.user_id = v_item.owner_id
          and wi.restaurant_id = v_restaurant_id
        for update;
        if not found then
            v_already_pinned := false;
        end if;
        insert into public.wishlist_items(
            user_id, restaurant_id, job_id, extraction_status, source, note, client_nonce, deleted_at
        ) values (
            v_item.owner_id, v_restaurant_id, v_item.job_id, 'resolved',
            v_item.client_facts->'source', nullif(v_item.client_facts->>'note', ''),
            v_effect_nonce, null
        )
        on conflict (user_id, restaurant_id) do update
        set deleted_at = null,
            job_id = excluded.job_id,
            extraction_status = 'resolved',
            source = coalesce(excluded.source, public.wishlist_items.source),
            note = coalesce(excluded.note, public.wishlist_items.note)
        returning id into v_wishlist_id;
        v_result := pg_catalog.jsonb_build_object(
            'outcome', 'fulfilled',
            'status', case when v_already_pinned then 'already_pinned' else 'saved' end,
            'wishlist_id', v_wishlist_id,
            'restaurant_id', v_restaurant_id
        );

    elsif v_destination.destination_kind = 'table' then
        -- Hold the authority row through the side effect so membership cannot
        -- be revoked between validation and insertion.
        perform 1
        from public.table_members tm
        where tm.table_id = v_destination.target_table_id
          and tm.member_id = v_item.owner_id
        for key share;
        v_authorized := found;
        if v_authorized then
            insert into public.table_shares(
                job_id, table_id, author_id, restaurant_id, extraction_status,
                source, note, client_nonce
            ) values (
                v_item.job_id, v_destination.target_table_id, v_item.owner_id,
                v_restaurant_id, 'resolved', v_item.client_facts->'source',
                nullif(v_item.client_facts->>'note', ''), v_effect_nonce
            )
            on conflict (author_id, table_id, client_nonce) where client_nonce is not null
            do nothing returning id into v_share_id;
            if v_share_id is null then
                select id into v_share_id from public.table_shares
                where author_id = v_item.owner_id
                  and table_id = v_destination.target_table_id
                  and client_nonce = v_effect_nonce;
            end if;
            v_result := pg_catalog.jsonb_build_object(
                'outcome', 'fulfilled', 'share_id', v_share_id, 'restaurant_id', v_restaurant_id
            );
        end if;

    elsif v_destination.destination_kind = 'list' then
        select l.id, l.owner_id, l.table_id
        into v_list_id, v_list_owner, v_list_table_id
        from public.lists l
        where l.id = v_destination.target_list_id
        for update;
        v_list_found := found;
        v_authorized := v_list_found and v_list_owner = v_item.owner_id;
        if v_list_found and not v_authorized and v_list_table_id is not null then
            perform 1
            from public.table_members tm
            where tm.table_id = v_list_table_id
              and tm.member_id = v_item.owner_id
            for key share;
            v_authorized := found;
        end if;

    else
        -- New-list creation has its own owner+job+title nonce ledger.  Multiple
        -- chunks therefore converge on exactly one list before entry routing.
        v_newlist_key := 'newlist:' || v_item.owner_id::text || ':' || v_item.job_id::text || ':' ||
            v_destination.title_nonce::text;
        v_newlist_payload := pg_catalog.jsonb_build_object(
            'owner_id', v_item.owner_id,
            'job_id', v_item.job_id,
            'title_nonce', v_destination.title_nonce,
            'title', pg_catalog.btrim(v_destination.target_list_title)
        );
        v_newlist_hash := pg_catalog.encode(extensions.digest(v_newlist_payload::text, 'sha256'), 'hex');
        v_inserted := null;
        insert into public.destination_nonce_ledger(
            ledger_key, owner_id, job_id, payload, payload_hash
        ) values (
            v_newlist_key, v_item.owner_id, v_item.job_id, v_newlist_payload, v_newlist_hash
        ) on conflict (ledger_key) do nothing
        returning true into v_inserted;

        if coalesce(v_inserted, false) then
            insert into public.lists(owner_id, title, ranked, privacy)
            values (v_item.owner_id, pg_catalog.btrim(v_destination.target_list_title), false, 'public')
            returning id into v_list_id;
            update public.destination_nonce_ledger
            set result = pg_catalog.jsonb_build_object('list_id', v_list_id),
                acked_at = pg_catalog.now()
            where ledger_key = v_newlist_key;
        else
            select * into v_existing from public.destination_nonce_ledger
            where ledger_key = v_newlist_key for update;
            if v_existing.payload_hash <> v_newlist_hash or v_existing.acked_at is null then
                raise exception using errcode = '23505', message = 'NEW_LIST_LEDGER_CONFLICT';
            end if;
            v_list_id := (v_existing.result->>'list_id')::uuid;
        end if;
        perform 1 from public.lists where id = v_list_id and owner_id = v_item.owner_id for update;
        v_authorized := found;
    end if;

    if v_destination.destination_kind in ('list', 'new_list') and v_authorized then
        select coalesce(pg_catalog.max(position), 0) + 1024 into v_position
        from public.list_entries where list_id = v_list_id;
        insert into public.list_entries(list_id, restaurant_id, note, position, added_by)
        values (
            v_list_id, v_restaurant_id, nullif(v_item.client_facts->>'note', ''),
            v_position, v_item.owner_id
        )
        on conflict (list_id, restaurant_id) do nothing
        returning id into v_entry_id;
        if v_entry_id is null then
            select id into v_entry_id from public.list_entries
            where list_id = v_list_id and restaurant_id = v_restaurant_id;
        end if;
        v_result := pg_catalog.jsonb_build_object(
            'outcome', 'fulfilled', 'list_id', v_list_id,
            'entry_id', v_entry_id, 'restaurant_id', v_restaurant_id
        );
    end if;

    if not v_authorized then
        v_result := pg_catalog.jsonb_build_object(
            'outcome', 'rejected', 'reason', 'AUTHORITY_REVOKED',
            'restaurant_id', v_restaurant_id
        );
    end if;

    update public.completeness_destinations
    set outcome = v_result->>'outcome'
    where id = v_destination.id and outcome = 'pending';
    update public.destination_nonce_ledger
    set result = v_result, acked_at = pg_catalog.now()
    where ledger_key = v_ledger_key;
    return v_result;
end;
$fn$;

revoke all on function public.fn_route_destination(uuid, uuid, uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.fn_route_destination(uuid, uuid, uuid, uuid)
    to service_role;

create or replace function public.fn_maybe_emit_import_done(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_job public.import_jobs%rowtype;
    v_success integer;
    v_unresolved integer;
    v_payload jsonb;
    v_hash text;
    v_key text;
    v_notification_id uuid;
    v_inserted boolean;
    v_existing public.destination_nonce_ledger%rowtype;
begin
    select * into v_job from public.import_jobs where job_id = p_job_id for update;
    if not found or v_job.sealed_at is null or v_job.done_emitted_at is not null then
        return false;
    end if;
    if (
        select pg_catalog.count(*)
        from public.restaurant_completeness_queue q
        where q.job_id = p_job_id and q.state in ('verified', 'resolved', 'exhausted')
    ) <> v_job.expected_items then
        return false;
    end if;
    if exists (
        select 1
        from public.restaurant_completeness_queue q
        join public.completeness_destinations d
          on d.owner_id = q.owner_id and d.job_id = q.job_id and d.item_nonce = q.item_nonce
        where q.job_id = p_job_id
          and q.state in ('verified', 'resolved')
          and d.outcome = 'pending'
    ) then
        return false;
    end if;

    select pg_catalog.count(*) filter (where state in ('verified','resolved')),
           pg_catalog.count(*) filter (where state = 'exhausted')
    into v_success, v_unresolved
    from public.restaurant_completeness_queue
    where job_id = p_job_id;

    v_key := 'importdone:' || v_job.user_id::text || ':' || p_job_id::text;
    v_payload := pg_catalog.jsonb_build_object(
        'job_id', p_job_id,
        'count', v_success,
        'unresolved_count', v_unresolved,
        'outcome', case when v_unresolved > 0 then 'partial' else 'completed' end
    );
    v_hash := pg_catalog.encode(extensions.digest(v_payload::text, 'sha256'), 'hex');
    insert into public.destination_nonce_ledger(
        ledger_key, owner_id, job_id, payload, payload_hash
    ) values (v_key, v_job.user_id, p_job_id, v_payload, v_hash)
    on conflict (ledger_key) do nothing returning true into v_inserted;

    if coalesce(v_inserted, false) then
        insert into public.notifications(user_id, kind, subject_meta)
        values (v_job.user_id, 'import_done', v_payload)
        returning id into v_notification_id;
        update public.destination_nonce_ledger
        set result = pg_catalog.jsonb_build_object('notification_id', v_notification_id),
            acked_at = pg_catalog.now()
        where ledger_key = v_key;
    else
        select * into v_existing from public.destination_nonce_ledger
        where ledger_key = v_key for update;
        if v_existing.payload_hash <> v_hash or v_existing.acked_at is null then
            raise exception using errcode = '23505', message = 'IMPORT_DONE_LEDGER_CONFLICT';
        end if;
    end if;

    update public.import_jobs
    set done_emitted_at = pg_catalog.now()
    where job_id = p_job_id and done_emitted_at is null;
    return true;
end;
$fn$;

revoke all on function public.fn_maybe_emit_import_done(uuid)
    from public, anon, authenticated;
grant execute on function public.fn_maybe_emit_import_done(uuid)
    to service_role;

create or replace function public.fn_finalize_completeness_item(
    p_item_id uuid,
    p_lease_token uuid,
    p_terminal_state text,
    p_restaurant_id uuid default null,
    p_last_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_item public.restaurant_completeness_queue%rowtype;
    v_restaurant_id uuid;
    v_emitted boolean;
begin
    if p_terminal_state not in ('verified', 'resolved', 'exhausted') then
        raise exception using errcode = '22023', message = 'invalid terminal state';
    end if;
    select * into v_item
    from public.restaurant_completeness_queue
    where id = p_item_id
    for update;
    if not found or v_item.state <> 'leased' or v_item.lease_token is distinct from p_lease_token then
        raise exception using errcode = '55000', message = 'STALE_LEASE';
    end if;
    perform 1 from public.import_jobs where job_id = v_item.job_id for update;

    v_restaurant_id := public.fn_resolve_canonical(v_item.restaurant_id);
    if p_restaurant_id is not null
       and public.fn_resolve_canonical(p_restaurant_id) is distinct from v_restaurant_id
    then
        raise exception using errcode = '42501', message = 'restaurant is not the leased item target';
    end if;
    if p_terminal_state in ('verified', 'resolved') then
        if v_restaurant_id is null or not exists (
            select 1 from public.restaurants r
            where r.id = v_restaurant_id and r.merged_into is null and r.verification = 'verified'
              and r.lat between -90::double precision and 90::double precision
              and r.lng between -180::double precision and 180::double precision
              and (
                  (r.photo_source = 'none' and r.photo_url is null)
                  or (
                      r.photo_source in ('user','table')
                      and nullif(pg_catalog.btrim(r.photo_url), '') is not null
                  )
                  or (
                      r.photo_source = 'places'
                      and nullif(pg_catalog.btrim(r.photo_url), '') is not null
                      and nullif(pg_catalog.btrim(r.places_photo_attribution_html), '') is not null
                  )
              )
        ) then
            raise exception using errcode = '23514', message = 'successful terminal state requires complete verified restaurant';
        end if;
        if exists (
            select 1 from public.completeness_destinations d
            where d.owner_id = v_item.owner_id and d.job_id = v_item.job_id
              and d.item_nonce = v_item.item_nonce and d.outcome = 'pending'
        ) then
            raise exception using errcode = '23514', message = 'successful item still has pending destinations';
        end if;
    end if;

    update public.restaurant_completeness_queue
    set state = p_terminal_state,
        restaurant_id = coalesce(v_restaurant_id, restaurant_id),
        last_error = p_last_error,
        lease_owner = null, lease_token = null, lease_until = null,
        updated_at = pg_catalog.now()
    where id = p_item_id and state = 'leased' and lease_token = p_lease_token;
    if not found then
        raise exception using errcode = '55000', message = 'STALE_LEASE';
    end if;

    v_emitted := public.fn_maybe_emit_import_done(v_item.job_id);
    return pg_catalog.jsonb_build_object(
        'item_id', p_item_id,
        'state', p_terminal_state,
        'restaurant_id', v_restaurant_id,
        'import_done_emitted', v_emitted
    );
end;
$fn$;

revoke all on function public.fn_finalize_completeness_item(uuid, uuid, text, uuid, text)
    from public, anon, authenticated;
grant execute on function public.fn_finalize_completeness_item(uuid, uuid, text, uuid, text)
    to service_role;

create or replace function public.fn_defer_completeness_item(
    p_item_id uuid,
    p_lease_token uuid,
    p_reason text,
    p_budget_deferred boolean,
    p_attempt_cap integer default 6
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_item public.restaurant_completeness_queue%rowtype;
    v_attempts integer;
begin
    select * into v_item from public.restaurant_completeness_queue
    where id = p_item_id for update;
    if not found or v_item.state <> 'leased' or v_item.lease_token is distinct from p_lease_token then
        raise exception using errcode = '55000', message = 'STALE_LEASE';
    end if;
    if coalesce(p_budget_deferred, false) then
        update public.restaurant_completeness_queue
        set state = 'deferred', next_attempt_at = pg_catalog.now() + interval '5 minutes',
            last_error = p_reason, lease_owner = null, lease_token = null, lease_until = null,
            updated_at = pg_catalog.now()
        where id = p_item_id and state = 'leased' and lease_token = p_lease_token;
        return 'deferred';
    end if;

    v_attempts := v_item.attempts + 1;
    if v_attempts >= pg_catalog.least(pg_catalog.greatest(coalesce(p_attempt_cap, 6), 1), 20) then
        perform public.fn_finalize_completeness_item(
            p_item_id, p_lease_token, 'exhausted', v_item.restaurant_id, p_reason
        );
        update public.restaurant_completeness_queue set attempts = v_attempts where id = p_item_id;
        return 'exhausted';
    end if;

    update public.restaurant_completeness_queue
    set state = 'deferred', attempts = v_attempts,
        next_attempt_at = pg_catalog.now() + pg_catalog.make_interval(
            secs => pg_catalog.least(86400, (60 * pg_catalog.power(2::numeric, v_attempts))::integer)
        ),
        last_error = p_reason, lease_owner = null, lease_token = null, lease_until = null,
        updated_at = pg_catalog.now()
    where id = p_item_id and state = 'leased' and lease_token = p_lease_token;
    return 'deferred';
end;
$fn$;

revoke all on function public.fn_defer_completeness_item(uuid, uuid, text, boolean, integer)
    from public, anon, authenticated;
grant execute on function public.fn_defer_completeness_item(uuid, uuid, text, boolean, integer)
    to service_role;

create or replace function public.fn_sweep_stuck_jobs(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_job record;
    v_count integer := 0;
begin
    for v_job in
        select j.job_id
        from public.import_jobs j
        where j.sealed_at is not null and j.done_emitted_at is null
          and (
              select pg_catalog.count(*)
              from public.restaurant_completeness_queue q
              where q.job_id = j.job_id and q.state in ('verified','resolved','exhausted')
          ) = j.expected_items
        order by j.sealed_at, j.job_id
        for update skip locked
        limit pg_catalog.least(pg_catalog.greatest(coalesce(p_limit, 25), 1), 100)
    loop
        if public.fn_maybe_emit_import_done(v_job.job_id) then
            v_count := v_count + 1;
        end if;
    end loop;
    return v_count;
end;
$fn$;

create or replace function public.fn_retry_completeness_item(
    p_actor uuid,
    p_item_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
    update public.restaurant_completeness_queue
    set state = 'pending', attempts = 0, next_attempt_at = pg_catalog.now(),
        last_error = null, lease_owner = null, lease_token = null, lease_until = null,
        -- Terminal resolver decisions are terminal for BACKGROUND auto-retry,
        -- not an owner-requested retry. Removing only this server-copied marker
        -- lets the next claim re-evaluate while preserving the immutable
        -- resolution row and any transient known-id Details evidence.
        client_facts = case
            when client_facts->>'resolution_decision' in (
                'no_result','name_reject','locality_reject','ambiguous'
            ) then client_facts - 'resolution_decision'
            else client_facts
        end,
        updated_at = pg_catalog.now()
    where id = p_item_id and owner_id = p_actor and state = 'exhausted'
      and dismissed_at is null;
    return found;
end;
$fn$;

create or replace function public.fn_dismiss_completeness_item(
    p_actor uuid,
    p_item_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_item public.restaurant_completeness_queue%rowtype;
begin
    select * into v_item
    from public.restaurant_completeness_queue
    where id = p_item_id
      and owner_id = p_actor
      and state = 'exhausted'
      and dismissed_at is null
    for update;
    if not found then
        return false;
    end if;

    -- Dismissal is terminal-without-routing. Pending intents are retired in
    -- place; no side effect and no route-ledger acknowledgement is fabricated.
    update public.completeness_destinations
    set outcome = 'rejected'
    where owner_id = v_item.owner_id
      and job_id = v_item.job_id
      and item_nonce = v_item.item_nonce
      and outcome = 'pending';

    update public.restaurant_completeness_queue
    set dismissed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    where id = v_item.id
      and owner_id = p_actor
      and state = 'exhausted'
      and dismissed_at is null;
    return found;
end;
$fn$;

-- A manual picker correction heals the original durable item.  It never
-- writes destinations directly: the normal fenced claim/route/finalize path
-- owns those effects, so a stale client cannot duplicate them.  The existing
-- import_done notification remains an immutable snapshot and is not reopened.
create or replace function public.fn_correct_completeness_item(
    p_actor uuid,
    p_item_id uuid,
    p_resolution_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_item public.restaurant_completeness_queue%rowtype;
    v_job public.import_jobs%rowtype;
    v_resolution public.import_resolutions%rowtype;
    v_restaurant public.restaurants%rowtype;
    v_restaurant_id uuid;
    v_external_id text;
    v_client_facts jsonb;
    v_payload jsonb;
    v_item_hash text;
begin
    if p_actor is null or p_item_id is null or p_resolution_id is null then
        raise exception using errcode = '22023', message = 'actor, item, and resolution are required';
    end if;

    -- Hide foreign/non-exhausted rows from the owner surface. Lock order
    -- matches finalization: queue item first, then its job barrier row.
    select * into v_item
    from public.restaurant_completeness_queue
    where id = p_item_id and owner_id = p_actor and state = 'exhausted'
      and dismissed_at is null
    for update;
    if not found then
        return null;
    end if;

    select * into v_job
    from public.import_jobs
    where job_id = v_item.job_id and user_id = p_actor
    for update;
    if not found or v_job.protocol_generation is distinct from 'v2'
       or v_job.sealed_at is null
    then
        raise exception using errcode = '55000', message = 'correction requires a sealed v2 job';
    end if;

    -- The picker mints a new append-only match after the item becomes
    -- exhausted. Do not accept a prior-job, foreign, non-match, or stale row.
    select * into v_resolution
    from public.import_resolutions ir
    where ir.resolution_id = p_resolution_id
      and ir.user_id = p_actor
      and ir.import_nonce = v_job.import_nonce
      and ir.decision = 'matched'
      and ir.created_at >= v_item.updated_at;
    if not found then
        raise exception using errcode = '42501', message = 'correction resolution is not freshly bound to this item job';
    end if;
    if exists (
        select 1
        from public.restaurant_completeness_queue q
        where q.resolution_id = p_resolution_id
          and q.id <> p_item_id
    ) then
        raise exception using errcode = '23505', message = 'CORRECTION_RESOLUTION_REUSED';
    end if;
    v_external_id := nullif(pg_catalog.btrim(v_resolution.matched_external_id), '');
    if v_external_id is null then
        raise exception using errcode = '23514', message = 'matched correction has no external id';
    end if;

    v_restaurant_id := public.fn_resolve_canonical(v_item.restaurant_id);
    if v_restaurant_id is null then
        raise exception using errcode = '23503', message = 'correction item restaurant does not exist';
    end if;
    select * into v_restaurant
    from public.restaurants
    where id = v_restaurant_id
    for update;
    if not found or v_restaurant.merged_into is not null then
        raise exception using errcode = '40001', message = 'correction restaurant identity changed; retry';
    end if;

    -- Mirror enqueue/canonicalization reachability and reidentity rules. A
    -- verified global row is immutable and must already own this exact Place
    -- id. Only an actor-created unverified ghost/alias may take a new id.
    if not (
        (
            v_restaurant.verification = 'verified'
            and nullif(pg_catalog.btrim(v_restaurant.external_id), '') = v_external_id
        )
        or (
            v_restaurant.verification = 'unverified'
            and v_restaurant.created_by = p_actor
            and (
                nullif(pg_catalog.btrim(v_restaurant.external_id), '') = v_external_id
                or v_restaurant.external_id like 'ghost\_%' escape '\'
                or v_restaurant.external_id like 'merged\_%' escape '\'
            )
        )
    ) then
        raise exception using errcode = '42501', message = 'restaurant cannot be rebound to the corrected identity';
    end if;

    -- Direct resolver markers are server-copied hints for the superseded
    -- resolution. Remove them; the new matched external_id/resolution_id pair
    -- is now the sole effective authority. Preserve all advisory display facts.
    v_client_facts := coalesce(v_item.client_facts, '{}'::jsonb)
        - 'resolution_decision' - 'attempted_external_id';
    v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'restaurant_id', v_restaurant_id,
        'external_id', v_external_id,
        'resolution_id', p_resolution_id,
        'client_facts', v_client_facts
    ));
    v_item_hash := pg_catalog.encode(
        extensions.digest(v_payload::text, 'sha256'),
        'hex'
    );

    update public.restaurant_completeness_queue
    set item_hash = v_item_hash,
        restaurant_id = v_restaurant_id,
        external_id = v_external_id,
        resolution_id = p_resolution_id,
        client_facts = v_client_facts,
        state = 'pending',
        attempts = 0,
        next_attempt_at = pg_catalog.now(),
        lease_owner = null,
        lease_token = null,
        lease_until = null,
        last_error = null,
        updated_at = pg_catalog.now()
    where id = p_item_id and owner_id = p_actor and state = 'exhausted'
      and dismissed_at is null;
    if not found then
        raise exception using errcode = '40001', message = 'correction item changed; retry';
    end if;

    return pg_catalog.jsonb_build_object(
        'item_id', p_item_id,
        'job_id', v_item.job_id,
        'state', 'pending',
        'restaurant_id', v_restaurant_id,
        'external_id', v_external_id,
        'resolution_id', p_resolution_id
    );
end;
$fn$;

revoke all on function public.fn_sweep_stuck_jobs(integer)
    from public, anon, authenticated;
revoke all on function public.fn_retry_completeness_item(uuid, uuid)
    from public, anon, authenticated;
revoke all on function public.fn_dismiss_completeness_item(uuid, uuid)
    from public, anon, authenticated;
revoke all on function public.fn_correct_completeness_item(uuid, uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.fn_sweep_stuck_jobs(integer)
    to service_role;
grant execute on function public.fn_retry_completeness_item(uuid, uuid)
    to service_role;
grant execute on function public.fn_dismiss_completeness_item(uuid, uuid)
    to service_role;
grant execute on function public.fn_correct_completeness_item(uuid, uuid, uuid)
    to service_role;

-- ---------------------------------------------------------------------------
-- List alias-safe insertion and creator-only ghost repair
-- ---------------------------------------------------------------------------

create or replace function public.fn_add_list_entries_canonical(
    p_actor uuid,
    p_list_id uuid,
    p_restaurant_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_list public.lists%rowtype;
    v_input uuid;
    v_canonical uuid;
    v_position integer;
    v_entry public.list_entries%rowtype;
    v_added jsonb := '[]'::jsonb;
    v_added_count integer := 0;
    v_skipped_count integer := 0;
    v_entry_count integer;
begin
    if p_actor is null or p_list_id is null
       or p_restaurant_ids is null or pg_catalog.cardinality(p_restaurant_ids) < 1
       or pg_catalog.cardinality(p_restaurant_ids) > 100
    then
        raise exception using errcode = '22023', message = 'actor, list, and 1..100 restaurants are required';
    end if;
    if exists (
        select 1 from pg_catalog.unnest(p_restaurant_ids) as input_id(value)
        where input_id.value is null
    ) then
        raise exception using errcode = '22023', message = 'restaurant ids may not contain null';
    end if;

    -- Restaurant rows precede list/entry locks, matching canonicalization.
    perform 1 from public.restaurants r
    where r.id = any(p_restaurant_ids)
    order by r.id for update;
    if (
        select pg_catalog.count(distinct input_id.value)
        from pg_catalog.unnest(p_restaurant_ids) as input_id(value)
    ) <> (
        select pg_catalog.count(*) from public.restaurants r where r.id = any(p_restaurant_ids)
    ) then
        raise exception using errcode = '23503', message = 'one or more restaurants do not exist';
    end if;

    select * into v_list from public.lists where id = p_list_id for update;
    if not found then
        raise exception using errcode = '23503', message = 'list does not exist';
    end if;
    if v_list.owner_id <> p_actor then
        if v_list.table_id is null then
            raise exception using errcode = '42501', message = 'list write authority required';
        end if;
        perform 1 from public.table_members tm
        where tm.table_id = v_list.table_id and tm.member_id = p_actor
        for key share;
        if not found then
            raise exception using errcode = '42501', message = 'list write authority required';
        end if;
    end if;

    select coalesce(pg_catalog.max(position), 0) into v_position
    from public.list_entries where list_id = p_list_id;

    for v_input in
        select x from pg_catalog.unnest(p_restaurant_ids) with ordinality u(x, ord)
        group by x order by pg_catalog.min(ord)
    loop
        v_canonical := public.fn_resolve_canonical(v_input);
        if v_canonical is null then
            raise exception using errcode = '23503', message = 'restaurant disappeared during canonical resolution';
        end if;
        perform 1 from public.restaurants where id = v_canonical for update;
        v_canonical := public.fn_resolve_canonical(v_canonical);
        if not exists (
            select 1 from public.restaurants r
            where r.id = v_canonical and r.merged_into is null
        ) then
            raise exception using errcode = '40001', message = 'restaurant alias changed; retry';
        end if;

        v_position := v_position + 1024;
        insert into public.list_entries(list_id, restaurant_id, position, added_by)
        values (p_list_id, v_canonical, v_position, p_actor)
        on conflict (list_id, restaurant_id) do nothing
        returning * into v_entry;
        if found then
            v_added := v_added || pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(v_entry));
            v_added_count := v_added_count + 1;
        else
            v_position := v_position - 1024;
            v_skipped_count := v_skipped_count + 1;
        end if;
    end loop;

    select pg_catalog.count(*) into v_entry_count
    from public.list_entries where list_id = p_list_id;
    return pg_catalog.jsonb_build_object(
        'added', v_added,
        'added_count', v_added_count,
        'skipped_count', v_skipped_count,
        'entry_count', v_entry_count
    );
end;
$fn$;

create or replace function public.fn_repair_list_ghost(
    p_actor uuid,
    p_entry_id uuid,
    p_list_id uuid,
    p_replacement_external_id text,
    p_expected_version integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_entry public.list_entries%rowtype;
    v_list public.lists%rowtype;
    v_ghost public.restaurants%rowtype;
    v_replacement public.restaurants%rowtype;
begin
    select * into v_entry from public.list_entries
    where id = p_entry_id and list_id = p_list_id;
    if not found then
        raise exception using errcode = '23503', message = 'entry does not belong to supplied list';
    end if;
    select * into v_ghost from public.restaurants where id = v_entry.restaurant_id;
    select * into v_replacement from public.restaurants
    where external_id = pg_catalog.btrim(p_replacement_external_id)
      and verification = 'verified' and merged_into is null;
    if v_ghost.id is null or v_replacement.id is null then
        raise exception using errcode = '23503', message = 'ghost/replacement restaurant does not exist';
    end if;

    perform 1 from public.restaurants r
    where r.id in (v_ghost.id, v_replacement.id)
    order by r.id for update;
    select * into v_ghost from public.restaurants where id = v_ghost.id;
    select * into v_replacement from public.restaurants where id = v_replacement.id;
    if v_replacement.id is null
       or v_replacement.verification <> 'verified'
       or v_replacement.merged_into is not null
       or v_replacement.external_id is distinct from pg_catalog.btrim(p_replacement_external_id)
    then
        raise exception using errcode = '40001', message = 'replacement identity changed; retry';
    end if;

    select * into v_list from public.lists where id = p_list_id for update;
    select * into v_entry from public.list_entries
    where id = p_entry_id and list_id = p_list_id for update;
    if not found or v_entry.restaurant_id <> v_ghost.id then
        raise exception using errcode = '40001', message = 'repair target changed; retry';
    end if;
    if v_ghost.created_by is distinct from p_actor then
        raise exception using errcode = '42501', message = 'only the ghost creator may repair it';
    end if;
    if v_ghost.merged_into is not null or v_ghost.completeness_version <> p_expected_version then
        raise exception using errcode = '40001', message = 'COMPLETENESS_CAS_MISMATCH';
    end if;

    if v_list.owner_id <> p_actor then
        if v_list.table_id is null then
            raise exception using errcode = '42501', message = 'repair authority required';
        end if;
        perform 1 from public.table_members tm
        where tm.table_id = v_list.table_id and tm.member_id = p_actor
        for key share;
        if not found then
            raise exception using errcode = '42501', message = 'repair authority required';
        end if;
    end if;

    if not exists (
        select 1 from public.place_attestations pa
        where pa.place_id = pg_catalog.btrim(p_replacement_external_id)
          and pa.fetched_at > pg_catalog.now() - interval '24 hours'
    ) then
        raise exception using errcode = '42501', message = 'replacement is not freshly server-attested';
    end if;

    return public.fn_canonicalize_ghost(
        v_ghost.id, p_replacement_external_id, p_expected_version, 'list_repair'
    );
end;
$fn$;

revoke all on function public.fn_add_list_entries_canonical(uuid, uuid, uuid[])
    from public, anon, authenticated;
revoke all on function public.fn_repair_list_ghost(uuid, uuid, uuid, text, integer)
    from public, anon, authenticated;
grant execute on function public.fn_add_list_entries_canonical(uuid, uuid, uuid[])
    to service_role;
grant execute on function public.fn_repair_list_ghost(uuid, uuid, uuid, text, integer)
    to service_role;

-- ---------------------------------------------------------------------------
-- Dual-compatible save rollout.  Keep the old signature in this release.
-- ---------------------------------------------------------------------------

create or replace function public.fn_save_import_spot(
    p_user_id uuid,
    p_import_nonce uuid,
    p_client_nonce uuid,
    p_restaurant_id uuid default null,
    p_external_id text default null,
    p_restaurant_name text default null,
    p_restaurant_city text default null,
    p_source jsonb default null,
    p_note text default null,
    p_table_id uuid default null,
    p_table_client_nonce uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_job public.import_jobs%rowtype;
    v_restaurant_id uuid;
    v_wishlist_id uuid;
    v_share_id uuid;
    v_ghost_ext_id text;
    v_verification text;
    v_skip_wishlist boolean := false;
begin
    if p_user_id is null or p_import_nonce is null or p_client_nonce is null then
        return pg_catalog.jsonb_build_object('status','failed','error','missing legacy save identity');
    end if;

    -- The unique owner+import_nonce row is the protocol race lock.  Whichever
    -- generation first creates/binds it wins; the other observes a mismatch
    -- before any wishlist/Table side effect.
    insert into public.import_jobs(user_id, import_nonce, status, source, protocol_generation)
    values (p_user_id, p_import_nonce, 'resolved', p_source, 'legacy')
    on conflict (user_id, import_nonce) where import_nonce is not null do nothing;

    select * into v_job
    from public.import_jobs
    where user_id = p_user_id and import_nonce = p_import_nonce
    for update;
    if not found then
        return pg_catalog.jsonb_build_object('status','failed','error','could not create import job');
    end if;
    if v_job.protocol_generation is null then
        update public.import_jobs set protocol_generation = 'legacy' where job_id = v_job.job_id;
        v_job.protocol_generation := 'legacy';
    elsif v_job.protocol_generation <> 'legacy' then
        return pg_catalog.jsonb_build_object('status','failed','error','PROTOCOL_GENERATION_MISMATCH');
    end if;

    if p_restaurant_id is not null then
        select public.fn_resolve_canonical(r.id) into v_restaurant_id
        from public.restaurants r
        where r.id = p_restaurant_id
          and (r.verification = 'verified' or r.created_by = p_user_id);
        if v_restaurant_id is null then
            return pg_catalog.jsonb_build_object('status','failed','error','restaurant is not caller-reachable');
        end if;
    elsif nullif(pg_catalog.btrim(p_external_id), '') is not null
          and p_external_id <> 'ghost_pending' then
        insert into public.restaurants(external_id, name, city, verification)
        values (
            pg_catalog.btrim(p_external_id),
            coalesce(nullif(pg_catalog.btrim(p_restaurant_name), ''), 'Unknown restaurant'),
            nullif(pg_catalog.btrim(p_restaurant_city), ''), 'verified'
        )
        on conflict (external_id) do update
        set name = coalesce(excluded.name, public.restaurants.name),
            city = coalesce(excluded.city, public.restaurants.city)
        returning id into v_restaurant_id;
    else
        v_ghost_ext_id := 'ghost_' || p_user_id::text || '_' || p_client_nonce::text;
        insert into public.restaurants(external_id, name, city, verification, created_by)
        values (
            v_ghost_ext_id,
            coalesce(nullif(pg_catalog.btrim(p_restaurant_name), ''), 'Unknown restaurant'),
            nullif(pg_catalog.btrim(p_restaurant_city), ''), 'unverified', p_user_id
        )
        on conflict (external_id) do update
        set name = coalesce(excluded.name, public.restaurants.name),
            city = coalesce(excluded.city, public.restaurants.city)
        returning id into v_restaurant_id;
    end if;

    select verification into v_verification
    from public.restaurants where id = v_restaurant_id;
    select id into v_wishlist_id
    from public.wishlist_items
    where user_id = p_user_id and restaurant_id = v_restaurant_id and deleted_at is null
    limit 1;
    if found then
        if p_table_id is null then
            return pg_catalog.jsonb_build_object(
                'status','already_pinned','job_id',v_job.job_id,'restaurant_id',v_restaurant_id
            );
        end if;
        v_skip_wishlist := true;
    end if;

    if not v_skip_wishlist then
        update public.wishlist_items
        set deleted_at = null, job_id = v_job.job_id, source = p_source,
            note = coalesce(p_note, note), client_nonce = p_client_nonce,
            extraction_status = 'resolved'
        where user_id = p_user_id and restaurant_id = v_restaurant_id and deleted_at is not null
        returning id into v_wishlist_id;
        if v_wishlist_id is null then
            insert into public.wishlist_items(
                user_id, restaurant_id, job_id, extraction_status, source, note, client_nonce
            ) values (
                p_user_id, v_restaurant_id, v_job.job_id, 'resolved', p_source, p_note, p_client_nonce
            )
            on conflict (user_id, client_nonce) where client_nonce is not null and deleted_at is null
            do nothing returning id into v_wishlist_id;
            if v_wishlist_id is null then
                select id into v_wishlist_id from public.wishlist_items
                where user_id = p_user_id and client_nonce = p_client_nonce and deleted_at is null;
            end if;
        end if;
    end if;

    if p_table_id is not null then
        if v_verification is distinct from 'verified' then
            return pg_catalog.jsonb_build_object(
                'status',case when v_skip_wishlist then 'already_pinned' else 'saved' end,
                'job_id',v_job.job_id,'wishlist_id',v_wishlist_id,
                'share_id',null,'restaurant_id',v_restaurant_id
            );
        end if;
        if not exists (
            select 1 from public.table_members tm
            where tm.table_id = p_table_id and tm.member_id = p_user_id
        ) then
            raise exception using errcode = '42501', message = 'NOT_A_MEMBER';
        end if;
        insert into public.table_shares(
            job_id, table_id, author_id, restaurant_id, extraction_status,
            source, note, client_nonce
        ) values (
            v_job.job_id, p_table_id, p_user_id, v_restaurant_id, 'resolved',
            p_source, p_note, p_table_client_nonce
        )
        on conflict (author_id, table_id, client_nonce) where client_nonce is not null
        do nothing returning id into v_share_id;
        if v_share_id is null and p_table_client_nonce is not null then
            select id into v_share_id from public.table_shares
            where author_id = p_user_id and table_id = p_table_id
              and client_nonce = p_table_client_nonce;
        end if;
    end if;

    return pg_catalog.jsonb_build_object(
        'status',case when v_skip_wishlist then 'already_pinned' else 'saved' end,
        'job_id',v_job.job_id,'wishlist_id',v_wishlist_id,'share_id',v_share_id,
        'restaurant_id',v_restaurant_id
    );
exception when others then
    return pg_catalog.jsonb_build_object('status','failed','error',sqlerrm);
end;
$fn$;

-- Added p_resolution_id is REQUIRED/non-default and precedes every defaulted
-- argument.  This avoids PostgREST overload ambiguity while retaining the exact
-- old signature until the later cleanup release.
create function public.fn_save_import_spot(
    p_user_id uuid,
    p_import_nonce uuid,
    p_client_nonce uuid,
    p_resolution_id uuid,
    p_restaurant_id uuid default null,
    p_external_id text default null,
    p_restaurant_name text default null,
    p_restaurant_city text default null,
    p_source jsonb default null,
    p_note text default null,
    p_table_id uuid default null,
    p_table_client_nonce uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_resolution public.import_resolutions%rowtype;
    v_target_external_id text;
begin
    if p_resolution_id is not null then
        select * into v_resolution
        from public.import_resolutions ir
        where ir.resolution_id = p_resolution_id
          and ir.user_id = p_user_id
          and (ir.import_nonce is null or ir.import_nonce = p_import_nonce);
        if not found then
            return pg_catalog.jsonb_build_object('status','failed','error','resolution is not bound to caller');
        end if;

        if v_resolution.decision = 'matched' then
            if nullif(pg_catalog.btrim(p_external_id), '') is not null
               and pg_catalog.btrim(p_external_id) is distinct from v_resolution.matched_external_id
            then
                return pg_catalog.jsonb_build_object('status','failed','error','resolution external id mismatch');
            end if;
            if p_restaurant_id is not null then
                select c.external_id into v_target_external_id
                from public.restaurants supplied
                join public.restaurants c
                  on c.id = public.fn_resolve_canonical(supplied.id)
                 and c.merged_into is null
                where supplied.id = p_restaurant_id
                  and (supplied.verification = 'verified' or supplied.created_by = p_user_id);
                if not found
                   or nullif(pg_catalog.btrim(v_target_external_id), '')
                      is distinct from v_resolution.matched_external_id
                then
                    return pg_catalog.jsonb_build_object('status','failed','error','resolution restaurant mismatch');
                end if;
            elsif nullif(pg_catalog.btrim(p_external_id), '') is null then
                return pg_catalog.jsonb_build_object('status','failed','error','matched resolution requires its bound restaurant identity');
            end if;
        elsif nullif(pg_catalog.btrim(p_external_id), '') is not null
              or p_restaurant_id is not null
        then
            return pg_catalog.jsonb_build_object('status','failed','error','non-match resolution cannot authorize a restaurant identity');
        end if;
    end if;
    return public.fn_save_import_spot(
        p_user_id, p_import_nonce, p_client_nonce, p_restaurant_id,
        p_external_id, p_restaurant_name, p_restaurant_city, p_source,
        p_note, p_table_id, p_table_client_nonce
    );
end;
$fn$;

revoke all on function public.fn_save_import_spot(
    uuid, uuid, uuid, uuid, text, text, text, jsonb, text, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.fn_save_import_spot(
    uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.fn_save_import_spot(
    uuid, uuid, uuid, uuid, text, text, text, jsonb, text, uuid, uuid
) to service_role;
grant execute on function public.fn_save_import_spot(
    uuid, uuid, uuid, uuid, uuid, text, text, text, jsonb, text, uuid, uuid
) to service_role;
