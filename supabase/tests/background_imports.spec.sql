-- Owner privacy, idempotency and stale-work fencing for pre-review imports.
-- Hermetic: run against the disposable replay DB, never production.
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/background_imports.spec.sql
begin;

do $privileges$
declare
    v_role text;
    v_table text;
    v_function text;
begin
    foreach v_table in array array['background_import_credentials','background_import_jobs'] loop
        assert (select relrowsecurity from pg_class where oid=('public.'||v_table)::regclass),
            'background import tables must have RLS enabled';
        foreach v_role in array array['anon','authenticated'] loop
            assert not has_table_privilege(v_role,'public.'||v_table,'SELECT,INSERT,UPDATE,DELETE'),
                format('%s has direct access to %s',v_role,v_table);
        end loop;
        assert has_table_privilege('service_role','public.'||v_table,'SELECT,INSERT,UPDATE,DELETE'),
            'service role must be able to operate the queue';
    end loop;
    foreach v_function in array array[
        'public.fn_enqueue_background_import(uuid,uuid,uuid,jsonb,uuid,uuid)',
        'public.fn_claim_background_imports(uuid,integer)',
        'public.fn_finish_background_import(uuid,uuid,text,jsonb,text,integer)',
        'public.fn_dismiss_background_import(uuid,uuid,uuid,jsonb)'
    ] loop
        foreach v_role in array array['anon','authenticated'] loop
            assert not has_function_privilege(v_role,v_function,'EXECUTE'),
                format('%s can call internal queue RPC %s',v_role,v_function);
        end loop;
        assert has_function_privilege('service_role',v_function,'EXECUTE');
        assert not (select prosecdef from pg_proc where oid=v_function::regprocedure),
            'queue RPCs must remain invoker functions';
    end loop;
end;
$privileges$;

set local role anon;
do $anon$
declare denied boolean := false;
begin
    begin perform public.fn_claim_background_imports();
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'anon must not claim paid work';
end;
$anon$;
reset role;
set local role authenticated;
do $authenticated$
declare denied boolean := false;
begin
    begin perform public.fn_claim_background_imports();
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'authenticated must not claim another owner work';
end;
$authenticated$;
reset role;

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('b9130000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','background-owner-a@example.invalid','{}','{}',now(),now()),
('b9130000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','background-owner-b@example.invalid','{}','{}',now(),now());

insert into auth.sessions(id,user_id,created_at,updated_at) values
('b9130000-0000-4000-8000-000000000041','b9130000-0000-4000-8000-000000000001',now(),now()),
('b9130000-0000-4000-8000-000000000042','b9130000-0000-4000-8000-000000000002',now(),now());
insert into public.background_import_credentials(id,user_id,session_id,installation_id,token_hash,expires_at,revoked_at)
select credential_id,owner_id,session_id,'b9130000-0000-4000-8000-000000000051'::uuid,
    repeat(token_letter,64),expires_at,revoked_at
from (values
('b9130000-0000-4000-8000-000000000031'::uuid,'b9130000-0000-4000-8000-000000000001'::uuid,
 'b9130000-0000-4000-8000-000000000041'::uuid,'a',now()+interval '1 day',null::timestamptz),
('b9130000-0000-4000-8000-000000000032'::uuid,'b9130000-0000-4000-8000-000000000002'::uuid,
 'b9130000-0000-4000-8000-000000000042'::uuid,'b',now()+interval '1 day',null::timestamptz),
('b9130000-0000-4000-8000-000000000033'::uuid,'b9130000-0000-4000-8000-000000000001'::uuid,
 'b9130000-0000-4000-8000-000000000041'::uuid,'c',now()-interval '1 second',null::timestamptz),
('b9130000-0000-4000-8000-000000000034'::uuid,'b9130000-0000-4000-8000-000000000001'::uuid,
 'b9130000-0000-4000-8000-000000000041'::uuid,'d',now()+interval '1 day',now())
) as fixtures(credential_id,owner_id,session_id,token_letter,expires_at,revoked_at);

-- Execute queue functions as the actual backend role, not the fixture superuser.
set local role service_role;
do $queue$
declare
    owner_a uuid := 'b9130000-0000-4000-8000-000000000001';
    owner_b uuid := 'b9130000-0000-4000-8000-000000000002';
    job_a uuid := 'b9130000-0000-4000-8000-000000000011';
    job_b uuid := 'b9130000-0000-4000-8000-000000000012';
    nonce_a uuid := 'b9130000-0000-4000-8000-000000000021';
    nonce_b uuid := 'b9130000-0000-4000-8000-000000000022';
    input jsonb := '{"url":"https://www.tiktok.com/@chef/video/123","protocol_generation":"v2"}';
    first_job public.background_import_jobs;
    repeated public.background_import_jobs;
    claimed public.background_import_jobs;
    newer public.background_import_jobs;
    old_lease uuid;
    denied boolean;
    count_rows integer;
    credential_id uuid;
