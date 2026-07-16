-- TICKET-196 ephemeral B-2 activation assertions.  CI applies the held file
-- only to its throwaway replay database before running this spec.
\set ON_ERROR_STOP on
BEGIN;

DO $spec$
DECLARE v_col text; caught boolean;
BEGIN
    ASSERT (SELECT enforce FROM public.moderation_config WHERE key='image_moderation'),
      'B-2 moderation flag is not ON';
    ASSERT (SELECT enforce FROM public.moderation_config WHERE key='grandfather_sweep'),
      'B-2 sweep gate is not ON';
    ASSERT NOT pg_catalog.has_table_privilege('authenticated','public.profiles','UPDATE'),
      'authenticated retains profiles UPDATE';
    ASSERT NOT pg_catalog.has_column_privilege('authenticated','public.entries','photo_url','INSERT'),
      'authenticated retains entries.photo_url INSERT';
    ASSERT NOT pg_catalog.has_column_privilege('authenticated','public.entries','photo_url','UPDATE'),
      'authenticated retains entries.photo_url UPDATE';
    ASSERT pg_catalog.has_column_privilege('authenticated','public.entries','content','INSERT'),
      'non-photo entries INSERT column was not regranted';
    FOREACH v_col IN ARRAY ARRAY[
      'id','user_id','restaurant_id','place_id','user_place_id','rating',
      'content','dish_description','cooked_by','value_profile','visited_at',
      'created_at','updated_at','table_id','table_night_id','visibility',
      'vibe_rating','flavor_rating','service_rating','value_rating',
      'reaction_count','comment_count','top_emojis','public_reaction_count',
      'public_reply_count','public_top_emojis','client_nonce','liked'
    ] LOOP
      ASSERT pg_catalog.has_column_privilege(
        'authenticated','public.entries',v_col,'UPDATE'
      ), pg_catalog.format('safe entries.%s UPDATE column was not regranted',v_col);
    END LOOP;
    ASSERT NOT pg_catalog.has_column_privilege('authenticated','public.entries','supper_id','UPDATE'),
      'B-2 broadened UPDATE to locked entries.supper_id';
    ASSERT NOT pg_catalog.has_table_privilege('authenticated','public.entry_photos','INSERT'),
      'authenticated retains entry_photos INSERT';
    ASSERT NOT pg_catalog.has_table_privilege('authenticated','public.entry_photos','DELETE'),
      'authenticated retains entry_photos DELETE';
    ASSERT NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies p
      WHERE (p.schemaname='public' AND p.tablename='entry_photos'
             AND p.policyname IN ('entry_photos_insert','entry_photos_delete'))
         OR (p.schemaname='storage' AND p.tablename='objects'
             AND p.policyname IN ('Authenticated upload own folder avatars',
                                  'Authenticated upload own folder entry-photos'))
    ), 'B-2 policy drops are incomplete';
    ASSERT NOT pg_catalog.has_function_privilege(
      'authenticated','public.fn_allow_legacy_image_storage_insert()','EXECUTE'),
      'authenticated retains the B-0 legacy Storage tombstone helper';
    ASSERT pg_catalog.has_function_privilege(
      'service_role','public.fn_allow_legacy_image_storage_insert()','EXECUTE'),
      'service_role lost the legacy Storage tombstone helper';
    ASSERT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies p
      WHERE p.schemaname='public' AND p.tablename='entries'
        AND p.policyname='entries_insert_own'
    ) AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies p
      WHERE p.schemaname='public' AND p.tablename='entries'
        AND p.policyname='entries_update_own'
    ), 'B-2 removed scalar entries RLS routing';
END;
$spec$;

