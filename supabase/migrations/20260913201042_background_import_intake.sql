begin;

-- Pre-review work, deliberately separate from accepted import_jobs/destinations.
create table public.background_import_credentials (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    session_id uuid not null references auth.sessions(id) on delete cascade,
    installation_id uuid not null,
    token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '90 days',
    revoked_at timestamptz
);
create index background_import_credentials_owner on public.background_import_credentials(user_id, installation_id);

create table public.background_import_jobs (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    import_nonce uuid not null,
    installation_id uuid,
    request jsonb not null check (jsonb_typeof(request) = 'object'),
    status text not null default 'pending' check (status in
        ('pending','processing','ready','needs_device','failed','dismissed','acknowledged')),
    response jsonb,
    notification_enqueued_at timestamptz,
    notification_attempt_at timestamptz,
    reason text,
    attempts integer not null default 0 check (attempts between 0 and 3),
    next_attempt_at timestamptz not null default now(),
    lease_token uuid,
    lease_until timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(user_id, import_nonce),
    check ((status = 'processing') = (lease_token is not null and lease_until is not null))
);
create index background_import_jobs_due on public.background_import_jobs(next_attempt_at, created_at)
    where status in ('pending','processing');
create index background_import_jobs_owner on public.background_import_jobs(user_id, created_at desc, id);
create index background_import_jobs_notice_due on public.background_import_jobs(notification_attempt_at nulls first, created_at)
    where status = 'ready' and notification_enqueued_at is null;

alter table public.background_import_credentials enable row level security;
alter table public.background_import_jobs enable row level security;
revoke all on public.background_import_credentials, public.background_import_jobs from public, anon, authenticated;
grant all on public.background_import_credentials, public.background_import_jobs to service_role;

-- Internal only. A per-owner advisory lock serializes dedup and admission.
create function public.fn_enqueue_background_import(
    p_owner uuid, p_job_id uuid, p_import_nonce uuid, p_request jsonb,
    p_credential_id uuid default null, p_installation_id uuid default null
) returns public.background_import_jobs
language plpgsql set search_path = public, pg_temp as $$
declare
    v_job public.background_import_jobs;
    v_allowed boolean;
    v_installation_id uuid := p_installation_id;
begin
    perform pg_advisory_xact_lock(hashtextextended('background-import:' || p_owner::text, 0));
    if p_credential_id is not null then
        select installation_id into v_installation_id from public.background_import_credentials
        where id = p_credential_id and user_id = p_owner
          and revoked_at is null and expires_at > now() for share;
        if not found then raise exception 'INTAKE_REVOKED' using errcode = '42501'; end if;
    end if;
    select * into v_job from public.background_import_jobs
    where id = p_job_id or (user_id = p_owner and import_nonce = p_import_nonce)
    for update;
    if found then
        if v_job.user_id <> p_owner then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
        if v_job.id <> p_job_id or v_job.import_nonce <> p_import_nonce or v_job.request <> p_request then
            raise exception 'NONCE_REUSE' using errcode = '23505';
        end if;
        return v_job;
    end if;
    select allowed into v_allowed from public.check_and_increment_rate_limit(p_owner, 'background_import', 30, 3600);
    if v_allowed is not true then raise exception 'IMPORT_RATE_LIMITED' using errcode = 'P0001'; end if;
    if (select count(*) from public.background_import_jobs where user_id = p_owner
        and status not in ('dismissed','acknowledged')) >= 100 then
        raise exception 'IMPORT_QUEUE_FULL' using errcode = 'P0001';
    end if;
    insert into public.background_import_jobs(id,user_id,import_nonce,request,installation_id)
    values(p_job_id,p_owner,p_import_nonce,p_request,v_installation_id) returning * into v_job;
    return v_job;
end;
$$;

