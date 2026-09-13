-- Real visit RPC contracts, also run by the full Supabase migration replay.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.expect_visit_error(statement text, expected text)
RETURNS void LANGUAGE plpgsql AS $expect$
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        IF position(expected IN SQLERRM) > 0 THEN RETURN; END IF;
        RAISE;
    END;
    RAISE EXCEPTION 'Expected refusal %, but mutation succeeded', expected;
END;
$expect$;

INSERT INTO auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data) VALUES
('95100000-0000-4000-8000-000000000001','authenticated','authenticated','visit-owner@test.invalid','{}','{}'),
('95100000-0000-4000-8000-000000000002','authenticated','authenticated','visit-other@test.invalid','{}','{}');
INSERT INTO public.profiles(user_id, display_name) VALUES
('95100000-0000-4000-8000-000000000001','Visit Owner'),
('95100000-0000-4000-8000-000000000002','Visit Other') ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.restaurants(id,name,verification) VALUES
('95200000-0000-4000-8000-000000000001','Visit Restaurant','verified'),
('95200000-0000-4000-8000-000000000002','Other Restaurant','verified'),
('95200000-0000-4000-8000-000000000003','Old alias','verified');
UPDATE public.restaurants SET merged_into='95200000-0000-4000-8000-000000000001'
WHERE id='95200000-0000-4000-8000-000000000003';
INSERT INTO public.restaurants(id,name,verification,created_by) VALUES
('95200000-0000-4000-8000-000000000004','Private ghost','unverified','95100000-0000-4000-8000-000000000002');
INSERT INTO public.tables(id,owner_id,name) VALUES
('95300000-0000-4000-8000-000000000001','95100000-0000-4000-8000-000000000001','Visit Table');
INSERT INTO public.table_members(table_id,member_id,role) VALUES
('95300000-0000-4000-8000-000000000001','95100000-0000-4000-8000-000000000001','admin');
INSERT INTO public.user_restaurant_status(user_id,restaurant_id,been,liked) VALUES
('95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001',true,true);
INSERT INTO public.wishlist_items(user_id,restaurant_id,note) VALUES
('95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001','Keep this pin');
UPDATE public.moderation_config SET enforce=true WHERE key='image_moderation';
INSERT INTO public.image_storage_origins(origin,environment) VALUES ('https://visit.test','local') ON CONFLICT DO NOTHING;
INSERT INTO public.user_image_objects(user_id,bucket,storage_path,public_url,sha256,state)
SELECT '95100000-0000-4000-8000-000000000001', 'entry-photos',
    'approved/95100000-0000-4000-8000-000000000001/' || repeat(n,64) || '.jpg',
    'https://visit.test/storage/v1/object/public/entry-photos/approved/95100000-0000-4000-8000-000000000001/' || repeat(n,64) || '.jpg',
    repeat(n,64), 'approved'
FROM unnest(ARRAY['a','b']) n;

DO $spec$
DECLARE
    u uuid := '95100000-0000-4000-8000-000000000001';
    other_u uuid := '95100000-0000-4000-8000-000000000002';
    r uuid := '95200000-0000-4000-8000-000000000001';
    nonce uuid := '95400000-0000-4000-8000-000000000001';
    a jsonb;
    b jsonb;
    id_a uuid;
    id_b uuid;
    photo_a text;
    photo_b text;
    original_photo_id uuid;
    old_count integer;
    k text;
