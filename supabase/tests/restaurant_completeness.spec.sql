-- TICKET-195 restaurant completeness native SQL contract.
-- Run after the complete migration chain:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/restaurant_completeness.spec.sql

begin;

-- ---------------------------------------------------------------------------
-- Blanket privilege posture: exercise denial under both client roles.
-- ---------------------------------------------------------------------------

set local role anon;
do $anon$
declare
    v_table text;
    v_call text;
    v_denied boolean;
begin
    foreach v_table in array array[
        'place_attestations','import_resolutions','restaurant_completeness_queue',
        'completeness_destinations','destination_nonce_ledger','restaurant_merges',
        'media_claims','sku_budget_config','sku_budget_usage','completeness_control',
        'rate_limit_buckets'
    ] loop
        v_denied := false;
        begin
            execute pg_catalog.format('select 1 from public.%I limit 1', v_table);
        exception when insufficient_privilege then
            v_denied := true;
        end;
        assert v_denied, pg_catalog.format('FAIL: anon can read public.%s', v_table);
    end loop;

    foreach v_call in array array[
        'select public.check_and_increment_rate_limit(null,null,null,null)',
        'select public.fn_set_completeness_freeze(null,null)',
        'select public.fn_charge_sku_budget(null,null)',
        'select public.fn_claim_place_attestation(null,null,null)',
        'select public.fn_commit_place_attestation(null,null,null)',
        'select public.fn_claim_media(null,null,null,null)',
        'select public.fn_commit_media(null,null,null,null)',
        'select public.fn_resolve_canonical(null)',
        'select public.fn_enqueue_completeness(null,null,null,null,null,null)',
        'select public.fn_claim_completeness_batch(null,null,null)',
        'select public.fn_claim_completeness_item(null,null,null)',
        'select public.fn_record_completeness_resolution(null,null,null,null,null,null)',
        'select public.fn_apply_restaurant_attestation(null,null,null,null,null)',
        'select public.fn_canonicalize_ghost(null,null,null,null)',
        'select public.fn_canonicalize_completeness_item(null,null,null,null,null)',
        'select public.fn_route_destination(null,null,null,null)',
        'select public.fn_maybe_emit_import_done(null)',
        'select public.fn_finalize_completeness_item(null,null,null,null,null)',
        'select public.fn_defer_completeness_item(null,null,null,null,null)',
        'select public.fn_sweep_stuck_jobs(null)',
        'select public.fn_retry_completeness_item(null,null)',
        'select public.fn_dismiss_completeness_item(null,null)',
        'select public.fn_correct_completeness_item(null,null,null)',
        'select public.fn_add_list_entries_canonical(null,null,null)',
        'select public.fn_repair_list_ghost(null,null,null,null,null)',
        'select public.restaurant_completeness_reject_resolution_mutation()',
        'select public.restaurant_completeness_destination_guard()',
        'select public.restaurant_completeness_queue_dismissal_guard()',
        'select public.restaurant_completeness_ledger_guard()',
        'select public.restaurant_completeness_freeze_job_contract()',
        'select public.restaurants_bump_completeness_version()'
    ] loop
        v_denied := false;
        begin
            execute v_call;
        exception when insufficient_privilege then
            v_denied := true;
        end;
        assert v_denied, pg_catalog.format('FAIL: anon can execute %s', v_call);
    end loop;
end;
$anon$;
reset role;

set local role authenticated;
do $authenticated$
declare
    v_table text;
    v_call text;
    v_denied boolean;
begin
    foreach v_table in array array[
        'place_attestations','import_resolutions','restaurant_completeness_queue',
        'completeness_destinations','destination_nonce_ledger','restaurant_merges',
        'media_claims','sku_budget_config','sku_budget_usage','completeness_control',
        'rate_limit_buckets'
    ] loop
        v_denied := false;
        begin
            execute pg_catalog.format('select 1 from public.%I limit 1', v_table);
        exception when insufficient_privilege then
            v_denied := true;
        end;
        assert v_denied, pg_catalog.format('FAIL: authenticated can read public.%s', v_table);
    end loop;

    foreach v_call in array array[
        'select public.check_and_increment_rate_limit(null,null,null,null)',
        'select public.fn_set_completeness_freeze(null,null)',
        'select public.fn_charge_sku_budget(null,null)',
        'select public.fn_claim_place_attestation(null,null,null)',
        'select public.fn_commit_place_attestation(null,null,null)',
        'select public.fn_claim_media(null,null,null,null)',
        'select public.fn_commit_media(null,null,null,null)',
        'select public.fn_resolve_canonical(null)',
        'select public.fn_enqueue_completeness(null,null,null,null,null,null)',
        'select public.fn_claim_completeness_batch(null,null,null)',
        'select public.fn_claim_completeness_item(null,null,null)',
        'select public.fn_record_completeness_resolution(null,null,null,null,null,null)',
        'select public.fn_apply_restaurant_attestation(null,null,null,null,null)',
        'select public.fn_canonicalize_ghost(null,null,null,null)',
        'select public.fn_canonicalize_completeness_item(null,null,null,null,null)',
        'select public.fn_route_destination(null,null,null,null)',
        'select public.fn_maybe_emit_import_done(null)',
        'select public.fn_finalize_completeness_item(null,null,null,null,null)',
        'select public.fn_defer_completeness_item(null,null,null,null,null)',
        'select public.fn_sweep_stuck_jobs(null)',
        'select public.fn_retry_completeness_item(null,null)',
        'select public.fn_dismiss_completeness_item(null,null)',
        'select public.fn_correct_completeness_item(null,null,null)',
        'select public.fn_add_list_entries_canonical(null,null,null)',
        'select public.fn_repair_list_ghost(null,null,null,null,null)',
        'select public.restaurant_completeness_reject_resolution_mutation()',
        'select public.restaurant_completeness_destination_guard()',
        'select public.restaurant_completeness_queue_dismissal_guard()',
        'select public.restaurant_completeness_ledger_guard()',
        'select public.restaurant_completeness_freeze_job_contract()',
        'select public.restaurants_bump_completeness_version()'
    ] loop
        v_denied := false;
        begin
            execute v_call;
        exception when insufficient_privilege then
            v_denied := true;
        end;
        assert v_denied, pg_catalog.format('FAIL: authenticated can execute %s', v_call);
    end loop;
end;
$authenticated$;
reset role;

-- SELECT attempts above prove RLS/ACL denial at runtime. Audit every table ACL
-- bit as well so a future accidental write-only grant cannot satisfy that
-- narrow probe while violating the blanket REVOKE ALL contract.
do $table_acl_audit$
declare
    v_role text;
    v_table text;
    v_privilege text;
begin
    foreach v_role in array array['anon','authenticated'] loop
        foreach v_table in array array[
            'place_attestations','import_resolutions','restaurant_completeness_queue',
            'completeness_destinations','destination_nonce_ledger','restaurant_merges',
            'media_claims','sku_budget_config','sku_budget_usage','completeness_control',
            'rate_limit_buckets'
        ] loop
            foreach v_privilege in array array[
                'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
            ] loop
                assert not pg_catalog.has_table_privilege(
                    v_role,
                    pg_catalog.format('public.%I', v_table),
                    v_privilege
                ), pg_catalog.format(
                    'FAIL: %s has %s on public.%s', v_role, v_privilege, v_table
                );
            end loop;
        end loop;
    end loop;
end;
$table_acl_audit$;

do $security_audit$
declare
    v_name text;
begin
    foreach v_name in array array[
        'check_and_increment_rate_limit','fn_set_completeness_freeze','fn_charge_sku_budget',
        'fn_claim_place_attestation','fn_commit_place_attestation','fn_claim_media','fn_commit_media',
        'fn_resolve_canonical','fn_enqueue_completeness','fn_claim_completeness_batch',
        'fn_claim_completeness_item','fn_record_completeness_resolution',
        'fn_apply_restaurant_attestation','fn_canonicalize_ghost',
        'fn_canonicalize_completeness_item','fn_route_destination',
        'fn_maybe_emit_import_done','fn_finalize_completeness_item','fn_defer_completeness_item',
        'fn_sweep_stuck_jobs','fn_retry_completeness_item','fn_dismiss_completeness_item',
        'fn_correct_completeness_item',
        'fn_add_list_entries_canonical',
        'fn_repair_list_ghost','fn_save_import_spot'
    ] loop
        assert exists (
            select 1
            from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = v_name
        ), pg_catalog.format('FAIL: required function %s is missing', v_name);
        assert not exists (
            select 1
            from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = v_name
              and (
                  not p.prosecdef
                  or not coalesce(
                      p.proconfig @> array['search_path=public, pg_temp']::text[],
                      false
                  )
              )
        ), pg_catalog.format('FAIL: %s must be SECURITY DEFINER with a pinned search_path', v_name);
        assert not exists (
            select 1
            from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = v_name
              and (
                  pg_catalog.has_function_privilege('anon', p.oid, 'execute')
                  or pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
              )
        ), pg_catalog.format('FAIL: client role can execute %s', v_name);
    end loop;

    foreach v_name in array array[
        'restaurant_completeness_reject_resolution_mutation',
        'restaurant_completeness_destination_guard',
        'restaurant_completeness_queue_dismissal_guard',
        'restaurant_completeness_ledger_guard',
        'restaurant_completeness_freeze_job_contract',
        'restaurants_bump_completeness_version'
    ] loop
        assert exists (
            select 1
            from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = v_name
              and coalesce(
                  p.proconfig @> array['search_path=public, pg_temp']::text[],
                  false
              )
        ), pg_catalog.format('FAIL: trigger function %s is missing or has an unpinned search_path', v_name);
        assert not exists (
            select 1
            from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = v_name
              and (
                  pg_catalog.has_function_privilege('anon', p.oid, 'execute')
                  or pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
              )
        ), pg_catalog.format('FAIL: client role can execute trigger function %s', v_name);
    end loop;

    assert (
        select pg_catalog.count(*) = 2
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'fn_save_import_spot'
    ), 'FAIL: additive rollout must retain exactly old + required-resolution overloads';
    assert exists (
        select 1 from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'fn_save_import_spot'
          and p.pronargs = 12 and p.pronargdefaults = 8
    ), 'FAIL: new save overload must have a required/non-default fourth argument';
    assert pg_catalog.to_regprocedure(
        'public.fn_canonicalize_completeness_item(uuid,uuid,uuid,text,integer)'
    ) is not null, 'FAIL: worker-fenced canonicalization signature is missing';
    assert pg_catalog.regexp_count(
        pg_catalog.lower(pg_catalog.pg_get_functiondef(
            'public.fn_route_destination(uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure
        )),
        'for key share'
    ) >= 2, 'FAIL: delayed Table/list authority checks are not held through routing';
end;
$security_audit$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users(
    instance_id,id,aud,role,email,created_at,updated_at,raw_app_meta_data,raw_user_meta_data
)
values
    ('00000000-0000-0000-0000-000000000000','19500000-0000-4000-8000-000000000001',
     'authenticated','authenticated','owner@completeness.invalid',now(),now(),
     '{"provider":"email","providers":["email"]}','{"display_name":"Completeness Owner"}'),
    ('00000000-0000-0000-0000-000000000000','19500000-0000-4000-8000-000000000002',
     'authenticated','authenticated','other@completeness.invalid',now(),now(),
     '{"provider":"email","providers":["email"]}','{"display_name":"Completeness Other"}')
on conflict (id) do nothing;

insert into public.profiles(user_id,display_name)
values
    ('19500000-0000-4000-8000-000000000001','Completeness Owner'),
    ('19500000-0000-4000-8000-000000000002','Completeness Other')
on conflict (user_id) do nothing;

-- Append-only provenance rejects direct deletion while still permitting the
-- FK cascades required for account/job lifecycle cleanup.
insert into auth.users(
    instance_id,id,aud,role,email,created_at,updated_at,raw_app_meta_data,raw_user_meta_data
)
values (
    '00000000-0000-0000-0000-000000000000','19500000-0000-4000-8000-000000000099',
    'authenticated','authenticated','cascade@completeness.invalid',now(),now(),
    '{"provider":"email","providers":["email"]}','{"display_name":"Cascade Fixture"}'
)
on conflict (id) do nothing;
insert into public.profiles(user_id,display_name)
values ('19500000-0000-4000-8000-000000000099','Cascade Fixture')
on conflict (user_id) do nothing;
insert into public.import_jobs(job_id,user_id,status,protocol_generation)
values (
    '19500000-0000-4000-8000-000000000098',
    '19500000-0000-4000-8000-000000000099','resolved','legacy'
);
insert into public.import_resolutions(
    resolution_id,user_id,candidate_evidence,decision
)
values (
    '19500000-0000-4000-8000-000000000097',
    '19500000-0000-4000-8000-000000000099','{}','no_result'
);
insert into public.destination_nonce_ledger(
    ledger_key,owner_id,job_id,payload,payload_hash
)
values (
    'cascade-spec-ledger',
    '19500000-0000-4000-8000-000000000099',
    '19500000-0000-4000-8000-000000000098','{}','fixture'
);
do $append_only_delete$
declare
    v_resolution_denied boolean := false;
    v_ledger_denied boolean := false;