create function public.fn_claim_background_imports(p_job_id uuid default null, p_limit integer default 2)
returns setof public.background_import_jobs language plpgsql set search_path = public, pg_temp as $$
begin
    -- A dead third attempt is terminal, never stuck indefinitely in processing.
    update public.background_import_jobs set status='failed',reason='processing_failed',
        lease_token=null,lease_until=null,updated_at=now()
    where status='processing' and lease_until <= now() and attempts >= 3;
    return query
    with due as (
        select id from public.background_import_jobs
        where (p_job_id is null or id = p_job_id) and attempts < 3
          and ((status='pending' and next_attempt_at <= now())
            or (status='processing' and lease_until <= now()))
        order by created_at, id for update skip locked
        limit greatest(1,least(coalesce(p_limit,2),5))
    )
    update public.background_import_jobs j
    set status='processing',attempts=j.attempts+1,lease_token=gen_random_uuid(),
        lease_until=now()+interval '120 seconds',updated_at=now()
    from due where j.id=due.id returning j.*;
end;
$$;

create function public.fn_finish_background_import(
    p_job_id uuid, p_lease_token uuid, p_status text, p_response jsonb default null,
    p_reason text default null, p_retry_seconds integer default 30
) returns boolean language plpgsql set search_path = public, pg_temp as $$
begin
    if p_status not in ('pending','ready','needs_device','failed') then
        raise exception 'INVALID_STATUS';
    end if;
    if p_status='ready' and (p_response is null or
        jsonb_typeof(p_response->'candidates') is distinct from 'array' or
        jsonb_array_length(p_response->'candidates') not between 1 and 20) then
        raise exception 'INVALID_READY_RESULT';
    end if;
    update public.background_import_jobs
    set status=case when p_status='pending' and attempts>=3 then 'failed' else p_status end,
        response=case when p_status='ready' then p_response else null end,
        reason=left(p_reason,100),lease_token=null,lease_until=null,updated_at=now(),
        next_attempt_at=now()+make_interval(secs=>greatest(5,least(coalesce(p_retry_seconds,30),3600)))
    where id=p_job_id and status='processing' and lease_token=p_lease_token and lease_until>now();
    return found;
end;
$$;

-- Cancel-before-acceptance must leave a server tombstone. A background URLSession
-- upload may arrive later even after the app has dismissed the local import.
create function public.fn_dismiss_background_import(
    p_owner uuid, p_job_id uuid, p_import_nonce uuid default null, p_request jsonb default null
) returns boolean language plpgsql set search_path = public, pg_temp as $$
declare v_job public.background_import_jobs; v_allowed boolean;
begin
    perform pg_advisory_xact_lock(hashtextextended('background-import:' || p_owner::text, 0));
    select * into v_job from public.background_import_jobs where id=p_job_id for update;
    if found then
        if v_job.user_id<>p_owner then return false; end if;
        update public.background_import_jobs set status='dismissed',response=null,
            lease_token=null,lease_until=null,updated_at=now() where id=p_job_id;
        return true;
    end if;
    if p_import_nonce is null or p_request is null then return false; end if;
    select allowed into v_allowed from public.check_and_increment_rate_limit(p_owner,'background_import_dismiss',120,3600);
    if v_allowed is not true then raise exception 'IMPORT_RATE_LIMITED'; end if;
    insert into public.background_import_jobs(id,user_id,import_nonce,request,status)
    values(p_job_id,p_owner,p_import_nonce,p_request,'dismissed');
    return true;
end;
$$;

revoke all on function public.fn_enqueue_background_import(uuid,uuid,uuid,jsonb,uuid,uuid) from public,anon,authenticated;
revoke all on function public.fn_claim_background_imports(uuid,integer) from public,anon,authenticated;
revoke all on function public.fn_finish_background_import(uuid,uuid,text,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.fn_enqueue_background_import(uuid,uuid,uuid,jsonb,uuid,uuid) to service_role;
grant execute on function public.fn_claim_background_imports(uuid,integer) to service_role;
grant execute on function public.fn_finish_background_import(uuid,uuid,text,jsonb,text,integer) to service_role;
revoke all on function public.fn_dismiss_background_import(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fn_dismiss_background_import(uuid,uuid,uuid,jsonb) to service_role;

commit;
