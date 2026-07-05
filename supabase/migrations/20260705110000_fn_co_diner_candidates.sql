-- TICKET-101 — feed empty-state rescue: co-diner follow candidates.
--
-- fn_co_diner_candidates(p_viewer, p_limit): the people the VIEWER has actually
-- eaten with on Napkin, ranked by meals-together, minus everyone they already
-- follow, minus either-direction blocks, minus self. Powers tier 1 of the
-- zero-follow feed empty state (up to 3 follow cards). These are the viewer's
-- OWN companions — never a strangers list; k-anonymity is N/A (they were all in
-- the room). The rescue exists so an empty feed reads as "early", not "bugged".
--
-- SECURITY DEFINER + service-role-only EXECUTE, same posture as fn_friends_feed:
-- the feed-facing surface is the user-profile edge fn (co_diners action), which
-- validates the JWT and passes auth.uid() as p_viewer. The function reads across
-- other members' rows (e.g. table_members it doesn't own) — that cross-user read
-- is the whole reason it must be DEFINER; the viewer scoping lives in SQL.
--
-- Co-diner / meal-event semantics (spec'd in TICKET-101 Technical Design):
--   A "meal-event" is one keyed row from one of four sources. The co-diner set
--   per event = co-attendees minus the viewer. Dedup is
--   COUNT(DISTINCT (event_kind, event_key)) per co-diner, so:
--     • two companions on the SAME entry don't double-count that entry,
--     • the same table membership isn't recounted per shared meal,
--     • a person met via BOTH a table and a supper counts those two events
--       separately (they are distinct (kind, key) tuples).
--
--   The four sources (event_kind → event_key):
--     entry     → entries.id       : entries the viewer co-attended (viewer is
--                                     entries.user_id OR entry_companions.user_id);
--                                     co-diners = author ∪ companions minus viewer.
--     supper    → supper_members.supper_id : suppers the viewer is a member of;
--                                     co-diners = other supper_members.user_id.
--     round     → table_night_participants.table_night_id : rounds the viewer
--                                     participated in; co-diners = other user_id.
--     table     → table_members.table_id : tables the viewer belongs to;
--                                     co-diners = other member_id. NOTE the
--                                     TICKET-001 exception — table_members keys on
--                                     member_id, NOT user_id. Typing user_id here
--                                     silently returns zero table-based co-diners
--                                     (the TICKET-034 P0-2 class of bug).
--
-- Only (co_diner_id uuid, meals_together int) ever leaves — the exact metric the
-- emergence arc is built on. No raw event rows, no source breakdown.

CREATE OR REPLACE FUNCTION public.fn_co_diner_candidates(
    p_viewer uuid,
    p_limit  int DEFAULT 3
)
RETURNS TABLE (
    co_diner_id     uuid,
    meals_together  int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH events AS (
        -- ── entry co-diners (two directions) ─────────────────────────────────
        -- Every entry the viewer co-attended: as the author, OR as a tagged
        -- companion. For each such entry the co-diners are {author} ∪
        -- {all companions} minus the viewer, keyed by entry_id.
        SELECT other.co_diner_id, 'entry'::text AS event_kind, ev.entry_id::text AS event_key
        FROM (
            -- entries where the viewer is the author
            SELECT e.id AS entry_id
            FROM public.entries e
            WHERE e.user_id = p_viewer
            UNION
            -- entries where the viewer is a tagged companion
            SELECT ec.entry_id
            FROM public.entry_companions ec
            WHERE ec.user_id = p_viewer
        ) ev
        CROSS JOIN LATERAL (
            -- co-attendees on that entry = author ∪ companions, minus viewer
            SELECT e2.user_id AS co_diner_id
            FROM public.entries e2
            WHERE e2.id = ev.entry_id AND e2.user_id <> p_viewer
            UNION
            SELECT ec2.user_id
            FROM public.entry_companions ec2
            WHERE ec2.entry_id = ev.entry_id AND ec2.user_id <> p_viewer
        ) other

        UNION ALL

        -- ── supper co-diners ─────────────────────────────────────────────────
        SELECT sm_other.user_id, 'supper'::text, sm_mine.supper_id::text
        FROM public.supper_members sm_mine
        JOIN public.supper_members sm_other
          ON sm_other.supper_id = sm_mine.supper_id
         AND sm_other.user_id <> p_viewer
        WHERE sm_mine.user_id = p_viewer

        UNION ALL

        -- ── round (table_night) co-diners ────────────────────────────────────
        SELECT tnp_other.user_id, 'round'::text, tnp_mine.table_night_id::text
        FROM public.table_night_participants tnp_mine
        JOIN public.table_night_participants tnp_other
          ON tnp_other.table_night_id = tnp_mine.table_night_id
         AND tnp_other.user_id <> p_viewer
        WHERE tnp_mine.user_id = p_viewer

        UNION ALL

        -- ── table co-diners (member_id — TICKET-001 exception, NOT user_id) ──
        SELECT tm_other.member_id, 'table'::text, tm_mine.table_id::text
        FROM public.table_members tm_mine
        JOIN public.table_members tm_other
          ON tm_other.table_id = tm_mine.table_id
         AND tm_other.member_id <> p_viewer
        WHERE tm_mine.member_id = p_viewer
    )
    SELECT
        ev.co_diner_id,
        COUNT(DISTINCT (ev.event_kind, ev.event_key))::int AS meals_together
    FROM events ev
    WHERE
        -- never the viewer themselves (defence in depth — sources already exclude)
        ev.co_diner_id <> p_viewer
        -- exclude anyone the viewer already follows
        AND NOT EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = p_viewer AND f.following_id = ev.co_diner_id
        )
        -- exclude either-direction blocks (viewer blocked them OR they blocked viewer)
        AND NOT EXISTS (
            SELECT 1 FROM public.blocked_users b
            WHERE (b.blocker_id = p_viewer AND b.blocked_id = ev.co_diner_id)
               OR (b.blocker_id = ev.co_diner_id AND b.blocked_id = p_viewer)
        )
    GROUP BY ev.co_diner_id
    -- deterministic tiebreak so the list doesn't reshuffle on re-fetch
    ORDER BY meals_together DESC, ev.co_diner_id ASC
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.fn_co_diner_candidates(uuid, int) IS
    'TICKET-101: co-diner follow candidates for the zero-follow feed empty state. '
    'Union of entry/supper/round/table co-attendance, dedup by (event_kind, '
    'event_key) meal-event, minus follows/either-direction-blocks/self, ranked '
    'meals_together DESC then co_diner_id ASC. table_members keys on member_id '
    '(TICKET-001 exception). Aggregate counts only — never raw event rows. '
    'Service-role only; the edge fn authenticates and passes p_viewer.';

REVOKE ALL ON FUNCTION public.fn_co_diner_candidates(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_co_diner_candidates(uuid, int) TO service_role;