begin
    begin
        delete from public.import_resolutions
        where resolution_id='19500000-0000-4000-8000-000000000097';
    exception when sqlstate '55000' then
        v_resolution_denied := true;
    end;
    begin
        delete from public.destination_nonce_ledger
        where ledger_key='cascade-spec-ledger';
    exception when sqlstate '55000' then
        v_ledger_denied := true;
    end;
    assert v_resolution_denied and v_ledger_denied,
        'FAIL: direct deletion bypassed append-only provenance';
end;
$append_only_delete$;
delete from public.profiles
where user_id='19500000-0000-4000-8000-000000000099';
do $cascade_delete$
begin
    assert not exists (
        select 1 from public.import_resolutions
        where resolution_id='19500000-0000-4000-8000-000000000097'
    ) and not exists (
        select 1 from public.destination_nonce_ledger
        where ledger_key='cascade-spec-ledger'
    ) and not exists (
        select 1 from public.import_jobs
        where job_id='19500000-0000-4000-8000-000000000098'
    ), 'FAIL: account/job FK cascade was blocked by append-only triggers';
end;
$cascade_delete$;

insert into public.restaurants(
    id,external_id,name,city,verification,created_by,lat,lng,photo_source
)
values
    ('19500000-aaaa-4000-8000-000000000001','ChIJ195Complete','Complete Gate','London','verified',
     '19500000-0000-4000-8000-000000000001',51.5,-0.1,'none'),
    ('19500000-aaaa-4000-8000-000000000002','ghost_195_queue','Queue Ghost','London','unverified',
     '19500000-0000-4000-8000-000000000001',null,null,null),
    ('19500000-aaaa-4000-8000-000000000007','ChIJ195OtherComplete','Other Complete','London','verified',
     '19500000-0000-4000-8000-000000000001',51.6,-0.2,'none')
on conflict (id) do nothing;

-- Cache lease, paired attribution, 24h hit, and append-only provenance.
do $cache$
declare
    v_claim record;
    v_resolution uuid;
    v_failed boolean := false;
begin
    select * into v_claim from public.fn_claim_place_attestation(
        'ChIJ195Cache','19500000-1000-4000-8000-000000000001',120
    );
    assert v_claim.outcome = 'claimed', 'FAIL: first attestation claimant did not win';
    select * into v_claim from public.fn_claim_place_attestation(
        'ChIJ195Cache','19500000-1000-4000-8000-000000000002',120
    );
    assert v_claim.outcome = 'pending',
        'FAIL: duplicate-place contender with its per-item claimant bypassed single-flight';
    begin
        perform public.fn_commit_place_attestation(
            'ChIJ195Cache','19500000-1000-4000-8000-000000000001',
            '{"display_name":"   ","lat":51.51,"lng":-0.11}'::jsonb
        );
    exception when invalid_parameter_value then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: blank-name attestation poisoned the cache';
    v_failed := false;
    begin
        perform public.fn_commit_place_attestation(
            'ChIJ195Cache','19500000-1000-4000-8000-000000000001',
            '{"display_name":"Cache Cafe","lat":null,"lng":null}'::jsonb
        );
    exception when invalid_parameter_value then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: coordinate-less attestation poisoned the cache';
    assert (
        select fetched_at is null
           and claim_owner='19500000-1000-4000-8000-000000000001'
        from public.place_attestations where place_id='ChIJ195Cache'
    ), 'FAIL: rejected attestation consumed its live cache lease';
    assert public.fn_commit_place_attestation(
        'ChIJ195Cache','19500000-1000-4000-8000-000000000001',
        '{"display_name":"Cache Cafe","formatted_address":"1 Test St","address_components":[{"longText":"London","types":["locality"]}],"lat":51.51,"lng":-0.11,"photo_reference":"places/ChIJ195Cache/photos/a","photo_attribution_html":"<a>Author</a>"}'::jsonb
    ), 'FAIL: attestation commit lost its live claim';
    select * into v_claim from public.fn_claim_place_attestation(
        'ChIJ195Cache','19500000-1000-4000-8000-000000000002',120
    );
    assert v_claim.outcome = 'hit', 'FAIL: fresh 24h attestation was not reused';

    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,matched_external_id,scores
    ) values (
        '19500000-0000-4000-8000-000000000001','19500000-2000-4000-8000-000000000001',
        '{"server":"evidence"}','matched','ChIJ195Complete','{"name":1}'
    ) returning resolution_id into v_resolution;
    begin
        update public.import_resolutions set scores = '{}' where resolution_id = v_resolution;
    exception when sqlstate '55000' then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: provenance row was mutable';
end;
$cache$;

-- Frozen budget is fail-closed; an unfrozen charge increments user + project.
do $budget$
declare
    v_before integer;
    v_after integer;
begin
    select pg_catalog.count(*) into v_before from public.sku_budget_usage;
    assert not public.fn_charge_sku_budget(
        '19500000-0000-4000-8000-000000000001','places_details_pro'
    ), 'FAIL: seeded spend freeze allowed a charge';
    assert public.fn_set_completeness_freeze(false,'sql spec') = false,
        'FAIL: freeze could not be cleared';
    assert public.fn_charge_sku_budget(
        '19500000-0000-4000-8000-000000000001','places_details_pro'
    ), 'FAIL: valid dual-scope charge was rejected';
    select pg_catalog.count(*) into v_after from public.sku_budget_usage;
    assert v_after = v_before + 2, 'FAIL: charge did not create both user and project rows';
    perform public.fn_set_completeness_freeze(true,'sql spec restored');
end;
$budget$;

-- Owner/import-nonce binding, exact sealing, stale-token fencing, shared ledger.
do $queue$
declare
    v_owner uuid := '19500000-0000-4000-8000-000000000001';
    v_other uuid := '19500000-0000-4000-8000-000000000002';
    v_import uuid := '19500000-3000-4000-8000-000000000001';
    v_item_nonce uuid := '19500000-3000-4000-8000-000000000002';
    v_destination_nonce uuid := '19500000-3000-4000-8000-000000000003';
    v_resolution uuid;
    v_other_resolution uuid;
    v_binding_resolution uuid;
    v_unmatched_resolution uuid;
    v_preserve_resolution uuid;
    v_revoked_resolution uuid;
    v_enqueued jsonb;
    v_other_enqueued jsonb;
    v_preserve_enqueued jsonb;
    v_resurrect_enqueued jsonb;
    v_revoked_enqueued jsonb;
    v_cross_enqueued jsonb;
    v_chunk_first jsonb;
    v_chunk_second jsonb;
    v_route_result jsonb;
    v_item_id uuid;
    v_destination_id uuid;
    v_claim record;
    v_old_token uuid;
    v_new_token uuid;
    v_failed boolean;
    v_claim_count integer;
    v_legacy jsonb;
