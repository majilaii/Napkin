-- Restore Google Places product metadata to the durable attestation cache.
-- The 24-hour cache TTL remains unchanged; sparse rows written before this
-- migration heal through the existing Place Details path after expiry.

alter table public.place_attestations
    add column google_rating double precision,
    add column google_rating_count integer,
    add column price_level smallint,
    add column types jsonb,
    add column primary_type text,
    add column website text,
    add column phone text,
    add column google_maps_uri text,
    add column opening_hours jsonb;

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
    v_lease := least(greatest(coalesce(p_lease_seconds, 120), 15), 900);

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
            'google_rating', v_row.google_rating,
            'google_rating_count', v_row.google_rating_count,
            'price_level', v_row.price_level,
            'types', v_row.types,
            'primary_type', v_row.primary_type,
            'website', v_row.website,
            'phone', v_row.phone,
            'google_maps_uri', v_row.google_maps_uri,
            'opening_hours', v_row.opening_hours,
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
        google_rating = nullif(p_projection->>'google_rating', '')::double precision,
        google_rating_count = nullif(p_projection->>'google_rating_count', '')::integer,
        price_level = nullif(p_projection->>'price_level', '')::smallint,
        types = nullif(p_projection->'types', 'null'::jsonb),
        primary_type = nullif(pg_catalog.btrim(p_projection->>'primary_type'), ''),
        website = nullif(pg_catalog.btrim(p_projection->>'website'), ''),
        phone = nullif(pg_catalog.btrim(p_projection->>'phone'), ''),
        google_maps_uri = nullif(pg_catalog.btrim(p_projection->>'google_maps_uri'), ''),
        opening_hours = nullif(p_projection->'opening_hours', 'null'::jsonb),
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

-- The completeness worker applies projections through this atomic queue/CAS
-- RPC rather than CompletenessProvider.persistAttestedRestaurant. Keep the
-- metadata write inside its existing fenced restaurant update.
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
        google_rating = coalesce(
            nullif(p_projection->>'google_rating', '')::numeric,
            google_rating
        ),
        google_rating_count = coalesce(
            nullif(p_projection->>'google_rating_count', '')::integer,
            google_rating_count
        ),
        price_level = coalesce(
            nullif(p_projection->>'price_level', '')::smallint,
            price_level
        ),
        place_types = case
            when pg_catalog.jsonb_typeof(p_projection->'types') = 'array' then
                array(
                    select t.type_value
                    from pg_catalog.jsonb_array_elements_text(p_projection->'types')
                         with ordinality as t(type_value, ordinal)
                    order by t.ordinal
                )
            else place_types
        end,
        cuisine = coalesce(
            nullif(
                pg_catalog.initcap(pg_catalog.replace(
                    pg_catalog.regexp_replace(
                        nullif(pg_catalog.btrim(p_projection->>'primary_type'), ''),
                        '_restaurant$', '', 'i'
                    ),
                    '_', ' '
                )),
                ''
            ),
            cuisine
        ),
        website = coalesce(
            nullif(pg_catalog.btrim(p_projection->>'website'), ''),
            website
        ),
        phone = coalesce(
            nullif(pg_catalog.btrim(p_projection->>'phone'), ''),
            phone
        ),
        google_maps_uri = coalesce(
            nullif(pg_catalog.btrim(p_projection->>'google_maps_uri'), ''),
            google_maps_uri
        ),
        hours = coalesce(
            nullif(p_projection->'opening_hours', 'null'::jsonb),
            hours
        ),
        places_synced_at = pg_catalog.now(),
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
