-- TICKET-196 B-0 replay contract.
-- Run after a from-zero migration replay while the B-2 hold file is ignored.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE ticket196_no_grant NOLOGIN;

DO $spec$
DECLARE
    v_tables text[] := ARRAY[
        'moderation_config','image_storage_origins','staging_reservations','image_stage_budget',
        'image_hash_verdicts','user_image_objects','image_object_refs','image_scan_leases',
        'image_compute_budget','image_scan_budget','image_moderation_ledger','image_gc_queue',
        'image_quarantine','image_moderation_notifications','job_leases','job_runs',
        'email_outbox','account_deletions'
    ];
    v_name text;
    v_privilege text;
    v_rls boolean;
    v_functions text[] := ARRAY[
        'append_entry_photo','fn_acquire_scan_lease','fn_assert_stage_moderatable',
        'fn_begin_image_promotion','fn_begin_stage','fn_bind_image_ref',
        'fn_claim_account_cleanup','fn_claim_account_image_drain','fn_claim_email_outbox',
        'fn_claim_gc_queue','fn_claim_grandfather_candidates','fn_claim_image_object_gc',
        'fn_claim_moderation_job','fn_claim_stage_put','fn_claim_staging_gc',
        'fn_claim_unbound_image_gc','fn_commit_avatar','fn_commit_image_verdict',
        'fn_commit_image_verdict_locked','fn_complete_moderation_job',
        'fn_complete_onboarding','fn_create_entry_and_merge_round',
        'fn_create_entry_with_tables','fn_debit_image_compute','fn_debit_scan_budget',
        'fn_delete_entry','fn_delete_entry_photo','fn_enqueue_alarm_selftest',
        'fn_enqueue_job_alarm','fn_enqueue_orphan_storage_object',
        'fn_evaluate_moderation_job_alarms','fn_fail_moderation_job',
        'fn_finalize_account_image_inventory','fn_finish_account_image_cleanup',
        'fn_finish_account_image_drain','fn_finish_email_outbox','fn_finish_gc_queue',
        'fn_finish_image_object_gc','fn_finish_image_promotion','fn_finish_stage',
        'fn_finish_staging_gc','fn_freeze_account_deletion',
        'fn_list_account_storage_paths','fn_list_reconcile_findings',
        'fn_list_reconcile_registry','fn_lock_grandfather_sweep','fn_lock_image_lifecycle',
        'fn_lock_moderation_enforcement','fn_mark_account_auth_deleted',
        'fn_mark_account_images_purging','fn_mark_stage_consumed',
        'fn_mark_stage_write_failed','fn_moderation_job_backlog',
        'fn_quarantine_legacy_image','fn_rebind_legacy_image',
        'fn_reconcile_registry_object','fn_reconcile_staging_usage',
        'fn_record_account_deletion_zero','fn_record_image_rejection',
        'fn_record_scan_result','fn_reject_legacy_image','fn_release_scan_lease',
        'fn_renew_moderation_job','fn_set_enforcement','fn_set_entry_hero',
        'fn_unbind_image_ref','fn_unlink_gc_ref','rate_round','start_round',
        'trg_entries_hero_gc','trg_entries_photo_owner_gc','trg_entry_photos_gc',
        'trg_tables_account_deletion_guard'
    ];
BEGIN
    ASSERT (SELECT public = false AND file_size_limit = 8388608
            AND allowed_mime_types = ARRAY['image/jpeg','image/png']::text[]
            FROM storage.buckets WHERE id = 'image-staging'),
        'image-staging bucket must be private, 8MiB, jpeg/png only';
    ASSERT NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies p
        WHERE p.schemaname = 'storage' AND p.policyname ILIKE '%image-staging%'
    ), 'image-staging must have no client policy';
    ASSERT (SELECT NOT enforce FROM public.moderation_config WHERE key='image_moderation'),
        'B-0 enforcement must be OFF';
    ASSERT (SELECT NOT enforce FROM public.moderation_config WHERE key='grandfather_sweep'),
        'B-0 grandfather sweep must be OFF';

    FOREACH v_name IN ARRAY v_tables LOOP
        SELECT c.relrowsecurity INTO v_rls
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=v_name;
        ASSERT v_rls, format('%s must have RLS enabled', v_name);
        ASSERT NOT pg_catalog.has_table_privilege('anon', 'public.'||v_name, 'SELECT'),
            format('anon inherited/PUBLIC SELECT leaked on %s', v_name);
        ASSERT NOT pg_catalog.has_table_privilege('authenticated', 'public.'||v_name, 'INSERT'),
            format('authenticated INSERT leaked on %s', v_name);
        FOREACH v_privilege IN ARRAY ARRAY[
            'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
        ] LOOP
            ASSERT NOT pg_catalog.has_table_privilege(
                'ticket196_no_grant','public.'||v_name,v_privilege),
              format('inherited PUBLIC %s leaked to no-grant role on %s',v_privilege,v_name);
            ASSERT NOT pg_catalog.has_table_privilege(
                'anon','public.'||v_name,v_privilege),
              format('anon %s leaked on %s',v_privilege,v_name);
            ASSERT NOT pg_catalog.has_table_privilege(
                'authenticated','public.'||v_name,v_privilege),
              format('authenticated %s leaked on %s',v_privilege,v_name);
            ASSERT pg_catalog.has_table_privilege(
                'service_role','public.'||v_name,v_privilege),
              format('service_role lacks %s on %s',v_privilege,v_name);
        END LOOP;
    END LOOP;
    ASSERT NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies p
        WHERE p.schemaname='public' AND p.tablename = ANY(v_tables)
    ), 'control-plane tables must be deny-all (no policies)';

    ASSERT NOT pg_catalog.has_function_privilege('anon','public.fn_begin_stage(uuid)','EXECUTE'),
        'PUBLIC/anon can execute fn_begin_stage';
    ASSERT NOT pg_catalog.has_function_privilege('authenticated','public.fn_bind_image_ref(uuid,text,text,text,text,boolean)','EXECUTE'),
        'authenticated can execute internal bind helper';
    ASSERT pg_catalog.has_function_privilege('service_role','public.fn_begin_stage(uuid)','EXECUTE'),
        'service_role lacks fn_begin_stage';
    ASSERT NOT pg_catalog.has_function_privilege(
        'ticket196_no_grant','public.fn_allow_legacy_image_storage_insert()','EXECUTE'),
        'PUBLIC leaked the legacy Storage tombstone helper';
    ASSERT NOT pg_catalog.has_function_privilege(
        'anon','public.fn_allow_legacy_image_storage_insert()','EXECUTE'),
        'anon can execute the legacy Storage tombstone helper';
    ASSERT pg_catalog.has_function_privilege(
        'authenticated','public.fn_allow_legacy_image_storage_insert()','EXECUTE'),
        'authenticated cannot evaluate the B-0 legacy Storage policy fence';
    ASSERT pg_catalog.has_function_privilege(
        'service_role','public.fn_allow_legacy_image_storage_insert()','EXECUTE'),
        'service_role lacks the legacy Storage tombstone helper';
    ASSERT pg_catalog.has_function_privilege(
        'service_role','public.trg_tables_account_deletion_guard()','EXECUTE'),
        'service_role lacks the Tables lifecycle guard';
    ASSERT (
        SELECT p.prosecdef
           AND 'search_path=""'=ANY(COALESCE(p.proconfig,'{}'::text[]))
        FROM pg_catalog.pg_proc p
        WHERE p.oid='public.fn_allow_legacy_image_storage_insert()'::pg_catalog.regprocedure
    ), 'legacy Storage tombstone helper must be SECDEF with empty search_path';
    ASSERT (
        SELECT p.prosecdef
           AND 'search_path=""'=ANY(COALESCE(p.proconfig,'{}'::text[]))
        FROM pg_catalog.pg_proc p
        WHERE p.oid='public.trg_tables_account_deletion_guard()'::pg_catalog.regprocedure
    ), 'Tables lifecycle guard must be SECDEF with empty search_path';
    ASSERT (
        SELECT pg_catalog.count(*)=2
           AND pg_catalog.bool_and(
               pg_catalog.strpos(p.with_check,'fn_allow_legacy_image_storage_insert')>0
           )
        FROM pg_catalog.pg_policies p
        WHERE p.schemaname='storage' AND p.tablename='objects'
          AND p.policyname IN (
              'Authenticated upload own folder avatars',
              'Authenticated upload own folder entry-photos'
          )
    ), 'both B-0 legacy Storage INSERT policies must carry the tombstone fence';
    ASSERT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger t
        WHERE t.tgrelid='public.tables'::pg_catalog.regclass
          AND t.tgname='tables_account_deletion_guard'
          AND NOT t.tgisinternal
    ), 'Tables lifecycle guard trigger is missing';
    ASSERT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint c
        WHERE c.conrelid='public.gatherings'::pg_catalog.regclass
          AND c.conname='gatherings_host_user_id_fkey'
          AND c.confdeltype='c'
    ), 'Gatherings host FK must cascade during account deletion';
    ASSERT NOT pg_catalog.has_function_privilege(
        'anon','public.fn_record_image_rejection(uuid,text,text,text)','EXECUTE'),
        'PUBLIC/anon can forge image rejection notices';
    ASSERT pg_catalog.has_function_privilege('service_role','public.fn_complete_onboarding(uuid,text,text,text)','EXECUTE'),
        'service_role lacks onboarding writer';
    ASSERT NOT pg_catalog.has_function_privilege('anon','public.fn_claim_moderation_job(text,text,integer,text)','EXECUTE'),
        'PUBLIC/anon can claim jobs';
    ASSERT NOT pg_catalog.has_function_privilege(
        'anon','public.fn_renew_moderation_job(text,text,bigint,uuid,integer)','EXECUTE'),
        'PUBLIC/anon can renew jobs';
    ASSERT pg_catalog.has_function_privilege(
        'service_role','public.fn_renew_moderation_job(text,text,bigint,uuid,integer)','EXECUTE'),
        'service_role lacks fenced job renewal';
    ASSERT NOT pg_catalog.has_function_privilege('anon','public.fn_moderation_job_backlog(text)','EXECUTE'),
        'PUBLIC/anon can inspect moderation job backlog';
    ASSERT pg_catalog.has_function_privilege('service_role','public.fn_moderation_job_backlog(text)','EXECUTE'),
        'service_role lacks moderation backlog snapshot';
    ASSERT NOT pg_catalog.has_function_privilege(
        'anon','public.fn_list_reconcile_findings(text,integer)','EXECUTE'),
        'PUBLIC/anon can list reconciliation findings';
    ASSERT pg_catalog.has_function_privilege(
        'service_role','public.fn_list_reconcile_findings(text,integer)','EXECUTE'),
        'service_role lacks bounded reconciliation findings';
    ASSERT NOT pg_catalog.has_function_privilege(
        'authenticated','public.fn_claim_account_image_drain(uuid,text,integer)','EXECUTE'),
        'authenticated can claim account image drain';
    ASSERT pg_catalog.has_function_privilege(
        'service_role','public.fn_list_account_storage_paths(uuid,text,text,text,integer)','EXECUTE'),
        'service_role lacks recursive account Storage inventory';
    ASSERT NOT pg_catalog.has_function_privilege(
        'authenticated','public.fn_reconcile_staging_usage()','EXECUTE'),
        'authenticated can inspect reconciliation staging usage';
    ASSERT NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
          AND p.proname=ANY(v_functions)
          AND (
            pg_catalog.has_function_privilege('ticket196_no_grant',p.oid,'EXECUTE')
            OR pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
            OR pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
          )
    ), 'a TICKET-196 function leaked PUBLIC/client EXECUTE';
    ASSERT NOT EXISTS (
        SELECT wanted.name
        FROM pg_catalog.unnest(v_functions) wanted(name)
        WHERE NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname=wanted.name
        )
    ), 'a role-tested TICKET-196 function is missing';
    ASSERT NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
          AND p.proname=ANY(v_functions)
          AND p.prosecdef
          AND NOT ('search_path=""' = ANY(COALESCE(p.proconfig,'{}'::text[])))
    ), 'new SECURITY DEFINER functions must pin empty search_path';
    ASSERT NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
          AND p.proname IN (
            'fn_claim_account_cleanup','fn_claim_staging_gc','fn_finish_staging_gc',
            'fn_list_reconcile_registry','fn_record_scan_result','fn_release_scan_lease',
            'fn_set_enforcement','fn_set_entry_hero','fn_delete_entry',
            'fn_delete_entry_photo'
          )
          AND NOT pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
    ), 'service_role lacks an Edge-callable TICKET-196 function';
    ASSERT pg_catalog.strpos(pg_catalog.upper(pg_catalog.pg_get_functiondef(
        'public.fn_lock_moderation_enforcement()'::pg_catalog.regprocedure)), 'FOR SHARE') > 0,
        'writer flag read is not held FOR SHARE through the transaction';
    ASSERT NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
          AND pg_catalog.strpos(p.prosrc,'public.fn_bind_image_ref(')>0
          AND (
              pg_catalog.strpos(p.prosrc,'public.fn_lock_image_lifecycle(')=0
              OR pg_catalog.strpos(p.prosrc,'public.fn_lock_image_lifecycle(')
                   > pg_catalog.strpos(p.prosrc,'public.fn_bind_image_ref(')
              OR (
                  pg_catalog.strpos(pg_catalog.upper(p.prosrc),'FOR UPDATE')>0
                  AND pg_catalog.strpos(p.prosrc,'public.fn_lock_image_lifecycle(')
                      > pg_catalog.strpos(pg_catalog.upper(p.prosrc),'FOR UPDATE')
              )
              OR (
                  pg_catalog.strpos(pg_catalog.upper(p.prosrc),'INSERT INTO')>0
                  AND pg_catalog.strpos(p.prosrc,'public.fn_lock_image_lifecycle(')
                      > pg_catalog.strpos(pg_catalog.upper(p.prosrc),'INSERT INTO')
              )
              OR (
                  pg_catalog.strpos(pg_catalog.upper(p.prosrc),'UPDATE PUBLIC.')>0
                  AND pg_catalog.strpos(p.prosrc,'public.fn_lock_image_lifecycle(')
                      > pg_catalog.strpos(pg_catalog.upper(p.prosrc),'UPDATE PUBLIC.')
              )
              OR (
                  pg_catalog.strpos(pg_catalog.upper(p.prosrc),'DELETE FROM')>0
                  AND pg_catalog.strpos(p.prosrc,'public.fn_lock_image_lifecycle(')
                      > pg_catalog.strpos(pg_catalog.upper(p.prosrc),'DELETE FROM')
              )
          )
    ), 'a bind caller locks or mutates before lifecycle';
    ASSERT (
        SELECT pg_catalog.strpos(p.prosrc,'public.fn_lock_image_lifecycle(')>0
           AND pg_catalog.strpos(p.prosrc,'public.fn_lock_image_lifecycle(')
                < pg_catalog.strpos(pg_catalog.upper(p.prosrc),'FOR UPDATE')
        FROM pg_catalog.pg_proc p
        WHERE p.oid='public.fn_rebind_legacy_image(text,text,uuid,text,text)'::pg_catalog.regprocedure
    ), 'grandfather rebind takes a sink lock before lifecycle';
    ASSERT pg_catalog.strpos(pg_catalog.upper(pg_catalog.pg_get_functiondef(
        'public.rate_round(uuid,uuid,numeric,text,text,text[],numeric,numeric,numeric,numeric,uuid)'::pg_catalog.regprocedure)), 'FOR UPDATE OF N, P') > 0,
        'rate_round regressed the round+participant serialization lock';