begin
    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,matched_external_id,scores
    ) values (
        v_owner,v_import,'{"source":"server"}','matched','ChIJ195Complete','{"name":1}'
    ) returning resolution_id into v_resolution;

    v_enqueued := public.fn_enqueue_completeness(
        v_owner,v_import,'v2',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce',v_item_nonce,'restaurant_id','19500000-aaaa-4000-8000-000000000001',
            'external_id','ChIJ195Complete','resolution_id',v_resolution,
            'client_facts',pg_catalog.jsonb_build_object('name','Complete Gate','city','London')
        )),
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce',v_item_nonce,'destination_nonce',v_destination_nonce,
            'destination_kind','wishlist','notify_done',true
        )),1
    );
    assert (v_enqueued->>'sealed')::boolean, 'FAIL: exact destination equality did not seal';
    v_item_id := (v_enqueued->'items'->0->>'id')::uuid;
    v_destination_id := (v_enqueued->'destinations'->0->>'id')::uuid;
    assert exists (
        select 1 from public.restaurant_completeness_queue q
        where q.id = v_item_id and q.next_attempt_at >= q.created_at + interval '15 minutes'
    ), 'FAIL: normal enqueue omitted the 15-minute grace';

    -- A multi-chunk enqueue returns mappings only for the submitted chunk.
    -- Otherwise the final chunk's inline fast path reclaims every earlier item.
    v_chunk_first := public.fn_enqueue_completeness(
        v_owner,'19500000-3000-4000-8000-0000000000c0','v2',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3000-4000-8000-0000000000c1',
            'restaurant_id','19500000-aaaa-4000-8000-000000000001',
            'external_id','ChIJ195Complete','resolution_id',null,
            'client_facts',pg_catalog.jsonb_build_object('deploy_gate',true)
        )),
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3000-4000-8000-0000000000c1',
            'destination_nonce','19500000-3000-4000-8000-0000000000c2',
            'destination_kind','wishlist'
        )),2
    );
    assert not (v_chunk_first->>'sealed')::boolean
       and pg_catalog.jsonb_array_length(v_chunk_first->'items') = 1
       and v_chunk_first->'items'->0->>'item_nonce' = '19500000-3000-4000-8000-0000000000c1'
       and pg_catalog.jsonb_array_length(v_chunk_first->'destinations') = 1,
       'FAIL: first chunk response leaked another mapping or sealed early';
    v_chunk_second := public.fn_enqueue_completeness(
        v_owner,'19500000-3000-4000-8000-0000000000c0','v2',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3000-4000-8000-0000000000c3',
            'restaurant_id','19500000-aaaa-4000-8000-000000000007',
            'external_id','ChIJ195OtherComplete','resolution_id',null,
            'client_facts',pg_catalog.jsonb_build_object('deploy_gate',true)
        )),
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3000-4000-8000-0000000000c3',
            'destination_nonce','19500000-3000-4000-8000-0000000000c4',
            'destination_kind','wishlist'
        )),2
    );
    assert (v_chunk_second->>'sealed')::boolean
       and pg_catalog.jsonb_array_length(v_chunk_second->'items') = 1
       and v_chunk_second->'items'->0->>'item_nonce' = '19500000-3000-4000-8000-0000000000c3'
       and pg_catalog.jsonb_array_length(v_chunk_second->'destinations') = 1
       and v_chunk_second->'destinations'->0->>'destination_nonce' =
           '19500000-3000-4000-8000-0000000000c4',
       'FAIL: final chunk response included an earlier item/destination mapping';

    -- Idempotent equality is accepted; altered evidence under the nonce is not.
    perform public.fn_enqueue_completeness(
        v_owner,v_import,'v2',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce',v_item_nonce,'restaurant_id','19500000-aaaa-4000-8000-000000000001',
            'external_id','ChIJ195Complete','resolution_id',v_resolution,
            'client_facts',pg_catalog.jsonb_build_object('name','Complete Gate','city','London')
        )),
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce',v_item_nonce,'destination_nonce',v_destination_nonce,
            'destination_kind','wishlist','notify_done',true
        )),1
    );
    v_failed := false;
    begin
        perform public.fn_enqueue_completeness(
            v_owner,v_import,'v2',
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'item_nonce',v_item_nonce,'restaurant_id','19500000-aaaa-4000-8000-000000000001',
                'external_id','ChIJ195Complete','resolution_id',v_resolution,
                'client_facts',pg_catalog.jsonb_build_object('name','ALTERED','city','London')
            )),
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'item_nonce',v_item_nonce,'destination_nonce',v_destination_nonce,
                'destination_kind','wishlist','notify_done',true
            )),1
        );
    exception when unique_violation then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: altered item evidence reused an immutable nonce';

    -- Exact claim intentionally bypasses grace for inline/gate. Reclamation
    -- changes the token; the stale worker cannot route.
    select * into v_claim from public.fn_claim_completeness_item(
        v_item_id,'19500000-3000-4000-8000-000000000010',120
    );
    v_old_token := v_claim.lease_token;
    update public.restaurant_completeness_queue
    set lease_until = now() - interval '1 second'
    where id = v_item_id;
    select * into v_claim from public.fn_claim_completeness_item(
        v_item_id,'19500000-3000-4000-8000-000000000011',120
    );
    v_new_token := v_claim.lease_token;
    assert v_new_token <> v_old_token, 'FAIL: expired lease was not fenced with a fresh token';
    v_failed := false;
    begin
        perform public.fn_route_destination(
            v_item_id,v_old_token,v_destination_id,'19500000-aaaa-4000-8000-000000000001'
        );
    exception when sqlstate '55000' then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: stale lease token routed a destination';

    v_failed := false;
    begin
        perform public.fn_canonicalize_completeness_item(
            v_item_id,
            v_old_token,
            '19500000-aaaa-4000-8000-000000000001',
            'ChIJ195Complete',
            (select completeness_version from public.restaurants
             where id = '19500000-aaaa-4000-8000-000000000001')
        );
    exception when sqlstate '55000' then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: stale lease token canonicalized a restaurant';

    -- Even the live worker cannot use its lease to canonicalize the item to an
    -- identity other than the server-bound queue external_id.
    v_failed := false;
    begin
        perform public.fn_canonicalize_completeness_item(
            v_item_id,
            v_new_token,
            '19500000-aaaa-4000-8000-000000000001',
            'ChIJ195LeaseSubstitution',
            (select completeness_version from public.restaurants
             where id = '19500000-aaaa-4000-8000-000000000001')
        );
    exception when insufficient_privilege then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: worker canonicalization ignored the queue external-id binding';
    assert (
        select external_id = 'ChIJ195Complete'
        from public.restaurants where id = '19500000-aaaa-4000-8000-000000000001'
    ), 'FAIL: rejected worker canonicalization changed restaurant identity';

    -- A service caller cannot substitute another complete canonical row for
    -- the leased item's target at either side-effect or terminal boundaries.
    v_failed := false;
    begin
        perform public.fn_route_destination(
            v_item_id,v_new_token,v_destination_id,'19500000-aaaa-4000-8000-000000000007'
        );
    exception when insufficient_privilege then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: route accepted an arbitrary complete restaurant target';
    v_failed := false;
    begin
        perform public.fn_finalize_completeness_item(
            v_item_id,v_new_token,'verified','19500000-aaaa-4000-8000-000000000007',null
        );
    exception when insufficient_privilege then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: finalize accepted an arbitrary complete restaurant target';

    v_route_result := public.fn_route_destination(
        v_item_id,v_new_token,v_destination_id,'19500000-aaaa-4000-8000-000000000001'
    );
    assert v_route_result->>'status'='saved',
        'FAIL: first v2 wishlist route did not report saved';
    perform public.fn_finalize_completeness_item(
        v_item_id,v_new_token,'verified','19500000-aaaa-4000-8000-000000000001',null
    );
    assert (
        select pg_catalog.count(*) = 1 from public.destination_nonce_ledger
        where ledger_key = 'route:'||v_owner::text||':'||(v_enqueued->>'job_id')||':'||
            v_item_nonce::text||':'||v_destination_nonce::text and acked_at is not null
    ), 'FAIL: routing did not share one acknowledged ledger boundary';
    assert (
        select pg_catalog.count(*) = 1 from public.notifications
        where user_id = v_owner and kind = 'import_done'
          and subject_meta->>'job_id' = v_enqueued->>'job_id'
    ), 'FAIL: terminal barrier did not emit exactly one import_done';
    assert not public.fn_maybe_emit_import_done((v_enqueued->>'job_id')::uuid),
        'FAIL: import_done snapshot re-emitted';

    -- The same destination nonce is legal in a later same-owner job. The
    -- downstream wishlist client_nonce must be derived from the full scoped
    -- route key, otherwise this second restaurant aliases the first side effect.
    v_cross_enqueued := public.fn_enqueue_completeness(
        v_owner,'19500000-3000-4000-8000-000000000090','v2',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3000-4000-8000-000000000091',
            'restaurant_id','19500000-aaaa-4000-8000-000000000007',
            'external_id','ChIJ195OtherComplete','resolution_id',null,
            'client_facts',pg_catalog.jsonb_build_object('deploy_gate',true)
        )),
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3000-4000-8000-000000000091',
            'destination_nonce',v_destination_nonce,
            'destination_kind','wishlist'
        )),1
    );
    v_item_id := (v_cross_enqueued->'items'->0->>'id')::uuid;
    v_destination_id := (v_cross_enqueued->'destinations'->0->>'id')::uuid;
    select * into v_claim from public.fn_claim_completeness_item(
        v_item_id,'19500000-3000-4000-8000-000000000092',120
    );
    perform public.fn_route_destination(
        v_item_id,v_claim.lease_token,v_destination_id,'19500000-aaaa-4000-8000-000000000007'
    );
    assert (
        select pg_catalog.count(*)=2 and pg_catalog.count(distinct client_nonce)=2
        from public.wishlist_items
        where user_id=v_owner
          and restaurant_id in (
              '19500000-aaaa-4000-8000-000000000001',
              '19500000-aaaa-4000-8000-000000000007'
          )
          and deleted_at is null
    ), 'FAIL: same-owner cross-job destination nonce aliased a wishlist effect';

    -- A v2-bound job rejects the retained legacy RPC before side effects.
    v_legacy := public.fn_save_import_spot(
        p_user_id => v_owner,
        p_import_nonce => v_import,
        p_client_nonce => '19500000-3000-4000-8000-000000000099'::uuid,
        p_restaurant_id => '19500000-aaaa-4000-8000-000000000001'::uuid
    );
    assert v_legacy->>'status' = 'failed'
       and v_legacy->>'error' = 'PROTOCOL_GENERATION_MISMATCH',
       'FAIL: v2-to-legacy generation race crossed the job lock';

    -- Conversely, legacy first-touch rejects v2 under the same owner+nonce lock.
    v_legacy := public.fn_save_import_spot(
        p_user_id => v_owner,
        p_import_nonce => '19500000-3000-4000-8000-000000000020'::uuid,
        p_client_nonce => '19500000-3000-4000-8000-000000000021'::uuid,
        p_restaurant_id => '19500000-aaaa-4000-8000-000000000001'::uuid
    );
    assert v_legacy->>'status' in ('saved','already_pinned'), 'FAIL: legacy fixture save failed';
    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,matched_external_id
    ) values (
        v_owner,'19500000-3000-4000-8000-000000000020','{}','matched','ChIJ195Complete'
    ) returning resolution_id into v_other_resolution;
    v_failed := false;
    begin
        perform public.fn_enqueue_completeness(
            v_owner,'19500000-3000-4000-8000-000000000020','v2',
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'item_nonce','19500000-3000-4000-8000-000000000022',
                'restaurant_id','19500000-aaaa-4000-8000-000000000001',
                'external_id','ChIJ195Complete','resolution_id',v_other_resolution,
                'client_facts','{}'::jsonb
            )),
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'item_nonce','19500000-3000-4000-8000-000000000022',
                'destination_nonce','19500000-3000-4000-8000-000000000023',
                'destination_kind','wishlist'
            )),1
        );
    exception when sqlstate '55000' then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: legacy-to-v2 generation race crossed the job lock';

    -- Invoke the additive overload explicitly: p_resolution_id is present even
    -- when a legacy caller has no provenance.  The old overload was exercised
    -- above via the named call that omits this required argument.
    v_legacy := public.fn_save_import_spot(
        p_user_id => v_owner,
        p_import_nonce => '19500000-3000-4000-8000-000000000030'::uuid,
        p_client_nonce => '19500000-3000-4000-8000-000000000031'::uuid,
        p_resolution_id => null,
        p_restaurant_id => '19500000-aaaa-4000-8000-000000000001'::uuid
    );
    assert v_legacy->>'status' in ('saved','already_pinned'),
        'FAIL: required-resolution overload was not callable with explicit legacy NULL';

    -- Same nonce under another owner is a distinct job/ledger namespace.
    v_other_enqueued := public.fn_enqueue_completeness(
        v_other,v_import,'v2',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce',v_item_nonce,'restaurant_id','19500000-aaaa-4000-8000-000000000001',
            'external_id','ChIJ195Complete','resolution_id',null,
            'client_facts',pg_catalog.jsonb_build_object('deploy_gate',true)
        )),
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce',v_item_nonce,'destination_nonce',v_destination_nonce,
            'destination_kind','wishlist'
        )),1
    );
    assert v_other_enqueued->>'job_id' <> v_enqueued->>'job_id',
        'FAIL: cross-user import nonce collided';

    -- A valid matched resolution cannot be cross-paired with an unrelated
    -- verified restaurant.  That would turn a global canonical row into a
    -- malicious merge source when the worker canonicalizes the item.
    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,matched_external_id
    ) values (
        v_owner,'19500000-3000-4000-8000-000000000040','{}','matched','ChIJ195CrossPair'
    ) returning resolution_id into v_binding_resolution;
    v_failed := false;
    begin
        perform public.fn_enqueue_completeness(
            v_owner,'19500000-3000-4000-8000-000000000040','v2',
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'item_nonce','19500000-3000-4000-8000-000000000041',
                'restaurant_id','19500000-aaaa-4000-8000-000000000001',
                'external_id','ChIJ195CrossPair','resolution_id',v_binding_resolution,
                'client_facts','{}'::jsonb
            )),
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'item_nonce','19500000-3000-4000-8000-000000000041',
                'destination_nonce','19500000-3000-4000-8000-000000000042',
                'destination_kind','wishlist'
            )),1
        );
    exception when insufficient_privilege then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: matched evidence cross-paired an unrelated verified restaurant';

    -- A non-match resolution carries no authority for a client-supplied
    -- external id, and the deploy sentinel likewise cannot cross identities.
    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision
    ) values (
        v_owner,'19500000-3000-4000-8000-000000000050','{}','no_result'
    ) returning resolution_id into v_unmatched_resolution;
    v_failed := false;
    begin
        perform public.fn_enqueue_completeness(
            v_owner,'19500000-3000-4000-8000-000000000050','v2',
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'item_nonce','19500000-3000-4000-8000-000000000051',
                'external_id','ChIJ195Unproven','resolution_id',v_unmatched_resolution,
                'client_facts','{}'::jsonb
            )),
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'item_nonce','19500000-3000-4000-8000-000000000051',
                'destination_nonce','19500000-3000-4000-8000-000000000052',
                'destination_kind','wishlist'
            )),1
        );
    exception when insufficient_privilege then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: non-match provenance authorized an arbitrary external id';

    v_failed := false;
    begin
        perform public.fn_enqueue_completeness(
            v_owner,'19500000-3000-4000-8000-000000000053','v2',
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'item_nonce','19500000-3000-4000-8000-000000000054',
                'restaurant_id','19500000-aaaa-4000-8000-000000000001',
                'external_id','ChIJ195Unproven','resolution_id',null,
                'client_facts',pg_catalog.jsonb_build_object('deploy_gate',true)
            )),
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'item_nonce','19500000-3000-4000-8000-000000000054',
                'destination_nonce','19500000-3000-4000-8000-000000000055',
                'destination_kind','wishlist'
            )),1
        );
    exception when insufficient_privilege then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: deploy sentinel crossed verified restaurant identities';

    -- Advisory client facts may discover an existing verified external id,
    -- but conflict handling must never overwrite canonical metadata.
    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,matched_external_id
    ) values (
        v_owner,'19500000-3000-4000-8000-000000000060','{}','matched','ChIJ195Complete'
    ) returning resolution_id into v_preserve_resolution;
    v_preserve_enqueued := public.fn_enqueue_completeness(
        v_owner,'19500000-3000-4000-8000-000000000060','v2',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3000-4000-8000-000000000061',
            'external_id','ChIJ195Complete','resolution_id',v_preserve_resolution,
            'client_facts',pg_catalog.jsonb_build_object(
                'name','POISONED CLIENT NAME','city','POISONED CLIENT CITY'
            )
        )),
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3000-4000-8000-000000000061',
            'destination_nonce','19500000-3000-4000-8000-000000000062',
            'destination_kind','wishlist'
        )),1
    );
    assert (
        select name='Complete Gate' and city='London'
        from public.restaurants where id='19500000-aaaa-4000-8000-000000000001'
    ), 'FAIL: advisory client facts overwrote verified canonical metadata';
    v_item_id := (v_preserve_enqueued->'items'->0->>'id')::uuid;
    v_destination_id := (v_preserve_enqueued->'destinations'->0->>'id')::uuid;
    select * into v_claim from public.fn_claim_completeness_item(
        v_item_id,'19500000-3000-4000-8000-000000000063',120
    );
    v_route_result := public.fn_route_destination(
        v_item_id,v_claim.lease_token,v_destination_id,
        '19500000-aaaa-4000-8000-000000000001'
    );
    assert v_route_result->>'status'='already_pinned',
        'FAIL: live v2 wishlist conflict did not report already_pinned';
    perform public.fn_finalize_completeness_item(
        v_item_id,v_claim.lease_token,'verified',
        '19500000-aaaa-4000-8000-000000000001',null
    );

    update public.wishlist_items
    set deleted_at=pg_catalog.now()
    where user_id=v_owner
      and restaurant_id='19500000-aaaa-4000-8000-000000000001';
    v_resurrect_enqueued := public.fn_enqueue_completeness(
        v_owner,'19500000-3000-4000-8000-000000000064','v2',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3000-4000-8000-000000000065',
            'restaurant_id','19500000-aaaa-4000-8000-000000000001',
            'external_id','ChIJ195Complete','resolution_id',null,
            'client_facts',pg_catalog.jsonb_build_object('deploy_gate',true)
        )),
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3000-4000-8000-000000000065',
            'destination_nonce','19500000-3000-4000-8000-000000000066',
            'destination_kind','wishlist'
        )),1
    );
    v_item_id := (v_resurrect_enqueued->'items'->0->>'id')::uuid;
    v_destination_id := (v_resurrect_enqueued->'destinations'->0->>'id')::uuid;
    select * into v_claim from public.fn_claim_completeness_item(
        v_item_id,'19500000-3000-4000-8000-000000000067',120
    );
    v_route_result := public.fn_route_destination(
        v_item_id,v_claim.lease_token,v_destination_id,
        '19500000-aaaa-4000-8000-000000000001'
    );
    assert v_route_result->>'status'='saved' and exists (
        select 1 from public.wishlist_items
        where user_id=v_owner
          and restaurant_id='19500000-aaaa-4000-8000-000000000001'
          and deleted_at is null
    ), 'FAIL: soft-deleted v2 wishlist route was not reported/resurrected as saved';
    perform public.fn_finalize_completeness_item(
        v_item_id,v_claim.lease_token,'verified',
        '19500000-aaaa-4000-8000-000000000001',null
    );

    -- Delayed routing revalidates membership and rejects a destination whose
    -- authority was revoked after enqueue.  The function-definition assertion
    -- above additionally pins the FOR KEY SHARE concurrency shape.
    insert into public.tables(id,owner_id,name)
    values ('19500000-bbbb-4000-8000-000000000001',v_owner,'Revocation Table');
    insert into public.table_members(table_id,member_id,role)
    values ('19500000-bbbb-4000-8000-000000000001',v_other,'member')
    on conflict do nothing;
    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,matched_external_id
    ) values (
        v_other,'19500000-3000-4000-8000-000000000070','{}','matched','ChIJ195Complete'
    ) returning resolution_id into v_revoked_resolution;
    v_revoked_enqueued := public.fn_enqueue_completeness(
        v_other,'19500000-3000-4000-8000-000000000070','v2',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3000-4000-8000-000000000071',
            'restaurant_id','19500000-aaaa-4000-8000-000000000001',
            'external_id','ChIJ195Complete','resolution_id',v_revoked_resolution,
            'client_facts','{}'::jsonb
        )),
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3000-4000-8000-000000000071',
            'destination_nonce','19500000-3000-4000-8000-000000000072',
            'destination_kind','table',
            'target_table_id','19500000-bbbb-4000-8000-000000000001'
        )),1
    );
    delete from public.table_members
    where table_id='19500000-bbbb-4000-8000-000000000001' and member_id=v_other;
    v_item_id := (v_revoked_enqueued->'items'->0->>'id')::uuid;
    v_destination_id := (v_revoked_enqueued->'destinations'->0->>'id')::uuid;
    select * into v_claim from public.fn_claim_completeness_item(
        v_item_id,'19500000-3000-4000-8000-000000000073',120
    );
    v_route_result := public.fn_route_destination(
        v_item_id,v_claim.lease_token,v_destination_id,
        '19500000-aaaa-4000-8000-000000000001'
    );
    assert v_route_result->>'outcome'='rejected',
        'FAIL: removed Table member retained delayed routing authority';
    assert not exists (
        select 1 from public.table_shares
        where table_id='19500000-bbbb-4000-8000-000000000001'
          and author_id=v_other
          and client_nonce='19500000-3000-4000-8000-000000000072'
    ), 'FAIL: rejected delayed destination still created a Table share';
    perform public.fn_finalize_completeness_item(
        v_item_id,v_claim.lease_token,'verified',
        '19500000-aaaa-4000-8000-000000000001',null
    );

    -- Defense in depth: even a malformed service-written queue row cannot be
    -- claimed when its owner differs from the locked import job owner.
    insert into public.import_jobs(
        job_id,user_id,status,protocol_generation,sealed_at,
        expected_items,expected_destinations
    ) values (
        '19500000-3000-4000-8000-000000000080',v_owner,'resolved','v2',now(),1,1
    );
    insert into public.restaurant_completeness_queue(
        id,owner_id,job_id,item_nonce,item_hash,state,next_attempt_at
    ) values (
        '19500000-3000-4000-8000-000000000081',v_other,
        '19500000-3000-4000-8000-000000000080',
        '19500000-3000-4000-8000-000000000082','owner-mismatch','pending',now()
    );
    select pg_catalog.count(*) into v_claim_count
    from public.fn_claim_completeness_item(
        '19500000-3000-4000-8000-000000000081',
        '19500000-3000-4000-8000-000000000083',120
    );
    assert v_claim_count=0, 'FAIL: exact claim accepted an owner/job mismatch';
    perform 1 from public.fn_claim_completeness_batch(
        '19500000-3000-4000-8000-000000000084',100,120
    );
    assert (
        select state='pending' and lease_token is null
        from public.restaurant_completeness_queue
        where id='19500000-3000-4000-8000-000000000081'
    ), 'FAIL: batch claim accepted an owner/job mismatch';
