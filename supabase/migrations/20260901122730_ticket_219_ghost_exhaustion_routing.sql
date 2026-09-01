-- TICKET-219: a Save remains a Save when completeness exhausts.  Non-table
-- destinations are routed to the minted ghost with the same nonce-ledger
-- discipline as verified routing.  The core is deliberately not executable
-- by service_role: callers must pass either the live lease fence or the
-- exhausted-row backfill fence first.

create or replace function public.fn_route_exhausted_destination_core(
    p_item_id uuid,
    p_destination_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $route_core$
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
    if not found or v_item.state not in ('leased', 'exhausted') then
        raise exception using errcode = '55000', message = 'INVALID_EXHAUSTED_ROUTE_STATE';
    end if;

    select * into v_destination
    from public.completeness_destinations
    where id = p_destination_id
      and owner_id = v_item.owner_id
      and job_id = v_item.job_id
      and item_nonce = v_item.item_nonce
    for update;
    if not found then
        raise exception using errcode = '23503', message = 'destination does not belong to item';
    end if;
    if v_destination.destination_kind = 'table' then
        raise exception using errcode = '22023', message = 'TABLE_DESTINATION_REQUIRES_VERIFIED_RESTAURANT';
    end if;

    v_restaurant_id := public.fn_resolve_canonical(v_item.restaurant_id);
    if v_restaurant_id is null or not exists (
        select 1 from public.restaurants r
        where r.id = v_restaurant_id and r.merged_into is null
    ) then
        raise exception using errcode = '23514', message = 'exhausted routing requires an existing canonical restaurant';
    end if;

    v_ledger_key := 'route:' || v_item.owner_id::text || ':' || v_item.job_id::text || ':' ||
        v_item.item_nonce::text || ':' || v_destination.destination_nonce::text;
    v_payload := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'owner_id', v_item.owner_id,
        'job_id', v_item.job_id,
        'item_nonce', v_item.item_nonce,
        'destination_nonce', v_destination.destination_nonce,
        'destination_kind', v_destination.destination_kind,
        'target_list_id', v_destination.target_list_id,
        'target_list_title', v_destination.target_list_title,
        'title_nonce', v_destination.title_nonce,
        'restaurant_id', v_restaurant_id
    ));
    v_hash := pg_catalog.encode(extensions.digest(v_payload::text, 'sha256'), 'hex');
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
            'restaurant_id', v_restaurant_id,
            'ghost', true
        );

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
            select * into v_existing
            from public.destination_nonce_ledger
            where ledger_key = v_newlist_key
            for update;
            if v_existing.payload_hash <> v_newlist_hash or v_existing.acked_at is null then
                raise exception using errcode = '23505', message = 'NEW_LIST_LEDGER_CONFLICT';
            end if;
            v_list_id := (v_existing.result->>'list_id')::uuid;
        end if;
        perform 1
        from public.lists
        where id = v_list_id and owner_id = v_item.owner_id
        for update;
        v_authorized := found;
    end if;

    if v_destination.destination_kind in ('list', 'new_list') and v_authorized then
        select coalesce(pg_catalog.max(position), 0) + 1024
        into v_position
        from public.list_entries
        where list_id = v_list_id;
        insert into public.list_entries(list_id, restaurant_id, note, position, added_by)
        values (
            v_list_id, v_restaurant_id, nullif(v_item.client_facts->>'note', ''),
            v_position, v_item.owner_id
        )
        on conflict (list_id, restaurant_id) do nothing
        returning id into v_entry_id;
        if v_entry_id is null then
            select id into v_entry_id
            from public.list_entries
            where list_id = v_list_id and restaurant_id = v_restaurant_id;
        end if;
        v_result := pg_catalog.jsonb_build_object(
            'outcome', 'fulfilled',
            'list_id', v_list_id,
            'entry_id', v_entry_id,
            'restaurant_id', v_restaurant_id,
            'ghost', true
        );
    end if;

    if not v_authorized then
        v_result := pg_catalog.jsonb_build_object(
            'outcome', 'rejected',
            'reason', 'AUTHORITY_REVOKED',
            'restaurant_id', v_restaurant_id,
            'ghost', true
        );
    end if;

    -- The acknowledgement precedes destination terminalization. Both writes
    -- remain in this transaction, so a failure rolls the complete route back.
    update public.destination_nonce_ledger
    set result = v_result, acked_at = pg_catalog.now()
    where ledger_key = v_ledger_key;
    update public.completeness_destinations
    set outcome = v_result->>'outcome'
    where id = v_destination.id and outcome = 'pending';
    return v_result;