END;
$spec$;

-- Users/profiles/table fixture.
INSERT INTO auth.users (instance_id,id,aud,role,email,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated','authenticated',
       u.email, now(),now(),'{}'::jsonb,'{}'::jsonb
FROM (VALUES
 ('19610000-0000-4000-8000-000000000001'::uuid,'u1@196.invalid'),
 ('19610000-0000-4000-8000-000000000002'::uuid,'u2@196.invalid'),
 ('19610000-0000-4000-8000-000000000003'::uuid,'u3@196.invalid'),
 ('19610000-0000-4000-8000-000000000005'::uuid,'u5-delete@196.invalid')
) u(id,email) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (user_id,display_name,account_privacy)
VALUES
 ('19610000-0000-4000-8000-000000000001','U1','private'),
 ('19610000-0000-4000-8000-000000000002','U2','private'),
 ('19610000-0000-4000-8000-000000000003','U3','private'),
 ('19610000-0000-4000-8000-000000000005','U5 Delete','private')
ON CONFLICT (user_id) DO UPDATE SET display_name=EXCLUDED.display_name;

-- Authenticated users must not be able to bypass the staging saga by writing
-- an approved namespace, nor access the private service-only staging bucket.
DO $spec$
DECLARE
    u1 uuid := '19610000-0000-4000-8000-000000000001';
    v_bucket text;
    v_stage_path text := u1::text||'/1961f000-0000-4000-8000-000000000001';
    v_denied boolean;
    v_visible bigint;
    v_affected bigint;
BEGIN
    PERFORM set_config(
        'request.jwt.claims',
        pg_catalog.json_build_object('sub',u1,'role','authenticated')::text,
        true
    );

    FOREACH v_bucket IN ARRAY ARRAY['avatars','entry-photos'] LOOP
        v_denied := false;
        BEGIN
            SET LOCAL ROLE authenticated;
            INSERT INTO storage.objects (bucket_id,name,metadata)
            VALUES (
                v_bucket,
                'approved/'||u1||'/'||repeat('1',64)||'.jpg',
                '{"size":1,"mimetype":"image/jpeg"}'::jsonb
            );
            RESET ROLE;
        EXCEPTION WHEN insufficient_privilege THEN
            RESET ROLE;
            v_denied := true;
        END;
        ASSERT v_denied, format('authenticated direct INSERT reached %s approved namespace',v_bucket);

        -- Service promotion owns the canonical object.  The legacy own-folder
        -- policies must not let its owner swap or remove approved bytes after
        -- Vision scanned them merely because the bucket itself is public.
        INSERT INTO storage.objects (bucket_id,name,metadata)
        VALUES (
          v_bucket,'approved/'||u1||'/'||repeat('1',64)||'.jpg',
          '{"size":1,"mimetype":"image/jpeg"}'::jsonb
        ) ON CONFLICT (bucket_id,name) DO NOTHING;
        v_affected:=0;
        BEGIN
          SET LOCAL ROLE authenticated;
          UPDATE storage.objects
          SET metadata=metadata||'{"swapped":true}'::jsonb
          WHERE bucket_id=v_bucket
            AND name='approved/'||u1||'/'||repeat('1',64)||'.jpg';
          GET DIAGNOSTICS v_affected = ROW_COUNT;
          RESET ROLE;
        EXCEPTION WHEN insufficient_privilege THEN
          RESET ROLE;
          v_affected:=0;
        END;
        ASSERT v_affected=0,
          format('authenticated UPDATE swapped %s approved bytes',v_bucket);
        BEGIN
          SET LOCAL ROLE authenticated;
          DELETE FROM storage.objects
          WHERE bucket_id=v_bucket
            AND name='approved/'||u1||'/'||repeat('1',64)||'.jpg';
          GET DIAGNOSTICS v_affected = ROW_COUNT;
          RESET ROLE;
        EXCEPTION WHEN insufficient_privilege THEN
          RESET ROLE;
          v_affected:=0;
        END;
        ASSERT v_affected=0 AND EXISTS (
          SELECT 1 FROM storage.objects o
          WHERE o.bucket_id=v_bucket
            AND o.name='approved/'||u1||'/'||repeat('1',64)||'.jpg'
        ), format('authenticated DELETE removed %s approved bytes',v_bucket);
        DELETE FROM storage.objects
        WHERE bucket_id=v_bucket
          AND name='approved/'||u1||'/'||repeat('1',64)||'.jpg';
    END LOOP;

    v_denied := false;
    BEGIN
        SET LOCAL ROLE authenticated;
        INSERT INTO storage.objects (bucket_id,name,metadata)
        VALUES ('image-staging',v_stage_path,'{"size":1,"mimetype":"image/jpeg"}'::jsonb);
        RESET ROLE;
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        v_denied := true;
    END;
    ASSERT v_denied, 'authenticated direct INSERT reached image-staging';

    INSERT INTO storage.objects (bucket_id,name,metadata)
    VALUES ('image-staging',v_stage_path,'{"size":1,"mimetype":"image/jpeg"}'::jsonb);

    v_visible := 0;
    BEGIN
        SET LOCAL ROLE authenticated;
        SELECT pg_catalog.count(*) INTO v_visible
        FROM storage.objects
        WHERE bucket_id='image-staging' AND name=v_stage_path;
        RESET ROLE;
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        v_visible := 0;
    END;
    ASSERT v_visible=0, 'authenticated SELECT exposed image-staging object';

    v_affected := 0;
    BEGIN
        SET LOCAL ROLE authenticated;
        UPDATE storage.objects SET metadata=metadata||'{"client":"write"}'::jsonb
        WHERE bucket_id='image-staging' AND name=v_stage_path;
        GET DIAGNOSTICS v_affected = ROW_COUNT;
        RESET ROLE;
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        v_affected := 0;
    END;
    ASSERT v_affected=0, 'authenticated UPDATE reached image-staging object';

    v_affected := 0;
    BEGIN
        SET LOCAL ROLE authenticated;
        DELETE FROM storage.objects
        WHERE bucket_id='image-staging' AND name=v_stage_path;
        GET DIAGNOSTICS v_affected = ROW_COUNT;
        RESET ROLE;
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        v_affected := 0;
    END;
    ASSERT v_affected=0, 'authenticated DELETE reached image-staging object';
    ASSERT EXISTS (
        SELECT 1 FROM storage.objects
        WHERE bucket_id='image-staging' AND name=v_stage_path
    ), 'authenticated storage denial test lost its service-owned fixture';

    DELETE FROM storage.objects
    WHERE bucket_id='image-staging' AND name=v_stage_path;
END;
$spec$;

INSERT INTO public.restaurants (id,name,city)
VALUES ('19610000-1000-4000-8000-000000000001','Moderation Spec','Testville')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.tables (id,owner_id,name)
VALUES ('19610000-2000-4000-8000-000000000001','19610000-0000-4000-8000-000000000001','Moderation Table')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.table_members (table_id,member_id,role) VALUES
 ('19610000-2000-4000-8000-000000000001','19610000-0000-4000-8000-000000000001','admin'),
 ('19610000-2000-4000-8000-000000000001','19610000-0000-4000-8000-000000000002','member')
ON CONFLICT DO NOTHING;

-- Account deletion is a permanent write fence even while B-0 keeps the
-- legacy own-folder Storage writers available to old clients.  Exercise the
-- real RLS/auth.uid path, budget ledgers, owner trigger, and FK cascade.
DO $spec$
DECLARE
    u5 uuid := '19610000-0000-4000-8000-000000000005';
    v_bucket text;
    v_denied boolean;
    v_caught boolean;
    v_legacy_path text;
BEGIN
    PERFORM pg_catalog.set_config(
        'request.jwt.claims',
        pg_catalog.json_build_object('sub',u5,'role','authenticated')::text,
        true
    );

    -- OFF compatibility: both historical {uid}/... INSERT policies still
    -- admit the authenticated owner before freeze.
    FOREACH v_bucket IN ARRAY ARRAY['avatars','entry-photos'] LOOP
        v_legacy_path := u5::text||'/legacy-before-freeze-'||v_bucket||'.jpg';
        SET LOCAL ROLE authenticated;
        INSERT INTO storage.objects (bucket_id,name,metadata)
        VALUES (v_bucket,v_legacy_path,'{"size":1,"mimetype":"image/jpeg"}'::jsonb);
        RESET ROLE;
        ASSERT EXISTS (
            SELECT 1 FROM storage.objects
            WHERE bucket_id=v_bucket AND name=v_legacy_path
        ), format('B-0 legacy %s own-folder INSERT did not commit',v_bucket);
        DELETE FROM storage.objects
        WHERE bucket_id=v_bucket AND name=v_legacy_path;
    END LOOP;

    -- Normal Table creation is unchanged before the deletion tombstone.
    INSERT INTO public.tables (id,owner_id,name) VALUES
      ('19610000-2000-4000-8000-000000000005',u5,'Pre-freeze Table');
    DELETE FROM public.tables
    WHERE id='19610000-2000-4000-8000-000000000005';

    PERFORM public.fn_freeze_account_deletion(u5);

    -- The same authenticated legacy paths are denied after freeze.
    FOREACH v_bucket IN ARRAY ARRAY['avatars','entry-photos'] LOOP
        v_legacy_path := u5::text||'/legacy-after-freeze-'||v_bucket||'.jpg';
        v_denied := false;
        BEGIN
            SET LOCAL ROLE authenticated;
            INSERT INTO storage.objects (bucket_id,name,metadata)
            VALUES (v_bucket,v_legacy_path,'{"size":1,"mimetype":"image/jpeg"}'::jsonb);
            RESET ROLE;
        EXCEPTION WHEN insufficient_privilege THEN
            RESET ROLE;
            v_denied := true;
        END;
        ASSERT v_denied,
            format('tombstoned user retained legacy %s Storage INSERT',v_bucket);
        ASSERT NOT EXISTS (
            SELECT 1 FROM storage.objects
            WHERE bucket_id=v_bucket AND name=v_legacy_path
        ), format('denied legacy %s INSERT left an object',v_bucket);
    END LOOP;

    v_caught := false;
    BEGIN
        PERFORM public.fn_debit_image_compute(u5);
    EXCEPTION WHEN SQLSTATE '55000' THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'compute debit accepted a tombstoned user';

    v_caught := false;
    BEGIN
        PERFORM public.fn_debit_scan_budget(u5,'general');
    EXCEPTION WHEN SQLSTATE '55000' THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'scan debit accepted a tombstoned user';
    ASSERT NOT EXISTS (
        SELECT 1 FROM public.image_compute_budget b
        WHERE b.scope='user' AND b.subject_id=u5
    ), 'compute debit recreated a deleted user budget';
    ASSERT NOT EXISTS (
        SELECT 1 FROM public.image_scan_budget b
        WHERE b.scope='user' AND b.subject_id=u5
    ), 'scan debit recreated a deleted user budget';
    ASSERT NOT EXISTS (
        SELECT 1 FROM public.image_moderation_ledger l WHERE l.user_id=u5
    ), 'scan debit recreated a deleted user ledger row';

    v_caught := false;
    BEGIN
        INSERT INTO public.tables (id,owner_id,name) VALUES
          ('19610000-2000-4000-8000-000000000006',u5,'Post-freeze Table');
    EXCEPTION WHEN SQLSTATE '55000' THEN
        v_caught := true;
    END;
    ASSERT v_caught, 'Table owner assignment bypassed account tombstone';
    ASSERT NOT EXISTS (
        SELECT 1 FROM public.tables
        WHERE id='19610000-2000-4000-8000-000000000006'
    ), 'rejected post-freeze Table was persisted';

    INSERT INTO public.gatherings (
        id,table_id,restaurant_id,host_user_id,gather_on,status
    ) VALUES (
        '19610000-3000-4000-8000-000000000005',
        '19610000-2000-4000-8000-000000000001',
        '19610000-1000-4000-8000-000000000001',
        u5, CURRENT_DATE + 1, 'proposed'
    );
    DELETE FROM auth.users WHERE id=u5;
    ASSERT NOT EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.user_id=u5
    ), 'Auth deletion did not cascade the user profile';
    ASSERT NOT EXISTS (
        SELECT 1 FROM public.gatherings g
        WHERE g.id='19610000-3000-4000-8000-000000000005'
    ), 'hosted Gathering blocked deletion or survived its host';
    ASSERT EXISTS (
        SELECT 1 FROM public.account_deletions d WHERE d.user_id=u5
    ), 'account deletion tombstone must survive Auth deletion';

    PERFORM pg_catalog.set_config('request.jwt.claims','{}',true);