end;
$queue$;

-- A failed Details candidate may retry its known provider id without paying
-- for Text Search, but only after a fresh server attestation and only when the
-- queue hint exactly matches the owner-bound append-only resolution evidence.
-- The same identity binding fences the later attestation write from a repair
-- that lands after canonicalization.
do $known_id_fence$
declare
    v_owner uuid := '19500000-0000-4000-8000-000000000001';
    v_resolution uuid;
    v_enqueued jsonb;
    v_claim record;
    v_restaurant_id uuid;
    v_version integer;
    v_failed boolean;
begin
    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,matched_external_id,scores
    ) values (
        v_owner,'19500000-3600-4000-8000-000000000001',
        '{"candidate":{"attempted_external_id":"ChIJ195KnownRetry"}}',
        'transient',null,'{"provider":"details"}'
    ) returning resolution_id into v_resolution;
    v_enqueued := public.fn_enqueue_completeness(
        v_owner,'19500000-3600-4000-8000-000000000001','v2',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3600-4000-8000-000000000002',
            'external_id',null,'resolution_id',v_resolution,
            'client_facts',pg_catalog.jsonb_build_object(
                'name','Known Retry','city','London',
                'attempted_external_id','ChIJ195KnownRetry'
            )
        )),
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3600-4000-8000-000000000002',
            'destination_nonce','19500000-3600-4000-8000-000000000003',
            'destination_kind','wishlist'
        )),1
    );
    select * into v_claim from public.fn_claim_completeness_item(
        (v_enqueued->'items'->0->>'id')::uuid,
        '19500000-3600-4000-8000-000000000004',120
    );
    v_restaurant_id := v_claim.restaurant_id;
    select completeness_version into v_version
    from public.restaurants where id = v_restaurant_id;

    v_failed := false;
    begin
        perform public.fn_canonicalize_completeness_item(
            v_claim.id,v_claim.lease_token,v_restaurant_id,
            'ChIJ195KnownRetry',v_version
        );
    exception when insufficient_privilege then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: attempted-id hint canonicalized before Details attestation';

    insert into public.place_attestations(
        place_id,display_name,formatted_address,address_components,lat,lng,fetched_at
    ) values (
        'ChIJ195KnownRetry','Known Retry','1 Retry Road',
        '[{"longText":"London","types":["locality"]}]',51.50,-0.10,now()
    );
    v_restaurant_id := public.fn_canonicalize_completeness_item(
        v_claim.id,v_claim.lease_token,v_restaurant_id,
        'ChIJ195KnownRetry',v_version
    );
    assert (
        select external_id = 'ChIJ195KnownRetry' and merged_into is null
        from public.restaurants where id = v_restaurant_id
    ), 'FAIL: fresh server-evidenced attempted id was not canonicalized';

    select completeness_version into v_version
    from public.restaurants where id = v_restaurant_id;
    v_failed := false;
    begin
        perform public.fn_apply_restaurant_attestation(
            v_claim.id,v_claim.lease_token,v_restaurant_id,v_version,
            '{"place_id":"ChIJ195ProjectionMismatch","display_name":"Wrong Place","address_components":[],"lat":51.51,"lng":-0.11}'
        );
    exception when insufficient_privilege then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: projection place_id escaped the leased resolution binding';

    -- Simulate a manual repair winning after canonicalization. Pass the new
    -- version deliberately so this proves identity binding, not only CAS.
    update public.restaurants
    set external_id = 'ChIJ195RepairWon'
    where id = v_restaurant_id;
    select completeness_version into v_version
    from public.restaurants where id = v_restaurant_id;
    v_failed := false;
    begin
        perform public.fn_apply_restaurant_attestation(
            v_claim.id,v_claim.lease_token,v_restaurant_id,v_version,
            '{"place_id":"ChIJ195KnownRetry","display_name":"Stale Retry","address_components":[],"lat":51.52,"lng":-0.12}'
        );
    exception when sqlstate '40001' then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: stale attestation overwrote a repair that changed identity';
    assert (
        select external_id = 'ChIJ195RepairWon' and lat is null and lng is null
        from public.restaurants where id = v_restaurant_id
    ), 'FAIL: rejected stale attestation changed repaired restaurant facts';

    -- A fresh attestation for a client-copied hint is still insufficient when
    -- the append-only resolution names a different attempted provider id.
    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,matched_external_id,scores
    ) values (
        v_owner,'19500000-3600-4000-8000-000000000010',
        '{"candidate":{"attempted_external_id":"ChIJ195EvidenceHint"}}',
        'unattempted_budget',null,'{"provider":"details"}'
    ) returning resolution_id into v_resolution;
    insert into public.place_attestations(
        place_id,display_name,lat,lng,fetched_at
    ) values
        ('ChIJ195EvidenceHint','Evidence Hint',51.53,-0.13,now()),
        ('ChIJ195ForgedHint','Forged Hint',51.54,-0.14,now());
    v_enqueued := public.fn_enqueue_completeness(
        v_owner,'19500000-3600-4000-8000-000000000010','v2',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3600-4000-8000-000000000011',
            'external_id',null,'resolution_id',v_resolution,
            'client_facts',pg_catalog.jsonb_build_object(
                'name','Forged Hint','city','London',
                'attempted_external_id','ChIJ195ForgedHint'
            )
        )),
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3600-4000-8000-000000000011',
            'destination_nonce','19500000-3600-4000-8000-000000000012',
            'destination_kind','wishlist'
        )),1
    );
    select * into v_claim from public.fn_claim_completeness_item(
        (v_enqueued->'items'->0->>'id')::uuid,
        '19500000-3600-4000-8000-000000000013',120
    );
    select completeness_version into v_version
    from public.restaurants where id = v_claim.restaurant_id;
    v_failed := false;
    begin
        perform public.fn_canonicalize_completeness_item(
            v_claim.id,v_claim.lease_token,v_claim.restaurant_id,
            'ChIJ195ForgedHint',v_version
        );
    exception when insufficient_privilege then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: forged attempted-id hint escaped append-only evidence binding';
    assert (
        select pg_catalog.left(external_id,6) = 'ghost_'
        from public.restaurants where id = v_claim.restaurant_id
    ), 'FAIL: rejected forged hint changed the ghost identity';
end;
$known_id_fence$;

-- Terminal resolver decisions stop background auto-retry, but an explicit
-- owner retry must be able to re-evaluate instead of immediately exhausting on
-- the same copied marker. The append-only provenance row remains intact.
do $manual_retry$
declare
    v_owner uuid := '19500000-0000-4000-8000-000000000001';
    v_other uuid := '19500000-0000-4000-8000-000000000002';
    v_resolution uuid;
    v_enqueued jsonb;
    v_claim record;
begin
    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,matched_external_id,scores
    ) values (
        v_owner,'19500000-3700-4000-8000-000000000001',
        '{"candidate":{"name":"Manual Retry"}}','ambiguous',null,
        '{"margin":0.05}'
    ) returning resolution_id into v_resolution;
    v_enqueued := public.fn_enqueue_completeness(
        v_owner,'19500000-3700-4000-8000-000000000001','v2',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3700-4000-8000-000000000002',
            'external_id',null,'resolution_id',v_resolution,
            'client_facts',pg_catalog.jsonb_build_object(
                'name','Manual Retry','city','London',
                'resolution_decision','ambiguous'
            )
        )),
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3700-4000-8000-000000000002',
            'destination_nonce','19500000-3700-4000-8000-000000000003',
            'destination_kind','wishlist'
        )),1
    );
    select * into v_claim from public.fn_claim_completeness_item(
        (v_enqueued->'items'->0->>'id')::uuid,
        '19500000-3700-4000-8000-000000000004',120
    );
    perform public.fn_finalize_completeness_item(
        v_claim.id,v_claim.lease_token,'exhausted',v_claim.restaurant_id,'ambiguous'
    );
    assert not public.fn_retry_completeness_item(v_other,v_claim.id),
        'FAIL: foreign actor retried an exhausted item';
    assert (
        select state = 'exhausted' and client_facts->>'resolution_decision' = 'ambiguous'
        from public.restaurant_completeness_queue where id = v_claim.id
    ), 'FAIL: rejected foreign retry changed terminal state';

    assert public.fn_retry_completeness_item(v_owner,v_claim.id),
        'FAIL: owner could not retry an exhausted item';
    assert (
        select state = 'pending'
           and attempts = 0
           and not (client_facts ? 'resolution_decision')
           and client_facts->>'name' = 'Manual Retry'
           and resolution_id = v_resolution
        from public.restaurant_completeness_queue where id = v_claim.id
    ), 'FAIL: owner retry did not clear only the terminal auto-stop marker';
    assert exists (
        select 1 from public.import_resolutions where resolution_id = v_resolution
    ), 'FAIL: owner retry rewrote append-only resolution evidence';
