-- Account deletion covers import screenshots (TICKET-251 addendum).
-- Run after migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/account_deletion_import_uploads.spec.sql
--
-- fn_list_account_storage_paths is the only way the deletion saga sees Storage
-- bytes. It must list a user's own import-uploads prefix, keep refusing another
-- user's prefix and any bucket outside the allowlist, and still accept the three
-- scopes it accepted before (20260716122000).

BEGIN;

INSERT INTO auth.users (
    instance_id, id, aud, role, email, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
)
VALUES
    ('00000000-0000-0000-0000-000000000000', '25200000-0000-4000-8000-000000000001',
     'authenticated', 'authenticated', 'deleting@import-uploads-test.invalid',
     now(), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Deleting User"}'),
    ('00000000-0000-0000-0000-000000000000', '25200000-0000-4000-8000-000000000002',
     'authenticated', 'authenticated', 'other@import-uploads-test.invalid',
     now(), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Other User"}')
ON CONFLICT (id) DO NOTHING;

-- Screenshots exactly as the app names them: <user_id>/<timestamp>-<rand>.jpg.
INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
    ('import-uploads', '25200000-0000-4000-8000-000000000001/1727000000000-abc123.jpg',
     jsonb_build_object('size', 100)),
    ('import-uploads', '25200000-0000-4000-8000-000000000001/1727000000001-def456.jpg',
     jsonb_build_object('size', 100)),
    ('import-uploads', '25200000-0000-4000-8000-000000000002/1727000000002-ghi789.jpg',
     jsonb_build_object('size', 100))
ON CONFLICT DO NOTHING;

DO $spec$
DECLARE
    v_user  uuid := '25200000-0000-4000-8000-000000000001';
    v_other uuid := '25200000-0000-4000-8000-000000000002';
    v_page jsonb;
    v_caught boolean;
    v_scope record;
    fn constant text := 'public.fn_list_account_storage_paths(uuid,text,text,text,integer)';
BEGIN
    -- Own prefix: both screenshots, nobody else's, sorted, no cursor.
    v_page := public.fn_list_account_storage_paths(v_user, 'import-uploads', v_user::text, NULL, 100);
    ASSERT v_page->'paths' = jsonb_build_array(
        v_user::text || '/1727000000000-abc123.jpg',
        v_user::text || '/1727000000001-def456.jpg'
    ), format('FAIL: own import-uploads prefix must list exactly the user''s screenshots, got %s', v_page);
    ASSERT v_page->'next_cursor' = 'null'::jsonb,
        'FAIL: a two-object prefix must not page';

    -- Another user's prefix is refused, even inside the allowed bucket.
    v_caught := false;
    BEGIN
        PERFORM public.fn_list_account_storage_paths(v_user, 'import-uploads', v_other::text, NULL, 100);
    EXCEPTION WHEN OTHERS THEN
        v_caught := SQLERRM LIKE '%invalid_account_storage_scope%';
    END;
    ASSERT v_caught, 'FAIL: another user''s import-uploads prefix must raise invalid_account_storage_scope';

    -- The approved/ namespace does not exist for screenshots either.
    v_caught := false;
    BEGIN
        PERFORM public.fn_list_account_storage_paths(v_user, 'import-uploads', 'approved/' || v_user::text, NULL, 100);
    EXCEPTION WHEN OTHERS THEN
        v_caught := SQLERRM LIKE '%invalid_account_storage_scope%';
    END;
    ASSERT v_caught, 'FAIL: an approved/ import-uploads prefix must raise invalid_account_storage_scope';

    -- A bucket outside the allowlist is still refused.
    v_caught := false;
    BEGIN
        PERFORM public.fn_list_account_storage_paths(v_user, 'clip-thumbs', v_user::text, NULL, 100);
    EXCEPTION WHEN OTHERS THEN
        v_caught := SQLERRM LIKE '%invalid_account_storage_scope%';
    END;
    ASSERT v_caught, 'FAIL: an unknown bucket must raise invalid_account_storage_scope';

    -- The pre-existing scopes are still accepted (empty pages, no raise).
    FOR v_scope IN
        SELECT * FROM (VALUES
            ('image-staging', v_user::text),
            ('avatars',       v_user::text),
            ('avatars',       'approved/' || v_user::text),
            ('entry-photos',  v_user::text),
            ('entry-photos',  'approved/' || v_user::text)
        ) AS s(bucket, prefix)
    LOOP
        v_page := public.fn_list_account_storage_paths(v_user, v_scope.bucket, v_scope.prefix, NULL, 100);
        ASSERT v_page->'paths' = '[]'::jsonb,
            format('FAIL: %s/%s must still be an accepted (empty) scope, got %s', v_scope.bucket, v_scope.prefix, v_page);
    END LOOP;

    -- Posture unchanged: service_role only, definer, empty search_path.
    ASSERT NOT has_function_privilege('anon', fn, 'execute'), 'FAIL: anon must not execute the lister';
    ASSERT NOT has_function_privilege('authenticated', fn, 'execute'), 'FAIL: authenticated must not execute the lister';
    ASSERT has_function_privilege('service_role', fn, 'execute'), 'FAIL: service_role must execute the lister';
    ASSERT (SELECT prosecdef FROM pg_proc WHERE oid = fn::regprocedure), 'FAIL: the lister must stay SECURITY DEFINER';
    ASSERT (SELECT 'search_path=""' = ANY (proconfig) FROM pg_proc WHERE oid = fn::regprocedure),
        format('FAIL: the lister must keep search_path = '''' (proconfig %s)',
               (SELECT proconfig FROM pg_proc WHERE oid = fn::regprocedure));

    RAISE NOTICE 'PASS account_deletion_import_uploads: own prefix listed, foreign prefix / approved prefix / unknown bucket refused, legacy scopes intact, posture';
END;
$spec$;

ROLLBACK;