END;
$spec$;

INSERT INTO public.image_hash_verdicts (sha256,verdict,likelihoods,provider_call_marker)
VALUES
 (repeat('a',64),'pass','{}','provider-a'),
 (repeat('b',64),'pass','{}','provider-b'),
 (repeat('c',64),'pass','{}','provider-c'),
 (repeat('d',64),'pass','{}','provider-d'),
 (repeat('e',64),'pass','{}','provider-e')
ON CONFLICT (sha256) DO NOTHING;

INSERT INTO public.user_image_objects
 (id,user_id,bucket,storage_path,public_url,sha256,state)
VALUES
 ('1961a000-0000-4000-8000-000000000001','19610000-0000-4000-8000-000000000001','avatars',
  'approved/19610000-0000-4000-8000-000000000001/'||repeat('a',64)||'.jpg',
  'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/19610000-0000-4000-8000-000000000001/'||repeat('a',64)||'.jpg',repeat('a',64),'approved'),
 ('1961b000-0000-4000-8000-000000000001','19610000-0000-4000-8000-000000000002','avatars',
  'approved/19610000-0000-4000-8000-000000000002/'||repeat('b',64)||'.jpg',
  'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/19610000-0000-4000-8000-000000000002/'||repeat('b',64)||'.jpg',repeat('b',64),'approved'),
 ('1961c000-0000-4000-8000-000000000001','19610000-0000-4000-8000-000000000001','entry-photos',
  'approved/19610000-0000-4000-8000-000000000001/'||repeat('c',64)||'.jpg',
  'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/19610000-0000-4000-8000-000000000001/'||repeat('c',64)||'.jpg',repeat('c',64),'approved'),
 ('1961d000-0000-4000-8000-000000000001','19610000-0000-4000-8000-000000000001','entry-photos',
  'approved/19610000-0000-4000-8000-000000000001/'||repeat('d',64)||'.jpg',
  'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/19610000-0000-4000-8000-000000000001/'||repeat('d',64)||'.jpg',repeat('d',64),'approved'),
 ('1961e000-0000-4000-8000-000000000001','19610000-0000-4000-8000-000000000001','avatars',
  'approved/19610000-0000-4000-8000-000000000001/'||repeat('e',64)||'.jpg',
  'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/19610000-0000-4000-8000-000000000001/'||repeat('e',64)||'.jpg',repeat('e',64),'promoting')
ON CONFLICT DO NOTHING;

-- This fixture represents a crashed promotion, not an in-flight approved PUT.
UPDATE public.user_image_objects
SET created_at=now()-interval '10 minutes',
    promotion_lease_expires=now()-interval '1 second'
WHERE id='1961e000-0000-4000-8000-000000000001';

-- One terminal hash verdict is shared, while ownership and physical registry
-- identity remain per user+bucket. GC of one bucket must never key on hash or
-- disturb the other physical object.
DO $spec$
DECLARE
    u1 uuid := '19610000-0000-4000-8000-000000000001';
    sha text := repeat('6',64);
    avatar_url text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/'
        ||u1||'/'||repeat('6',64)||'.jpg';
    photo_url text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/'
        ||u1||'/'||repeat('6',64)||'.jpg';
    avatar_id uuid;
    photo_id uuid;
    j jsonb;
BEGIN
    INSERT INTO public.image_hash_verdicts (sha256,verdict,likelihoods,provider_call_marker)
    VALUES (sha,'pass','{}','one-paid-provider-call') ON CONFLICT DO NOTHING;
    j:=public.fn_begin_image_promotion(u1,'avatars',sha,avatar_url);
    avatar_id:=(j->>'object_id')::uuid;
    PERFORM public.fn_finish_image_promotion(u1,avatar_id);
    j:=public.fn_begin_image_promotion(u1,'entry-photos',sha,photo_url);
    photo_id:=(j->>'object_id')::uuid;
    PERFORM public.fn_finish_image_promotion(u1,photo_id);
    ASSERT (SELECT count(*)=2 FROM public.user_image_objects o
            WHERE o.user_id=u1 AND o.sha256=sha
              AND o.bucket IN ('avatars','entry-photos')),
      'same hash in two buckets did not create two physical registry rows';
    ASSERT (SELECT count(*)=1 FROM public.image_hash_verdicts v WHERE v.sha256=sha),
      'same hash duplicated the global terminal verdict';

    PERFORM public.fn_bind_image_ref(
      u1,avatar_url,'avatars','avatar','ticket196-cross-bucket-avatar',true);
    PERFORM public.fn_bind_image_ref(
      u1,photo_url,'entry-photos','entry_photo','ticket196-cross-bucket-photo',true);
    PERFORM public.fn_unbind_image_ref(
      'avatar','ticket196-cross-bucket-avatar','cross_bucket_test');
    j:=public.fn_claim_image_object_gc(avatar_id,'cross-bucket-gc','cross_bucket_test');
    ASSERT (j->>'claimed')::boolean, 'unbound avatar object was not GC claimable';
    ASSERT public.fn_finish_image_object_gc(avatar_id,'cross-bucket-gc',true,NULL),
      'avatar object GC did not finish';
    ASSERT NOT EXISTS (SELECT 1 FROM public.user_image_objects WHERE id=avatar_id),
      'avatar registry row survived its independent GC';
    ASSERT EXISTS (SELECT 1 FROM public.user_image_objects
                   WHERE id=photo_id AND bucket='entry-photos' AND state='approved')
       AND EXISTS (SELECT 1 FROM public.image_object_refs
                   WHERE object_id=photo_id AND sink_id='ticket196-cross-bucket-photo'),
      'avatar GC disturbed same-hash entry-photo object/ref';
END;
$spec$;

-- AC7 actual-order compatibility: every image sink writer must still accept
-- the legacy/raw payload shape while the B-0 enforcement row is OFF.  Keep
-- these rows inside an intentional subtransaction rollback so the subsequent
-- ON matrix observes the original fixtures, not artifacts from this phase.
DO $spec$
DECLARE
    u1 uuid := '19610000-0000-4000-8000-000000000001';
    u2 uuid := '19610000-0000-4000-8000-000000000002';
    t1 uuid := '19610000-2000-4000-8000-000000000001';
    r1 uuid := '19610000-1000-4000-8000-000000000001';
    raw_avatar text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/'
        ||'19610000-0000-4000-8000-000000000001/off-commit.jpg';
    foreign_approved_avatar text :=
        'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/'
        ||'19610000-0000-4000-8000-000000000002/'||repeat('b',64)||'.jpg';
    wrong_bucket_approved text :=
        'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/'
        ||'19610000-0000-4000-8000-000000000001/'||repeat('c',64)||'.jpg';
    raw_create_a text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/'
        ||'19610000-0000-4000-8000-000000000001/off-create-a.jpg';
    raw_create_b text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/'
        ||'19610000-0000-4000-8000-000000000001/off-create-b.jpg';
    raw_append text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/'
        ||'19610000-0000-4000-8000-000000000001/off-append.jpg';
    raw_merge text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/'
        ||'19610000-0000-4000-8000-000000000002/off-merge.jpg';
    raw_start_a text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/'
        ||'19610000-0000-4000-8000-000000000001/off-start-a.jpg';
    raw_start_b text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/'
        ||'19610000-0000-4000-8000-000000000001/off-start-b.jpg';
    raw_rate text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/'
        ||'19610000-0000-4000-8000-000000000002/off-rate.jpg';
    off_create uuid;
    off_append_entry uuid;
    off_merge_entry uuid;
    off_night uuid;
    off_start_entry uuid;
    off_rate_entry uuid;
    caught boolean;
    j jsonb;
BEGIN
    ASSERT (SELECT NOT enforce FROM public.moderation_config WHERE key='image_moderation'),
      'OFF writer matrix did not start with enforcement disabled';

    BEGIN
        -- Settings / quick-swap writer.
        PERFORM public.fn_commit_avatar(u1,raw_avatar);
        ASSERT (SELECT avatar_url=raw_avatar FROM public.profiles WHERE user_id=u1),
          'OFF fn_commit_avatar rejected a legacy own-folder avatar';
        ASSERT NOT EXISTS (
          SELECT 1 FROM public.image_object_refs
          WHERE sink_kind='avatar' AND sink_id=u1::text
        ), 'OFF raw avatar unexpectedly gained an approved-object ref';

        -- OFF is a compatibility path for legacy raw values only.  A canonical
        -- approved URL with no caller-owned registry row must never be
        -- downgraded to an untracked raw value (including another user's URL).
        caught:=false;
        BEGIN
          PERFORM public.fn_commit_avatar(u1,foreign_approved_avatar);
        EXCEPTION WHEN OTHERS THEN
          caught:=SQLERRM LIKE '%approved_image_required%';
        END;
        ASSERT caught, 'OFF writer downgraded a foreign approved URL to legacy raw';
        ASSERT (SELECT avatar_url=raw_avatar FROM public.profiles WHERE user_id=u1),
          'rejected foreign approved URL changed the OFF avatar sink';
        caught:=false;
        BEGIN
          PERFORM public.fn_commit_avatar(u1,wrong_bucket_approved);
        EXCEPTION WHEN OTHERS THEN
          caught:=SQLERRM LIKE '%approved_image_required%';
        END;
        ASSERT caught, 'OFF writer downgraded a wrong-bucket approved URL to legacy raw';

        -- Canonical entry writer: preserve both the hero and every photo_urls
        -- row even though no approved-object registry rows exist yet.
        SELECT x.entry_id INTO off_create
        FROM public.fn_create_entry_with_tables(
          u1,
          pg_catalog.jsonb_build_object(
            'restaurant_id',r1,'rating',4.5,'visited_at',now(),
            'visibility','table','photo_url',raw_create_a,
            'photo_urls',pg_catalog.jsonb_build_array(raw_create_a,raw_create_b)
          ),
          ARRAY[t1],ARRAY[u1],NULL
        ) x;
        ASSERT (SELECT photo_url=raw_create_a FROM public.entries WHERE id=off_create),
          'OFF create lost the legacy hero URL';
        ASSERT (SELECT pg_catalog.array_agg(photo_url ORDER BY sort_order)
                       =ARRAY[raw_create_a,raw_create_b]
                FROM public.entry_photos WHERE entry_id=off_create),
          'OFF create lost or reordered legacy photo_urls rows';

        -- Append writer, including its first-photo hero behavior.
        SELECT x.entry_id INTO off_append_entry
        FROM public.fn_create_entry_with_tables(
          u1,
          pg_catalog.jsonb_build_object(
            'restaurant_id',r1,'rating',4,'visited_at',now(),'visibility','private'
          ),
          NULL,ARRAY[u1],NULL
        ) x;
        j:=public.append_entry_photo(off_append_entry,u1,raw_append);
        ASSERT (j->>'photo_url')=raw_append AND (j->>'hero_url')=raw_append,
          'OFF append_entry_photo rejected or failed to promote a legacy first photo';
        ASSERT (SELECT photo_url=raw_append FROM public.entries WHERE id=off_append_entry)
           AND (SELECT pg_catalog.array_agg(photo_url ORDER BY sort_order)=ARRAY[raw_append]
                FROM public.entry_photos WHERE entry_id=off_append_entry),
          'OFF append did not persist both its row and hero';

        -- Merge writer forwards the complete B image payload through the same
        -- OFF-compatible entry RPC. U1's table entry is A; U2 creates B.
        j:=public.fn_create_entry_and_merge_round(
          u2,t1,r1,now(),off_create,
          pg_catalog.jsonb_build_object(
            'restaurant_id',r1,'rating',4,'visited_at',now(),
            'photo_url',raw_merge,
            'photo_urls',pg_catalog.jsonb_build_array(raw_merge)
          ),
          NULL
        );
        off_merge_entry:=(j->>'entry_b_id')::uuid;
        ASSERT off_merge_entry IS NOT NULL
           AND (SELECT photo_url=raw_merge FROM public.entries WHERE id=off_merge_entry)
           AND (SELECT pg_catalog.array_agg(photo_url ORDER BY sort_order)=ARRAY[raw_merge]
                FROM public.entry_photos WHERE entry_id=off_merge_entry),
          'OFF merge writer lost its legacy B image payload';

        -- Live-round host and attendee writers must both retain the legacy
        -- hero plus exact entry_photos rows while enforcement is OFF.
        j:=public.start_round(
          t1,r1,u1,4,'off start','off dish',
          ARRAY[raw_start_a,raw_start_b],ARRAY[u2],true,
          NULL,NULL,NULL,NULL,NULL
        );
        off_night:=(j->>'night_id')::uuid;
        off_start_entry:=(j->>'entry_id')::uuid;
        ASSERT off_night IS NOT NULL
           AND (SELECT photo_url=raw_start_a FROM public.entries WHERE id=off_start_entry)
           AND (SELECT pg_catalog.array_agg(photo_url ORDER BY sort_order)
                       =ARRAY[raw_start_a,raw_start_b]
                FROM public.entry_photos WHERE entry_id=off_start_entry),
          'OFF start_round lost its legacy hero/photo rows';

        j:=public.rate_round(
          off_night,u2,3.5,'off rate','off dish',ARRAY[raw_rate],
          NULL,NULL,NULL,NULL,NULL
        );
        off_rate_entry:=(j->>'entry_id')::uuid;
        ASSERT off_rate_entry IS NOT NULL
           AND (SELECT photo_url=raw_rate FROM public.entries WHERE id=off_rate_entry)
           AND (SELECT pg_catalog.array_agg(photo_url ORDER BY sort_order)=ARRAY[raw_rate]
                FROM public.entry_photos WHERE entry_id=off_rate_entry),
          'OFF rate_round lost its legacy hero/photo row';

        ASSERT NOT EXISTS (
          SELECT 1 FROM public.image_object_refs r
          WHERE (r.sink_kind='entry_hero' AND r.sink_id IN (
                    off_create::text,off_append_entry::text,off_merge_entry::text,
                    off_start_entry::text,off_rate_entry::text
                 ))
             OR (r.sink_kind='entry_photo' AND r.sink_id IN (
                    SELECT ep.id::text FROM public.entry_photos ep
                    WHERE ep.entry_id IN (
                      off_create,off_append_entry,off_merge_entry,
                      off_start_entry,off_rate_entry
                    )
                 ))
        ), 'OFF raw entry writers fabricated approved-object refs';

        RAISE EXCEPTION 'ticket196_off_matrix_rollback' USING ERRCODE='P1960';
    EXCEPTION WHEN SQLSTATE 'P1960' THEN
        IF SQLERRM <> 'ticket196_off_matrix_rollback' THEN RAISE; END IF;
    END;

    ASSERT (SELECT NOT enforce FROM public.moderation_config WHERE key='image_moderation'),
      'OFF writer matrix changed the enforcement flag';
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.entries
      WHERE id IN (
        off_create,off_append_entry,off_merge_entry,off_start_entry,off_rate_entry
      )
    ), 'OFF writer fixture rollback leaked entry rows into the ON phase';