end;
$manual_retry$;

-- The additive save overload treats provenance as authority, not decoration:
-- non-matches cannot carry an arbitrary external id, and a matched resolution
-- cannot be paired with a different verified restaurant through the id branch.
do $save_overload_binding$
declare
    v_owner uuid := '19500000-0000-4000-8000-000000000001';
    v_resolution uuid;
    v_result jsonb;
begin
    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision
    ) values (
        v_owner,'19500000-3750-4000-8000-000000000001','{}','no_result'
    ) returning resolution_id into v_resolution;
    v_result := public.fn_save_import_spot(
        p_user_id => v_owner,
        p_import_nonce => '19500000-3750-4000-8000-000000000001',
        p_client_nonce => '19500000-3750-4000-8000-000000000002',
        p_resolution_id => v_resolution,
        p_external_id => 'ChIJ195Arbitrary'
    );
    assert v_result->>'status'='failed'
       and not exists (
           select 1 from public.restaurants where external_id='ChIJ195Arbitrary'
       ), 'FAIL: non-match resolution authorized an arbitrary verified row';

    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,matched_external_id
    ) values (
        v_owner,'19500000-3750-4000-8000-000000000003','{}','matched','ChIJ195Complete'
    ) returning resolution_id into v_resolution;
    v_result := public.fn_save_import_spot(
        p_user_id => v_owner,
        p_import_nonce => '19500000-3750-4000-8000-000000000003',
        p_client_nonce => '19500000-3750-4000-8000-000000000004',
        p_resolution_id => v_resolution,
        p_restaurant_id => '19500000-aaaa-4000-8000-000000000007'
    );
    assert v_result->>'status'='failed',
        'FAIL: matched resolution cross-paired a different verified restaurant';

    v_result := public.fn_save_import_spot(
        p_user_id => v_owner,
        p_import_nonce => '19500000-3750-4000-8000-000000000003',
        p_client_nonce => '19500000-3750-4000-8000-000000000005',
        p_resolution_id => v_resolution,
        p_restaurant_id => '19500000-aaaa-4000-8000-000000000001'
    );
    assert v_result->>'status' in ('saved','already_pinned'),
        'FAIL: exact matched restaurant binding was rejected';
end;
$save_overload_binding$;

-- A picker correction must heal the ORIGINAL exhausted queue item. Fresh
-- owner/job provenance replaces the terminal resolution, then the ordinary
-- lease-token route/finalize path fulfils its still-pending destination. The
-- prior import_done notification remains a one-time unresolved snapshot.
insert into public.restaurants(
    id,external_id,name,verification,created_by,lat,lng,photo_source
) values (
    '19500000-aaaa-4000-8000-000000000009','ChIJ195Corrected','Corrected Complete','verified',
    '19500000-0000-4000-8000-000000000001',51.62,-0.22,'none'
);
do $manual_correction$
declare
    v_owner uuid := '19500000-0000-4000-8000-000000000001';
    v_other uuid := '19500000-0000-4000-8000-000000000002';
    v_import uuid := '19500000-3800-4000-8000-000000000001';
    v_item_nonce uuid := '19500000-3800-4000-8000-000000000002';
    v_destination_nonce uuid := '19500000-3800-4000-8000-000000000003';
    v_initial_resolution uuid;
    v_foreign_resolution uuid;
    v_wrong_job_resolution uuid;
    v_stale_resolution uuid;
    v_fresh_resolution uuid;
    v_enqueued jsonb;
    v_corrected jsonb;
    v_claim record;
    v_destination_id uuid;
    v_ghost_id uuid;
    v_version integer;
    v_done_at timestamptz;
    v_failed boolean;
begin
    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,created_at
    ) values (
        v_owner,v_import,'{"candidate":{"name":"Needs Correction"}}','ambiguous',
        pg_catalog.clock_timestamp() - interval '2 hours'
    ) returning resolution_id into v_initial_resolution;
    v_enqueued := public.fn_enqueue_completeness(
        v_owner,v_import,'v2',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce',v_item_nonce,
            'external_id',null,
            'resolution_id',v_initial_resolution,
            'client_facts',pg_catalog.jsonb_build_object(
                'name','Needs Correction','city','London',
                'resolution_decision','ambiguous',
                'attempted_external_id','ChIJ195Superseded'
            )
        )),
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce',v_item_nonce,
            'destination_nonce',v_destination_nonce,
            'destination_kind','wishlist'
        )),1
    );
    v_destination_id := (v_enqueued->'destinations'->0->>'id')::uuid;
    select * into v_claim from public.fn_claim_completeness_item(
        (v_enqueued->'items'->0->>'id')::uuid,
        '19500000-3800-4000-8000-000000000004',120
    );
    v_ghost_id := v_claim.restaurant_id;
    perform public.fn_finalize_completeness_item(
        v_claim.id,v_claim.lease_token,'exhausted',v_ghost_id,'ambiguous'
    );
    select done_emitted_at into v_done_at
    from public.import_jobs where job_id = (v_enqueued->>'job_id')::uuid;
    assert v_done_at is not null, 'FAIL: correction fixture did not emit terminal snapshot';

    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,matched_external_id,created_at
    ) values (
        v_other,v_import,'{"attestation":{"place_id":"ChIJ195Corrected"}}',
        'matched','ChIJ195Corrected',pg_catalog.clock_timestamp()
    ) returning resolution_id into v_foreign_resolution;
    v_failed := false;
    begin
        perform public.fn_correct_completeness_item(v_owner,v_claim.id,v_foreign_resolution);
    exception when insufficient_privilege then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: foreign correction provenance was accepted';

    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,matched_external_id,created_at
    ) values (
        v_owner,'19500000-3800-4000-8000-000000000099',
        '{"attestation":{"place_id":"ChIJ195Corrected"}}',
        'matched','ChIJ195Corrected',pg_catalog.clock_timestamp()
    ) returning resolution_id into v_wrong_job_resolution;
    v_failed := false;
    begin
        perform public.fn_correct_completeness_item(v_owner,v_claim.id,v_wrong_job_resolution);
    exception when insufficient_privilege then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: wrong-job correction provenance was accepted';

    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,matched_external_id,created_at
    ) values (
        v_owner,v_import,'{"attestation":{"place_id":"ChIJ195Corrected"}}',
        'matched','ChIJ195Corrected',pg_catalog.clock_timestamp() - interval '1 day'
    ) returning resolution_id into v_stale_resolution;
    v_failed := false;
    begin
        perform public.fn_correct_completeness_item(v_owner,v_claim.id,v_stale_resolution);
    exception when insufficient_privilege then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: pre-exhaustion correction provenance was accepted';

    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,matched_external_id,created_at
    ) values (
        v_owner,v_import,'{"attestation":{"place_id":"ChIJ195Corrected"}}',
        'matched','ChIJ195Corrected',pg_catalog.clock_timestamp()
    ) returning resolution_id into v_fresh_resolution;
    assert public.fn_correct_completeness_item(v_other,v_claim.id,v_fresh_resolution) is null,
        'FAIL: foreign actor discovered or changed an exhausted item';

    v_corrected := public.fn_correct_completeness_item(
        v_owner,v_claim.id,v_fresh_resolution
    );
    assert v_corrected->>'state' = 'pending'
       and v_corrected->>'external_id' = 'ChIJ195Corrected',
        'FAIL: fresh owner correction did not reopen the original item';
    assert (
        select state = 'pending'
           and attempts = 0
           and restaurant_id = v_ghost_id
           and external_id = 'ChIJ195Corrected'
           and resolution_id = v_fresh_resolution
           and client_facts->>'name' = 'Needs Correction'
           and not (client_facts ? 'resolution_decision')
           and not (client_facts ? 'attempted_external_id')
           and item_hash = pg_catalog.encode(extensions.digest(
               pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                   'restaurant_id',restaurant_id,
                   'external_id',external_id,
                   'resolution_id',resolution_id,
                   'client_facts',client_facts
               ))::text,
               'sha256'
           ),'hex')
        from public.restaurant_completeness_queue where id = v_claim.id
    ), 'FAIL: correction did not replace evidence/hash while preserving display facts';
    assert (
        select done_emitted_at = v_done_at
        from public.import_jobs where job_id = (v_enqueued->>'job_id')::uuid
    ), 'FAIL: correction reopened import_done state';

    select * into v_claim from public.fn_claim_completeness_item(
        v_claim.id,'19500000-3800-4000-8000-000000000005',120
    );
    assert v_claim.external_id = 'ChIJ195Corrected',
        'FAIL: corrected item was not claimable with its matched identity';
    select completeness_version into v_version
    from public.restaurants where id = v_ghost_id;
    perform public.fn_canonicalize_completeness_item(
        v_claim.id,v_claim.lease_token,v_ghost_id,'ChIJ195Corrected',v_version
    );
    perform public.fn_route_destination(
        v_claim.id,v_claim.lease_token,v_destination_id,
        '19500000-aaaa-4000-8000-000000000009'
    );
    perform public.fn_finalize_completeness_item(
        v_claim.id,v_claim.lease_token,'resolved',
        '19500000-aaaa-4000-8000-000000000009',null
    );
    assert (
        select state = 'resolved'
           and restaurant_id = '19500000-aaaa-4000-8000-000000000009'
        from public.restaurant_completeness_queue where id = v_claim.id
    ), 'FAIL: corrected item did not reach success through fenced finalization';
    assert (
        select outcome = 'fulfilled'
        from public.completeness_destinations where id = v_destination_id
    ), 'FAIL: corrected item did not route its original pending destination';
    assert (
        select pg_catalog.count(*) = 1
        from public.notifications
        where user_id = v_owner and kind = 'import_done'
          and subject_meta->>'job_id' = v_enqueued->>'job_id'
          and subject_meta->>'unresolved_count' = '1'
    ), 'FAIL: correction re-emitted or rewrote the import_done snapshot';
end;
$manual_correction$;

-- Fresh correction provenance is single-item authority. A second exhausted
-- item in the same job cannot replay it. Durable dismissal then retires only
-- that owner's item and its pending intent without inventing a route ledger.
do $correction_single_use_and_dismissal$
declare
    v_owner uuid := '19500000-0000-4000-8000-000000000001';
    v_other uuid := '19500000-0000-4000-8000-000000000002';
    v_import uuid := '19500000-3900-4000-8000-000000000001';
    v_initial_one uuid;
    v_initial_two uuid;
    v_fresh uuid;
    v_enqueued jsonb;
    v_item_one uuid;
    v_item_two uuid;
    v_destination_two uuid;
    v_claim record;
    v_failed boolean;