BEGIN
    a := public.fn_record_visit(u,r,nonce);
    id_a := (a->>'id')::uuid;
    ASSERT (a->>'is_bare')::boolean AND a->>'rating' IS NULL
        AND a->>'content' IS NULL AND NOT (a->>'liked')::boolean
        AND a->>'visibility'='friends' AND a->'photos'='[]'::jsonb, 'record must be genuinely bare';
    ASSERT (a->>'visited_at')::timestamptz BETWEEN now() - interval '1 minute' AND now(),
        'quick check-in is dated today by default';
    ASSERT (SELECT count(*)=1 AND bool_and(user_id=u AND rating IS NULL AND notes IS NULL)
        FROM public.entry_participants WHERE entry_id=id_a), 'record seeds only author';
    b := public.fn_record_visit(u,'95200000-0000-4000-8000-000000000003',nonce);
    ASSERT b->>'id'=id_a::text AND (b->>'was_dedup')::boolean, 'canonical alias retry dedups';
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_record_visit(%L,%L,%L)',u,
        '95200000-0000-4000-8000-000000000002',nonce),'VISIT_NONCE_MISMATCH');
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_record_visit(%L,%L,%L)',u,
        '95200000-0000-4000-8000-000000000004',gen_random_uuid()),'RESTAURANT_NOT_FOUND');
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_record_visit(%L,%L,%L)',u,
        gen_random_uuid(),gen_random_uuid()),'RESTAURANT_NOT_FOUND');
    b := public.fn_record_visit(u,r,gen_random_uuid());
    id_b := (b->>'id')::uuid;
    UPDATE public.entries SET created_at='2000-01-01T00:00:00Z' WHERE id=id_a;
    ASSERT id_a<>id_b AND (SELECT count(*)=2 FROM public.entries WHERE user_id=u), 'deliberate repeat is a distinct visit';
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_undo_visit(%L,%L)',u,id_a),'VISIT_UNDO_REFUSED');
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_undo_visit(%L,%L)',other_u,id_b),'NOT_OWNER');
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',other_u,id_b,'{"rating":4}'),'NOT_OWNER');
    RAISE NOTICE 'PASS visits: bare record, author participant, alias retry, mismatch/private/missing refusal, distinct repeats, ownership/latest';

    SELECT public_url INTO photo_a FROM public.user_image_objects WHERE user_id=u AND sha256=repeat('a',64);
    SELECT public_url INTO photo_b FROM public.user_image_objects WHERE user_id=u AND sha256=repeat('b',64);
    a := public.fn_save_visit(u,id_a,jsonb_build_object('rating',4.5,'content',' Good meal ','photo_urls',jsonb_build_array(photo_a,photo_b)));
    ASSERT a->>'id'=id_a::text AND a->>'visited_at' IS NOT NULL AND a->>'rating'='4.5'
        AND a->>'content'='Good meal' AND jsonb_array_length(a->'photos')=2
        AND a->>'photo_url'=photo_a AND NOT (a->>'is_bare')::boolean, 'enrichment preserves ID and the check-in date';
    ASSERT (SELECT rating=4.5 AND notes='Good meal' FROM public.entry_participants WHERE entry_id=id_a AND user_id=u),
        'author take follows own rating and note';
    original_photo_id := (a->'photos'->0->>'id')::uuid;
    a := public.fn_record_visit(u,r,nonce);
    ASSERT (a->>'was_dedup')::boolean AND a->>'rating'='4.5' AND NOT (a->>'is_bare')::boolean,
        'retry returns enriched authoritative row without erasing it';
    a := public.fn_save_visit(u,id_a,'{"visited_at":"2020-01-02T00:00:00Z"}');
    ASSERT a->>'visited_at' IS NOT NULL AND a->>'rating'='4.5' AND jsonb_array_length(a->'photos')=2,
        'date-only patch preserves review/photos';
    a := public.fn_save_visit(u,id_a,'{"visited_at":null}');
    ASSERT a->>'visited_at' IS NULL AND a->>'rating'='4.5', 'clear date does not clear rating';
    a := public.fn_save_visit(u,id_a,jsonb_build_object('photo_urls',jsonb_build_array(photo_b,photo_a)));
    ASSERT a->>'photo_url'=photo_b AND (a->'photos'->1->>'id')::uuid=original_photo_id,
        'desired order determines hero while retained photo IDs stay stable';
    RAISE NOTICE 'PASS visits: atomic enrichment, null dates, retry after enrichment, date-only saves, stable photo IDs/order/hero';

    SELECT count(*) INTO old_count FROM public.image_object_refs;
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,id_a,
        jsonb_build_object('rating',2,'content','Must roll back','visited_at','2021-01-01T00:00:00Z',
            'photo_urls',jsonb_build_array(photo_a,'https://visit.test/rejected.jpg'))), 'approved_image_required');
    a := public.fn_visit_entry_result(id_a);
    ASSERT a->>'rating'='4.5' AND a->>'content'='Good meal' AND a->>'visited_at' IS NULL
        AND a->>'photo_url'=photo_b AND jsonb_array_length(a->'photos')=2,
        'rejected second photo rolls back all scalar/desired-set writes';
    ASSERT (SELECT count(*)=old_count FROM public.image_object_refs), 'failed save must not leak image refs';
    a := public.fn_save_visit(u,id_a,'{"photo_urls":[]}');
    ASSERT a->'photos'='[]'::jsonb AND a->>'photo_url' IS NULL, 'empty desired set clears hero';
    ASSERT EXISTS (SELECT 1 FROM public.image_gc_queue WHERE sink_id=original_photo_id::text), 'removed photo uses lifecycle GC';
    RAISE NOTICE 'PASS visits: rejected-photo transaction rollback, ref rollback, remove-all hero/GC lifecycle';

    FOREACH k IN ARRAY ARRAY['{"rating":0}','{"rating":4.7}','{"liked":null}',
        '{"visited_at":"tomorrow"}','{"visited_at":"2026-02-30T00:00:00Z"}',
        '{"visited_at":"2099-01-01T00:00:00Z"}','{"photo_urls":null}',
        '{"photo_urls":["https://a.test/x","https://a.test/x"]}'] LOOP
        PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,id_b,k), 'invalid');
    END LOOP;
    RAISE NOTICE 'PASS visits: SQL validates patch allowlist, half-stars, ISO/calendar dates and unique photos';

    -- Every enrichment category blocks undo, including a stale UI that still
    -- remembers a bare record. Roll each specimen back before the next one.
    FOREACH k IN ARRAY ARRAY['rating','vibe_rating','flavor_rating','service_rating','value_rating'] LOOP
        EXECUTE format('UPDATE public.entries SET %I=4 WHERE id=%L', k,id_b);
        PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_undo_visit(%L,%L)',u,id_b),'VISIT_UNDO_REFUSED');
        EXECUTE format('UPDATE public.entries SET %I=NULL WHERE id=%L', k,id_b);
    END LOOP;
    FOREACH k IN ARRAY ARRAY['content','dish_description','cooked_by','photo_url'] LOOP
        EXECUTE format('UPDATE public.entries SET %I=%L WHERE id=%L', k,'present',id_b);
        PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_undo_visit(%L,%L)',u,id_b),'VISIT_UNDO_REFUSED');
        EXECUTE format('UPDATE public.entries SET %I=NULL WHERE id=%L', k,id_b);
    END LOOP;
    -- A date is metadata, not enrichment: a dated (or cleared) bare check-in stays undoable.
    UPDATE public.entries SET visited_at='2020-01-02T00:00:00Z' WHERE id=id_b;
    ASSERT (public.fn_visit_entry_result(id_b)->>'is_bare')::boolean, 'backdated bare check-in is still bare';
    UPDATE public.entries SET visited_at=NULL WHERE id=id_b;
    ASSERT (public.fn_visit_entry_result(id_b)->>'is_bare')::boolean, 'undated bare check-in is still bare';
    UPDATE public.entries SET visited_at=now(), liked=true WHERE id=id_b;
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_undo_visit(%L,%L)',u,id_b),'VISIT_UNDO_REFUSED');
    UPDATE public.entries SET liked=false, value_profile='{}' WHERE id=id_b;
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_undo_visit(%L,%L)',u,id_b),'VISIT_UNDO_REFUSED');
    UPDATE public.entries SET value_profile=NULL WHERE id=id_b;
    INSERT INTO public.entry_tables(entry_id,table_id) VALUES(id_b,'95300000-0000-4000-8000-000000000001');
    PERFORM public.fn_save_visit(u,id_b,'{"content":"Shared solo"}');
    ASSERT EXISTS (SELECT 1 FROM public.entry_tables WHERE entry_id=id_b), 'save preserves existing shares';
    PERFORM public.fn_save_visit(u,id_b,'{"content":null}');
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_undo_visit(%L,%L)',u,id_b),'VISIT_UNDO_REFUSED');
    DELETE FROM public.entry_tables WHERE entry_id=id_b;
    -- Author presence is bare, someone else's participant presence is not.
    INSERT INTO public.entry_participants(entry_id,user_id) VALUES(id_b,other_u);
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_undo_visit(%L,%L)',u,id_b),'VISIT_UNDO_REFUSED');
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,id_b,'{}'),'VISIT_NOT_SOLO');
    DELETE FROM public.entry_participants WHERE entry_id=id_b AND user_id=other_u;
    INSERT INTO public.entry_companions(entry_id,user_id) VALUES(id_b,other_u);
    PERFORM public.fn_save_visit(u,id_b,'{}');
    ASSERT EXISTS (SELECT 1 FROM public.entry_companions WHERE entry_id=id_b), 'save preserves companions';
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_undo_visit(%L,%L)',u,id_b),'VISIT_UNDO_REFUSED');
    DELETE FROM public.entry_companions WHERE entry_id=id_b;
    INSERT INTO public.suppers(id,restaurant_id,host_user_id)
    VALUES('95500000-0000-4000-8000-000000000001',r,u);
    UPDATE public.entries SET supper_id='95500000-0000-4000-8000-000000000001' WHERE id=id_b;
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_undo_visit(%L,%L)',u,id_b),'VISIT_UNDO_REFUSED');
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,id_b,'{}'),'VISIT_NOT_SOLO');
    UPDATE public.entries SET supper_id=NULL WHERE id=id_b;
    INSERT INTO public.table_nights(id,table_id,restaurant_id,host_user_id,kind,status,is_async)
    VALUES('95600000-0000-4000-8000-000000000001','95300000-0000-4000-8000-000000000001',r,u,'merged',NULL,false);
    UPDATE public.entries SET table_night_id='95600000-0000-4000-8000-000000000001' WHERE id=id_b;
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_undo_visit(%L,%L)',u,id_b),'VISIT_UNDO_REFUSED');
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,id_b,'{}'),'VISIT_NOT_SOLO');
    UPDATE public.entries SET table_night_id=NULL WHERE id=id_b;
    INSERT INTO public.round_entries(entry_id,round_id,table_id)
    VALUES(id_b,'95600000-0000-4000-8000-000000000001','95300000-0000-4000-8000-000000000001');
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_undo_visit(%L,%L)',u,id_b),'VISIT_UNDO_REFUSED');
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,id_b,'{}'),'VISIT_NOT_SOLO');
    DELETE FROM public.round_entries WHERE entry_id=id_b;
    INSERT INTO public.entry_photos(entry_id,photo_url,sort_order) VALUES(id_b,photo_a,0);
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_undo_visit(%L,%L)',u,id_b),'VISIT_UNDO_REFUSED');
    DELETE FROM public.entry_photos WHERE entry_id=id_b;
    RAISE NOTICE 'PASS visits: strict bare refusals for every scalar, date/like, shares and other participants; shared solo edits preserve shares';
    RAISE NOTICE 'PASS visits: companion/photo-only/supper/live-round/merged-round undo guards; gathering editor refusals';

    a := public.fn_undo_visit(u,id_b);
    ASSERT (a->>'deleted')::boolean AND a->>'entry_id'=id_b::text AND a->>'restaurant_id'=r::text,
        'undo returns deleted identity';
    ASSERT NOT EXISTS (SELECT 1 FROM public.entries WHERE id=id_b) AND EXISTS (SELECT 1 FROM public.entries WHERE id=id_a),
        'undo deletes exactly the selected latest bare row';
    ASSERT (SELECT been AND liked FROM public.user_restaurant_status WHERE user_id=u AND restaurant_id=r), 'legacy been/liked unchanged';
    ASSERT (SELECT note='Keep this pin' AND deleted_at IS NULL FROM public.wishlist_items WHERE user_id=u AND restaurant_id=r), 'pin unchanged';
    RAISE NOTICE 'PASS visits: latest bare undo succeeds; earlier enriched visit, legacy been/liked and pin preserved';