END;
$spec$;

DO $spec$
DECLARE
    u1 uuid := '19610000-0000-4000-8000-000000000001';
    u2 uuid := '19610000-0000-4000-8000-000000000002';
    avatar text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/19610000-0000-4000-8000-000000000001/'||repeat('a',64)||'.jpg';
    other_avatar text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/19610000-0000-4000-8000-000000000002/'||repeat('b',64)||'.jpg';
    photo_c text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/19610000-0000-4000-8000-000000000001/'||repeat('c',64)||'.jpg';
    promoting text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/19610000-0000-4000-8000-000000000001/'||repeat('e',64)||'.jpg';
    raw text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/'||u1||'/legacy.jpg';
    caught boolean;
BEGIN
    -- Old null/raw onboarding remains valid while B-0 is OFF.
    PERFORM public.fn_complete_onboarding(u2,'Old Null',NULL,NULL);
    PERFORM public.fn_complete_onboarding(u1,'Old Raw','London',raw);
    ASSERT (SELECT avatar_url=raw FROM public.profiles WHERE user_id=u1), 'OFF raw onboarding failed';

    UPDATE public.moderation_config SET enforce=true WHERE key='image_moderation';

    -- Six explicit bad-avatar cases: null, raw, cross-user, wrong bucket,
    -- non-approved state, and missing registry object.
    caught:=false; BEGIN PERFORM public.fn_complete_onboarding(u1,'X',NULL,NULL);
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%avatar_required%'; END;
    ASSERT caught, 'ON null avatar was accepted';
    caught:=false; BEGIN PERFORM public.fn_complete_onboarding(u1,'X',NULL,raw);
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'ON raw avatar was accepted';
    caught:=false; BEGIN PERFORM public.fn_complete_onboarding(u1,'X',NULL,other_avatar);
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'cross-user avatar was accepted';
    caught:=false; BEGIN PERFORM public.fn_complete_onboarding(u1,'X',NULL,photo_c);
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'wrong-bucket avatar was accepted';
    caught:=false; BEGIN PERFORM public.fn_complete_onboarding(u1,'X',NULL,promoting);
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%image_object_not_bindable%'; END;
    ASSERT caught, 'non-approved-state avatar was accepted';
    caught:=false; BEGIN PERFORM public.fn_complete_onboarding(u1,'X',NULL,
      'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/'||u1||'/'||repeat('f',64)||'.jpg');
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'missing-object avatar was accepted';

    PERFORM public.fn_complete_onboarding(u1,'Approved Name','London',avatar);
    ASSERT (SELECT display_name='Approved Name' AND home_city='London' AND avatar_url=avatar
                   AND onboarded_at IS NOT NULL AND terms_accepted_at IS NOT NULL
                   AND account_privacy='public'
            FROM public.profiles WHERE user_id=u1), 'atomic completion fields are wrong';
    ASSERT EXISTS (SELECT 1 FROM public.image_object_refs WHERE sink_kind='avatar' AND sink_id=u1::text),
        'approved avatar ref missing';

    -- Missing flag row must fail closed and the exception subtransaction restores it.
    caught:=false;
    BEGIN
      DELETE FROM public.moderation_config WHERE key='image_moderation';
      PERFORM public.fn_commit_avatar(u1,avatar);
    EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%moderation_config_missing%'; END;
    ASSERT caught, 'missing flag did not fail closed';
    ASSERT EXISTS (SELECT 1 FROM public.moderation_config WHERE key='image_moderation'),
        'exception subtransaction did not restore flag row';
END;
$spec$;

DO $spec$
DECLARE
    u1 uuid := '19610000-0000-4000-8000-000000000001';
    u2 uuid := '19610000-0000-4000-8000-000000000002';
    t1 uuid := '19610000-2000-4000-8000-000000000001';
    r1 uuid := '19610000-1000-4000-8000-000000000001';
    c text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/19610000-0000-4000-8000-000000000001/'||repeat('c',64)||'.jpg';
    d text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/19610000-0000-4000-8000-000000000001/'||repeat('d',64)||'.jpg';
    raw text := 'https://example.invalid/raw.jpg';
    retry_url text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/19610000-0000-4000-8000-000000000001/'||repeat('7',64)||'.jpg';
    retry_object_id uuid := '1961c000-0000-4000-8000-000000000007';
    retry_nonce uuid := '19617000-0000-4000-8000-000000000001';
    e1 uuid; e2 uuid; retry_entry uuid; night uuid; rate_entry uuid; merge_entry uuid; p_id uuid;
    cascade_photo_ids text[];
    caught boolean;
    j jsonb;
BEGIN
    -- An approved upload survives a failed sink transaction unbound, and the
    -- identical client retry can bind it exactly once after the unrelated
    -- authorization error is corrected.
    INSERT INTO public.image_hash_verdicts (sha256,verdict,likelihoods)
    VALUES (repeat('7',64),'pass','{}') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_image_objects (
      id,user_id,bucket,storage_path,public_url,sha256,state
    ) VALUES (
      retry_object_id,u1,'entry-photos',
      'approved/'||u1||'/'||repeat('7',64)||'.jpg',
      retry_url,repeat('7',64),'approved'
    );
    caught:=false;
    BEGIN
      PERFORM * FROM public.fn_create_entry_with_tables(
        u1,pg_catalog.jsonb_build_object(
          'restaurant_id',r1,'rating',4,'visited_at',now(),
          'client_nonce',retry_nonce,'photo_url',retry_url,
          'photo_urls',pg_catalog.jsonb_build_array(retry_url)
        ),ARRAY['19619999-0000-4000-8000-000000000001'::uuid],ARRAY[u1],NULL
      );
    EXCEPTION WHEN OTHERS THEN
      caught:=SQLERRM LIKE '%table_not_authorized%';
    END;
    ASSERT caught, 'failed-entry fixture did not reach its post-bind rollback';
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.entries e
      WHERE e.user_id=u1 AND e.client_nonce=retry_nonce
    ) AND NOT EXISTS (
      SELECT 1 FROM public.image_object_refs r WHERE r.object_id=retry_object_id
    ), 'failed entry creation leaked its sink row or image refs';
    SELECT x.entry_id INTO retry_entry
    FROM public.fn_create_entry_with_tables(
      u1,pg_catalog.jsonb_build_object(
        'restaurant_id',r1,'rating',4,'visited_at',now(),
        'client_nonce',retry_nonce,'photo_url',retry_url,
        'photo_urls',pg_catalog.jsonb_build_array(retry_url)
      ),ARRAY[t1],ARRAY[u1],NULL
    ) x;
    ASSERT retry_entry IS NOT NULL
       AND (SELECT count(*)=2 FROM public.image_object_refs r
            WHERE r.object_id=retry_object_id)
       AND (SELECT count(*)=1 FROM public.entries e
            WHERE e.user_id=u1 AND e.client_nonce=retry_nonce),
      'retry did not atomically bind the abandoned approved object exactly once per sink';

    -- Approved entry full payload binds one hero plus every exact photo row.
    SELECT x.entry_id INTO e1 FROM public.fn_create_entry_with_tables(
      u1, pg_catalog.jsonb_build_object('restaurant_id',r1,'rating',4.5,'visited_at',now(),
        'visibility','table','photo_url',c,'photo_urls',pg_catalog.jsonb_build_array(c,d)),
      ARRAY[t1],ARRAY[u1],NULL) x;
    ASSERT (SELECT count(*)=3 FROM public.image_object_refs r
            WHERE (r.sink_kind='entry_hero' AND r.sink_id=e1::text)
               OR (r.sink_kind='entry_photo' AND r.sink_id IN (SELECT id::text FROM public.entry_photos WHERE entry_id=e1))),
        'entry writer did not bind hero + exact photo refs';

    caught:=false; BEGIN
      PERFORM * FROM public.fn_create_entry_with_tables(
        u1,pg_catalog.jsonb_build_object('restaurant_id',r1,'rating',4,'visited_at',now(),'photo_url',raw),
        NULL,ARRAY[u1],NULL);
    EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'raw create passed under ON';

    SELECT x.entry_id INTO e2 FROM public.fn_create_entry_with_tables(
      u1,pg_catalog.jsonb_build_object('restaurant_id',r1,'rating',4,'visited_at',now()),
      NULL,ARRAY[u1],NULL) x;
    j:=public.append_entry_photo(e2,u1,c);
    ASSERT (j->>'hero_url')=c, 'first append did not atomically set hero';
    ASSERT EXISTS (SELECT 1 FROM public.image_object_refs WHERE sink_kind='entry_hero' AND sink_id=e2::text),
      'append first-photo hero ref missing';
    caught:=false; BEGIN PERFORM public.append_entry_photo(e2,u1,raw);
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'raw append passed under ON';

    INSERT INTO public.user_image_objects (user_id,bucket,storage_path,public_url,sha256,state)
    VALUES (u2,'entry-photos','approved/'||u2||'/'||repeat('c',64)||'.jpg',
      'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/'||u2||'/'||repeat('c',64)||'.jpg',repeat('c',64),'approved')
    ON CONFLICT DO NOTHING;

    -- Merge-round forwards the full B payload through the same atomic writer.
    caught:=false; BEGIN
      PERFORM public.fn_create_entry_and_merge_round(
        u2,t1,r1,now(),e1,
        pg_catalog.jsonb_build_object('restaurant_id',r1,'rating',4,'visited_at',now(),
          'photo_url',raw,'photo_urls',pg_catalog.jsonb_build_array(raw)),NULL);
    EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'raw merge payload passed under ON';
    j:=public.fn_create_entry_and_merge_round(
      u2,t1,r1,now(),e1,
      pg_catalog.jsonb_build_object('restaurant_id',r1,'rating',4,'visited_at',now(),
        'photo_url','https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/'||u2||'/'||repeat('c',64)||'.jpg',
        'photo_urls',pg_catalog.jsonb_build_array('https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/'||u2||'/'||repeat('c',64)||'.jpg')),
      NULL);
    merge_entry:=(j->>'entry_b_id')::uuid;
    ASSERT (SELECT count(*)=2 FROM public.image_object_refs r
            WHERE (r.sink_kind='entry_hero' AND r.sink_id=merge_entry::text)
               OR (r.sink_kind='entry_photo' AND r.sink_id IN (SELECT id::text FROM public.entry_photos WHERE entry_id=merge_entry))),
      'merge payload did not bind photo + hero refs';

    caught:=false; BEGIN
      PERFORM public.start_round(t1,r1,u1,4,'n','d',ARRAY[raw],ARRAY[u2],true,NULL,NULL,NULL,NULL,NULL);
    EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'raw start_round passed under ON';
    j:=public.start_round(t1,r1,u1,4,'n','d',ARRAY[c,d],ARRAY[u2],true,NULL,NULL,NULL,NULL,NULL);
    night:=(j->>'night_id')::uuid; e2:=(j->>'entry_id')::uuid;
    ASSERT (SELECT count(*)=3 FROM public.image_object_refs r
            WHERE (r.sink_kind='entry_hero' AND r.sink_id=e2::text)
               OR (r.sink_kind='entry_photo' AND r.sink_id IN (SELECT id::text FROM public.entry_photos WHERE entry_id=e2))),
      'start_round dual refs missing';
    caught:=false; BEGIN
      PERFORM public.rate_round(night,u2,3.5,'n','d',ARRAY[raw],NULL,NULL,NULL,NULL,NULL);
    EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'raw rate_round passed under ON';

    -- Give U2 its own approved entry object; cross-user reuse must remain denied.
    j:=public.rate_round(night,u2,3.5,'n','d',ARRAY[
      'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/'||u2||'/'||repeat('c',64)||'.jpg'
    ],NULL,NULL,NULL,NULL,NULL);
    rate_entry:=(j->>'entry_id')::uuid;
    ASSERT (SELECT count(*)=2 FROM public.image_object_refs r
            WHERE (r.sink_kind='entry_hero' AND r.sink_id=rate_entry::text)
               OR (r.sink_kind='entry_photo' AND r.sink_id IN (SELECT id::text FROM public.entry_photos WHERE entry_id=rate_entry))),
      'rate_round entry_photo + hero refs missing';

    -- Direct pre-B-2 photo delete still reaches the trigger queue.
    SELECT id INTO p_id FROM public.entry_photos WHERE entry_id=e1 ORDER BY sort_order LIMIT 1;
    DELETE FROM public.entry_photos WHERE id=p_id;
    ASSERT EXISTS (SELECT 1 FROM public.image_gc_queue WHERE sink_kind='entry_photo' AND sink_id=p_id::text),
      'direct entry_photo delete did not enqueue';
    SELECT pg_catalog.array_agg(ep.id::text ORDER BY ep.id)
    INTO cascade_photo_ids
    FROM public.entry_photos ep WHERE ep.entry_id=e2;
    ASSERT pg_catalog.cardinality(cascade_photo_ids)=2,
      'cascade fixture did not retain both start_round photos';
    DELETE FROM public.entries WHERE id=e2;
    ASSERT EXISTS (SELECT 1 FROM public.image_gc_queue WHERE sink_kind='entry_hero' AND sink_id=e2::text),
      'entry cascade did not enqueue hero';
    ASSERT NOT EXISTS (
      SELECT expected.sink_id
      FROM pg_catalog.unnest(cascade_photo_ids) AS expected(sink_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.image_gc_queue q
        WHERE q.sink_kind='entry_photo'
          AND q.sink_id=expected.sink_id
          AND q.reason='entry_photo_delete'
      )
    ), 'entry cascade did not enqueue every exact photo sink';
    ASSERT (SELECT pg_catalog.count(DISTINCT q.sink_id)=pg_catalog.cardinality(cascade_photo_ids)
            FROM public.image_gc_queue q
            WHERE q.sink_kind='entry_photo' AND q.sink_id=ANY(cascade_photo_ids)),
      'entry cascade photo assertion was satisfied by an unrelated queue row';
