-- TICKET-037: append_entry_photo RPC — server-side sort_order computation for photo appends.
-- Eliminates the client read-then-write race on concurrent photo additions.
-- Storage orphan cleanup remains in the edge function (RPCs cannot call HTTP APIs).

CREATE OR REPLACE FUNCTION public.append_entry_photo(
    p_entry_id  uuid,
    p_user_id   uuid,
    p_photo_url text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- Pin search_path so a caller-set search_path cannot shadow public objects
-- (SECURITY DEFINER + mutable search_path = privilege escalation vector).
SET search_path = public, pg_temp
AS $$
DECLARE
    v_next_order int;
    v_row        public.entry_photos;
BEGIN
    -- Auth: caller owns the entry
    IF NOT EXISTS (
        SELECT 1 FROM public.entries WHERE id = p_entry_id AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = '42501';
    END IF;

    -- Lock the entry to serialize concurrent appenders for this entry
    PERFORM 1 FROM public.entries WHERE id = p_entry_id FOR UPDATE;

    SELECT COALESCE(MAX(sort_order) + 1, 0)
      INTO v_next_order
      FROM public.entry_photos
     WHERE entry_id = p_entry_id;

    INSERT INTO public.entry_photos (entry_id, photo_url, sort_order)
    VALUES (p_entry_id, p_photo_url, v_next_order)
    RETURNING * INTO v_row;

    RETURN to_jsonb(v_row);
END;
$$;

-- Revoke broad execute; grant to service_role only (edge functions use service
-- role; no direct authenticated call). Defence in depth against RLS confusion.
REVOKE ALL ON FUNCTION public.append_entry_photo(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_entry_photo(uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.append_entry_photo IS
    'TICKET-037: Appends a photo to an entry with server-computed sort_order. Row-locks the entry to prevent concurrent sort_order races. Called from supabase/functions/entry/index.ts (action=append_entry_photo).';
