-- TICKET-082 Phase 1 — "Supper" schema + visibility.  (rev 2 — Codex P1 fix)
--
-- A Supper is a cluster of `entries` sharing a `supper_id`, built WITHOUT the
-- legacy table_nights machinery. Each participant's take is their own `entries` row.
--
-- SECURITY MODEL (revised after Codex dual-review FAIL on rev 1):
--   Membership must NOT be derivable from client-writable state. Rev 1 derived it
--   from entries.supper_id + entry_participants — both client-writable — so a user
--   who learned a supper UUID could self-enroll (set supper_id on their own entry,
--   or insert an entry_participants row) and read everyone's takes via branch 5.
--   Rev 2: membership lives in `supper_members`, written ONLY by the service-role
--   edge function (no client write policy). is_supper_member() trusts ONLY
--   suppers.host_user_id + supper_members — neither client-writable.
--   entries.supper_id stays client-writable but is now HARMLESS: branch 5 also
--   requires the ENTRY'S AUTHOR to be a member, so a stranger attaching their own
--   entry to a supper (set supper_id) cannot surface it to members.
--   NOTE for Phase 2: the service-role `supper-detail` read MUST mirror this — fetch
--   takes as `entries WHERE supper_id = X AND user_id IN (members)`; service role
--   bypasses RLS, so branch 5 does not protect that path.
--
-- DUAL-REVIEW (schema + RLS) per CLAUDE.md.

-- ── 1. suppers anchor ────────────────────────────────────────────────────────
CREATE TABLE public.suppers (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
    host_user_id  uuid NOT NULL REFERENCES public.profiles(user_id),
    created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.suppers ENABLE ROW LEVEL SECURITY;

-- ── 2. supper_members — the roster AND the trust anchor ──────────────────────
-- Written ONLY by the service-role edge fn (host + each tagged friend, seeded at
-- creation). A "pending" participant = a member row whose user has no entry with
-- this supper_id yet. NO client write policy → authenticated cannot self-enroll.
CREATE TABLE public.supper_members (
    supper_id  uuid NOT NULL REFERENCES public.suppers(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (supper_id, user_id)
);
ALTER TABLE public.supper_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_supper_members_user ON public.supper_members (user_id);

-- ── 3. entries.supper_id group key ───────────────────────────────────────────
-- NULL for solo / with-companions / table entries. ON DELETE SET NULL so deleting
-- the anchor never cascades away a person's actual log.
ALTER TABLE public.entries
    ADD COLUMN supper_id uuid REFERENCES public.suppers(id) ON DELETE SET NULL;
CREATE INDEX idx_entries_supper_id ON public.entries (supper_id) WHERE supper_id IS NOT NULL;
-- entries has COLUMN-LEVEL select grants (20260509000100 revoked table-wide SELECT,
-- then granted specific columns). A new column is NOT readable by authenticated
-- until explicitly granted (TICKET-034/043 column-grant trap).
GRANT SELECT (supper_id) ON public.entries TO authenticated;

-- ── 4. membership helper (SECDEF, STRICT, pinned search_path) ────────────────
-- Trusts ONLY service-role-controlled tables (suppers.host_user_id + supper_members).
-- STRICT → returns NULL on NULL input, so is_supper_member(NULL, …) never scans;
-- this guarantees the branch-5 short-circuit regardless of planner AND-ordering
-- (Codex P2). SECURITY DEFINER bypasses RLS on suppers/supper_members, so the
-- can_view_entry → is_supper_member chain cannot recurse.
CREATE OR REPLACE FUNCTION public.is_supper_member(p_supper_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
STRICT
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.suppers s
        WHERE s.id = p_supper_id AND s.host_user_id = p_user_id
        UNION ALL
        SELECT 1 FROM public.supper_members m
        WHERE m.supper_id = p_supper_id AND m.user_id = p_user_id
    );
$$;
-- Revoke from anon + authenticated explicitly: Supabase default privileges grant
-- EXECUTE on new public functions to both, and `FROM public` alone leaves those
-- explicit grants intact — which would expose this SECDEF membership oracle to anon
-- (Codex nit). Re-grant only to the two intended roles.
REVOKE ALL ON FUNCTION public.is_supper_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_supper_member(uuid, uuid) TO authenticated, service_role;

-- ── 5. RLS: members read suppers + roster; writes are service-role only ──────
-- No INSERT/UPDATE/DELETE policy → denied for authenticated (RLS on, no write
-- policy). The service-role edge fn bypasses RLS for all writes.
CREATE POLICY suppers_select ON public.suppers
    FOR SELECT TO authenticated
    USING (public.is_supper_member(id, auth.uid()));
CREATE POLICY supper_members_select ON public.supper_members
    FOR SELECT TO authenticated
    USING (public.is_supper_member(supper_id, auth.uid()));

-- Supabase default privileges GRANT ALL on new public tables to anon + authenticated.
-- RLS already denies the real attack, but align the privilege layer with intent so a
-- future RLS regression can't expose writes (Codex nit). Revoke the defaults, then
-- re-grant only the intended SELECT (authenticated) + ALL (service_role).
REVOKE ALL ON TABLE public.suppers        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.supper_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.suppers        TO authenticated;
GRANT SELECT ON public.supper_members TO authenticated;
GRANT ALL    ON public.suppers        TO service_role;
GRANT ALL    ON public.supper_members TO service_role;

-- ── 6. can_view_entry: add branch 5 (supper member) ──────────────────────────
-- Verbatim body of 20260509000010 + Branch 5. Branch 5 requires BOTH the viewer
-- AND the entry's author to be supper members: viewer-member gates the read,
-- author-member blocks injection. `supper_id IS NOT NULL` + the STRICT helper
-- mean non-supper rows pay only a cheap NULL check.
CREATE OR REPLACE FUNCTION public.can_view_entry(e public.entries)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND (
            -- Branch 1: Author.
            public.fn_user_authored_entry(e.id, auth.uid())

            -- Branch 2: Tablemate via entry_tables.
            OR EXISTS (
                SELECT 1
                FROM public.entry_tables et
                WHERE et.entry_id = e.id
                  AND public.is_table_member(et.table_id, auth.uid())
            )

            -- Branch 3: Companion (tagged presence overrides visibility='private').
            OR public.is_entry_companion(e.id, auth.uid())

            -- Branch 4: Public-eligible.
            OR (
                e.visibility = 'public'
                AND e.rating IS NOT NULL
                AND char_length(trim(COALESCE(e.content, ''))) >= 20
                AND EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.user_id = e.user_id
                      AND p.account_privacy = 'public'
                )
            )

            -- Branch 5 (TICKET-082): supper. Viewer must be a member (gates read)
            -- AND the author must be a member (anti-injection). Membership comes
            -- only from is_supper_member (service-role-controlled), never from the
            -- client-writable supper_id alone.
            OR (
                e.supper_id IS NOT NULL
                AND public.is_supper_member(e.supper_id, auth.uid())
                AND public.is_supper_member(e.supper_id, e.user_id)
            )
        );
$$;

COMMENT ON FUNCTION public.can_view_entry(public.entries) IS
    'TICKET-082: + branch 5 (supper). Both viewer and entry author must be supper '
    'members (anti-injection); membership via is_supper_member (service-role-only '
    'supper_members). Branches 1-4 unchanged from 20260509000010.';