END;
$spec$;

DO $spec$
DECLARE
    u3 uuid := '19610000-0000-4000-8000-000000000003';
    u2 uuid := '19610000-0000-4000-8000-000000000002';
    crashed_stage_id uuid := '19613000-0000-4000-8000-000000000002';
    j jsonb; path text; gen bigint; caught boolean; i integer;
    old_token bigint; new_token bigint; old_run uuid; new_run uuid; old_incident uuid;
    old_scan bigint; new_scan bigint;
BEGIN
    -- Generation claim is single-use and returns the consumed NEW generation.
    j:=public.fn_begin_stage(u3); path:=j->>'staging_path'; gen:=(j->>'generation')::bigint;
    j:=public.fn_claim_stage_put(u3,path,gen);
    ASSERT (j->>'state')='putting' AND (j->>'generation')::bigint=gen+1,
      'byte-arrival claim did not consume generation';
    caught:=false; BEGIN PERFORM public.fn_claim_stage_put(u3,path,gen);
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%stage_claim_conflict%'; END;
    ASSERT caught, 'replayed stage generation was accepted';

    INSERT INTO public.staging_reservations (
      id,user_id,staging_path,state,generation,lease_expires,byte_count,content_type
    ) VALUES (
      '19613000-0000-4000-8000-000000000001',u3,
      u3::text||'/19613000-0000-4000-8000-000000000001',
      'staged',1,now()+interval '1 hour',1024,'image/jpeg'
    );

    -- Exercise the real ownership/state guard, not an Edge fake returning the
    -- desired error.  Only the owning caller with an exact staged reservation
    -- may reach download/decode.
    caught:=false;
    BEGIN
      PERFORM public.fn_assert_stage_moderatable(
        u2,u3::text||'/19613000-0000-4000-8000-000000000001'
      );
    EXCEPTION WHEN OTHERS THEN
      caught:=SQLERRM LIKE '%stage_not_moderatable%';
    END;
    ASSERT caught, 'cross-user staged reservation passed the SQL authz guard';
    caught:=false;
    BEGIN
      PERFORM public.fn_assert_stage_moderatable(
        u3,u3::text||'/19613000-0000-4000-8000-000000000099'
      );
    EXCEPTION WHEN OTHERS THEN
      caught:=SQLERRM LIKE '%stage_not_moderatable%';
    END;
    ASSERT caught, 'non-staging path passed the SQL authz guard';
    j:=public.fn_assert_stage_moderatable(
      u3,u3::text||'/19613000-0000-4000-8000-000000000001'
    );
    ASSERT (j->>'state')='staged' AND (j->>'reservation_id')::uuid=
      '19613000-0000-4000-8000-000000000001'::uuid,
      'own staged reservation failed the SQL authz guard';

    -- Crash-after-PUT: finish_stage never runs, so an expired putting lease
    -- must be generation-invalidated, retried after an injected Storage
    -- failure, and finally removed by the ordinary staging-GC saga.
    INSERT INTO public.staging_reservations (
      id,user_id,staging_path,state,generation,lease_expires,byte_count,content_type
    ) VALUES (
      crashed_stage_id,u2,u2::text||'/'||crashed_stage_id::text,
      'putting',9,now()-interval '1 second',2048,'image/jpeg'
    );
    j:=public.fn_claim_staging_gc('stage-crash-1',50);
    ASSERT j @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id',crashed_stage_id,'state','cleanup_required','generation',10
    )), 'expired post-PUT reservation was not generation-fenced for GC';
    ASSERT public.fn_finish_staging_gc(
      crashed_stage_id,'stage-crash-1',false,'injected storage failure'
    ), 'staging GC failure was not persisted for retry';
    j:=public.fn_claim_staging_gc('stage-crash-2',50);
    ASSERT j @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id',crashed_stage_id
    )), 'failed post-PUT cleanup was not reclaimable';
    ASSERT public.fn_finish_staging_gc(
      crashed_stage_id,'stage-crash-2',true,NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM public.staging_reservations r WHERE r.id=crashed_stage_id
    ), 'reclaimed post-PUT cleanup did not reach terminal removal';

    -- Freeze invalidates post-fence putting and persists the active-writer bound.
    j:=public.fn_freeze_account_deletion(u3);
    ASSERT (j->>'state')='draining', 'freeze did not enter draining';
    ASSERT (j->>'quiesce_after')::timestamptz >=
      (SELECT created_at+interval '730 seconds' FROM public.staging_reservations WHERE staging_path=path),
      'durable quiesce_after does not cover active writer';
    ASSERT (SELECT state='cleanup_required' AND generation>=gen+2
            FROM public.staging_reservations WHERE staging_path=path),
      'freeze did not generation-invalidate putting reservation';
    ASSERT (SELECT state='cleanup_required'
            FROM public.staging_reservations
            WHERE id='19613000-0000-4000-8000-000000000001'),
      'freeze left an ordinary staged reservation outside cleanup';
    ASSERT j->'staging_paths' @> pg_catalog.jsonb_build_array(
      u3::text||'/19613000-0000-4000-8000-000000000001'),
      'freeze inventory omitted a known staged path';

    -- A moderate request that crossed staging before freeze must not recreate
    -- its per-user budget/ledger rows after deletion cleanup.
    caught:=false; BEGIN PERFORM public.fn_debit_image_compute(u3);
      EXCEPTION WHEN SQLSTATE '55000' THEN caught:=true; END;
    ASSERT caught, 'post-freeze compute debit was not lifecycle-fenced';
    caught:=false; BEGIN PERFORM public.fn_debit_scan_budget(u3,'general');
      EXCEPTION WHEN SQLSTATE '55000' THEN caught:=true; END;
    ASSERT caught, 'post-freeze scan debit was not lifecycle-fenced';
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.image_compute_budget b
      WHERE b.scope='user' AND b.subject_id=u3
    ), 'post-freeze compute debit recreated a user budget';
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.image_scan_budget b
      WHERE b.scope='user' AND b.subject_id=u3
    ), 'post-freeze scan debit recreated a user budget';
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.image_moderation_ledger l WHERE l.user_id=u3
    ), 'post-freeze scan debit recreated a ledger row';

    -- Compute 30/hour user boundary is atomic; the 31st fails.
    FOR i IN 1..30 LOOP PERFORM public.fn_debit_image_compute(u2); END LOOP;
    caught:=false; BEGIN PERFORM public.fn_debit_image_compute(u2);
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%compute_user_cap_exhausted%'; END;
    ASSERT caught, 'compute user cap did not stop request 31';

    -- Staging issue rate is exactly 10/user/hour.
    FOR i IN 1..10 LOOP PERFORM public.fn_begin_stage(u2); END LOOP;
    caught:=false; BEGIN PERFORM public.fn_begin_stage(u2);
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%staging_rate_exhausted%'; END;
    ASSERT caught, 'staging rate did not stop request 11';

    -- Paid scan partitions are 395 general + 100 sweep + 5 canary = 500;
    -- general also enforces 20/user/day.
    FOR i IN 1..20 LOOP PERFORM public.fn_debit_scan_budget(u2,'general'); END LOOP;
    caught:=false; BEGIN PERFORM public.fn_debit_scan_budget(u2,'general');
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%scan_user_cap_exhausted%'; END;
    ASSERT caught, 'paid user cap did not stop request 21';
    FOR i IN 1..100 LOOP PERFORM public.fn_debit_scan_budget(u2,'sweep'); END LOOP;
    caught:=false; BEGIN PERFORM public.fn_debit_scan_budget(u2,'sweep');
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%scan_project_cap_exhausted%'; END;
    ASSERT caught, 'sweep reserved cap exceeded 100';
    FOR i IN 1..5 LOOP PERFORM public.fn_debit_scan_budget(u2,'canary'); END LOOP;
    caught:=false; BEGIN PERFORM public.fn_debit_scan_budget(u2,'canary');
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%scan_project_cap_exhausted%'; END;
    ASSERT caught, 'canary reserved cap exceeded 5';
    ASSERT (SELECT sum(used)<=500 FROM public.image_scan_budget WHERE scope<>'user'),
      'project paid pools exceed 500/day';

    -- Per-hash lease takeover fences stale verdict/release writes.
    j:=public.fn_acquire_scan_lease(repeat('f',64),'old-scan'); old_scan:=(j->>'fencing_token')::bigint;
    UPDATE public.image_scan_leases SET expires_at=now()-interval '1 second' WHERE sha256=repeat('f',64);
    j:=public.fn_acquire_scan_lease(repeat('f',64),'new-scan'); new_scan:=(j->>'fencing_token')::bigint;
    ASSERT new_scan>old_scan, 'scan fencing token did not increase';
    ASSERT NOT (public.fn_commit_image_verdict(repeat('f',64),'old-scan',old_scan,'pass','{}')->>'committed')::boolean,
      'stale scan owner committed verdict';
    ASSERT (public.fn_commit_image_verdict(repeat('f',64),'new-scan',new_scan,'pass','{}')->>'committed')::boolean,
      'current scan owner could not commit verdict';

    -- Fenced job takeover terminalizes the stale run, preserves its incident,
    -- and refuses to bypass the retry backoff.
    j:=public.fn_claim_moderation_job('reconcile','old',60,'ops@example.invalid');
    old_token:=(j->>'fence_token')::bigint; old_run:=(j->>'run_id')::uuid;
    old_incident:=(j->>'incident_id')::uuid;
    UPDATE public.job_leases SET lease_expires=now()-interval '1 second' WHERE job_name='reconcile';
    j:=public.fn_claim_moderation_job('reconcile','new',60,'ops@example.invalid');
    ASSERT j IS NULL, 'lease-expired run bypassed retry backoff';
    ASSERT (SELECT status='failed' AND error='lease_expired'
                   AND incident_id=old_incident AND next_attempt_at>now()
            FROM public.job_runs WHERE id=old_run),
      'stale running row was not fenced terminal with its incident retained';
    ASSERT NOT public.fn_complete_moderation_job('reconcile','old',old_token,old_run,1,NULL),
      'superseded job completed';
    UPDATE public.job_runs SET next_attempt_at=now()-interval '1 second' WHERE id=old_run;
    j:=public.fn_claim_moderation_job('reconcile','new',60,'ops@example.invalid');
    new_token:=(j->>'fence_token')::bigint; new_run:=(j->>'run_id')::uuid;
    ASSERT new_token>old_token, 'job fence token did not increase';
    ASSERT (j->>'incident_id')::uuid=old_incident AND (j->>'attempt')::integer=2,
      'lease-expired retry did not retain incident and increment attempt';
    ASSERT public.fn_renew_moderation_job('reconcile','new',new_token,new_run,300),
      'current fenced job could not renew';
    ASSERT NOT public.fn_renew_moderation_job('reconcile','old',old_token,old_run,300),
      'superseded job renewed its lease';
    ASSERT public.fn_complete_moderation_job('reconcile','new',new_token,new_run,1,'registry:cursor-1'),
      'current fenced job could not complete';
    j:=public.fn_claim_moderation_job('reconcile','resume',60,'ops@example.invalid');
    ASSERT j->>'cursor'='registry:cursor-1',
      'claim did not return the latest successful durable cursor';
    ASSERT public.fn_complete_moderation_job(
      'reconcile','resume',(j->>'fence_token')::bigint,(j->>'run_id')::uuid,0,j->>'cursor'),
      'cursor-resumption fixture could not complete';
