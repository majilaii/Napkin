-- TICKET-037: maybe_reveal_round RPC — idempotent "nudge" to reveal a round
-- where all participants are already ready. Safe to poll. Validates table membership.

CREATE OR REPLACE FUNCTION public.maybe_reveal_round(
    p_round_id uuid,
    p_user_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- Pin search_path so a caller-set search_path cannot shadow public objects
-- (SECURITY DEFINER + mutable search_path = privilege escalation vector).
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status text;
BEGIN
    -- Auth: caller must be a member of the round's table
    IF NOT EXISTS (
        SELECT 1
          FROM public.table_nights n
          JOIN public.table_members tm ON tm.table_id = n.table_id
         WHERE n.id = p_round_id AND tm.member_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
    END IF;

    UPDATE public.table_nights
       SET status = 'revealed', revealed_at = now()
     WHERE id = p_round_id
       AND status = 'rating'
       AND NOT EXISTS (
           SELECT 1 FROM public.table_night_participants
            WHERE table_night_id = p_round_id AND ready = false
       )
    RETURNING status INTO v_status;

    IF v_status IS NULL THEN
        SELECT status INTO v_status FROM public.table_nights WHERE id = p_round_id;
    END IF;

    RETURN jsonb_build_object('status', v_status);
END;
$$;

-- Revoke broad execute; grant to service_role only (edge functions use service
-- role; no direct authenticated call). Defence in depth against RLS confusion.
REVOKE ALL ON FUNCTION public.maybe_reveal_round(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.maybe_reveal_round(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.maybe_reveal_round IS
    'TICKET-037: Idempotent nudge to reveal a round where all participants are ready. Safe to poll. Called from supabase/functions/table-night/index.ts (action=nudge_reveal).';