begin
    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,created_at
    ) values (
        v_owner,v_import,'{"candidate":{"name":"First Exhausted"}}','ambiguous',
        pg_catalog.clock_timestamp() - interval '2 hours'
    ) returning resolution_id into v_initial_one;
    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,created_at
    ) values (
        v_owner,v_import,'{"candidate":{"name":"Second Exhausted"}}','ambiguous',
        pg_catalog.clock_timestamp() - interval '2 hours'
    ) returning resolution_id into v_initial_two;
    v_enqueued := public.fn_enqueue_completeness(
        v_owner,v_import,'v2',
        pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'item_nonce','19500000-3900-4000-8000-000000000002',
                'resolution_id',v_initial_one,
                'client_facts',pg_catalog.jsonb_build_object(
                    'name','First Exhausted','city','London','resolution_decision','ambiguous'
                )
            ),
            pg_catalog.jsonb_build_object(
                'item_nonce','19500000-3900-4000-8000-000000000003',
                'resolution_id',v_initial_two,
                'client_facts',pg_catalog.jsonb_build_object(
                    'name','Second Exhausted','city','London','resolution_decision','ambiguous'
                )
            )
        ),
        pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'item_nonce','19500000-3900-4000-8000-000000000002',
                'destination_nonce','19500000-3900-4000-8000-000000000004',
                'destination_kind','wishlist'
            ),
            pg_catalog.jsonb_build_object(
                'item_nonce','19500000-3900-4000-8000-000000000003',
                'destination_nonce','19500000-3900-4000-8000-000000000005',
                'destination_kind','wishlist'
            )
        ),2
    );
    v_item_one := (v_enqueued->'items'->0->>'id')::uuid;
    v_item_two := (v_enqueued->'items'->1->>'id')::uuid;
    v_destination_two := (v_enqueued->'destinations'->1->>'id')::uuid;
    select * into v_claim from public.fn_claim_completeness_item(
        v_item_one,'19500000-3900-4000-8000-000000000006',120
    );
    perform public.fn_finalize_completeness_item(
        v_claim.id,v_claim.lease_token,'exhausted',v_claim.restaurant_id,'ambiguous'
    );
    select * into v_claim from public.fn_claim_completeness_item(
        v_item_two,'19500000-3900-4000-8000-000000000007',120
    );
    perform public.fn_finalize_completeness_item(
        v_claim.id,v_claim.lease_token,'exhausted',v_claim.restaurant_id,'ambiguous'
    );

    insert into public.import_resolutions(
        user_id,import_nonce,candidate_evidence,decision,matched_external_id,created_at
    ) values (
        v_owner,v_import,'{"attestation":{"place_id":"ChIJ195Corrected"}}',
        'matched','ChIJ195Corrected',pg_catalog.clock_timestamp()
    ) returning resolution_id into v_fresh;
    perform public.fn_correct_completeness_item(v_owner,v_item_one,v_fresh);
    v_failed := false;
    begin
        perform public.fn_correct_completeness_item(v_owner,v_item_two,v_fresh);
    exception when unique_violation then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: one fresh correction resolution healed multiple items';

    assert not public.fn_dismiss_completeness_item(v_other,v_item_two),
        'FAIL: foreign actor dismissed an exhausted item';
    assert public.fn_dismiss_completeness_item(v_owner,v_item_two),
        'FAIL: owner could not durably dismiss an exhausted item';
    assert not public.fn_dismiss_completeness_item(v_owner,v_item_two),
        'FAIL: dismissal was not idempotently terminal';
    assert (
        select state='exhausted' and dismissed_at is not null
        from public.restaurant_completeness_queue where id=v_item_two
    ), 'FAIL: dismissal changed terminal state or omitted its marker';
    assert (
        select outcome='rejected'
        from public.completeness_destinations where id=v_destination_two
    ), 'FAIL: dismissal left its original destination pending';
    assert not exists (
        select 1 from public.destination_nonce_ledger
        where ledger_key = 'route:'||v_owner::text||':'||(v_enqueued->>'job_id')||':'||
            '19500000-3900-4000-8000-000000000003:'||
            '19500000-3900-4000-8000-000000000005'
    ), 'FAIL: dismissal fabricated a route ledger acknowledgement';
    assert not public.fn_retry_completeness_item(v_owner,v_item_two),
        'FAIL: dismissed item was retryable';
    assert public.fn_correct_completeness_item(v_owner,v_item_two,v_fresh) is null,
        'FAIL: dismissed item was correctable';

    v_failed := false;
    begin
        update public.restaurant_completeness_queue
        set dismissed_at=null where id=v_item_two;
    exception when sqlstate '55000' then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: dismissed_at could be cleared after terminal dismissal';
end;
$correction_single_use_and_dismissal$;

-- A syntactically verified row with an impossible hero tuple is not complete:
-- neither routing nor successful terminalization may accept it.
insert into public.restaurants(
    id,external_id,name,verification,created_by,lat,lng,
    photo_url,photo_source,places_photo_attribution_html
) values (
    '19500000-aaaa-4000-8000-000000000008','ChIJ195MalformedHero','Malformed Hero','verified',
    '19500000-0000-4000-8000-000000000001',51.61,-0.21,
    null,'places','<a>Orphan attribution</a>'
);
do $malformed_complete$
declare
    v_enqueued jsonb;
    v_claim record;
    v_failed boolean := false;
begin
    v_enqueued := public.fn_enqueue_completeness(
        '19500000-0000-4000-8000-000000000001',
        '19500000-3000-4000-8000-000000000093','v2',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3000-4000-8000-000000000094',
            'restaurant_id','19500000-aaaa-4000-8000-000000000008',
            'external_id','ChIJ195MalformedHero','resolution_id',null,
            'client_facts',pg_catalog.jsonb_build_object('deploy_gate',true)
        )),
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'item_nonce','19500000-3000-4000-8000-000000000094',
            'destination_nonce','19500000-3000-4000-8000-000000000095',
            'destination_kind','wishlist'
        )),1
    );
    select * into v_claim from public.fn_claim_completeness_item(
        (v_enqueued->'items'->0->>'id')::uuid,
        '19500000-3000-4000-8000-000000000096',120
    );
    begin
        perform public.fn_route_destination(
            v_claim.id,v_claim.lease_token,
            (v_enqueued->'destinations'->0->>'id')::uuid,
            '19500000-aaaa-4000-8000-000000000008'
        );
    exception when check_violation then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: malformed hero routed a destination';
    v_failed := false;
    begin
        perform public.fn_finalize_completeness_item(
            v_claim.id,v_claim.lease_token,'verified',
            '19500000-aaaa-4000-8000-000000000008',null
        );
    exception when check_violation then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: malformed hero reached successful terminal state';
end;
$malformed_complete$;

-- Table routing has its own legacy nonce uniqueness. Reusing one destination
-- nonce in two jobs must still create two correctly-bound shares.
insert into public.tables(id,owner_id,name)
values (
    '19500000-bbbb-4000-8000-000000000002',
    '19500000-0000-4000-8000-000000000001','Scoped Nonce Table'
);
insert into public.table_members(table_id,member_id,role)
values (
    '19500000-bbbb-4000-8000-000000000002',
    '19500000-0000-4000-8000-000000000001','admin'
) on conflict do nothing;
do $table_nonce_scope$
declare
    v_enqueued jsonb;
    v_claim record;
    v_index integer;
    v_restaurant uuid;
    v_external text;
    v_import uuid;
    v_item uuid;
begin
    for v_index in 1..2 loop
        v_restaurant := case when v_index=1
            then '19500000-aaaa-4000-8000-000000000001'::uuid
            else '19500000-aaaa-4000-8000-000000000007'::uuid end;
        v_external := case when v_index=1 then 'ChIJ195Complete' else 'ChIJ195OtherComplete' end;
        v_import := case when v_index=1
            then '19500000-3000-4000-8000-0000000000a0'::uuid
            else '19500000-3000-4000-8000-0000000000b0'::uuid end;
        v_item := case when v_index=1
            then '19500000-3000-4000-8000-0000000000a1'::uuid
            else '19500000-3000-4000-8000-0000000000b1'::uuid end;
        v_enqueued := public.fn_enqueue_completeness(
            '19500000-0000-4000-8000-000000000001',v_import,'v2',
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'item_nonce',v_item,'restaurant_id',v_restaurant,
                'external_id',v_external,'resolution_id',null,
                'client_facts',pg_catalog.jsonb_build_object('deploy_gate',true)
            )),
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'item_nonce',v_item,
                'destination_nonce','19500000-3000-4000-8000-0000000000af',
                'destination_kind','table',
                'target_table_id','19500000-bbbb-4000-8000-000000000002'
            )),1
        );
        select * into v_claim from public.fn_claim_completeness_item(
            (v_enqueued->'items'->0->>'id')::uuid,
            case when v_index=1
                then '19500000-3000-4000-8000-0000000000a2'::uuid
                else '19500000-3000-4000-8000-0000000000b2'::uuid end,
            120
        );
        perform public.fn_route_destination(
            v_claim.id,v_claim.lease_token,
            (v_enqueued->'destinations'->0->>'id')::uuid,v_restaurant
        );
    end loop;
    assert (
        select pg_catalog.count(*)=2
           and pg_catalog.count(distinct client_nonce)=2
           and pg_catalog.count(distinct restaurant_id)=2
        from public.table_shares
        where table_id='19500000-bbbb-4000-8000-000000000002'
          and author_id='19500000-0000-4000-8000-000000000001'
    ), 'FAIL: same-owner cross-job destination nonce aliased a Table share';
end;
$table_nonce_scope$;

-- Reference-sensitive media serialization: same ref waits/reuses, a new
-- Places reference is fresh, while user/Table/none terminal heroes stop spend.
insert into public.restaurants(
    id,external_id,name,verification,created_by,lat,lng,photo_source
)
values (
    '19500000-aaaa-4000-8000-000000000003','ChIJ195Media','Media Cafe','verified',
    '19500000-0000-4000-8000-000000000001',51.52,-0.12,null
) , (
    '19500000-aaaa-4000-8000-0000000000f1','ChIJ195MediaNone','Media None','verified',
    '19500000-0000-4000-8000-000000000001',51.52,-0.12,'none'
) on conflict (id) do nothing;

insert into public.place_attestations(
    place_id,display_name,lat,lng,photo_reference,photo_attribution_html,fetched_at
)
values
    ('ChIJ195MediaA','Media Cafe',51.52,-0.12,'places/ChIJ195Media/photos/a','<a>Author A</a>',now()),
    ('ChIJ195MediaB','Media Cafe',51.52,-0.12,'places/ChIJ195Media/photos/b','<a>Author B</a>',now())
on conflict (place_id) do nothing;

do $media$
declare
    v_claim record;
begin
    select * into v_claim from public.fn_claim_media(
        '19500000-aaaa-4000-8000-0000000000f1','places/ChIJ195Media/photos/a',
        '19500000-4000-4000-8000-000000000000',120
    );
    assert v_claim.outcome = 'satisfied' and v_claim.committed_url is null,
        'FAIL: explicit photoless terminal authorized replacement media spend';
    assert not exists (
        select 1 from public.media_claims
        where restaurant_id = '19500000-aaaa-4000-8000-0000000000f1'
    ), 'FAIL: explicit photoless terminal created a media claim';

    select * into v_claim from public.fn_claim_media(
        '19500000-aaaa-4000-8000-000000000003','places/ChIJ195Media/photos/a',
        '19500000-4000-4000-8000-000000000001',120
    );
    assert v_claim.outcome = 'claimed', 'FAIL: first media claim did not win';
    select * into v_claim from public.fn_claim_media(
        '19500000-aaaa-4000-8000-000000000003','places/ChIJ195Media/photos/a',
        '19500000-4000-4000-8000-000000000002',120
    );
    assert v_claim.outcome = 'pending', 'FAIL: concurrent same-reference media claim did not wait';
    assert public.fn_commit_media(
        '19500000-aaaa-4000-8000-000000000003','places/ChIJ195Media/photos/a',
        '19500000-4000-4000-8000-000000000001',
        'https://storage.invalid/19500000-aaaa-4000-8000-000000000003/a.jpg'
    ), 'FAIL: winning media claim could not commit';
    assert (
        select photo_source='places'
          and photo_url='https://storage.invalid/19500000-aaaa-4000-8000-000000000003/a.jpg'
        from public.restaurants where id='19500000-aaaa-4000-8000-000000000003'
    ), 'FAIL: exact-URL CAS could not replace a prior photoless terminal';
    select * into v_claim from public.fn_claim_media(
        '19500000-aaaa-4000-8000-000000000003','places/ChIJ195Media/photos/a',
        '19500000-4000-4000-8000-000000000003',120
    );
    assert v_claim.outcome = 'done', 'FAIL: committed media was not reused';
    select * into v_claim from public.fn_claim_media(
        '19500000-aaaa-4000-8000-000000000003','places/ChIJ195Media/photos/b',
        '19500000-4000-4000-8000-000000000004',120
    );
    assert v_claim.outcome = 'claimed', 'FAIL: a new photo reference reused stale media bytes';
    assert not public.fn_commit_media(
        '19500000-aaaa-4000-8000-000000000003','places/ChIJ195Media/photos/b',
        '19500000-4000-4000-8000-000000000004',
        'https://storage.invalid/19500000-aaaa-4000-8000-000000000003/b.jpg'
    ), 'FAIL: losing exact-URL media CAS was acknowledged';
    assert (
        select committed_at is null
           and claim_owner = '19500000-4000-4000-8000-000000000004'
           and committed_url is null
        from public.media_claims
        where restaurant_id = '19500000-aaaa-4000-8000-000000000003'
          and claim_key like '%:' || pg_catalog.encode(
              extensions.digest('places/ChIJ195Media/photos/b','sha1'),'hex'
          )
    ), 'FAIL: zero-row media CAS left a false committed claim';
    assert (
        select photo_url = 'https://storage.invalid/19500000-aaaa-4000-8000-000000000003/a.jpg'
           and photo_reference = 'places/ChIJ195Media/photos/a'
        from public.restaurants where id = '19500000-aaaa-4000-8000-000000000003'
    ), 'FAIL: losing media commit replaced the live exact URL';
end;
$media$;

-- Promoting an owner ghost to a newly matched external identity is not a
-- server attestation.  Client coordinates and a client terminal marker must
-- remain unverified until Details is applied under the completeness CAS.
insert into public.restaurants(
    id,external_id,name,verification,created_by,lat,lng,photo_source
)
values (
    '19500000-aaaa-4000-8000-000000000004','ghost_195_no_preattest','Client Ghost','unverified',
    '19500000-0000-4000-8000-000000000001',40.1,-73.2,'none'
);
do $promotion$
declare
    v_id uuid;