END;
$spec$;

-- Expired outbox claims remain subject to durable retry timing, are reclaimable
-- once due, and fence the worker that held the expired claim.
DO $spec$
DECLARE
    key text := 'ticket196-expired-outbox-claim';
    first_claim jsonb;
    reclaimed jsonb;
BEGIN
    INSERT INTO public.email_outbox (
      idempotency_key,incident_id,job_name,alarm_kind,to_addr,subject,body,
      provider_idem_key,created_at
    ) VALUES (
      key,'19610000-0000-4000-8000-000000000099','outbox-reclaim-spec',
      'expired_claim','ops@example.invalid','expired claim fixture',
      'expired claim fixture',key,'2000-01-01 00:00:00+00'
    );

    first_claim:=public.fn_claim_email_outbox('outbox-worker-old',1);
    ASSERT pg_catalog.jsonb_array_length(first_claim)=1
       AND first_claim->0->>'idempotency_key'=key
       AND (first_claim->0->>'attempt')::integer=1,
      'pending outbox fixture was not claimed exactly once';

    UPDATE public.email_outbox
    SET claim_expires=now()-interval '1 second',
        next_attempt_at=now()+interval '1 hour'
    WHERE idempotency_key=key;
    ASSERT public.fn_claim_email_outbox('outbox-worker-too-soon',1)='[]'::jsonb,
      'expired outbox claim bypassed its durable next_attempt_at backoff';

    UPDATE public.email_outbox
    SET next_attempt_at=now()-interval '1 second'
    WHERE idempotency_key=key;
    reclaimed:=public.fn_claim_email_outbox('outbox-worker-new',1);
    ASSERT pg_catalog.jsonb_array_length(reclaimed)=1
       AND reclaimed->0->>'idempotency_key'=key
       AND reclaimed->0->>'claimed_by'='outbox-worker-new'
       AND (reclaimed->0->>'attempt')::integer=2,
      'due expired outbox claim was not reclaimed with an incremented attempt';
    ASSERT NOT public.fn_finish_email_outbox(
      key,'outbox-worker-old',true,NULL
    ), 'expired outbox worker terminalized a reclaimed row';
    ASSERT public.fn_finish_email_outbox(
      key,'outbox-worker-new',true,NULL
    ), 'current outbox worker could not terminalize its reclaimed row';
    ASSERT (SELECT state='sent' AND sent_at IS NOT NULL
            FROM public.email_outbox WHERE idempotency_key=key),
      'reclaimed outbox row did not persist its terminal sent state';
END;
$spec$;

DO $spec$
DECLARE
    jobs text[] := ARRAY['grandfather','gc_staging','gc_unbound','gc_refdriven','reconcile','account_cleanup'];
    job text; holder text; j jsonb; token bigint; run_id uuid; attempt integer;
    retry_incident uuid; backlog jsonb; findings jsonb; usage jsonb;
BEGIN
    -- An ordinary failed run cannot be reclaimed before next_attempt_at; after
    -- advancing the durable timestamp it resumes the same incident at attempt 2.
    j:=public.fn_claim_moderation_job('alarm_selftest','backoff-1',60,'ops@example.invalid');
    token:=(j->>'fence_token')::bigint; run_id:=(j->>'run_id')::uuid;
    retry_incident:=(j->>'incident_id')::uuid;
    ASSERT public.fn_fail_moderation_job(
      'alarm_selftest','backoff-1',token,run_id,'backoff',now()+interval '1 hour','ops@example.invalid'),
      'backoff fixture failure was not recorded';
    ASSERT public.fn_claim_moderation_job(
      'alarm_selftest','backoff-too-soon',60,'ops@example.invalid') IS NULL,
      'immediate retry bypassed next_attempt_at';
    ASSERT (SELECT holder IS NULL AND lease_expires IS NULL FROM public.job_leases
            WHERE job_name='alarm_selftest'),
      'backoff denial did not release newly-acquired lease';
    UPDATE public.job_runs SET next_attempt_at=now()-interval '1 second' WHERE id=run_id;
    j:=public.fn_claim_moderation_job('alarm_selftest','backoff-2',60,'ops@example.invalid');
    ASSERT (j->>'incident_id')::uuid=retry_incident AND (j->>'attempt')::integer=2,
      'eligible retry did not reuse incident at attempt 2';
    ASSERT public.fn_complete_moderation_job(
      'alarm_selftest','backoff-2',(j->>'fence_token')::bigint,(j->>'run_id')::uuid,1,NULL),
      'eligible backoff retry could not complete';

    -- A lease crash on attempt three is itself an exhausted failure; claim
    -- terminalizes it and atomically persists the retry alarm before returning.
    FOR attempt IN 1..2 LOOP
      holder:='ops-crash-'||attempt;
      j:=public.fn_claim_moderation_job('ops-alarm',holder,60,'ops@example.invalid');
      ASSERT (j->>'attempt')::integer=attempt, 'ops crash fixture attempt mismatch';
      ASSERT public.fn_fail_moderation_job(
        'ops-alarm',holder,(j->>'fence_token')::bigint,(j->>'run_id')::uuid,
        'pre-crash failure',now(),'ops@example.invalid'),
        'ops crash fixture failure was not recorded';
    END LOOP;
    j:=public.fn_claim_moderation_job('ops-alarm','ops-crash-3',60,'ops@example.invalid');
    ASSERT (j->>'attempt')::integer=3, 'ops crash fixture did not reach attempt 3';
    run_id:=(j->>'run_id')::uuid;
    UPDATE public.job_leases SET lease_expires=now()-interval '1 second'
    WHERE job_name='ops-alarm';
    ASSERT public.fn_claim_moderation_job(
      'ops-alarm','ops-crash-takeover',60,'ops@example.invalid') IS NULL,
      'attempt-3 lease crash bypassed terminal backoff';
    ASSERT (SELECT status='failed' AND error='lease_expired'
            FROM public.job_runs WHERE id=run_id),
      'attempt-3 lease crash did not terminalize the run';
    ASSERT EXISTS (
      SELECT 1 FROM public.email_outbox o
      WHERE o.job_name='ops-alarm' AND o.alarm_kind='retry_exhausted'
    ), 'attempt-3 lease crash lost its atomic escalation';

    -- Every background job uses the same bounded three-attempt escalation path.
    FOREACH job IN ARRAY jobs LOOP
      FOR attempt IN 1..3 LOOP
        holder:=job||'-'||attempt;
        j:=public.fn_claim_moderation_job(job,holder,60,'ops@example.invalid');
        ASSERT j IS NOT NULL AND (j->>'attempt')::integer=attempt,
          format('%s did not reuse incident attempt %s',job,attempt);
        token:=(j->>'fence_token')::bigint; run_id:=(j->>'run_id')::uuid;
        ASSERT public.fn_fail_moderation_job(
          job,holder,token,run_id,'forced failure',now(),'ops@example.invalid'),
          format('%s forced failure was not fenced',job);
      END LOOP;
      ASSERT (SELECT count(*)=1 FROM public.email_outbox o
              WHERE o.job_name=job AND o.alarm_kind='retry_exhausted'),
        format('%s attempt-3 failure did not atomically enqueue exhaustion',job);
      ASSERT public.fn_enqueue_job_alarm(run_id,'forced_failure','ops@example.invalid',
        'forced failure',job||' forced failure'),
        format('%s did not enqueue exhausted alarm',job);
      ASSERT (SELECT count(*)=1 FROM public.email_outbox o
              WHERE o.job_name=job AND o.alarm_kind='forced_failure'),
        format('%s alarm was not idempotent',job);
    END LOOP;
    j:=public.fn_enqueue_alarm_selftest('ops@example.invalid');
    ASSERT EXISTS (SELECT 1 FROM public.email_outbox WHERE idempotency_key=j->>'idempotency_key'),
      'manual alarm selftest did not reach outbox';
    backlog:=public.fn_moderation_job_backlog('gc_staging');
    ASSERT (backlog->>'backlog_count')::bigint>0
           AND (backlog->>'oldest_pending_at')::timestamptz IS NOT NULL,
      'staging backlog snapshot did not measure eligible cleanup rows';
    backlog:=public.fn_moderation_job_backlog('reconcile');
    ASSERT (backlog->>'backlog_count')::bigint>0,
      'reconcile backlog snapshot did not measure promoting/missing registry work';
    findings:=public.fn_list_reconcile_findings(NULL,100);
    ASSERT findings->'rows' @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'kind','promoting_object_missing',
      'object_id','1961e000-0000-4000-8000-000000000001'
    )), 'bounded reconcile page omitted promoting/missing registry finding';
    usage:=public.fn_reconcile_staging_usage();
    ASSERT (usage->>'objects')::bigint>=0 AND (usage->>'bytes')::numeric>=0,
      'reconcile staging usage did not return nonnegative exact totals';
    backlog:=public.fn_moderation_job_backlog('grandfather');
    ASSERT (backlog->>'backlog_count')::bigint=0
           AND backlog->'oldest_pending_at' = 'null'::jsonb,
      'disabled grandfather gate exposed a runnable backlog';
    j:=public.fn_claim_moderation_job('gc_staging','alarm-eval',60,'ops@example.invalid');
    token:=(j->>'fence_token')::bigint; run_id:=(j->>'run_id')::uuid;
    j:=public.fn_evaluate_moderation_job_alarms(
      'gc_staging',run_id,0,2,now()-interval '25 hours','ops@example.invalid');
    ASSERT (j->>'backlog_age_enqueued')::boolean
       AND NOT (j->>'stuck_progress_enqueued')::boolean,
      'an empty/unknown prior backlog caused a false first-run stuck alarm';
    ASSERT public.fn_complete_moderation_job('gc_staging','alarm-eval',token,run_id,0,NULL),
      'alarm-evaluation run could not complete';
    j:=public.fn_claim_moderation_job('gc_staging','alarm-stuck-second',60,'ops@example.invalid');
    token:=(j->>'fence_token')::bigint; run_id:=(j->>'run_id')::uuid;
    j:=public.fn_evaluate_moderation_job_alarms(
      'gc_staging',run_id,0,2,now()-interval '25 hours','ops@example.invalid');
    ASSERT (j->>'stuck_progress_enqueued')::boolean,
      'two nonempty zero-progress runs did not enqueue stuck-progress';
    ASSERT public.fn_complete_moderation_job(
      'gc_staging','alarm-stuck-second',token,run_id,0,NULL
    ), 'second stuck-progress run could not complete';
    j:=public.fn_claim_moderation_job('gc_staging','alarm-progress',60,'ops@example.invalid');
    token:=(j->>'fence_token')::bigint; run_id:=(j->>'run_id')::uuid;
    j:=public.fn_evaluate_moderation_job_alarms(
      'gc_staging',run_id,1,2,now()-interval '25 hours','ops@example.invalid');
    ASSERT NOT (j->>'stuck_progress_enqueued')::boolean,
      'productive current run was falsely classified as stuck';
    ASSERT public.fn_complete_moderation_job('gc_staging','alarm-progress',token,run_id,1,NULL),
      'productive alarm-evaluation run could not complete';
END;
$spec$;

-- GC row-lock behavior and registry-missing repair.
DO $spec$
DECLARE
    u1 uuid := '19610000-0000-4000-8000-000000000001';
    u2 uuid := '19610000-0000-4000-8000-000000000002';
    avatar text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/19610000-0000-4000-8000-000000000001/'||repeat('a',64)||'.jpg';
    oid uuid := '1961a000-0000-4000-8000-000000000001';
    promoting_oid uuid := '1961e000-0000-4000-8000-000000000001';
    promoting_path text := 'approved/19610000-0000-4000-8000-000000000001/'||repeat('e',64)||'.jpg';
    orphan_path text := 'approved/19610000-0000-4000-8000-000000000002/'||repeat('6',64)||'.jpg';
    orphan_url text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/19610000-0000-4000-8000-000000000002/'||repeat('6',64)||'.jpg';
    orphan_oid uuid := '1961a000-0000-4000-8000-000000000006';
    orphan_q1 uuid;
    orphan_q2 uuid;
    promotion_race_path text := 'approved/19610000-0000-4000-8000-000000000002/'||repeat('3',64)||'.jpg';
    promotion_race_url text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/19610000-0000-4000-8000-000000000002/'||repeat('3',64)||'.jpg';
    promotion_race_q uuid;
    nonterminal_oid uuid := '1961a000-0000-4000-8000-000000000009';
    nonterminal_url text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/19610000-0000-4000-8000-000000000002/'||repeat('9',64)||'.jpg';
    unbound_id uuid := '1961f000-0000-4000-8000-000000000001';
    legacy_entry uuid;
    legacy_photo uuid;
    legacy_queue uuid;
    legacy_url text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/'
        ||'19610000-0000-4000-8000-000000000001/shared-legacy.jpg';
    j jsonb;
    caught boolean;