end;
$route_core$;

revoke all on function public.fn_route_exhausted_destination_core(uuid, uuid)
    from public, anon, authenticated, service_role;

create or replace function public.fn_route_exhausted_destinations(
    p_item_id uuid,
    p_lease_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $live_route$
declare
    v_item public.restaurant_completeness_queue%rowtype;
    v_destination record;
    v_results jsonb := '[]'::jsonb;
begin
    select * into v_item
    from public.restaurant_completeness_queue
    where id = p_item_id
    for update;
    if not found or v_item.state <> 'leased' or v_item.lease_token is distinct from p_lease_token then
        raise exception using errcode = '55000', message = 'STALE_LEASE';
    end if;

    for v_destination in
        select d.id
        from public.completeness_destinations d
        where d.owner_id = v_item.owner_id
          and d.job_id = v_item.job_id
          and d.item_nonce = v_item.item_nonce
          and d.destination_kind <> 'table'
          and d.outcome = 'pending'
        order by d.created_at, d.id
    loop
        v_results := v_results || pg_catalog.jsonb_build_array(
            public.fn_route_exhausted_destination_core(p_item_id, v_destination.id)
        );
    end loop;
    return v_results;
end;
$live_route$;

revoke all on function public.fn_route_exhausted_destinations(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.fn_route_exhausted_destinations(uuid, uuid)
    to service_role;

create or replace function public.fn_backfill_exhausted_destinations(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $backfill_route$
declare
    v_item public.restaurant_completeness_queue%rowtype;
    v_destination record;
    v_results jsonb := '[]'::jsonb;
begin
    select * into v_item
    from public.restaurant_completeness_queue
    where id = p_item_id
    for update;
    if not found or v_item.state <> 'exhausted' or v_item.dismissed_at is not null then
        raise exception using errcode = '55000', message = 'NOT_ACTIVE_EXHAUSTED_ITEM';
    end if;

    for v_destination in
        select d.id
        from public.completeness_destinations d
        where d.owner_id = v_item.owner_id
          and d.job_id = v_item.job_id
          and d.item_nonce = v_item.item_nonce
          and d.destination_kind <> 'table'
          and d.outcome = 'pending'
        order by d.created_at, d.id
    loop
        v_results := v_results || pg_catalog.jsonb_build_array(
            public.fn_route_exhausted_destination_core(p_item_id, v_destination.id)
        );
    end loop;
    return v_results;
end;
$backfill_route$;

revoke all on function public.fn_backfill_exhausted_destinations(uuid)
    from public, anon, authenticated;
grant execute on function public.fn_backfill_exhausted_destinations(uuid)
    to service_role;

do $privilege_assert$
begin
    if pg_catalog.has_function_privilege('anon', 'public.fn_route_exhausted_destination_core(uuid,uuid)', 'execute')
       or pg_catalog.has_function_privilege('authenticated', 'public.fn_route_exhausted_destination_core(uuid,uuid)', 'execute')
       or pg_catalog.has_function_privilege('service_role', 'public.fn_route_exhausted_destination_core(uuid,uuid)', 'execute')
    then
        raise exception 'exhausted route core privilege fence failed';
    end if;
    if pg_catalog.has_function_privilege('anon', 'public.fn_route_exhausted_destinations(uuid,uuid)', 'execute')
       or pg_catalog.has_function_privilege('authenticated', 'public.fn_route_exhausted_destinations(uuid,uuid)', 'execute')
       or not pg_catalog.has_function_privilege('service_role', 'public.fn_route_exhausted_destinations(uuid,uuid)', 'execute')
    then
        raise exception 'live exhausted route privilege fence failed';
    end if;
    if pg_catalog.has_function_privilege('anon', 'public.fn_backfill_exhausted_destinations(uuid)', 'execute')
       or pg_catalog.has_function_privilege('authenticated', 'public.fn_backfill_exhausted_destinations(uuid)', 'execute')
       or not pg_catalog.has_function_privilege('service_role', 'public.fn_backfill_exhausted_destinations(uuid)', 'execute')
    then
        raise exception 'backfill exhausted route privilege fence failed';
    end if;
end;
$privilege_assert$;

-- Finalization is the single convergence seam for recorded terminal decisions,
-- missing facts, scored misses, and the defer attempt cap.
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
as $finalize$
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
    else
        perform public.fn_route_exhausted_destinations(p_item_id, p_lease_token);
        if exists (
            select 1 from public.completeness_destinations d
            where d.owner_id = v_item.owner_id and d.job_id = v_item.job_id
              and d.item_nonce = v_item.item_nonce
              and d.destination_kind <> 'table'
              and d.outcome = 'pending'
        ) then
            raise exception using errcode = '23514', message = 'exhausted item still has pending routable destinations';
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
$finalize$;

revoke all on function public.fn_finalize_completeness_item(uuid, uuid, text, uuid, text)
    from public, anon, authenticated;
grant execute on function public.fn_finalize_completeness_item(uuid, uuid, text, uuid, text)
    to service_role;

-- One-time founder backfill.  The loop is replay-safe on environments that do
-- not contain production data, and every present row is asserted after routing.
do $founder_backfill$
declare
    v_target record;
    v_item record;
    v_wishlist_count integer;
    v_destination_count integer;
    v_ledger_count integer;
begin
    for v_target in
        select * from (values
            ('ghost_8bac3e18-6829-4e8d-9f12-98413e934dec_456ca383-ef0f-4238-94ce-00891fc4717f', 'e3ecf204-', 'Parisik'),
            ('ghost_8bac3e18-6829-4e8d-9f12-98413e934dec_ecd59156-fa97-4993-9ec7-0cc53052f1db', '63f8fd6c-', 'PanoPano'),
            ('ghost_8bac3e18-6829-4e8d-9f12-98413e934dec_0befb177-854f-4427-b0a7-6574bd586c61', 'd7217c44-', 'Jip')
        ) as targets(external_id, restaurant_prefix, restaurant_name)
    loop
        select q.id as item_id, q.owner_id, q.job_id, q.item_nonce, r.id as restaurant_id
        into v_item
        from public.restaurant_completeness_queue q
        join public.restaurants r on r.id = q.restaurant_id
        where q.owner_id = '8bac3e18-6829-4e8d-9f12-98413e934dec'::uuid
          and q.job_id = '5e9c0a29-7891-4c62-ab94-384f2986307b'::uuid
          and q.state = 'exhausted'
          and q.dismissed_at is null
          and r.external_id = v_target.external_id
        for update of q;
        if not found then
            continue;
        end if;
        if v_item.restaurant_id::text not like v_target.restaurant_prefix || '%' then
            raise exception 'founder backfill restaurant mismatch for %', v_target.restaurant_name;
        end if;

        perform public.fn_backfill_exhausted_destinations(v_item.item_id);

        select pg_catalog.count(*) into v_wishlist_count
        from public.wishlist_items wi
        where wi.user_id = v_item.owner_id
          and wi.restaurant_id = v_item.restaurant_id
          and wi.deleted_at is null
          and (
              wi.source is null
              or (
                  pg_catalog.jsonb_typeof(wi.source) = 'object'
                  and wi.source ? 'type'
                  and (
                      (wi.source->>'type' in ('tiktok', 'google_maps', 'web') and wi.source ? 'url')
                      or wi.source->>'type' in ('screenshot', 'vision', 'video')
                      or (
                          wi.source->>'type' = 'handoff'
                          and pg_catalog.jsonb_typeof(wi.source->'sharer_name') = 'string'
                          and pg_catalog.btrim(wi.source->>'sharer_name') <> ''
                          and (wi.source - 'type' - 'sharer_name') = '{}'::jsonb
                      )
                  )
              )
          );
        select pg_catalog.count(*) into v_destination_count
        from public.completeness_destinations d
        where d.owner_id = v_item.owner_id
          and d.job_id = v_item.job_id
          and d.item_nonce = v_item.item_nonce
          and d.destination_kind = 'wishlist'
          and d.outcome = 'fulfilled';
        select pg_catalog.count(*) into v_ledger_count
        from public.destination_nonce_ledger l
        where l.owner_id = v_item.owner_id
          and l.job_id = v_item.job_id
          and l.ledger_key like 'route:' || v_item.owner_id::text || ':' ||
              v_item.job_id::text || ':' || v_item.item_nonce::text || ':%'
          and l.acked_at is not null;
        if v_wishlist_count <> 1 or v_destination_count <> 1 or v_ledger_count <> 1 then
            raise exception 'founder backfill verification failed for %: wishlist %, destination %, ledger %',
                v_target.restaurant_name, v_wishlist_count, v_destination_count, v_ledger_count;
        end if;
    end loop;
end;
$founder_backfill$;