begin
    v_id := public.fn_canonicalize_ghost(
        '19500000-aaaa-4000-8000-000000000004','ChIJ195NoPreattest',0,'sql_spec'
    );
    assert v_id='19500000-aaaa-4000-8000-000000000004',
        'FAIL: in-place identity promotion changed restaurant id';
    assert (
        select external_id='ChIJ195NoPreattest' and verification='unverified'
        from public.restaurants where id=v_id
    ), 'FAIL: identity promotion trusted client completeness before Details';
end;
$promotion$;

-- Merging into an existing external-id row must not promote or enrich it from
-- client-shaped ghost facts. Only the later fenced attestation may verify it.
insert into public.restaurants(
    id,external_id,name,city,verification,created_by,lat,lng,
    photo_url,photo_source
) values
    (
        '19500000-aaaa-4000-8000-000000000005','ghost_195_existing_target',
        'Poison Ghost','Poison City','unverified',
        '19500000-0000-4000-8000-000000000001',12.34,56.78,
        'https://client.invalid/ghost.jpg','user'
    ),
    (
        '19500000-aaaa-4000-8000-000000000006','ChIJ195ExistingUnverified',
        'Existing Stale','Stale City','unverified',
        '19500000-0000-4000-8000-000000000001',22.22,33.33,
        'https://client.invalid/target.jpg','user'
    );
do $existing_unverified_target$
declare
    v_id uuid;
begin
    v_id := public.fn_canonicalize_ghost(
        '19500000-aaaa-4000-8000-000000000005',
        'ChIJ195ExistingUnverified',0,'sql_spec'
    );
    assert v_id='19500000-aaaa-4000-8000-000000000006',
        'FAIL: existing external-id merge chose the wrong target';
    assert (
        select verification='unverified'
           and name='Existing Stale'
           and city='Stale City'
           and lat=22.22 and lng=33.33
           and photo_url='https://client.invalid/target.jpg'
        from public.restaurants where id=v_id
    ), 'FAIL: canonicalization promoted/copied untrusted ghost completeness';
end;
$existing_unverified_target$;

-- ---------------------------------------------------------------------------
-- Exhaustive canonicalization fixture (every actual restaurant FK policy).
-- ---------------------------------------------------------------------------

insert into public.restaurants(
    id,external_id,name,city,verification,created_by,lat,lng,
    photo_url,photo_reference,photo_source,places_photo_attribution_html
)
values
    ('19500000-aaaa-4000-8000-000000000101','ghost_195_merge','Merge Ghost','London','unverified',
     '19500000-0000-4000-8000-000000000001',51.50,-0.10,
     'https://storage.invalid/19500000-aaaa-4000-8000-000000000101/ref.jpg',
     'places/merge/photos/ref','places','<a>Merge Author</a>'),
    ('19500000-aaaa-4000-8000-000000000102','ChIJ195Canonical','Merge Canonical',null,'verified',
     null,null,null,null,null,'none',null),
    ('19500000-aaaa-4000-8000-000000000103','merged_preexisting','Older Alias',null,'unverified',
     '19500000-0000-4000-8000-000000000001',null,null,null,null,null,null)
on conflict (id) do nothing;

update public.restaurants
set merged_into = '19500000-aaaa-4000-8000-000000000101'
where id = '19500000-aaaa-4000-8000-000000000103';
insert into public.restaurant_merges(ghost_id,canonical_id)
values ('19500000-aaaa-4000-8000-000000000103','19500000-aaaa-4000-8000-000000000101')
on conflict (ghost_id) do update set canonical_id = excluded.canonical_id;

insert into public.tables(id,owner_id,name)
values ('19500000-bbbb-4000-8000-000000000101','19500000-0000-4000-8000-000000000001','Merge Table')
on conflict (id) do nothing;
insert into public.table_members(table_id,member_id,role)
values
    ('19500000-bbbb-4000-8000-000000000101','19500000-0000-4000-8000-000000000001','admin'),
    ('19500000-bbbb-4000-8000-000000000101','19500000-0000-4000-8000-000000000002','member')
on conflict do nothing;

insert into public.lists(id,owner_id,title,ranked,privacy,table_id)
values
    ('19500000-cccc-4000-8000-000000000101','19500000-0000-4000-8000-000000000001','Merge List',true,'private',null),
    ('19500000-cccc-4000-8000-000000000102','19500000-0000-4000-8000-000000000001','Alias Insert List',true,'private',null)
on conflict (id) do nothing;

-- Wishlist collision: live ghost must beat an older soft-deleted canonical row.
insert into public.wishlist_items(
    id,user_id,restaurant_id,note,source,created_at,deleted_at,client_nonce
)
values
    ('19500000-dddd-4000-8000-000000000101','19500000-0000-4000-8000-000000000001',
     '19500000-aaaa-4000-8000-000000000102','deleted canonical','{"type":"web"}',now()-interval '3 days',now(),
     '19500000-dddd-4000-8000-000000000111'),
    ('19500000-dddd-4000-8000-000000000102','19500000-0000-4000-8000-000000000001',
     '19500000-aaaa-4000-8000-000000000101','live ghost','{"type":"tiktok"}',now()-interval '1 day',null,
     '19500000-dddd-4000-8000-000000000112')
on conflict (id) do nothing;

-- list_entries collision: older canonical row keeps conflicting note/added_by;
-- minimum position survives. Legacy list_items has no timestamp.
insert into public.list_entries(id,list_id,restaurant_id,note,position,created_at,added_by)
values
    ('19500000-eeee-4000-8000-000000000101','19500000-cccc-4000-8000-000000000101',
     '19500000-aaaa-4000-8000-000000000102','older canonical',20,now()-interval '3 days',
     '19500000-0000-4000-8000-000000000001'),
    ('19500000-eeee-4000-8000-000000000102','19500000-cccc-4000-8000-000000000101',
     '19500000-aaaa-4000-8000-000000000101','newer ghost',5,now()-interval '1 day',
     '19500000-0000-4000-8000-000000000002')
on conflict (id) do nothing;
insert into public.list_items(list_id,restaurant_id,note,position)
values
    ('19500000-cccc-4000-8000-000000000101','19500000-aaaa-4000-8000-000000000102',null,9),
    ('19500000-cccc-4000-8000-000000000101','19500000-aaaa-4000-8000-000000000101','ghost legacy note',2)
on conflict do nothing;

insert into public.visits(id,user_id,restaurant_id,visited_on)
values ('19500000-1111-4000-8000-000000000101','19500000-0000-4000-8000-000000000001',
        '19500000-aaaa-4000-8000-000000000101',current_date);
insert into public.entries(id,user_id,restaurant_id,rating,content)
values ('19500000-1111-4000-8000-000000000102','19500000-0000-4000-8000-000000000001',
        '19500000-aaaa-4000-8000-000000000101',4,'merge fixture');

insert into public.user_restaurant_status(
    user_id,restaurant_id,been,liked,want_to_try,created_at,updated_at
)
values
    ('19500000-0000-4000-8000-000000000001','19500000-aaaa-4000-8000-000000000102',true,false,false,now()-interval '3 days',now()-interval '2 days'),
    ('19500000-0000-4000-8000-000000000001','19500000-aaaa-4000-8000-000000000101',false,true,true,now()-interval '1 day',now())
on conflict do nothing;

insert into public.import_jobs(job_id,user_id,status,restaurant_id,protocol_generation)
values ('19500000-2222-4000-8000-000000000101','19500000-0000-4000-8000-000000000001',
        'resolved','19500000-aaaa-4000-8000-000000000101','legacy');
insert into public.table_shares(
    id,job_id,table_id,author_id,restaurant_id,extraction_status
)
values ('19500000-2222-4000-8000-000000000102','19500000-2222-4000-8000-000000000101',
        '19500000-bbbb-4000-8000-000000000101','19500000-0000-4000-8000-000000000001',
        '19500000-aaaa-4000-8000-000000000101','resolved');
insert into public.table_nights(id,table_id,restaurant_id,host_user_id,status)
values ('19500000-2222-4000-8000-000000000103','19500000-bbbb-4000-8000-000000000101',
        '19500000-aaaa-4000-8000-000000000101','19500000-0000-4000-8000-000000000001','closed');
insert into public.table_top_4(table_id,position,restaurant_id,updated_by)
values ('19500000-bbbb-4000-8000-000000000101',1,'19500000-aaaa-4000-8000-000000000101',
        '19500000-0000-4000-8000-000000000001');
insert into public.table_top_4_history(
    id,table_id,position,actor_id,event_type,prev_restaurant_id,next_restaurant_id
)
values ('19500000-2222-4000-8000-000000000104','19500000-bbbb-4000-8000-000000000101',1,
        '19500000-0000-4000-8000-000000000001','swapped',
        '19500000-aaaa-4000-8000-000000000101','19500000-aaaa-4000-8000-000000000101');

insert into public.table_float_state(
    id,table_id,restaurant_id,saver_set_hash,saver_user_ids,window_start,window_end,
    distinct_count,first_crossed_at,surfaced_at,dismissed_at,suppressed_until
)
values
    ('19500000-3333-4000-8000-000000000101','19500000-bbbb-4000-8000-000000000101',
     '19500000-aaaa-4000-8000-000000000102','same','{19500000-0000-4000-8000-000000000001}',
     now()-interval '5 days',now(),1,now()-interval '4 days',now()-interval '3 days',null,now()+interval '1 day'),
    ('19500000-3333-4000-8000-000000000102','19500000-bbbb-4000-8000-000000000101',
     '19500000-aaaa-4000-8000-000000000101','same','{19500000-0000-4000-8000-000000000001}',
     now()-interval '5 days',now(),2,now()-interval '2 days',now()-interval '1 day',now(),now()+interval '10 days');

-- Gathering collision. Ghost proposal is earlier, but equal-time RSVP ties
-- retain the RSVP that was already on the canonical restaurant.
insert into public.gatherings(
    id,table_id,restaurant_id,host_user_id,note,gather_on,status,created_at,updated_at
)
values
    ('19500000-4444-4000-8000-000000000101','19500000-bbbb-4000-8000-000000000101',
     '19500000-aaaa-4000-8000-000000000101','19500000-0000-4000-8000-000000000001',
     'ghost proposal',current_date+10,'proposed',now()-interval '2 days',now()-interval '2 days'),
    ('19500000-4444-4000-8000-000000000102','19500000-bbbb-4000-8000-000000000101',
     '19500000-aaaa-4000-8000-000000000102','19500000-0000-4000-8000-000000000001',
     'canonical proposal',current_date+11,'proposed',now()-interval '1 day',now()-interval '1 day');
insert into public.gathering_rsvps(gathering_id,user_id,response,counter_on,created_at,updated_at)
values
    ('19500000-4444-4000-8000-000000000101','19500000-0000-4000-8000-000000000002','out',null,now()-interval '2 days',now()-interval '1 hour'),
    ('19500000-4444-4000-8000-000000000102','19500000-0000-4000-8000-000000000002','counter',current_date+12,now()-interval '1 day',now()-interval '1 hour');

insert into public.user_claimed_cities(user_id,city,is_home)
values ('19500000-0000-4000-8000-000000000001','London',true)
on conflict do nothing;
insert into public.user_top_4(user_id,city,position,restaurant_id)
values
    ('19500000-0000-4000-8000-000000000001','London',1,'19500000-aaaa-4000-8000-000000000102'),
    ('19500000-0000-4000-8000-000000000001','London',2,'19500000-aaaa-4000-8000-000000000101');
insert into public.user_profile_top_4(user_id,position,restaurant_id)
values
    ('19500000-0000-4000-8000-000000000001',1,'19500000-aaaa-4000-8000-000000000102'),
    ('19500000-0000-4000-8000-000000000001',2,'19500000-aaaa-4000-8000-000000000101');
insert into public.user_profile_takes(user_id,prompt_key,position,restaurant_id,note)
values ('19500000-0000-4000-8000-000000000001','best_value',1,
        '19500000-aaaa-4000-8000-000000000101','ghost take');

insert into public.professional_critic_reviews(
    id,restaurant_id,publication,kind,suppressed,suppression_reason,updated_at
)
values
    ('19500000-5555-4000-8000-000000000101','19500000-aaaa-4000-8000-000000000102',
     'spec','feature',false,null,now()),
    ('19500000-5555-4000-8000-000000000102','19500000-aaaa-4000-8000-000000000101',
     'spec','feature',true,'operator takedown',now()-interval '1 day');
insert into public.critic_scrape_attempts(restaurant_id,publication,last_attempted_at,status)
values
    ('19500000-aaaa-4000-8000-000000000102','spec',now()-interval '2 days','miss'),
    ('19500000-aaaa-4000-8000-000000000101','spec',now()-interval '1 day','hit');