INSERT INTO auth.users (instance_id,id,aud,role,email,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES
 ('00000000-0000-0000-0000-000000000000','19620000-0000-4000-8000-000000000001',
  'authenticated','authenticated','b2@196.invalid',now(),now(),'{}','{}'),
 ('00000000-0000-0000-0000-000000000000','19620000-0000-4000-8000-000000000002',
  'authenticated','authenticated','b2-member@196.invalid',now(),now(),'{}','{}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (user_id,display_name,account_privacy)
VALUES
 ('19620000-0000-4000-8000-000000000001','B2','private'),
 ('19620000-0000-4000-8000-000000000002','B2 Member','private')
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.image_hash_verdicts (sha256,verdict,likelihoods)
VALUES
 (repeat('9',64),'pass','{}'),
 (repeat('a',64),'pass','{}'),
 (repeat('b',64),'pass','{}'),
 (repeat('c',64),'pass','{}')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_image_objects (user_id,bucket,storage_path,public_url,sha256,state)
VALUES
(
 '19620000-0000-4000-8000-000000000001','avatars',
 'approved/19620000-0000-4000-8000-000000000001/'||repeat('9',64)||'.jpg',
 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/19620000-0000-4000-8000-000000000001/'||repeat('9',64)||'.jpg',
 repeat('9',64),'approved'
),
(
 '19620000-0000-4000-8000-000000000001','entry-photos',
 'approved/19620000-0000-4000-8000-000000000001/'||repeat('a',64)||'.jpg',
 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/19620000-0000-4000-8000-000000000001/'||repeat('a',64)||'.jpg',
 repeat('a',64),'approved'
),
(
 '19620000-0000-4000-8000-000000000001','entry-photos',
 'approved/19620000-0000-4000-8000-000000000001/'||repeat('b',64)||'.jpg',
 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/19620000-0000-4000-8000-000000000001/'||repeat('b',64)||'.jpg',
 repeat('b',64),'approved'
),
(
 '19620000-0000-4000-8000-000000000002','entry-photos',
 'approved/19620000-0000-4000-8000-000000000002/'||repeat('c',64)||'.jpg',
 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/19620000-0000-4000-8000-000000000002/'||repeat('c',64)||'.jpg',
 repeat('c',64),'approved'
);
INSERT INTO public.restaurants (id,name,city)
VALUES ('19620000-1000-4000-8000-000000000001','B2 Matrix','Testville');
INSERT INTO public.tables (id,owner_id,name)
VALUES ('19620000-2000-4000-8000-000000000001','19620000-0000-4000-8000-000000000001','B2 Matrix');
INSERT INTO public.table_members (table_id,member_id,role) VALUES
 ('19620000-2000-4000-8000-000000000001','19620000-0000-4000-8000-000000000001','admin'),
 ('19620000-2000-4000-8000-000000000001','19620000-0000-4000-8000-000000000002','member');

DO $spec$
DECLARE
    u uuid := '19620000-0000-4000-8000-000000000001';
    u2 uuid := '19620000-0000-4000-8000-000000000002';
    t1 uuid := '19620000-2000-4000-8000-000000000001';
    restaurant uuid := '19620000-1000-4000-8000-000000000001';
    approved text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/approved/19620000-0000-4000-8000-000000000001/'||repeat('9',64)||'.jpg';
    raw text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/avatars/19620000-0000-4000-8000-000000000001/legacy.jpg';
    raw_entry text := 'https://example.invalid/unmoderated.jpg';
    photo_a text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/19620000-0000-4000-8000-000000000001/'||repeat('a',64)||'.jpg';
    photo_b text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/19620000-0000-4000-8000-000000000001/'||repeat('b',64)||'.jpg';
    photo_c text := 'https://ftvmseaqwwlcxtdlvxxz.supabase.co/storage/v1/object/public/entry-photos/approved/19620000-0000-4000-8000-000000000002/'||repeat('c',64)||'.jpg';
    caught boolean;
    v_col text;
    scalar_entry uuid;
    e1 uuid;
    e2 uuid;
    merge_entry uuid;
    night uuid;
    rate_entry uuid;
    j jsonb;
BEGIN
    caught:=false; BEGIN PERFORM public.fn_complete_onboarding(u,'B2',NULL,NULL);
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%avatar_required%'; END;
    ASSERT caught, 'B-2 avatarless completion passed';
    caught:=false; BEGIN PERFORM public.fn_complete_onboarding(u,'B2',NULL,raw);
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'B-2 raw completion passed';
    PERFORM public.fn_complete_onboarding(u,'B2 Approved','London',approved);
    ASSERT EXISTS (SELECT 1 FROM public.image_object_refs WHERE sink_kind='avatar' AND sink_id=u::text),
      'B-2 approved completion did not bind';

    -- The complete B-0 service-writer matrix remains functional after the
    -- held activation migration changes grants/policies, and every raw path
    -- remains rejected under the now-live flag.
    caught:=false; BEGIN PERFORM public.fn_commit_avatar(u,raw);
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'B-2 settings avatar writer accepted raw bytes';
    PERFORM public.fn_commit_avatar(u,approved);

    SELECT x.entry_id INTO e1 FROM public.fn_create_entry_with_tables(
      u,pg_catalog.jsonb_build_object(
        'restaurant_id',restaurant,'rating',4.5,'visited_at',now(),
        'photo_url',photo_a,
        'photo_urls',pg_catalog.jsonb_build_array(photo_a,photo_b)
      ),ARRAY[t1],ARRAY[u],NULL
    ) x;
    ASSERT (SELECT count(*)=3 FROM public.image_object_refs r
            WHERE (r.sink_kind='entry_hero' AND r.sink_id=e1::text)
               OR (r.sink_kind='entry_photo' AND r.sink_id IN (
                   SELECT id::text FROM public.entry_photos WHERE entry_id=e1
               ))), 'B-2 create-entry writer lost hero/photo refs';
    caught:=false; BEGIN
      PERFORM * FROM public.fn_create_entry_with_tables(
        u,pg_catalog.jsonb_build_object(
          'restaurant_id',restaurant,'rating',4,'visited_at',now(),'photo_url',raw_entry
        ),NULL,ARRAY[u],NULL);
    EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'B-2 create-entry writer accepted raw bytes';

    SELECT x.entry_id INTO e2 FROM public.fn_create_entry_with_tables(
      u,pg_catalog.jsonb_build_object(
        'restaurant_id',restaurant,'rating',4,'visited_at',now()
      ),NULL,ARRAY[u],NULL
    ) x;
    j:=public.append_entry_photo(e2,u,photo_a);
    ASSERT (j->>'hero_url')=photo_a
       AND EXISTS (SELECT 1 FROM public.image_object_refs
                   WHERE sink_kind='entry_hero' AND sink_id=e2::text)
       AND EXISTS (SELECT 1 FROM public.image_object_refs r
                   WHERE r.sink_kind='entry_photo' AND r.sink_id IN (
                     SELECT id::text FROM public.entry_photos WHERE entry_id=e2
                   )), 'B-2 append/add-take path lost dual refs';
    caught:=false; BEGIN PERFORM public.append_entry_photo(e2,u,raw_entry);
      EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'B-2 append-entry-photo accepted raw bytes';

    caught:=false; BEGIN
      PERFORM public.fn_create_entry_and_merge_round(
        u2,t1,restaurant,now(),e1,
        pg_catalog.jsonb_build_object(
          'restaurant_id',restaurant,'rating',4,'visited_at',now(),
          'photo_url',raw_entry,'photo_urls',pg_catalog.jsonb_build_array(raw_entry)
        ),NULL);
    EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'B-2 merge-round accepted raw bytes';
    j:=public.fn_create_entry_and_merge_round(
      u2,t1,restaurant,now(),e1,
      pg_catalog.jsonb_build_object(
        'restaurant_id',restaurant,'rating',4,'visited_at',now(),
        'photo_url',photo_c,'photo_urls',pg_catalog.jsonb_build_array(photo_c)
      ),NULL);
    merge_entry:=(j->>'entry_b_id')::uuid;
    ASSERT (SELECT count(*)=2 FROM public.image_object_refs r
            WHERE (r.sink_kind='entry_hero' AND r.sink_id=merge_entry::text)
               OR (r.sink_kind='entry_photo' AND r.sink_id IN (
                 SELECT id::text FROM public.entry_photos WHERE entry_id=merge_entry
               ))), 'B-2 merge-round lost photo + hero refs';

    caught:=false; BEGIN
      PERFORM public.start_round(
        t1,restaurant,u,4,'n','d',ARRAY[raw_entry],ARRAY[u2],true,
        NULL,NULL,NULL,NULL,NULL);
    EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'B-2 start_round accepted raw bytes';
    j:=public.start_round(
      t1,restaurant,u,4,'n','d',ARRAY[photo_a,photo_b],ARRAY[u2],true,
      NULL,NULL,NULL,NULL,NULL);
    night:=(j->>'night_id')::uuid;
    e2:=(j->>'entry_id')::uuid;
    ASSERT (SELECT count(*)=3 FROM public.image_object_refs r
            WHERE (r.sink_kind='entry_hero' AND r.sink_id=e2::text)
               OR (r.sink_kind='entry_photo' AND r.sink_id IN (
                 SELECT id::text FROM public.entry_photos WHERE entry_id=e2
               ))), 'B-2 start_round lost entry_photo + entry_hero refs';
    caught:=false; BEGIN
      PERFORM public.rate_round(
        night,u2,3.5,'n','d',ARRAY[raw_entry],NULL,NULL,NULL,NULL,NULL);
    EXCEPTION WHEN OTHERS THEN caught:=SQLERRM LIKE '%approved_image_required%'; END;
    ASSERT caught, 'B-2 rate_round accepted raw bytes';
    j:=public.rate_round(
      night,u2,3.5,'n','d',ARRAY[photo_c],NULL,NULL,NULL,NULL,NULL);
    rate_entry:=(j->>'entry_id')::uuid;
    ASSERT (SELECT count(*)=2 FROM public.image_object_refs r
            WHERE (r.sink_kind='entry_hero' AND r.sink_id=rate_entry::text)
               OR (r.sink_kind='entry_photo' AND r.sink_id IN (
                 SELECT id::text FROM public.entry_photos WHERE entry_id=rate_entry
               ))), 'B-2 rate_round lost entry_photo + entry_hero refs';

    -- B-2 retains authenticated scalar entry insert/update via the existing
    -- own-row RLS policies while the photo column privilege stays closed.
    -- Supply the id instead of using RETURNING: entries_select_v2's authored
    -- helper intentionally reads committed rows and is not an INSERT-returning
    -- oracle.  This assertion is about the DML grants/RLS path itself.
    scalar_entry := '19620000-3000-4000-8000-000000000001';
    PERFORM set_config('request.jwt.claims',pg_catalog.json_build_object('sub',u)::text,true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.entries (id,user_id,content)
    VALUES (scalar_entry,u,'scalar insert survives B2');
    UPDATE public.entries SET content='scalar update survives B2' WHERE id=scalar_entry;
    RESET ROLE;
    ASSERT (SELECT content='scalar update survives B2' FROM public.entries WHERE id=scalar_entry),
      'authenticated non-photo entries insert/update failed after B-2';

    caught:=false;
    BEGIN
      SET LOCAL ROLE authenticated;
      UPDATE public.entries SET photo_url=raw WHERE id=scalar_entry;
      RESET ROLE;
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE; caught:=true;
    END;
    ASSERT caught, 'authenticated entries.photo_url update remained writable';

    caught:=false;
    BEGIN
      SET LOCAL ROLE authenticated;
      UPDATE public.entries SET supper_id=NULL WHERE id=scalar_entry;
      RESET ROLE;
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE; caught:=true;
    END;
    ASSERT caught, 'B-2 reopened authenticated entries.supper_id UPDATE';

    caught:=false;
    BEGIN
      SET LOCAL ROLE authenticated;
      INSERT INTO public.entries (user_id,content,photo_url)
      VALUES (u,'forbidden direct photo insert',raw_entry);
      RESET ROLE;
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE; caught:=true;
    END;
    ASSERT caught, 'authenticated entries.photo_url insert remained writable';

    caught:=false;
    BEGIN
      SET LOCAL ROLE authenticated;
      INSERT INTO public.entry_photos (entry_id,photo_url,sort_order)
      VALUES (scalar_entry,raw_entry,0);
      RESET ROLE;
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE; caught:=true;
    END;
    ASSERT caught, 'authenticated direct entry_photos INSERT remained writable';

    -- Every completion field is direct-write closed, not only avatar/onboarded.
    FOREACH v_col IN ARRAY ARRAY[
      'display_name','home_city','avatar_url','onboarded_at','terms_accepted_at','account_privacy'
    ] LOOP
      caught:=false;
      BEGIN
        PERFORM set_config('request.jwt.claims',pg_catalog.json_build_object('sub',u)::text,true);
        SET LOCAL ROLE authenticated;
        EXECUTE format('UPDATE public.profiles SET %I = %I WHERE user_id = $1',v_col,v_col) USING u;
        RESET ROLE;
      EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE; caught:=true;
      END;
      ASSERT caught, format('direct profile write remained open for %s',v_col);
    END LOOP;
END;
$spec$;

ROLLBACK;