begin
    foreach credential_id in array array[
        'b9130000-0000-4000-8000-000000000032'::uuid,
        'b9130000-0000-4000-8000-000000000033'::uuid,
        'b9130000-0000-4000-8000-000000000034'::uuid
    ] loop
        denied := false;
        begin perform public.fn_enqueue_background_import(owner_a,job_a,nonce_a,input,credential_id);
        exception when insufficient_privilege then denied := true; end;
        assert denied, 'foreign, expired or revoked credentials cannot enqueue work';
    end loop;
    first_job := public.fn_enqueue_background_import(owner_a,job_a,nonce_a,input,
        'b9130000-0000-4000-8000-000000000031');
    repeated := public.fn_enqueue_background_import(owner_a,job_a,nonce_a,input);
    assert first_job.installation_id='b9130000-0000-4000-8000-000000000051'::uuid, 'origin installation must come from the credential';
    assert first_job.id = repeated.id and repeated.status='pending' and repeated.attempts=0,
        'an ambiguous network retry must reuse one pending job';
    assert (select count(*) from public.background_import_jobs where user_id=owner_a)=1;
    assert (select sum(count) from public.rate_limit_buckets where user_id=owner_a and bucket_key='background_import')=1,
        'ambiguous retries must not consume a second admission';

    denied := false;
    begin perform public.fn_enqueue_background_import(owner_b,job_a,nonce_a,input);
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'cross-owner job-id collision must not disclose or reuse the job';

    denied := false;
    begin perform public.fn_enqueue_background_import(owner_a,job_a,nonce_a,
        '{"url":"https://example.invalid/changed","protocol_generation":"v2"}');
    exception when unique_violation then denied := true; end;
    assert denied, 'a reused nonce cannot change the source';

    denied := false;
    begin perform public.fn_enqueue_background_import(owner_a,job_b,nonce_a,input);
    exception when unique_violation then denied := true; end;
    assert denied, 'same owner/nonce cannot mint a second job id';

    -- The same nonce in a different account is an independent import.
    repeated := public.fn_enqueue_background_import(owner_b,job_b,nonce_a,input);
    assert repeated.user_id=owner_b and repeated.id=job_b;

    select * into claimed from public.fn_claim_background_imports(job_a,1);
    assert claimed.status='processing' and claimed.attempts=1
        and claimed.lease_token is not null and claimed.lease_until>now();
    select count(*) into count_rows from public.fn_claim_background_imports(job_a,1);
    assert count_rows=0, 'a live lease must prevent a duplicate worker';
    assert not public.fn_finish_background_import(job_a,nonce_b,'ready','{"candidates":[{}]}'),
        'a foreign lease must not commit results';

    old_lease := claimed.lease_token;
    update public.background_import_jobs set lease_until=now()-interval '1 second' where id=job_a;
    assert not public.fn_finish_background_import(job_a,old_lease,'ready','{"candidates":[{}]}'),
        'expired work must not commit even before another claim';
    select * into newer from public.fn_claim_background_imports(job_a,1);
    assert newer.attempts=2 and newer.lease_token<>old_lease;
    assert not public.fn_finish_background_import(job_a,old_lease,'ready','{"candidates":[{}]}'),
        'reclaimed work must fence the prior worker';

    assert public.fn_finish_background_import(job_a,newer.lease_token,'pending',null,'upstream',30);
    assert (select status='pending' and response is null and lease_token is null
        and lease_until is null and next_attempt_at>now() from public.background_import_jobs where id=job_a);
    select count(*) into count_rows from public.fn_claim_background_imports(job_a,1);
    assert count_rows=0, 'retry backoff must prevent immediate paid replay';
    update public.background_import_jobs set next_attempt_at=now()-interval '1 second' where id=job_a;
    select * into claimed from public.fn_claim_background_imports(job_a,1);
    assert claimed.attempts=3;
    assert public.fn_finish_background_import(job_a,claimed.lease_token,'pending',null,'upstream',30);
    assert (select status='failed' and attempts=3 and lease_token is null from public.background_import_jobs where id=job_a),
        'third failed attempt must be terminal';
    select count(*) into count_rows from public.fn_claim_background_imports(job_a,1);
    assert count_rows=0, 'terminal failures must not spend again';

    -- User dismissal clears its lease; a late result cannot resurrect the job.
    select * into claimed from public.fn_claim_background_imports(job_b,1);
    update public.background_import_jobs set status='dismissed',lease_token=null,lease_until=null where id=job_b;
    assert not public.fn_finish_background_import(job_b,claimed.lease_token,'ready','{"candidates":[{}]}');
    assert (select status='dismissed' and response is null from public.background_import_jobs where id=job_b);

    -- Completion validation cannot store empty or oversized ready payloads.
    repeated := public.fn_enqueue_background_import(owner_a,gen_random_uuid(),nonce_b,input);
    select * into claimed from public.fn_claim_background_imports(repeated.id,1);
    denied := false;
    begin perform public.fn_finish_background_import(repeated.id,claimed.lease_token,'ready','{"candidates":[]}');
    exception when raise_exception then denied := true; end;
    assert denied, 'empty ready response must be refused';
    denied := false;
    begin perform public.fn_finish_background_import(repeated.id,claimed.lease_token,'ready',
        jsonb_build_object('candidates',(select jsonb_agg('{}'::jsonb) from generate_series(1,21))));
    exception when raise_exception then denied := true; end;
    assert denied, 'ready response must not exceed the 20-candidate review cap';
    assert public.fn_finish_background_import(repeated.id,claimed.lease_token,'ready','{"candidates":[{"resolution_id":"test-proof"}]}');
    assert (select status='ready' and response->'candidates'->0->>'resolution_id'='test-proof'
        from public.background_import_jobs where id=repeated.id);
    assert not public.fn_finish_background_import(repeated.id,claimed.lease_token,'pending'),
        'completed work cannot be overwritten by a second finish';

    -- A third attempt killed by the runtime is rescued into terminal failure.
    repeated := public.fn_enqueue_background_import(owner_b,gen_random_uuid(),nonce_b,input);
    update public.background_import_jobs set status='processing',attempts=3,
        lease_token=gen_random_uuid(),lease_until=now()-interval '1 second' where id=repeated.id;
    perform public.fn_claim_background_imports(repeated.id,1);
    assert (select status='failed' and lease_token is null and lease_until is null
        from public.background_import_jobs where id=repeated.id),
        'expired third attempt must not remain stuck in processing';

    -- Cancellation can precede acceptance of the OS-owned upload.
    old_lease := gen_random_uuid();
    credential_id := gen_random_uuid();
    assert public.fn_dismiss_background_import(owner_a, old_lease, credential_id, input);
    repeated := public.fn_enqueue_background_import(owner_a, old_lease, credential_id, input);
    assert repeated.status='dismissed' and repeated.attempts=0,
        'a delayed upload must reuse the cancellation tombstone, not resurrect work';
    select count(*) into count_rows from public.fn_claim_background_imports(old_lease,1);
    assert count_rows=0, 'cancel-before-enqueue must never spend';
    assert not public.fn_dismiss_background_import(owner_b, old_lease, credential_id, input),
        'another owner cannot cancel or take over a known job';
    assert not public.fn_dismiss_background_import(owner_a, gen_random_uuid()),
        'absent jobs require original capture identity before local tombstone cleanup';

    -- Preparing results never pins, logs, or shares a restaurant.
    assert not exists(select 1 from public.wishlist_items where user_id in (owner_a,owner_b));
    assert not exists(select 1 from public.import_jobs where user_id in (owner_a,owner_b));
