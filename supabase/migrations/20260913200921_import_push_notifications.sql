-- Import-only push. Device tokens and delivery receipts are service-role data.
-- Session revocation deactivates the token while retaining its stale-write fence.
begin;
create table public.import_push_devices (
    installation_id uuid primary key,
    secret_hash text not null check (secret_hash ~ '^[a-f0-9]{64}$'),
    user_id uuid not null references auth.users(id) on delete cascade,
    session_id uuid references auth.sessions(id) on delete set null,
    expo_push_token text unique,
    registration_revision bigint not null default 0 check (registration_revision >= 0),
    updated_at timestamptz not null default now()
);
alter table public.import_push_devices enable row level security;
revoke all on public.import_push_devices from public, anon, authenticated;
grant all on public.import_push_devices to service_role;
create index import_push_devices_user_idx on public.import_push_devices(user_id);

create table public.import_push_deliveries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    job_id uuid not null,
    installation_id uuid not null references public.import_push_devices(installation_id) on delete cascade,
    ready_count integer not null check (ready_count > 0 and ready_count <= 1000),
    status text not null default 'pending' check (status in ('pending','sending','ticketed','delivered','failed','cancelled')),
    attempts integer not null default 0,
    next_attempt_at timestamptz not null default now(),
    locked_at timestamptz,
    ticket_id text,
    sent_token text,
    last_error text,
    created_at timestamptz not null default now(),
    unique(job_id, installation_id)
);
alter table public.import_push_deliveries enable row level security;
revoke all on public.import_push_deliveries from public, anon, authenticated;
grant all on public.import_push_deliveries to service_role;
create index import_push_deliveries_due_idx on public.import_push_deliveries(next_attempt_at)
    where status in ('pending','sending','ticketed');

-- Verified JWT owner/session are supplied by notifications, never by the client.
-- A secret is required to reassign an installation to a different account.
create function public.fn_register_import_push_device(
    p_installation_id uuid, p_secret_hash text, p_user_id uuid,
    p_session_id uuid, p_expo_push_token text, p_registration_revision bigint
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_existing public.import_push_devices;
begin
    if p_registration_revision is null or p_registration_revision<1 or p_session_id is null or p_secret_hash !~ '^[a-f0-9]{64}$' or
       p_expo_push_token !~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$'
    then return false; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_expo_push_token, 1));
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_installation_id::text, 2));
    select * into v_existing from public.import_push_devices
        where installation_id = p_installation_id for update;
    if found and v_existing.secret_hash <> p_secret_hash then return false; end if;
    if found and v_existing.registration_revision >= p_registration_revision then
        return coalesce(v_existing.registration_revision=p_registration_revision
            and v_existing.user_id=p_user_id and v_existing.session_id=p_session_id
            and v_existing.expo_push_token=p_expo_push_token,false);
    end if;
    -- A token can survive reinstall while local storage does not. Possession of
    -- that unguessable Expo token registers this installation, and unlinks the old.
    update public.import_push_devices set expo_push_token=null,session_id=null,
        registration_revision=registration_revision+1,updated_at=now()
        where expo_push_token=p_expo_push_token and installation_id<>p_installation_id;
    delete from public.import_push_deliveries
        where installation_id = p_installation_id and user_id <> p_user_id;
    insert into public.import_push_devices(installation_id,secret_hash,user_id,session_id,expo_push_token,registration_revision)
    values(p_installation_id,p_secret_hash,p_user_id,p_session_id,p_expo_push_token,p_registration_revision)
    on conflict(installation_id) do update set user_id=excluded.user_id,
        session_id=excluded.session_id,expo_push_token=excluded.expo_push_token,
        registration_revision=excluded.registration_revision,updated_at=now();
    return true;
end $$;
revoke all on function public.fn_register_import_push_device(uuid,text,uuid,uuid,text,bigint) from public, anon, authenticated;
grant execute on function public.fn_register_import_push_device(uuid,text,uuid,uuid,text,bigint) to service_role;

-- A revocation tombstone must exist even when the timed-out registration has not
-- arrived yet. Otherwise its late request could silently recreate the device.
create function public.fn_revoke_import_push_device(
    p_installation_id uuid,p_secret_hash text,p_user_id uuid,p_registration_revision bigint
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_existing public.import_push_devices;
begin
    if p_registration_revision is null or p_registration_revision<1 or p_secret_hash !~ '^[a-f0-9]{64}$' then return false; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_installation_id::text, 2));
    select * into v_existing from public.import_push_devices where installation_id=p_installation_id for update;
    if found and (v_existing.secret_hash<>p_secret_hash or v_existing.user_id<>p_user_id) then return false; end if;
    if found and v_existing.registration_revision>=p_registration_revision then
        return v_existing.registration_revision=p_registration_revision and v_existing.session_id is null;
    end if;
    insert into public.import_push_devices(installation_id,secret_hash,user_id,registration_revision)
    values(p_installation_id,p_secret_hash,p_user_id,p_registration_revision)
    on conflict(installation_id) do update set session_id=null,expo_push_token=null,
        registration_revision=excluded.registration_revision,updated_at=now();
    delete from public.import_push_deliveries where installation_id=p_installation_id;
    return true;
end $$;
revoke all on function public.fn_revoke_import_push_device(uuid,text,uuid,bigint) from public, anon, authenticated;
grant execute on function public.fn_revoke_import_push_device(uuid,text,uuid,bigint) to service_role;

create function public.fn_claim_import_push_deliveries(p_limit integer default 25)
returns setof jsonb language plpgsql security invoker set search_path = '' as $$
begin
    update public.import_push_deliveries d set status='cancelled',locked_at=null
        where d.status in ('pending','sending','ticketed') and exists(
            select 1 from public.import_push_devices v where v.installation_id=d.installation_id and v.session_id is null);
    update public.import_push_deliveries set status='failed',locked_at=null,last_error='RETRY_LIMIT'
        where status='sending' and attempts>=8 and locked_at<now()-interval '5 minutes';
    -- An abandoned send is retried with the same collapse identifier. Expo does
    -- not offer exactly-once send, so a transport ambiguity can still duplicate.
    return query
    with picked as (
        select d.id from public.import_push_deliveries d
        join public.import_push_devices v on v.installation_id=d.installation_id and v.user_id=d.user_id
        where v.session_id is not null and v.expo_push_token is not null
          and ((d.status in ('pending','ticketed') and d.next_attempt_at<=now())
            or (d.status='sending' and d.locked_at<now()-interval '5 minutes'))
          and d.attempts<8
        order by d.next_attempt_at,d.id
        for update of d skip locked limit greatest(1,least(coalesce(p_limit,25),100))
    ), claimed as (
        update public.import_push_deliveries d set status='sending',locked_at=now(),attempts=attempts+1
        from picked where d.id=picked.id returning d.*
    )
    select to_jsonb(c)||jsonb_build_object('expo_push_token',v.expo_push_token)
    from claimed c join public.import_push_devices v
        on v.installation_id=c.installation_id and v.user_id=c.user_id;
end $$;
revoke all on function public.fn_claim_import_push_deliveries(integer) from public, anon, authenticated;
grant execute on function public.fn_claim_import_push_deliveries(integer) to service_role;
commit;