END;
$spec$;

DO $legacy$
DECLARE
    u uuid := '95100000-0000-4000-8000-000000000001';
    r uuid := '95200000-0000-4000-8000-000000000001';
    legacy_entry_id uuid;
    old_url text := 'https://visit.test/storage/v1/object/public/entry-photos/legacy/old.jpg';
    approved_url text;
    result jsonb;
BEGIN
    legacy_entry_id := (public.fn_record_visit(u,r,gen_random_uuid())->>'id')::uuid;
    -- A pre-enforcement sink, with no approved registry record.
    UPDATE public.entries SET photo_url=old_url WHERE id=legacy_entry_id;
    SELECT public_url INTO approved_url FROM public.user_image_objects WHERE user_id=u AND sha256=repeat('a',64);
    result := public.fn_save_visit(u,legacy_entry_id,'{"content":"Keep my old photo"}');
    ASSERT result->>'photo_url'=old_url AND jsonb_array_length(result->'photos')=1;
    result := public.fn_save_visit(u,legacy_entry_id,jsonb_build_object('photo_urls',jsonb_build_array(old_url,approved_url)));
    ASSERT result->>'photo_url'=old_url AND jsonb_array_length(result->'photos')=2;
    ASSERT NOT EXISTS(SELECT 1 FROM public.entry_photos p WHERE p.entry_id=legacy_entry_id AND p.photo_url=old_url), 'legacy sink was not copied';
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,legacy_entry_id,
        jsonb_build_object('content','Must roll back','photo_urls',jsonb_build_array(old_url,'https://visit.test/unapproved.jpg'))),'approved_image_required');
    ASSERT (SELECT e.content='Keep my old photo' FROM public.entries e WHERE e.id=legacy_entry_id), 'unapproved addition rolls back words';
    result := public.fn_save_visit(u,legacy_entry_id,jsonb_build_object('photo_urls',jsonb_build_array(approved_url)));
    ASSERT result->>'photo_url'=approved_url AND jsonb_array_length(result->'photos')=1, 'explicit legacy removal chooses approved hero';
    RAISE NOTICE 'PASS visits: legacy hero retention, moderated addition, forged URL rollback and explicit removal';