end;
$queue$;
reset role;

-- TICKET-249: no worker leases jobs any more. The owner's `status` read in
-- background-imports/index.ts hands a pending or processing job to its device
-- with the statement below; keep the two in step.
set local role service_role;
do $handoff$
declare
    owner_a uuid := 'b9130000-0000-4000-8000-000000000001';
    owner_b uuid := 'b9130000-0000-4000-8000-000000000002';
    input jsonb := '{"url":"https://www.tiktok.com/@chef/video/456","protocol_generation":"v2"}';
    job public.background_import_jobs;
    claimed public.background_import_jobs;
    terminal text;
    handed integer;
begin
    -- A pending job becomes needs_device.
    job := public.fn_enqueue_background_import(owner_a,gen_random_uuid(),gen_random_uuid(),input);
    update public.background_import_jobs set status='needs_device',reason='device_owns_import',
        lease_token=null,lease_until=null,updated_at=now()
    where id=job.id and user_id=owner_a and status in ('pending','processing');
    get diagnostics handed = row_count;
    assert handed=1 and (select status='needs_device' and reason='device_owns_import'
        and lease_token is null and lease_until is null from public.background_import_jobs where id=job.id),
        'a pending job must be handed to its device';
    -- A late upload of the same capture keeps the handed-over job.
    assert (public.fn_enqueue_background_import(owner_a,job.id,job.import_nonce,input)).status='needs_device',
        'a delayed extension upload must not reopen a handed-over job';
    -- Dismissal after the handoff still tombstones it.
    assert public.fn_dismiss_background_import(owner_a,job.id);
    assert (select status='dismissed' from public.background_import_jobs where id=job.id);

    -- Another owner's read changes nothing.
    job := public.fn_enqueue_background_import(owner_b,gen_random_uuid(),gen_random_uuid(),input);
    update public.background_import_jobs set status='needs_device',reason='device_owns_import',
        lease_token=null,lease_until=null,updated_at=now()
    where id=job.id and user_id=owner_a and status in ('pending','processing');
    get diagnostics handed = row_count;
    assert handed=0 and (select status='pending' from public.background_import_jobs where id=job.id),
        'a status read must only hand over the caller''s own job';

    -- A live lease from a worker deployed before this change: the handoff wins
    -- and that worker's later finish is refused.
    job := public.fn_enqueue_background_import(owner_a,gen_random_uuid(),gen_random_uuid(),input);
    select * into claimed from public.fn_claim_background_imports(job.id,1);
    assert claimed.status='processing' and claimed.lease_until>now();
    update public.background_import_jobs set status='needs_device',reason='device_owns_import',
        lease_token=null,lease_until=null,updated_at=now()
    where id=job.id and user_id=owner_a and status in ('pending','processing');
    get diagnostics handed = row_count;
    assert handed=1, 'a leased job must be handed over';
    assert not public.fn_finish_background_import(job.id,claimed.lease_token,'needs_device',null,'device_owns_import',30),
        'a pre-deploy worker finishing late must not rewrite a handed-over job';
    assert not public.fn_finish_background_import(job.id,claimed.lease_token,'ready','{"candidates":[{}]}'),
        'a late worker must never store a ready result';
    assert (select status='needs_device' and response is null and lease_token is null
        from public.background_import_jobs where id=job.id);

    -- An expired third attempt, which the old claim turned into a failure, goes
    -- to the device instead; the lease check constraint holds.
    job := public.fn_enqueue_background_import(owner_a,gen_random_uuid(),gen_random_uuid(),input);
    update public.background_import_jobs set status='processing',attempts=3,
        lease_token=gen_random_uuid(),lease_until=now()-interval '1 second' where id=job.id;
    update public.background_import_jobs set status='needs_device',reason='device_owns_import',
        lease_token=null,lease_until=null,updated_at=now()
    where id=job.id and user_id=owner_a and status in ('pending','processing');
    get diagnostics handed = row_count;
    assert handed=1 and (select status='needs_device' and attempts=3 from public.background_import_jobs where id=job.id),
        'an exhausted expired attempt must be handed to the device, not stuck';

    -- Settled jobs keep their state.
    foreach terminal in array array['needs_device','ready','failed','dismissed','acknowledged'] loop
        job := public.fn_enqueue_background_import(owner_a,gen_random_uuid(),gen_random_uuid(),input);
        update public.background_import_jobs set status=terminal,reason='fixture' where id=job.id;
        update public.background_import_jobs set status='needs_device',reason='device_owns_import',
            lease_token=null,lease_until=null,updated_at=now()
        where id=job.id and user_id=owner_a and status in ('pending','processing');
        get diagnostics handed = row_count;
        assert handed=0 and (select status=terminal and reason='fixture' from public.background_import_jobs where id=job.id),
            format('a %s job must not be handed over', terminal);
    end loop;
end;
$handoff$;
reset role;

-- Revoking the originating Supabase session deletes the extension credential.
delete from auth.sessions where id='b9130000-0000-4000-8000-000000000041';
do $session_cascade$
begin
    assert not exists(select 1 from public.background_import_credentials
        where session_id='b9130000-0000-4000-8000-000000000041');
    assert exists(select 1 from public.background_import_credentials
        where session_id='b9130000-0000-4000-8000-000000000042'),
        'revoking one session must not revoke another owner';
end;
$session_cascade$;
set local role service_role;
do $revoked_session$
declare denied boolean := false;
begin
    begin perform public.fn_enqueue_background_import(
        'b9130000-0000-4000-8000-000000000001',
        'b9130000-0000-4000-8000-000000000011',
        'b9130000-0000-4000-8000-000000000021',
        '{"url":"https://www.tiktok.com/@chef/video/123","protocol_generation":"v2"}',
        'b9130000-0000-4000-8000-000000000031');
    exception when insufficient_privilege then denied := true; end;
    assert denied, 'revoked session cannot even reuse an already-admitted job';
end;
$revoked_session$;
reset role;

rollback;
