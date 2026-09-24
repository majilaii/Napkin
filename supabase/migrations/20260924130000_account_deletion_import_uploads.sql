-- Account deletion covers import screenshots (TICKET-251 addendum).
--
-- The app uploads import screenshots to the Storage bucket import-uploads at
-- <user_id>/<timestamp>-<rand>.jpg (napkin-app/lib/imageDownscale.ts). They
-- are read by resolve-url and table-shares and are never registered in the
-- image lifecycle tables, so the account deletion saga (supabase/functions/
-- account/deletionSaga.ts, allPerUserScopes) never inventoried or removed
-- them: an account could be deleted while its screenshots stayed behind,
-- which contradicts the privacy policy.
--
-- The saga lists every per-user Storage scope through
-- fn_list_account_storage_paths, which RAISES invalid_account_storage_scope
-- for any bucket outside its allowlist. Adding the scope in TypeScript alone
-- would therefore break every account deletion; the allowlist gains the
-- import-uploads bucket with the user's own prefix here, and the edge function
-- change that lists it lands in the same release (db push runs before the
-- function deploy in prod-deploy.yml, so the RPC accepts the scope before the
-- saga asks for it).
--
-- Redefined from the function's only definition (20260716122000) with one
-- predicate branch added. SECURITY DEFINER, search_path '' and the
-- service_role-only grants are reproduced unchanged.
--
-- Replay-from-zero: pure DDL on a function created earlier in the chain.
-- Contract spec: supabase/tests/account_deletion_import_uploads.spec.sql.

CREATE OR REPLACE FUNCTION public.fn_list_account_storage_paths(
    p_user_id uuid,
    p_bucket text,
    p_prefix text,
    p_after_path text DEFAULT NULL,
    p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
    v_rows jsonb;
    v_count integer;
    v_last text;
BEGIN
    IF p_user_id IS NULL OR NOT (
        (p_bucket = 'image-staging' AND p_prefix = p_user_id::text)
        OR (p_bucket = 'avatars' AND p_prefix IN (
            p_user_id::text, 'approved/' || p_user_id::text
        ))
        OR (p_bucket = 'entry-photos' AND p_prefix IN (
            p_user_id::text, 'approved/' || p_user_id::text
        ))
        -- Import screenshots: uploaded by the app to
        -- import-uploads/<user_id>/<timestamp>-<rand>.jpg and never registered
        -- in the image lifecycle tables, so the account saga lists them here.
        OR (p_bucket = 'import-uploads' AND p_prefix = p_user_id::text)
    ) THEN
        RAISE EXCEPTION 'invalid_account_storage_scope' USING ERRCODE = '22023';
    END IF;

    WITH page AS (
        SELECT s.name AS path
        FROM storage.objects s
        WHERE s.bucket_id = p_bucket
          AND s.name LIKE p_prefix || '/%'
          AND (p_after_path IS NULL OR s.name > p_after_path)
        ORDER BY s.name
        LIMIT v_limit
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(p.path ORDER BY p.path), '[]'::jsonb),
           pg_catalog.count(*)::integer,
           pg_catalog.max(p.path)
    INTO v_rows, v_count, v_last
    FROM page p;

    RETURN pg_catalog.jsonb_build_object(
        'paths', v_rows,
        'next_cursor', CASE WHEN v_count = v_limit THEN v_last ELSE NULL END
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_list_account_storage_paths(uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_list_account_storage_paths(uuid, text, text, text, integer) TO service_role;