BEGIN
    j:=public.fn_claim_image_object_gc(oid,'gc-a','test');
    ASSERT NOT (j->>'claimed')::boolean AND (j->>'has_refs')::boolean,
      'GC claimed a referenced avatar';
    -- The discovery page said "present", but bytes disappeared before repair:
    -- the repair RPC must ignore that stale true and re-read Storage itself.
    j:=public.fn_reconcile_registry_object(oid,true);
    ASSERT (j->>'repaired_storage_missing')::boolean, 'missing approved storage was not repaired';
    ASSERT (SELECT avatar_url IS NULL FROM public.profiles WHERE user_id=u1),
      'missing storage left live avatar sink';
    ASSERT NOT EXISTS (SELECT 1 FROM public.user_image_objects WHERE id=oid),
      'missing storage left registry row';
    ASSERT EXISTS (SELECT 1 FROM public.image_moderation_notifications
                   WHERE user_id=u1 AND sink_kind='avatar' AND payload->>'reason'='registry_storage_missing'),
      'missing storage did not notify owner';
    ASSERT (SELECT count(*)=1 FROM public.notifications
            WHERE user_id=u1 AND kind='image_rejected'
              AND subject_meta->>'sink_kind'='avatar'
              AND subject_meta->>'sink_id'=u1::text
              AND subject_meta->>'reason'='registry_storage_missing'),
      'missing storage rejection did not reach the visible inbox exactly once';

    -- Conversely, a path discovered as missing may be restored before repair;
    -- stale false must not clear sinks/delete the registry row.
    INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES ('avatars', promoting_path, pg_catalog.jsonb_build_object('size', 128))
    ON CONFLICT DO NOTHING;
    j:=public.fn_reconcile_registry_object(promoting_oid,false);
    ASSERT j->>'state'='approved'
       AND EXISTS (SELECT 1 FROM public.user_image_objects
                   WHERE id=promoting_oid AND state='approved'),
      'stale missing snapshot deleted/restored promotion bytes';

    orphan_q1:=public.fn_enqueue_orphan_storage_object('avatars',orphan_path);
    orphan_q2:=public.fn_enqueue_orphan_storage_object('avatars',orphan_path);
    ASSERT orphan_q1=orphan_q2
       AND (SELECT count(*)=1 FROM public.image_gc_queue
            WHERE reason='namespace_orphan' AND bucket='avatars'
              AND path=orphan_path AND state<>'done'),
      'repeated reconciliation duplicated a live namespace-orphan delete';

    -- A registry can appear after orphan discovery.  Enqueue rechecks that
    -- boundary, and already-queued stale work is cancelled at consumption
    -- without bypassing bind fencing / the 48h unbound TTL.
    INSERT INTO public.user_image_objects (
      id,user_id,bucket,storage_path,public_url,sha256,state
    ) VALUES (
      orphan_oid,u2,'avatars',orphan_path,orphan_url,repeat('6',64),'approved'
    );
    ASSERT public.fn_enqueue_orphan_storage_object('avatars',orphan_path) IS NULL,
      'orphan enqueue ignored a newly registered physical path';
    PERFORM public.fn_commit_avatar(u2,orphan_url);
    UPDATE public.image_gc_queue
    SET state='claimed',claimed_by='orphan-stale',
        lease_expires=now()+interval '5 minutes'
    WHERE id=orphan_q1;
    j:=public.fn_unlink_gc_ref(orphan_q1,'orphan-stale');
    ASSERT (j->>'cancelled_registry_restored')::boolean
       AND EXISTS (SELECT 1 FROM public.user_image_objects WHERE id=orphan_oid)
       AND EXISTS (SELECT 1 FROM public.image_object_refs WHERE object_id=orphan_oid)
       AND (SELECT state='done' FROM public.image_gc_queue WHERE id=orphan_q1),
      'stale orphan work deleted a registered/bound object';

    INSERT INTO public.image_hash_verdicts (sha256,verdict,likelihoods)
    VALUES (repeat('3',64),'pass','{}') ON CONFLICT DO NOTHING;
    promotion_race_q:=public.fn_enqueue_orphan_storage_object(
      'avatars',promotion_race_path
    );
    UPDATE public.image_gc_queue
    SET state='claimed',claimed_by='orphan-delete',
        lease_expires=now()+interval '5 minutes'
    WHERE id=promotion_race_q;
    j:=public.fn_unlink_gc_ref(promotion_race_q,'orphan-delete');
    ASSERT j->>'legacy_path'=promotion_race_path,
      'orphan fixture did not reach external-delete state';
    caught:=false;
    BEGIN
      PERFORM public.fn_begin_image_promotion(
        u2,'avatars',repeat('3',64),promotion_race_url
      );
    EXCEPTION WHEN OTHERS THEN
      caught:=SQLERRM LIKE '%promotion_orphan_delete_in_flight%';
    END;
    ASSERT caught AND NOT EXISTS (
      SELECT 1 FROM public.user_image_objects
      WHERE bucket='avatars' AND storage_path=promotion_race_path
    ), 'promotion raced an orphan Storage delete already in flight';
    ASSERT public.fn_finish_gc_queue(
      promotion_race_q,'orphan-delete',true,NULL
    ), 'orphan external-delete fixture could not finish';
    j:=public.fn_begin_image_promotion(
      u2,'avatars',repeat('3',64),promotion_race_url
    );
    ASSERT (j->>'needs_copy')::boolean,
      'promotion retry did not proceed after orphan delete became terminal';

    INSERT INTO public.user_image_objects (
      id,user_id,bucket,storage_path,public_url,sha256,state
    ) VALUES (
      nonterminal_oid,u2,'avatars','approved/'||u2||'/'||repeat('9',64)||'.jpg',
      nonterminal_url,repeat('9',64),'gc_pending'
    );
    caught:=false;
    BEGIN
      PERFORM public.fn_bind_image_ref(
        u2,nonterminal_url,'avatars','avatar',u2::text,false
      );
    EXCEPTION WHEN OTHERS THEN
      caught:=SQLERRM LIKE '%image_object_not_bindable%';
    END;
    ASSERT caught AND NOT EXISTS (
      SELECT 1 FROM public.image_object_refs WHERE object_id=nonterminal_oid
    ), 'OFF compatibility rebound a known gc_pending object as legacy raw';
    DELETE FROM public.user_image_objects WHERE id=nonterminal_oid;

    -- A failed unbound delete returns to gc_pending and must be reclaimable;
    -- an expired deleting lease is likewise reclaimable by a competing worker.
    INSERT INTO public.user_image_objects (
      id,user_id,bucket,storage_path,public_url,sha256,state,created_at
    ) VALUES (
      unbound_id,u1,'avatars','approved/'||u1||'/'||repeat('f',64)||'.jpg',
      'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/'||u1||'/'||repeat('f',64)||'.jpg',
      repeat('f',64),'approved',now()-interval '49 hours'
    );
    j:=public.fn_claim_unbound_image_gc('unbound-1',10);
    ASSERT j @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('object_id',unbound_id)),
      'eligible unbound object was not claimed';
    ASSERT public.fn_finish_image_object_gc(unbound_id,'unbound-1',false,'injected'),
      'unbound failure transition was rejected';
    ASSERT (SELECT state='gc_pending' FROM public.user_image_objects WHERE id=unbound_id),
      'failed unbound delete did not return to gc_pending';
    j:=public.fn_claim_unbound_image_gc('unbound-2',10);
    ASSERT j @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('object_id',unbound_id)),
      'gc_pending unbound retry was stranded';
    UPDATE public.user_image_objects
    SET gc_lease_expires=now()-interval '1 second' WHERE id=unbound_id;
    ASSERT NOT public.fn_finish_image_object_gc(unbound_id,'unbound-2',true,NULL),
      'expired object-GC worker retained finish authority';
    j:=public.fn_claim_unbound_image_gc('unbound-3',10);
    ASSERT j @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('object_id',unbound_id)),
      'expired deleting unbound retry was stranded';
    ASSERT public.fn_finish_image_object_gc(unbound_id,'unbound-3',true,NULL),
      'reclaimed unbound object could not finish';

    -- Legacy bytes may be shared across a hero + photo sink.  Processing one
    -- grandfather/trigger queue must defer physical deletion until every exact
    -- legacy reference disappears.
    INSERT INTO public.entries (user_id,content,photo_url)
    VALUES (u1,'shared legacy GC fixture',legacy_url) RETURNING id INTO legacy_entry;
    INSERT INTO public.entry_photos (entry_id,photo_url,sort_order)
    VALUES (legacy_entry,legacy_url,0) RETURNING id INTO legacy_photo;
    INSERT INTO public.image_gc_queue (reason,bucket,path)
    VALUES ('grandfather_rebound','entry-photos',legacy_url) RETURNING id INTO legacy_queue;
    j:=public.fn_claim_gc_queue('legacy-share-1',100);
    ASSERT j @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',legacy_queue)),
      'legacy shared-path queue was not claimed';
    j:=public.fn_unlink_gc_ref(legacy_queue,'legacy-share-1');
    ASSERT (j->>'deferred_shared_legacy')::boolean,
      'legacy GC did not defer while another exact sink remained';
    ASSERT (SELECT state='pending' AND claimed_by IS NULL FROM public.image_gc_queue
            WHERE id=legacy_queue),
      'deferred legacy queue did not release its claim';
    ASSERT (SELECT photo_url=legacy_url FROM public.entries WHERE id=legacy_entry)
       AND (SELECT photo_url=legacy_url FROM public.entry_photos WHERE id=legacy_photo),
      'legacy deferral mutated a live sink';

    UPDATE public.entries SET photo_url=NULL WHERE id=legacy_entry;
    DELETE FROM public.entry_photos WHERE id=legacy_photo;
    UPDATE public.image_gc_queue SET next_attempt_at=now()-interval '1 second'
    WHERE id=legacy_queue;
    j:=public.fn_claim_gc_queue('legacy-share-2',100);
    ASSERT j @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',legacy_queue)),
      'fully-unreferenced legacy queue was not reclaimed';
    j:=public.fn_unlink_gc_ref(legacy_queue,'legacy-share-2');
    ASSERT j->>'legacy_path'=legacy_url,
      'legacy bytes did not become deletable after the final sink cleared';
    ASSERT public.fn_finish_gc_queue(legacy_queue,'legacy-share-2',true,NULL),
      'legacy shared-path queue could not finish';
END;
$spec$;

-- A B-0/B-1 legacy direct writer can replace a bound approved sink without
-- touching its registry ref.  Foreign quarantine and rejected sweep outcomes
-- must remove that stale ref transactionally while hiding the raw sink.
DO $spec$
DECLARE
    u1 uuid := '19610000-0000-4000-8000-000000000001';
    u2 uuid := '19610000-0000-4000-8000-000000000002';
    avatar_oid uuid := '1961a000-0000-4000-8000-000000000006';
    hero_oid uuid := '1961c000-0000-4000-8000-000000000001';
    hero_approved text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/'
        ||'19610000-0000-4000-8000-000000000001/'||repeat('c',64)||'.jpg';
    foreign_avatar text := 'https://foreign.invalid/avatar.jpg';
    rejected_hero text := 'https://foreign.invalid/rejected-hero.jpg';
    legacy_pass_url text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/'
        ||'19610000-0000-4000-8000-000000000001/grandfather-pass.jpg';
    hero_entry uuid;
    pass_entry uuid;
    pass_result jsonb;
BEGIN
    UPDATE public.moderation_config SET enforce=true
    WHERE key='grandfather_sweep';

    INSERT INTO public.entries (user_id,content,photo_url)
    VALUES (u1,'legacy PASS rebound fixture',legacy_pass_url)
    RETURNING id INTO pass_entry;
    pass_result:=public.fn_rebind_legacy_image(
      'entry_hero',pass_entry::text,u1,legacy_pass_url,hero_approved
    );
    ASSERT (pass_result->>'rebound')::boolean
       AND (SELECT photo_url=hero_approved FROM public.entries WHERE id=pass_entry)
       AND EXISTS (
         SELECT 1 FROM public.image_object_refs r
         WHERE r.object_id=hero_oid AND r.sink_kind='entry_hero'
           AND r.sink_id=pass_entry::text
       )
       AND EXISTS (
         SELECT 1 FROM public.image_gc_queue q
         WHERE q.reason='grandfather_rebound' AND q.path=legacy_pass_url
       ), 'legacy PASS did not transactionally rewrite + bind + queue old bytes';

    UPDATE public.profiles SET avatar_url=foreign_avatar WHERE user_id=u2;
    PERFORM public.fn_quarantine_legacy_image(
      'avatar',u2::text,u2,foreign_avatar,'foreign_origin'
    );
    ASSERT (SELECT avatar_url IS NULL FROM public.profiles WHERE user_id=u2)
       AND NOT EXISTS (SELECT 1 FROM public.image_object_refs WHERE object_id=avatar_oid)
       AND EXISTS (SELECT 1 FROM public.image_gc_queue WHERE object_id=avatar_oid),
      'foreign avatar quarantine leaked its stale approved ref';

    INSERT INTO public.entries (user_id,content)
    VALUES (u1,'stale grandfather hero ref') RETURNING id INTO hero_entry;
    PERFORM public.fn_bind_image_ref(
      u1,hero_approved,'entry-photos','entry_hero',hero_entry::text,true
    );
    UPDATE public.entries SET photo_url=rejected_hero WHERE id=hero_entry;
    PERFORM public.fn_reject_legacy_image(
      'entry_hero',hero_entry::text,u1,rejected_hero,'moderation_rejected'
    );
    ASSERT (SELECT photo_url IS NULL FROM public.entries WHERE id=hero_entry)
       AND NOT EXISTS (
          SELECT 1 FROM public.image_object_refs
          WHERE object_id=hero_oid AND sink_kind='entry_hero'
            AND sink_id=hero_entry::text
       )
       AND EXISTS (SELECT 1 FROM public.image_gc_queue WHERE object_id=hero_oid),
      'rejected legacy hero leaked its stale approved ref';
