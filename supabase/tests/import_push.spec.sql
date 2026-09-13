-- Run only in the isolated migration replay DB. All fixtures roll back.
begin;
do $privileges$
declare v_role text; v_table text; v_function text;
begin
    foreach v_table in array array['import_push_devices','import_push_deliveries'] loop
        assert (select relrowsecurity from pg_class where oid=('public.'||v_table)::regclass);
        foreach v_role in array array['anon','authenticated'] loop
            assert not has_table_privilege(v_role,'public.'||v_table,'SELECT,INSERT,UPDATE,DELETE'),
                'push tokens and receipts must never be directly accessible to clients';
        end loop;
    end loop;
    foreach v_function in array array[
        'public.fn_register_import_push_device(uuid,text,uuid,uuid,text,bigint)',
        'public.fn_revoke_import_push_device(uuid,text,uuid,bigint)',
        'public.fn_claim_import_push_deliveries(integer)'
    ] loop
        assert has_function_privilege('service_role',v_function,'EXECUTE');
        assert not (select prosecdef from pg_proc where oid=v_function::regprocedure);
        foreach v_role in array array['anon','authenticated'] loop
            assert not has_function_privilege(v_role,v_function,'EXECUTE');
        end loop;
    end loop;
end;
$privileges$;

insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('b9140000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','push-a@example.invalid','{}','{}',now(),now()),
('b9140000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','push-b@example.invalid','{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values
('b9140000-0000-4000-8000-000000000011','b9140000-0000-4000-8000-000000000001',now(),now()),
('b9140000-0000-4000-8000-000000000012','b9140000-0000-4000-8000-000000000002',now(),now());

set local role service_role;
do $registration$
declare
    owner_a uuid := 'b9140000-0000-4000-8000-000000000001';
    owner_b uuid := 'b9140000-0000-4000-8000-000000000002';
    session_a uuid := 'b9140000-0000-4000-8000-000000000011';
    session_b uuid := 'b9140000-0000-4000-8000-000000000012';
    install_a uuid := 'b9140000-0000-4000-8000-000000000021';
    job_a uuid := 'b9140000-0000-4000-8000-000000000031';
    first_claim jsonb;
    count_rows integer;
begin
    assert public.fn_register_import_push_device(install_a,repeat('a',64),owner_a,session_a,'ExpoPushToken[fixture_123456789]',1);
    insert into public.import_push_deliveries(user_id,job_id,installation_id,ready_count)
    values(owner_a,job_a,install_a,2);
    assert not public.fn_register_import_push_device(install_a,repeat('b',64),owner_b,session_b,'ExpoPushToken[fixture_987654321]',2),
        'knowing the installation id cannot reassign its owner';
    assert (select user_id from public.import_push_devices where installation_id=install_a)=owner_a;
    assert public.fn_register_import_push_device(install_a,repeat('a',64),owner_b,session_b,'ExpoPushToken[fixture_123456789]',2);
    assert not public.fn_register_import_push_device(install_a,repeat('a',64),owner_a,session_a,'ExpoPushToken[fixture_123456789]',1),
        'a timed-out previous-account request cannot undo reassignment';
    assert not exists(select 1 from public.import_push_deliveries where installation_id=install_a),
        'reassignment must remove queued notices for the previous account';

    insert into public.import_push_deliveries(user_id,job_id,installation_id,ready_count)
    values(owner_b,job_a,install_a,2);
    select * into first_claim from public.fn_claim_import_push_deliveries(1);
    assert first_claim->>'user_id'=owner_b::text and first_claim->>'attempts'='1';
    select count(*) into count_rows from public.fn_claim_import_push_deliveries(1);
    assert count_rows=0, 'an active delivery lease cannot be claimed again';
    update public.import_push_deliveries set locked_at=now()-interval '6 minutes' where job_id=job_a;
    select * into first_claim from public.fn_claim_import_push_deliveries(1);
    assert first_claim->>'attempts'='2', 'an abandoned delivery lease must recover';
    update public.import_push_deliveries set status='ticketed',ticket_id='ticket-1',next_attempt_at=now()+interval '15 minutes' where job_id=job_a;
    select count(*) into count_rows from public.fn_claim_import_push_deliveries(1);
    assert count_rows=0, 'provider receipts must not be polled before their due time';
    assert public.fn_revoke_import_push_device(install_a,repeat('a',64),owner_b,4);
    assert not public.fn_register_import_push_device(install_a,repeat('a',64),owner_b,session_b,'ExpoPushToken[fixture_123456789]',3),
        'a late registration cannot undo logout revocation';
    assert public.fn_register_import_push_device(install_a,repeat('a',64),owner_b,session_b,'ExpoPushToken[fixture_123456789]',5);
    insert into public.import_push_deliveries(user_id,job_id,installation_id,ready_count)
    values(owner_b,job_a,install_a,2);
    -- Revoke before the first registration reaches the server, creating a fence.
    assert public.fn_revoke_import_push_device('b9140000-0000-4000-8000-000000000022',repeat('b',64),owner_b,2);
    assert not public.fn_register_import_push_device('b9140000-0000-4000-8000-000000000022',repeat('b',64),owner_b,session_b,'ExpoPushToken[fixture_987654321]',1);
end;
$registration$;
reset role;

-- Online logout/session revocation disables delivery while retaining the fence.
delete from auth.sessions where id='b9140000-0000-4000-8000-000000000012';
do $logout$
begin
    assert (select session_id is null from public.import_push_devices where installation_id='b9140000-0000-4000-8000-000000000021');
    assert (select count(*) from public.fn_claim_import_push_deliveries())=0;
    assert (select status from public.import_push_deliveries where installation_id='b9140000-0000-4000-8000-000000000021')='cancelled';
end;
$logout$;
rollback;