insert into public.suppers(id,restaurant_id,host_user_id)
values ('19500000-5555-4000-8000-000000000103','19500000-aaaa-4000-8000-000000000101',
        '19500000-0000-4000-8000-000000000001');

insert into public.notifications(id,user_id,kind,subject_restaurant_id,subject_meta)
values ('19500000-5555-4000-8000-000000000104','19500000-0000-4000-8000-000000000001',
        'import_done','19500000-aaaa-4000-8000-000000000101','{"outcome":"completed"}');
insert into public.restaurant_completeness_queue(
    id,owner_id,job_id,item_nonce,item_hash,restaurant_id,state,next_attempt_at
)
values ('19500000-5555-4000-8000-000000000105','19500000-0000-4000-8000-000000000001',
        '19500000-2222-4000-8000-000000000101','19500000-5555-4000-8000-000000000106',
        'fixture','19500000-aaaa-4000-8000-000000000101','pending',now());

insert into public.media_claims(
    claim_key,restaurant_id,committed_at,committed_reference,committed_url
)
values (
    'media:19500000-aaaa-4000-8000-000000000101:' ||
        pg_catalog.encode(extensions.digest('places/merge/photos/ref','sha1'),'hex'),
    '19500000-aaaa-4000-8000-000000000101',now(),'places/merge/photos/ref',
    'https://storage.invalid/19500000-aaaa-4000-8000-000000000101/ref.jpg'
);
insert into public.place_attestations(
    place_id,display_name,lat,lng,photo_reference,photo_attribution_html,fetched_at
) values (
    'ChIJ195MergeAttestation','Merge Canonical',51.50,-0.10,
    'places/merge/photos/ref','<a>Merge Author</a>',now()
);

do $merge$
declare
    v_id uuid;
    v_result jsonb;
begin
    v_id := public.fn_canonicalize_ghost(
        '19500000-aaaa-4000-8000-000000000101','ChIJ195Canonical',0,'sql_spec'
    );
    assert v_id = '19500000-aaaa-4000-8000-000000000102', 'FAIL: wrong canonical target';
    assert (
        select merged_into = v_id and external_id like 'merged_%'
        from public.restaurants where id = '19500000-aaaa-4000-8000-000000000101'
    ), 'FAIL: ghost was not retained as a tombstone';
    assert public.fn_resolve_canonical('19500000-aaaa-4000-8000-000000000103') = v_id,
        'FAIL: transitive alias path was not compressed/resolved';

    assert (
        select restaurant_id = v_id and deleted_at is null and note = 'live ghost'
        from public.wishlist_items where user_id = '19500000-0000-4000-8000-000000000001'
    ), 'FAIL: wishlist live-over-deleted merge policy';
    assert (
        select pg_catalog.count(*) = 1 and pg_catalog.min(note) = 'older canonical'
               and pg_catalog.min(position) = 5
        from public.list_entries where list_id = '19500000-cccc-4000-8000-000000000101'
    ), 'FAIL: list_entries older/conflict/min-position policy';
    assert (
        select note = 'ghost legacy note' and position = 2
        from public.list_items
        where list_id = '19500000-cccc-4000-8000-000000000101' and restaurant_id = v_id
    ), 'FAIL: timestamp-less list_items policy';
    assert exists (select 1 from public.visits where id='19500000-1111-4000-8000-000000000101' and restaurant_id=v_id),
        'FAIL: visits not repointed';
    assert exists (select 1 from public.entries where id='19500000-1111-4000-8000-000000000102' and restaurant_id=v_id),
        'FAIL: entries not repointed';
    assert (
        select been and liked and want_to_try from public.user_restaurant_status
        where user_id='19500000-0000-4000-8000-000000000001' and restaurant_id=v_id
    ), 'FAIL: user status did not boolean-union';
    assert exists (select 1 from public.table_shares where id='19500000-2222-4000-8000-000000000102' and restaurant_id=v_id),
        'FAIL: table_shares not repointed';
    assert exists (select 1 from public.table_nights where id='19500000-2222-4000-8000-000000000103' and restaurant_id=v_id),
        'FAIL: table_nights not repointed';
    assert exists (select 1 from public.import_jobs where job_id='19500000-2222-4000-8000-000000000101' and restaurant_id=v_id),
        'FAIL: import_jobs not repointed';
    assert exists (select 1 from public.table_top_4 where table_id='19500000-bbbb-4000-8000-000000000101' and restaurant_id=v_id),
        'FAIL: table_top_4 not repointed';
    assert exists (
        select 1 from public.table_top_4_history where id='19500000-2222-4000-8000-000000000104'
          and prev_restaurant_id=v_id and next_restaurant_id=v_id
    ), 'FAIL: table_top_4_history not repointed';
    assert (
        select id='19500000-3333-4000-8000-000000000102'
          and suppressed_until > now()+interval '9 days'
          and dismissed_at is not null
          and distinct_count=2
          and first_crossed_at > now()-interval '3 days'
        from public.table_float_state
        where table_id='19500000-bbbb-4000-8000-000000000101' and restaurant_id=v_id
    ), 'FAIL: table_float_state did not keep the real most-suppressive survivor';
    assert (
        select restaurant_id=v_id from public.gatherings where id='19500000-4444-4000-8000-000000000101'
    ) and not exists (
        select 1 from public.gatherings where id='19500000-4444-4000-8000-000000000102'
    ), 'FAIL: gathering proposal survivor was not deterministic';
    assert (
        select response='counter' and counter_on=current_date+12
        from public.gathering_rsvps
        where gathering_id='19500000-4444-4000-8000-000000000101'
          and user_id='19500000-0000-4000-8000-000000000002'
    ), 'FAIL: equal-time canonical gathering RSVP did not survive';
    assert (
        select pg_catalog.count(*)=1 from public.user_top_4
        where user_id='19500000-0000-4000-8000-000000000001' and city='London' and restaurant_id=v_id
    ), 'FAIL: user_top_4 collision not deduped';
    assert (
        select pg_catalog.count(*)=1 from public.user_profile_top_4
        where user_id='19500000-0000-4000-8000-000000000001' and restaurant_id=v_id
    ), 'FAIL: user_profile_top_4 collision not deduped';
    assert exists (
        select 1 from public.user_profile_takes
        where user_id='19500000-0000-4000-8000-000000000001' and restaurant_id=v_id
    ), 'FAIL: user_profile_takes not repointed';
    assert (
        select suppressed and suppression_reason like '%operator takedown%'
        from public.professional_critic_reviews where restaurant_id=v_id and publication='spec'
    ), 'FAIL: suppressed critic audit row did not win';
    assert (
        select status='hit' and last_attempted_at > now()-interval '2 days'
        from public.critic_scrape_attempts where restaurant_id=v_id and publication='spec'
    ), 'FAIL: latest critic scrape attempt did not win';
    assert exists (select 1 from public.suppers where id='19500000-5555-4000-8000-000000000103' and restaurant_id=v_id),
        'FAIL: suppers not repointed';
    assert (
        select subject_restaurant_id='19500000-aaaa-4000-8000-000000000101'
        from public.notifications where id='19500000-5555-4000-8000-000000000104'
    ) and public.fn_resolve_canonical('19500000-aaaa-4000-8000-000000000101')=v_id,
        'FAIL: notification FK moved or hydration cannot resolve tombstone';
    assert exists (
        select 1 from public.restaurant_completeness_queue
        where id='19500000-5555-4000-8000-000000000105' and restaurant_id=v_id
    ), 'FAIL: completeness queue target not repointed';
    assert (
        select photo_url='https://storage.invalid/19500000-aaaa-4000-8000-000000000101/ref.jpg'
          and photo_reference='places/merge/photos/ref'
          and photo_source='places'
          and places_photo_attribution_html='<a>Merge Author</a>'
        from public.restaurants where id=v_id
    ), 'FAIL: canonical row lost exact URL/reference/attribution';
    assert exists (
        select 1 from public.media_claims
        where restaurant_id=v_id
          and claim_key like 'media:'||v_id::text||':%'
          and committed_url='https://storage.invalid/19500000-aaaa-4000-8000-000000000101/ref.jpg'
    ), 'FAIL: path-relaxed media claim was copied/re-fetched instead of transferred';

    -- Alias-remap and insertion share one transaction; two alias ids collapse
    -- to one canonical list row with deterministic accounting.
    v_result := public.fn_add_list_entries_canonical(
        '19500000-0000-4000-8000-000000000001',
        '19500000-cccc-4000-8000-000000000102',
        array['19500000-aaaa-4000-8000-000000000101'::uuid,
              '19500000-aaaa-4000-8000-000000000103'::uuid]
    );
    assert (v_result->>'added_count')::integer=1 and (v_result->>'skipped_count')::integer=1,
        'FAIL: alias-safe bulk list insert did not collapse to canonical id';
end;
$merge$;

-- Full list-repair authorization: non-creator member fails, creator removed
-- from the Table fails, and the current-member creator succeeds.
insert into public.restaurants(id,external_id,name,verification,created_by)
values
    ('19500000-aaaa-4000-8000-000000000201','ghost_195_repair','Repair Ghost','unverified',
     '19500000-0000-4000-8000-000000000002'),
    ('19500000-aaaa-4000-8000-000000000202','ChIJ195Repair','Repair Canonical','verified',null)
on conflict (id) do nothing;
insert into public.place_attestations(place_id,display_name,lat,lng,fetched_at)
values ('ChIJ195Repair','Repair Canonical',51.53,-0.13,now())
on conflict (place_id) do update set fetched_at=excluded.fetched_at;
insert into public.lists(id,owner_id,title,ranked,privacy,table_id)
values ('19500000-cccc-4000-8000-000000000201','19500000-0000-4000-8000-000000000001',
        'Repair Table List',false,'private','19500000-bbbb-4000-8000-000000000101')
on conflict (id) do nothing;
insert into public.list_entries(id,list_id,restaurant_id,position,added_by)
values ('19500000-eeee-4000-8000-000000000201','19500000-cccc-4000-8000-000000000201',
        '19500000-aaaa-4000-8000-000000000201',0,'19500000-0000-4000-8000-000000000002')
on conflict (id) do nothing;

do $repair$
declare
    v_failed boolean;
    v_id uuid;
begin
    v_failed := false;
    begin
        perform public.fn_repair_list_ghost(
            '19500000-0000-4000-8000-000000000001',
            '19500000-eeee-4000-8000-000000000201',
            '19500000-cccc-4000-8000-000000000201',
            'ChIJ195Repair',0
        );
    exception when insufficient_privilege then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: non-creator Table member repaired another user''s ghost';

    delete from public.table_members
    where table_id='19500000-bbbb-4000-8000-000000000101'
      and member_id='19500000-0000-4000-8000-000000000002';
    v_failed := false;
    begin
        perform public.fn_repair_list_ghost(
            '19500000-0000-4000-8000-000000000002',
            '19500000-eeee-4000-8000-000000000201',
            '19500000-cccc-4000-8000-000000000201',
            'ChIJ195Repair',0
        );
    exception when insufficient_privilege then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: removed Table member retained repair authority';

    insert into public.table_members(table_id,member_id,role)
    values ('19500000-bbbb-4000-8000-000000000101',
            '19500000-0000-4000-8000-000000000002','member');
    v_id := public.fn_repair_list_ghost(
        '19500000-0000-4000-8000-000000000002',
        '19500000-eeee-4000-8000-000000000201',
        '19500000-cccc-4000-8000-000000000201',
        'ChIJ195Repair',0
    );
    assert v_id='19500000-aaaa-4000-8000-000000000202',
        'FAIL: creator/current-member repair did not return canonical id';
    assert exists (
        select 1 from public.list_entries
        where id='19500000-eeee-4000-8000-000000000201' and restaurant_id=v_id
    ), 'FAIL: repair transaction did not repoint its list entry';
end;
$repair$;

-- Cycle guard must terminate explicitly rather than recurse forever.
insert into public.restaurants(id,external_id,name,verification)
values
    ('19500000-aaaa-4000-8000-000000000301','cycle_195_a','Cycle A','unverified'),
    ('19500000-aaaa-4000-8000-000000000302','cycle_195_b','Cycle B','unverified')
on conflict (id) do nothing;
update public.restaurants set merged_into='19500000-aaaa-4000-8000-000000000302'
where id='19500000-aaaa-4000-8000-000000000301';
update public.restaurants set merged_into='19500000-aaaa-4000-8000-000000000301'
where id='19500000-aaaa-4000-8000-000000000302';

do $cycle$
declare
    v_failed boolean := false;
begin
    begin
        perform public.fn_resolve_canonical('19500000-aaaa-4000-8000-000000000301');
    exception when check_violation then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: alias cycle guard did not terminate with ALIAS_CYCLE';
end;
$cycle$;

do $pass$
begin
    raise notice 'PASS restaurant_completeness: security, leases, ledger, merge inventory, repair';
end;
$pass$;
rollback;