END;
$spec$;

-- Freeze can land after the durable promoting row but before Storage copy /
-- finish, or while a pre-freeze GC worker owns a delete lease.  Both must be
-- drained under a new fence before inventory can persist.
DO $spec$
DECLARE
    u4 uuid := '19610000-0000-4000-8000-000000000004';
    promoting_path text := 'approved/19610000-0000-4000-8000-000000000004/'
        ||repeat('8',64)||'.jpg';
    approved text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/'
        ||'19610000-0000-4000-8000-000000000004/'||repeat('8',64)||'.jpg';
    gc_object_id uuid := '1961a000-0000-4000-8000-000000000047';
    bound_object_id uuid := '1961a000-0000-4000-8000-000000000045';
    bound_url text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/'
        ||'19610000-0000-4000-8000-000000000004/'||repeat('5',64)||'.jpg';
    nested_legacy text := '19610000-0000-4000-8000-000000000004/nested/legacy.jpg';
    j jsonb;
    paths jsonb;
    object_id uuid;
    caught boolean := false;
BEGIN
    INSERT INTO public.image_hash_verdicts (sha256,verdict,likelihoods)
    VALUES (repeat('8',64),'pass','{}') ON CONFLICT DO NOTHING;
    j:=public.fn_begin_image_promotion(u4,'avatars',repeat('8',64),approved);
    object_id:=(j->>'object_id')::uuid;
    UPDATE public.user_image_objects
    SET created_at=now()-interval '1 day',
        promotion_lease_expires=now()-interval '1 second'
    WHERE id=object_id;
    j:=public.fn_begin_image_promotion(u4,'avatars',repeat('8',64),approved);
    ASSERT (j->>'object_id')::uuid=object_id
       AND (SELECT promotion_lease_expires > now()+interval '420 seconds'
            FROM public.user_image_objects WHERE id=object_id),
      'retrying an old promoting row did not refresh its durable PUT deadline';
    j:=public.fn_reconcile_registry_object(object_id,false);
    ASSERT (j->>'promotion_in_flight')::boolean
       AND EXISTS (SELECT 1 FROM public.user_image_objects WHERE id=object_id),
      'reconcile destroyed a promotion during its durable approved-PUT lease';
    INSERT INTO public.user_image_objects (
      id,user_id,bucket,storage_path,public_url,sha256,state
    ) VALUES (
      gc_object_id,u4,'avatars','approved/'||u4||'/'||repeat('7',64)||'.jpg',
      'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/'
        ||u4||'/'||repeat('7',64)||'.jpg',repeat('7',64),'approved'
    );
    j:=public.fn_claim_image_object_gc(gc_object_id,'pre-freeze-gc','boundary');
    ASSERT (j->>'claimed')::boolean, 'pre-freeze GC lease fixture was not claimed';
    INSERT INTO public.user_image_objects (
      id,user_id,bucket,storage_path,public_url,sha256,state
    ) VALUES (
      bound_object_id,u4,'avatars','approved/'||u4||'/'||repeat('5',64)||'.jpg',
      bound_url,repeat('5',64),'approved'
    );
    PERFORM public.fn_bind_image_ref(
      u4,bound_url,'avatars','avatar',u4::text,true
    );

    j:=public.fn_freeze_account_deletion(u4);
    ASSERT (j->>'quiesce_after')::timestamptz >= (
      SELECT pg_catalog.max(x) FROM (VALUES
        ((SELECT promotion_lease_expires
          FROM public.user_image_objects WHERE id=object_id)),
        ((SELECT gc_lease_expires
          FROM public.user_image_objects WHERE id=gc_object_id))
      ) deadline(x)
    ), 'freeze deadline did not cover promotion + pre-freeze GC workers';
    BEGIN
      PERFORM public.fn_finish_image_promotion(u4,object_id);
    EXCEPTION WHEN OTHERS THEN
      caught:=SQLERRM LIKE '%account_deleting%';
    END;
    ASSERT caught, 'promotion finish ignored an account tombstone';
    caught:=false;
    BEGIN
      PERFORM public.fn_bind_image_ref(
        u4,NULL,'avatars','avatar',u4::text,false
      );
    EXCEPTION WHEN OTHERS THEN
      caught:=SQLERRM LIKE '%account_deleting%';
    END;
    ASSERT caught AND EXISTS (
      SELECT 1 FROM public.image_object_refs WHERE object_id=bound_object_id
    ), 'tombstoned NULL bind unlinked an existing approved ref';

    -- Simulate the paused handler's approved PUT arriving after freeze.  The
    -- persisted promoting deadline prevents the real saga from draining until
    -- that handler is dead; this fixture advances it explicitly below.
    INSERT INTO storage.objects (bucket_id,name,metadata) VALUES
      ('avatars',promoting_path,pg_catalog.jsonb_build_object('size',128)),
      ('avatars',nested_legacy,pg_catalog.jsonb_build_object('size',64))
    ON CONFLICT DO NOTHING;
    paths:=public.fn_list_account_storage_paths(
      u4,'avatars',u4::text,NULL,100
    );
    ASSERT paths->'paths' @> pg_catalog.jsonb_build_array(nested_legacy),
      'recursive account inventory omitted a nested legacy Storage object';

    j:=public.fn_claim_image_object_gc(gc_object_id,'post-freeze-gc','boundary');
    ASSERT NOT (j->>'claimed')::boolean AND (j->>'account_deleting')::boolean,
      'permanent account tombstone admitted a post-freeze GC claim';
    UPDATE public.account_deletions
    SET quiesce_after=now()-interval '1 second',
        writer_zero_seen_at=now()-interval '2 seconds', writer_zero_confirmed_at=now()
    WHERE user_id=u4;

    caught:=false;
    BEGIN
      PERFORM public.fn_claim_account_image_drain(u4,'account-drain',100);
    EXCEPTION WHEN OTHERS THEN
      caught:=SQLERRM LIKE '%account_image_drain_busy%';
    END;
    ASSERT caught, 'account drain stole an active pre-freeze GC lease';
    UPDATE public.user_image_objects
    SET gc_lease_expires=now()-interval '1 second' WHERE id=gc_object_id;

    j:=public.fn_claim_account_image_drain(u4,'account-drain',100);
    ASSERT j @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('object_id',object_id))
       AND j @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('object_id',gc_object_id)),
      'account drain did not fence every nonterminal registry object';
    caught:=false;
    BEGIN
      PERFORM public.fn_finalize_account_image_inventory(u4,'{}');
    EXCEPTION WHEN OTHERS THEN
      caught:=SQLERRM LIKE '%account_deletion_not_quiescent%';
    END;
    ASSERT caught, 'inventory persisted while account image drain was unfinished';

    DELETE FROM storage.objects
    WHERE bucket_id='avatars' AND name=promoting_path;
    ASSERT public.fn_finish_account_image_drain(
      u4,object_id,'account-drain',true,NULL
    ), 'promoting account image drain could not finish';
    ASSERT public.fn_finish_account_image_drain(
      u4,gc_object_id,'account-drain',true,NULL
    ), 'pre-freeze GC takeover could not finish';

    j:=public.fn_finalize_account_image_inventory(
      u4,pg_catalog.jsonb_build_object('storage',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('bucket','avatars','path',nested_legacy)
      ))
    );
    ASSERT j->>'state'='inventoried',
      'drained account could not persist image inventory';
    ASSERT NOT EXISTS (
      SELECT 1 FROM public.user_image_objects
      WHERE user_id=u4 AND state IN ('promoting','gc_pending','deleting')
    ), 'account inventory left nonterminal registry work behind';

    caught:=false;
    BEGIN
      PERFORM public.fn_record_account_deletion_zero(u4,'all_prefix',true,1);
    EXCEPTION WHEN OTHERS THEN
      caught:=SQLERRM LIKE '%account_deletion_not_found%';
    END;
    ASSERT caught,
      'all-prefix stable-zero was accepted before inventory entered purging';
    ASSERT public.fn_mark_account_images_purging(u4),
      'inventoried account could not enter purging';
    UPDATE public.account_deletions
    SET all_prefix_zero_seen_at=now()-interval '2 seconds'
    WHERE user_id=u4;
    PERFORM public.fn_record_account_deletion_zero(u4,'all_prefix',true,1);
    ASSERT (SELECT all_prefix_zero_confirmed_at IS NOT NULL
            FROM public.account_deletions WHERE user_id=u4),
      'purging account could not record all-prefix stable-zero';

    -- A resumed purge re-inventories before deleting again.  That refresh must
    -- invalidate any older zero observation so it cannot authorize Auth delete
    -- for newly discovered bytes.
    PERFORM public.fn_finalize_account_image_inventory(
      u4,pg_catalog.jsonb_build_object('storage',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('bucket','avatars','path',nested_legacy)
      ))
    );
    ASSERT (SELECT state='inventoried'
                   AND all_prefix_zero_seen_at IS NULL
                   AND all_prefix_zero_confirmed_at IS NULL
            FROM public.account_deletions WHERE user_id=u4),
      'inventory refresh retained a stale all-prefix zero authorization';
END;
$spec$;

-- Terminal account cleanup removes every per-user moderation row, including
-- the paid-attempt ledger, while retaining the global hash verdict cache.
DO $spec$
DECLARE
    u3 uuid := '19610000-0000-4000-8000-000000000003';
    caught boolean := false;
    cascade_entry uuid;
    cascade_photo uuid;
BEGIN
    INSERT INTO public.image_moderation_ledger (user_id,budget_scope,outcome)
    VALUES (u3,'general','provider_error');
    INSERT INTO public.entries (user_id,content,photo_url)
    VALUES (u3,'account cascade queue fixture','https://example.invalid/deleted-hero.jpg')
    RETURNING id INTO cascade_entry;
    INSERT INTO public.entry_photos (entry_id,photo_url,sort_order)
    VALUES (cascade_entry,'https://example.invalid/deleted-photo.jpg',0)
    RETURNING id INTO cascade_photo;
    DELETE FROM public.entries WHERE id=cascade_entry;
    ASSERT EXISTS (
      SELECT 1 FROM public.image_gc_queue
      WHERE user_id=u3 AND sink_kind='entry_hero' AND sink_id=cascade_entry::text
        AND state<>'done'
    ) AND EXISTS (
      SELECT 1 FROM public.image_gc_queue
      WHERE user_id=u3 AND sink_kind='entry_photo' AND sink_id=cascade_photo::text
        AND state<>'done'
    ), 'content cascade did not create durable owned hero+photo GC work';
    UPDATE public.account_deletions
    SET state='auth_deleted', all_prefix_zero_confirmed_at=now()
    WHERE user_id=u3;
    ASSERT public.fn_finish_account_image_cleanup(u3),
      'terminal account image cleanup was rejected';
    ASSERT NOT EXISTS (SELECT 1 FROM public.staging_reservations WHERE user_id=u3)
       AND NOT EXISTS (SELECT 1 FROM public.image_stage_budget WHERE user_id=u3)
       AND NOT EXISTS (SELECT 1 FROM public.image_compute_budget
                       WHERE scope='user' AND subject_id=u3)
       AND NOT EXISTS (SELECT 1 FROM public.image_scan_budget
                       WHERE scope='user' AND subject_id=u3)
       AND NOT EXISTS (SELECT 1 FROM public.image_moderation_ledger WHERE user_id=u3)
       AND NOT EXISTS (SELECT 1 FROM public.user_image_objects WHERE user_id=u3)
       AND NOT EXISTS (SELECT 1 FROM public.image_quarantine WHERE user_id=u3)
       AND NOT EXISTS (SELECT 1 FROM public.image_gc_queue WHERE user_id=u3),
      'terminal account cleanup left per-user moderation rows';
    ASSERT (SELECT state='done' FROM public.account_deletions WHERE user_id=u3),
      'durable account tombstone did not reach done';
    BEGIN
      PERFORM public.fn_begin_stage(u3);
    EXCEPTION WHEN OTHERS THEN
      caught:=SQLERRM LIKE '%account_deleting%';
    END;
    ASSERT caught,
      'completed deletion tombstone allowed a stale authenticated writer to restart';
    ASSERT EXISTS (SELECT 1 FROM public.image_hash_verdicts WHERE sha256=repeat('f',64)),
      'account cleanup deleted the shared global verdict cache';
END;
$spec$;

ROLLBACK;