END;
$legacy$;

-- Full-composer saves are one transaction on the selected solo visit.
DO $full_review$
DECLARE
    u uuid := '95100000-0000-4000-8000-000000000001';
    companion uuid := '95100000-0000-4000-8000-000000000002';
    r uuid := '95200000-0000-4000-8000-000000000001';
    t uuid := '95300000-0000-4000-8000-000000000001';
    unavailable_t uuid := '95300000-0000-4000-8000-000000000002';
    visit_id uuid;
    result jsonb;
    before_row jsonb;
    created timestamptz;
    shared_at timestamptz;
    visits integer;
    k text;
BEGIN
    INSERT INTO public.tables(id,owner_id,name) VALUES(unavailable_t,companion,'Unavailable Table');
    INSERT INTO public.table_members(table_id,member_id,role) VALUES(unavailable_t,companion,'admin');
    INSERT INTO public.follows(follower_id,following_id) VALUES(u,companion),(companion,u);
    result := public.fn_record_visit(u,r,gen_random_uuid());
    visit_id := (result->>'id')::uuid;
    created := (result->>'created_at')::timestamptz;
    SELECT count(*) INTO visits FROM public.entries WHERE user_id=u AND restaurant_id=r;

    result := public.fn_save_visit(u,visit_id,jsonb_build_object(
        'rating',4.5,'content',' Same visit, full review ','liked',true,
        'vibe_rating',3.5,'flavor_rating',5,'service_rating',4,'value_rating',2.5,
        'companion_ids',jsonb_build_array(companion),'table_ids',jsonb_build_array(t)));
    ASSERT result->>'id'=visit_id::text AND (result->>'created_at')::timestamptz=created
        AND (SELECT count(*)=visits FROM public.entries WHERE user_id=u AND restaurant_id=r),
        'full composer enriches exact visit without creating or renumbering another';
    ASSERT result->>'content'='Same visit, full review' AND (result->>'liked')::boolean
        AND (result->>'vibe_rating')::numeric=3.5 AND (result->>'flavor_rating')::numeric=5
        AND (result->>'service_rating')::numeric=4 AND (result->>'value_rating')::numeric=2.5,
        'all full-composer scalars persist together';
    ASSERT result->'companion_ids'=jsonb_build_array(companion) AND result->'table_ids'=jsonb_build_array(t)
        AND result->>'table_id'=t::text AND result->>'visibility'='friends',
        'response returns authoritative audience while preserving visibility';
    ASSERT (SELECT count(*)=1 AND bool_and(user_id=u) FROM public.entry_participants WHERE entry_id=visit_id),
        'companions never become gathering participants';
    SELECT posted_at INTO shared_at FROM public.entry_tables WHERE entry_id=visit_id AND table_id=t;
    result := public.fn_save_visit(u,visit_id,jsonb_build_object('table_ids',jsonb_build_array(t)));
    ASSERT (SELECT posted_at=shared_at FROM public.entry_tables WHERE entry_id=visit_id AND table_id=t),
        'retrying a retained share does not move the feed cursor';
    result := public.fn_save_visit(u,visit_id,'{"visited_at":null}');
    ASSERT result->>'visited_at' IS NULL AND result->>'rating'='4.5' AND (result->>'liked')::boolean
        AND result->'table_ids'=jsonb_build_array(t) AND result->'companion_ids'=jsonb_build_array(companion)
        AND (result->>'flavor_rating')::numeric=5, 'omissions preserve the full existing review';
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_undo_visit(%L,%L)',u,visit_id),'VISIT_UNDO_REFUSED');
    RAISE NOTICE 'PASS full review: exact identity/count/chronology, all fields, desired sets, author-only participant, cursor and omission preservation';

    before_row := public.fn_visit_entry_result(visit_id);
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,visit_id,
        jsonb_build_object('rating',1,'content','Must not persist','table_ids',jsonb_build_array(unavailable_t))), 'TABLE_NOT_AUTHORIZED');
    ASSERT public.fn_visit_entry_result(visit_id)=before_row, 'unauthorized Table refuses every field';
    DELETE FROM public.follows WHERE follower_id=companion AND following_id=u;
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,visit_id,
        jsonb_build_object('rating',1,'companion_ids',jsonb_build_array(companion))), 'COMPANION_NOT_AUTHORIZED');
    ASSERT public.fn_visit_entry_result(visit_id)=before_row, 'one-way follow refuses every field';
    INSERT INTO public.follows(follower_id,following_id) VALUES(companion,u);
    INSERT INTO public.blocked_users(blocker_id,blocked_id) VALUES(companion,u);
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,visit_id,
        jsonb_build_object('companion_ids',jsonb_build_array(companion))), 'COMPANION_NOT_AUTHORIZED');
    DELETE FROM public.blocked_users WHERE blocker_id=companion AND blocked_id=u;
    INSERT INTO public.blocked_users(blocker_id,blocked_id) VALUES(u,companion);
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,visit_id,
        jsonb_build_object('companion_ids',jsonb_build_array(companion))), 'COMPANION_NOT_AUTHORIZED');
    DELETE FROM public.blocked_users WHERE blocker_id=u AND blocked_id=companion;
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,visit_id,
        jsonb_build_object('companion_ids',jsonb_build_array(u))), 'COMPANION_NOT_AUTHORIZED');
    ASSERT public.fn_visit_entry_result(visit_id)=before_row, 'both block directions and self-tag refuse every field';
    -- The audience writes happen before image binding. A rejection must roll all
    -- of them back as well as the words, stars, date and author participant.
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,visit_id,
        '{"rating":1,"liked":false,"vibe_rating":null,"table_ids":[],"companion_ids":[],"photo_urls":["https://visit.test/rejected-full-review.jpg"]}'), 'approved_image_required');
    ASSERT public.fn_visit_entry_result(visit_id)=before_row
        AND EXISTS(SELECT 1 FROM public.entry_tables WHERE entry_id=visit_id AND table_id=t)
        AND EXISTS(SELECT 1 FROM public.entry_companions WHERE entry_id=visit_id AND user_id=companion)
        AND (SELECT rating=4.5 FROM public.entry_participants WHERE entry_id=visit_id AND user_id=u),
        'image rejection rolls back audience changes, all scalars and author participant';
    RAISE NOTICE 'PASS full review: unavailable Table, one-way follows, blocks in both directions, self-tag and image rejection all fail atomically';

    FOREACH k IN ARRAY ARRAY['{"visibility":"friends"}','{"liked":1}',
        '{"vibe_rating":4.7}','{"flavor_rating":0}','{"service_rating":6}','{"value_rating":"4"}',
        '{"companion_ids":null}','{"table_ids":"all"}','{"companion_ids":["invalid"]}'] LOOP
        PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,visit_id,k), 'invalid');
    END LOOP;
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,visit_id,
        jsonb_build_object('table_ids',jsonb_build_array(t,t))), 'invalid');
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,visit_id,
        jsonb_build_object('companion_ids',jsonb_build_array(companion,companion))), 'invalid');
    PERFORM pg_temp.expect_visit_error(format('SELECT public.fn_save_visit(%L,%L,%L)',u,visit_id,
        jsonb_build_object('table_ids',(SELECT jsonb_agg(gen_random_uuid()) FROM generate_series(1,11)))), 'invalid');
    UPDATE public.entries SET visibility='private' WHERE id=visit_id;
    result := public.fn_save_visit(u,visit_id,'{"liked":false,"rating":null,"content":null,"vibe_rating":null,"flavor_rating":null,"service_rating":null,"value_rating":null,"table_ids":[],"companion_ids":[]}');
    ASSERT result->>'rating' IS NULL AND result->>'content' IS NULL AND NOT (result->>'liked')::boolean
        AND result->>'vibe_rating' IS NULL AND result->>'flavor_rating' IS NULL
        AND result->>'service_rating' IS NULL AND result->>'value_rating' IS NULL
        AND result->'table_ids'='[]'::jsonb AND result->'companion_ids'='[]'::jsonb
        AND result->>'table_id' IS NULL AND result->>'visibility'='private',
        'explicit clearing removes only selected fields and never changes private visibility';
    RAISE NOTICE 'PASS full review: direct RPC validation, table limit, explicit scalar/audience clear and private visibility preservation';
END;
$full_review$;

DO $permissions$
DECLARE signature text;
BEGIN
    FOREACH signature IN ARRAY ARRAY['fn_visit_entry_result(uuid)','fn_record_visit(uuid,uuid,uuid)',
        'fn_save_visit(uuid,uuid,jsonb)','fn_undo_visit(uuid,uuid)'] LOOP
        ASSERT NOT has_function_privilege('anon','public.'||signature,'EXECUTE'), 'anon must not call visit RPCs';
        ASSERT NOT has_function_privilege('authenticated','public.'||signature,'EXECUTE'), 'authenticated must not impersonate passed user';
        ASSERT has_function_privilege('service_role','public.'||signature,'EXECUTE'), 'service role needs visit RPCs';
        ASSERT (SELECT prosecdef AND 'search_path=""'=ANY(proconfig) FROM pg_proc WHERE oid=('public.'||signature)::regprocedure),
            'visit functions must pin empty search_path';
    END LOOP;
    RAISE NOTICE 'PASS visits: service-role-only permissions and pinned search_path';
END;
$permissions$;
ROLLBACK;
