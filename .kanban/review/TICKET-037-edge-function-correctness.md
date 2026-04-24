---
id: TICKET-037
title: "Edge function correctness & atomicity — transactions, dedupe, error handling"
priority: high
status: review
created: 2026-04-24
updated: 2026-04-24
tags: [backend, edge-functions, correctness, atomicity]
---

# Edge function correctness & atomicity

## Problem

Bug patrol (2026-04-24) found a cluster of edge-function-layer bugs: non-atomic multi-step writes that orphan rows on partial failure, race conditions on "all ready" reveal, data dedupe bugs, swallowed errors, and inconsistent response shapes. None of these are hot on their own but several are correctness-critical under real usage.

### Findings covered

- **P1-1 — `entry_photos` sort_order race.** `napkin-app/hooks/entries/useEntryPhotoMutations.ts:36-50`. Read-then-write: two concurrent adds compute the same `nextOrder`, second insert hits the unique constraint, storage upload is orphaned. Root cause: client computes `sort_order`.
- **P1-6 — `table-night.rate` orphans participants on entry-insert failure.** `supabase/functions/table-night/index.ts:391-477`. Flow: update participant `ready=true, rating=X` → insert `entries` row → maybe set status `revealed`. If the entry insert fails, participant stays `ready=true` with no journal entry. Similar in `useStartRound` (host flow).
- **P1-7 — auto-reveal race.** `table-night/index.ts:462-475`. Two holdouts rate concurrently; each sees 4/5 ready, neither triggers reveal. Round stuck in `rating` status.
- **P1-11 — participant + companion dedupe bug.** `supabase/functions/entry/index.ts:432-469`. Participants dedupe against `user.id`; companions dedupe against `user.id`; but `companion_ids` is NOT deduped against `participant_ids`. A user can be tagged as both, producing incoherent UI ("6 ratings" strip + "with Alex, Bea" with Alex in both).
- **P1-13 — `useRoundContext` direct DB fetch bypasses membership.** `napkin-app/hooks/tables/useTableNight.ts:198-234`. Fetches all participant ratings via `supabase.from(...)`. No membership check at the client. Only works because of RLS assumptions; client-side gate is cosmetic.
- **P2-8 — `places-search` accepts any HTTP method.** `supabase/functions/places-search/index.ts:10`. Only guards OPTIONS; malformed GET/DELETE still charges Places API quota.
- **P2-12 — trigger dependency not documented.** `post-interactions/index.ts` relies on `set_post_interaction_table_id` trigger for denorm. If refactored independently, invariant breaks silently.
- **P2-13 — companion insert is non-fatal but never surfaces warnings.** `supabase/functions/entry/index.ts:457-469`. If `entry_companions` insert fails, user thinks Alex was tagged, Alex never sees the post. No UI indicator, no response warning.
- **P2-14 — `update_reply_permission` response shape diverges from other profile updates.** `user-profile/index.ts:1050-1056`. Returns subset of fields. Hurts optimistic patching consistency.
- **P2-16 — `NOT IN` uses string-joined UUID list.** `restaurant-history/index.ts:285`. `onNapkinQuery.not('id', 'in', '(${visitedIds.join(',')})')`. Works for UUIDs but fragile — should pass array.
- **P2-17 — `useReorderListEntry` passes client-side neighbour ids.** `hooks/lists/useReorderListEntry.ts:17-24`. Client derives `before_entry_id`/`after_entry_id` from cache. Stale cache → server computes wrong position → drag snaps back.
- **P2-20 — swallowed errors in `table-night` status / active handlers.** `table-night/index.ts:93, 153`. Destructure only `data`, not `error`. Silent failures.
- **P2-21 — inconsistent invoke-error unwrapping.** Half the hooks unwrap `FunctionsHttpError.context` to surface `error_code`; half don't. `AddMemberError` works by accident because `useAddMember` has custom unwrapping.

## Notes

### Design decisions

- **Multi-step writes → Postgres RPCs with explicit transactions.** For `table-night.rate` and `table-night.start`, wrap the participant update + entry insert in a SQL function so either both commit or both roll back.
- **Atomic reveal via WHERE clause.** Replace the read-then-decide-then-write for "all ready" with a single `UPDATE ... WHERE status='rating' AND NOT EXISTS (SELECT 1 FROM participants WHERE ready=false)`. Idempotent and race-free.
- **Server-side `sort_order` computation.** Move photo sort_order to a new `add_entry_photo` edge function action (or an RPC) that computes `COALESCE(MAX(sort_order)+1, 0)` inside the INSERT transaction. Client no longer reads-then-writes.
- **Single error envelope.** Every edge function returns `{ data } | { error: { code, message, details? } }`. 4xx/5xx status codes always carry an `error` object with a `code` field. Client has a shared `unwrapInvokeError(err)` helper.
- **Response shape consistency on profile updates.** All profile-update actions return the same full profile row shape.
- **List reorder: server looks up neighbours.** `useReorderListEntry` sends only `{ entry_id, new_index }`. Server reads the current list, resolves neighbours, computes position.
- **Dedupe companions against participants explicitly.** `entry` function sanitizes `companion_ids` to also exclude `participant_ids`.
- **`useRoundContext` routes through `table-night` edge function.** New `action=round_context` that validates membership.

### Dependencies

- TICKET-034 (RLS) overlaps with `useRoundContext`: once RLS is correct, the direct fetch would still work but is still wrong to keep (defense in depth). This ticket finishes the job.
- TICKET-035 (pagination) independent.
- TICKET-036 (optimistic) will want `client_nonce` in the `entry` function — this ticket keeps that addition scoped there.
- TICKET-039 (DX helpers) picks up the shared `unwrapInvokeError` — land the helper here, rely on 039 to finish propagation across every hook.

### Risk

- Medium. RPCs are a new abstraction in this codebase (none exist today). Document the pattern clearly so builders can follow.
- `rate_round` RPC must be SECURITY DEFINER to match the edge function's service-role bypass pattern; be careful with the `search_path`.

---

## Product Spec

### User Stories

- As a **Round participant**, I want my rating to either fully save (participant marked ready AND entry created) or not at all. No orphaned half-states.
- As the **last holdout in a Round**, I want the reveal to fire reliably when everyone's in, not stall because two of us submitted at the same millisecond.
- As a **user tagging companions**, I want the tag to succeed or fail loudly — never silently drop.
- As a **user reordering a list**, I want my drag to stick where I dropped it, not snap back because the server computed a different position.
- As the **operator**, I want edge functions to fail with a structured error code the client can branch on, not a generic `non-2xx status`.

### Acceptance Criteria

#### RPC — `rate_round`

- [ ] Migration creates `public.rate_round(round_id uuid, user_id uuid, rating double precision, content text, photo_urls text[], client_nonce uuid)` SECURITY DEFINER.
- [ ] Function body (in a single transaction):
  1. Validate `user_id` is a participant in `round_id`.
  2. UPDATE `table_night_participants` SET `ready=true, rating=?` WHERE …
  3. INSERT into `entries` with `table_night_id=round_id, user_id, rating, content, client_nonce`.
  4. INSERT into `entry_photos` for each `photo_url` with server-computed `sort_order = row_number() - 1`.
  5. Atomically try reveal: `UPDATE table_nights SET status='revealed' WHERE id=round_id AND status='rating' AND NOT EXISTS (SELECT 1 FROM table_night_participants WHERE table_night_id=round_id AND ready=false)`.
  6. Return `{ entry_id, round_status, revealed: bool }`.
- [ ] `supabase/functions/table-night/index.ts::rate` rewritten to call the RPC via `supabase.rpc('rate_round', ...)`.
- [ ] Remove the manual participant update + entry insert + reveal check from the edge function.

#### RPC — `start_round`

- [ ] Same treatment. `public.start_round(table_id, restaurant_id, host_user_id, host_rating, host_content, photo_urls, client_nonce)` — creates `table_nights` row, inserts host `entries` row, inserts host participant row, in one transaction.
- [ ] Edge function rewritten.

#### Atomic reveal — decouple from `rate`

- [ ] Even though `rate_round` does the atomic reveal, also add a standalone `maybe_reveal_round(round_id)` RPC callable as a "nudge" in case a round gets stuck (e.g., one participant left the group). Idempotent.

#### Photo sort_order — server-side

- [ ] New edge function action or RPC: `append_entry_photo(entry_id, photo_url)`. Server computes `sort_order = COALESCE((SELECT MAX(sort_order) FROM entry_photos WHERE entry_id=?) + 1, 0)` and inserts atomically. Returns the inserted row.
- [ ] Rewrite `napkin-app/hooks/entries/useEntryPhotoMutations.ts::useAddEntryPhoto` to call this instead of read-then-write.
- [ ] Storage orphan protection: if the insert fails after upload, the server-side function also deletes the uploaded file (via `storage` API).

#### Companion/participant dedupe

- [ ] `supabase/functions/entry/index.ts` — sanitize `companion_ids` to:
  ```ts
  const sanitizedCompanionIds = [...new Set(
    rawCompanionIds.filter((id) => id && id !== user.id && !allParticipantIds.includes(id))
  )];
  ```
- [ ] Add a unit test-ish check in the function: if `companion_ids ∩ participant_ids ≠ ∅`, log a warning and drop duplicates silently.

#### Companion insert failure — surface warnings

- [ ] `entry/index.ts:457-469` — when `entry_companions` insert fails, collect the failure into a `warnings` array in the response: `{ data: {...}, warnings: [{ type: 'companion_tag_failed', failed_ids: [...], reason }] }`.
- [ ] Client `useCreateEntry.onSuccess` — if `warnings` present, surface via toast: "Couldn't tag some friends."

#### `useRoundContext` via edge function

- [ ] New action `table-night?action=round_context` that validates membership, then returns the participant count, group average (if revealed), and status.
- [ ] `napkin-app/hooks/tables/useTableNight.ts:198-234` rewritten to call this action. Delete the direct-DB fetch.

#### List reorder — server-authoritative

- [ ] `supabase/functions/lists/index.ts::reorder` — new/updated shape: accepts `{ entry_id, new_index }`. Server reads the list, picks neighbour ids from the authoritative state, computes position.
- [ ] `napkin-app/hooks/lists/useReorderListEntry.ts` simplified: no more `before_entry_id`/`after_entry_id` derivation on the client.
- [ ] Retain `compactPositions` server logic but move to a single `UPDATE ... FROM (SELECT ... ROW_NUMBER() ...)` SQL (also listed in TICKET-038; bundle here if convenient).

#### `places-search` method guard

- [ ] `places-search/index.ts` — add `if (req.method !== 'POST' && req.method !== 'OPTIONS') return new Response(null, { status: 405, headers: corsHeaders });`.

#### `update_reply_permission` response shape

- [ ] Return the full profile shape — `user_id, username, display_name, bio, avatar_url, account_privacy, allow_public_replies`.
- [ ] Client `useUpdateReplyPermission.onSuccess` — use `setQueryData(queryKeys.users.profile(viewerId), result)` optimistically.

#### `NOT IN` array

- [ ] `restaurant-history/index.ts:285` — change `.not('id', 'in', '(${visitedIds.join(',')})')` to pass the UUID array directly via PostgREST syntax. Verify syntax against the Supabase client version in use.

#### Swallowed errors — `table-night`

- [ ] Every `supabase.from(...)...single()` call in `table-night/index.ts` destructures both `data` and `error`. On error, either log-and-continue with an explicit null guard or throw with `error.message`. No silent `null`s.
- [ ] Grep for the same pattern elsewhere in `supabase/functions/**` and fix.

#### Trigger dependency documentation

- [ ] `post-interactions/index.ts` — add a top-of-file doc comment listing which DB triggers/functions it relies on (`set_post_interaction_table_id`, reaction count triggers, etc.). Future refactors can't silently break the contract.

#### Error envelope + helper

- [ ] Standardize every edge function's error response: `return new Response(JSON.stringify({ error: { code: 'SNAKE_CASE_CODE', message: '...', details?: ... } }), { status: <4xx|5xx>, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });`.
- [ ] New helper `napkin-app/lib/edgeInvoke.ts::unwrapInvokeError(err): { code, message, details }` — extracts from `FunctionsHttpError.context.json()` if present, falls back to `err.message`.
- [ ] At least every mutation hook that needs to branch on `error.code` uses the helper. Widespread propagation is TICKET-039 but land the helper here.

#### Testing plan

- [ ] **Transaction rollback test.** In staging, simulate a DB failure mid-`rate_round` (e.g., temporarily break `entry_photos` unique constraint on a specific row). Confirm participant row does NOT become `ready=true`.
- [ ] **Race test.** Two concurrent `rate_round` calls for the last two participants — confirm exactly one reveal transition happens and round status === `revealed`.
- [ ] **Photo race.** Spam the photo-upload UI 5× fast — confirm 5 unique sort_orders, no failures, no orphaned storage objects.
- [ ] **Companion failure.** Manually provoke a companion insert failure (FK violation) — confirm response carries `warnings` and client shows the toast.
- [ ] **Reorder.** Open the same list on two devices; device A drags an item; device B (cache stale) drags another item. Confirm server-side neighbour resolution produces correct positions on both.
- [ ] **Error unwrap.** Trigger a known error code (e.g. `NOT_OWNER` from `useAddMember`) — confirm `unwrapInvokeError` exposes the code to UI.

### Non-goals

- Do not migrate every edge function to RPCs. Only multi-step writes that need atomicity.
- Do not change the overall edge-function pattern (service role + manual auth). CLAUDE.md still governs.
- Do not add retry logic here; that's a separate reliability ticket.

### Definition of Done

- RPCs created and callable; edge functions rewritten to use them.
- All listed findings closed with a cross-ref to file:line.
- Transaction rollback test passes in staging.
- Build log lists every new RPC with its SECURITY DEFINER / search_path settings.

---

## Technical Design

### Approach

We introduce Postgres RPCs (`SECURITY DEFINER`, pinned `search_path`) for every multi-step write that currently races or orphans: `rate_round`, `start_round`, `maybe_reveal_round`, `append_entry_photo`. Edge functions become thin routers — they still handle auth, shape validation, and CORS, but all multi-statement persistence collapses into a single `rpc()` call so a single transaction commits or rolls back together. Atomic reveal rides the same transaction via an `UPDATE ... WHERE NOT EXISTS (… ready=false)` guard, making double-fire impossible. Alongside, we standardize the error envelope, ship one shared `unwrapInvokeError` helper (broad adoption deferred to TICKET-039), fix the dedupe/warning/method-guard/NOT-IN bugs in place, and move list reordering to server-authoritative neighbour resolution.

### Codebase reality check (discrepancies with the ticket)

Verified before designing — adjust below:

- **`entries.client_nonce` does NOT exist.** No migration defines it. The RPC signature must include adding it (either in this ticket's migration or deferred to TICKET-036). Design below adds it in this ticket's migration (scoped addition only; TICKET-036 uses it for optimistic dedupe).
- **Supabase dir is `/Users/jacky/Napkin/supabase/` (not under `napkin-app/`).** `napkin-app/supabase/` is the local linked dir (only `.temp/`). All edge functions + migrations live at repo root under `/Users/jacky/Napkin/supabase/`.
- **`table_night_participants.rating` is `numeric(2,1)`**, not `double precision`. RPC params will accept `numeric` (or `double precision` and cast on insert — the check constraint is 0.5–5.0).
- **`entries.table_night_id` FK confirmed** (column added in `20251222023333_remote_schema.sql` line 121; indexed line 131).
- **`lists` edge function exists** and already does `reorder_entry` with `before_entry_id`/`after_entry_id` (lines 498-569). `useReorderListEntry` exists and derives neighbours on the client (lines 33-36). Both need the rewrite described.
- **`_shared/` holds `cors.ts`, `calibration.ts`, `restaurant.ts`, `test-utils.ts`.** No error helper yet. `errors.ts` is new.
- **Migration naming convention: `YYYYMMDDHHmmss_snake_case_description.sql`.** Zero-padded 14-digit timestamp. Latest migration is `20260501000000_create_professional_critic_reviews.sql`. This ticket's migrations must sort after it.
- **Ad-hoc `unwrapInvokeError` already exists locally in `hooks/restaurants/useRestaurantHistory.ts:29-40`.** Promote that implementation to `lib/edgeInvoke.ts` verbatim, then replace the local copy.
- **`useAddMember` uses `data.error_code` as a top-level field on the JSON body, not nested under `error`.** Current error envelope is inconsistent across the codebase. We standardize on `{ error: { code, message, details? } }` going forward; `useAddMember` updates to match.

### Canonical RPC template (follow this exactly)

All new RPCs share this shape. Any builder adding a new RPC should copy this and fill in the body:

```sql
CREATE OR REPLACE FUNCTION public.<rpc_name>(
    <args>
)
RETURNS <json | table(...) | record>
LANGUAGE plpgsql
SECURITY DEFINER
-- Pin search_path so a caller-set search_path cannot shadow public objects
-- (SECURITY DEFINER + mutable search_path = privilege escalation vector).
SET search_path = public, pg_temp
AS $$
DECLARE
    <locals>
BEGIN
    -- 1. Authorization: validate the calling user_id matches the row's invariant
    --    (membership, ownership, etc.). Edge function validates the JWT; the RPC
    --    re-validates the business rule because SECURITY DEFINER runs as owner.
    IF NOT EXISTS (
        SELECT 1 FROM <gate_table> WHERE <user_id = p_user_id AND ...>
    ) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
    END IF;

    -- 2. Multi-step write inside implicit transaction. Any RAISE or constraint
    --    violation rolls back all statements.
    ...

    -- 3. Return a single JSON blob so the edge function can forward verbatim.
    RETURN jsonb_build_object(...);
END;
$$;

-- Revoke broad execute; grant to service_role only (edge functions use service
-- role; no direct authenticated call). Defence in depth against RLS confusion.
REVOKE ALL ON FUNCTION public.<rpc_name>(<arg_types>) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.<rpc_name>(<arg_types>) TO service_role;

COMMENT ON FUNCTION public.<rpc_name> IS
    'TICKET-037: <one-line purpose>. Called from supabase/functions/<fn>/index.ts.';
```

Non-negotiable: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO service_role`, and the `COMMENT` linking back to the calling edge function.

### RPC signatures and bodies

#### `public.rate_round`

```sql
CREATE OR REPLACE FUNCTION public.rate_round(
    p_round_id       uuid,
    p_user_id        uuid,
    p_rating         numeric(2,1),
    p_notes          text,
    p_dish           text,
    p_photo_urls     text[],
    p_vibe_rating    numeric(2,1) DEFAULT NULL,
    p_flavor_rating  numeric(2,1) DEFAULT NULL,
    p_service_rating numeric(2,1) DEFAULT NULL,
    p_value_rating   numeric(2,1) DEFAULT NULL,
    p_client_nonce   uuid         DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_night         public.table_nights;
    v_entry_id      uuid;
    v_new_status    text;
    v_revealed      boolean := false;
BEGIN
    -- Auth: caller must be a participant who has NOT submitted
    SELECT n.* INTO v_night
    FROM public.table_nights n
    JOIN public.table_night_participants p
      ON p.table_night_id = n.id AND p.user_id = p_user_id
    WHERE n.id = p_round_id
    FOR UPDATE OF p;   -- lock the participant row; serializes races

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_A_PARTICIPANT' USING ERRCODE = '42501';
    END IF;

    IF v_night.status <> 'rating' THEN
        RAISE EXCEPTION 'ROUND_NOT_RATING' USING ERRCODE = 'P0001';
    END IF;

    -- 1. Mark ready
    UPDATE public.table_night_participants
       SET rating         = p_rating,
           ready          = true,
           notes          = NULLIF(btrim(p_notes), ''),
           vibe_rating    = p_vibe_rating,
           flavor_rating  = p_flavor_rating,
           service_rating = p_service_rating,
           value_rating   = p_value_rating
     WHERE table_night_id = p_round_id
       AND user_id        = p_user_id
       AND ready = false;   -- idempotent guard; no-op if already submitted

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ALREADY_SUBMITTED' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Insert journal entry
    INSERT INTO public.entries (
        user_id, restaurant_id, table_id, table_night_id,
        rating, content, dish_description, visibility,
        vibe_rating, flavor_rating, service_rating, value_rating,
        photo_url, client_nonce
    ) VALUES (
        p_user_id, v_night.restaurant_id, v_night.table_id, p_round_id,
        p_rating, NULLIF(btrim(p_notes), ''), NULLIF(btrim(p_dish), ''), 'table',
        p_vibe_rating, p_flavor_rating, p_service_rating, p_value_rating,
        COALESCE(p_photo_urls[1], NULL), p_client_nonce
    )
    RETURNING id INTO v_entry_id;

    -- 3. Photos with server-computed sort_order
    IF p_photo_urls IS NOT NULL AND array_length(p_photo_urls, 1) > 0 THEN
        INSERT INTO public.entry_photos (entry_id, photo_url, sort_order)
        SELECT v_entry_id, url, ord - 1
        FROM unnest(p_photo_urls) WITH ORDINALITY AS u(url, ord);
    END IF;

    -- 4. Atomic reveal: single UPDATE with NOT EXISTS guard. Race-free.
    UPDATE public.table_nights
       SET status = 'revealed', revealed_at = now()
     WHERE id = p_round_id
       AND status = 'rating'
       AND NOT EXISTS (
           SELECT 1 FROM public.table_night_participants
           WHERE table_night_id = p_round_id AND ready = false
       )
    RETURNING status INTO v_new_status;

    v_revealed := v_new_status = 'revealed';

    RETURN jsonb_build_object(
        'entry_id',     v_entry_id,
        'round_status', COALESCE(v_new_status, v_night.status),
        'revealed',     v_revealed
    );
END;
$$;
```

Return shape: `{ entry_id: uuid, round_status: 'rating'|'revealed', revealed: boolean }`.

#### `public.start_round`

```sql
CREATE OR REPLACE FUNCTION public.start_round(
    p_table_id        uuid,
    p_restaurant_id   uuid,
    p_host_user_id    uuid,
    p_host_rating     numeric(2,1),
    p_host_notes      text,
    p_host_dish       text,
    p_photo_urls      text[],
    p_attendee_ids    uuid[],
    p_is_async        boolean DEFAULT true,
    p_vibe_rating     numeric(2,1) DEFAULT NULL,
    p_flavor_rating   numeric(2,1) DEFAULT NULL,
    p_service_rating  numeric(2,1) DEFAULT NULL,
    p_value_rating    numeric(2,1) DEFAULT NULL,
    p_client_nonce    uuid         DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_night_id   uuid;
    v_entry_id   uuid;
    v_invalid    uuid[];
BEGIN
    -- Auth: host must be a member of the table
    IF NOT EXISTS (
        SELECT 1 FROM public.table_members
         WHERE table_id = p_table_id AND member_id = p_host_user_id
    ) THEN
        RAISE EXCEPTION 'NOT_A_TABLE_MEMBER' USING ERRCODE = '42501';
    END IF;

    -- Validate attendees are table members (in one query)
    IF p_attendee_ids IS NOT NULL AND array_length(p_attendee_ids, 1) > 0 THEN
        SELECT COALESCE(array_agg(a), '{}')
          INTO v_invalid
          FROM unnest(p_attendee_ids) a
         WHERE a <> p_host_user_id
           AND NOT EXISTS (
               SELECT 1 FROM public.table_members
                WHERE table_id = p_table_id AND member_id = a
           );
        IF array_length(v_invalid, 1) > 0 THEN
            RAISE EXCEPTION 'ATTENDEE_NOT_MEMBER: %', v_invalid USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 1. Create round
    INSERT INTO public.table_nights (table_id, restaurant_id, host_user_id, status, is_async)
    VALUES (p_table_id, p_restaurant_id, p_host_user_id, 'rating', COALESCE(p_is_async, true))
    RETURNING id INTO v_night_id;

    -- 2. Host participant row (ready=true)
    INSERT INTO public.table_night_participants (
        table_night_id, user_id, rating, ready, notes,
        vibe_rating, flavor_rating, service_rating, value_rating
    ) VALUES (
        v_night_id, p_host_user_id, p_host_rating, true, NULLIF(btrim(p_host_notes), ''),
        p_vibe_rating, p_flavor_rating, p_service_rating, p_value_rating
    );

    -- 3. Attendee participant rows (ready=false)
    IF p_attendee_ids IS NOT NULL THEN
        INSERT INTO public.table_night_participants (table_night_id, user_id)
        SELECT v_night_id, a
          FROM unnest(p_attendee_ids) a
         WHERE a <> p_host_user_id
        ON CONFLICT DO NOTHING;
    END IF;

    -- 4. Host journal entry
    INSERT INTO public.entries (
        user_id, restaurant_id, table_id, table_night_id,
        rating, content, dish_description, visibility,
        vibe_rating, flavor_rating, service_rating, value_rating,
        photo_url, client_nonce
    ) VALUES (
        p_host_user_id, p_restaurant_id, p_table_id, v_night_id,
        p_host_rating, NULLIF(btrim(p_host_notes), ''), NULLIF(btrim(p_host_dish), ''), 'table',
        p_vibe_rating, p_flavor_rating, p_service_rating, p_value_rating,
        COALESCE(p_photo_urls[1], NULL), p_client_nonce
    )
    RETURNING id INTO v_entry_id;

    -- 5. Host photos
    IF p_photo_urls IS NOT NULL AND array_length(p_photo_urls, 1) > 0 THEN
        INSERT INTO public.entry_photos (entry_id, photo_url, sort_order)
        SELECT v_entry_id, url, ord - 1
        FROM unnest(p_photo_urls) WITH ORDINALITY AS u(url, ord);
    END IF;

    -- 6. Solo round (no attendees) → auto-reveal
    IF p_attendee_ids IS NULL OR array_length(p_attendee_ids, 1) = 0 THEN
        UPDATE public.table_nights
           SET status = 'revealed', revealed_at = now()
         WHERE id = v_night_id AND status = 'rating';
    END IF;

    RETURN jsonb_build_object(
        'night_id', v_night_id,
        'entry_id', v_entry_id
    );
END;
$$;
```

Return: `{ night_id: uuid, entry_id: uuid }`. Edge function still needs to upsert the restaurant from Places before calling (`restaurant_id` is a required param) — that's not part of the transaction because Places upsert is its own concern and already lives in `_shared/restaurant.ts`.

#### `public.maybe_reveal_round`

```sql
CREATE OR REPLACE FUNCTION public.maybe_reveal_round(
    p_round_id uuid,
    p_user_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
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
```

Idempotent. Safe to poll. Returns current status.

#### `public.append_entry_photo`

```sql
CREATE OR REPLACE FUNCTION public.append_entry_photo(
    p_entry_id  uuid,
    p_user_id   uuid,
    p_photo_url text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_next_order int;
    v_row public.entry_photos;
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
```

Return: full `entry_photos` row as JSON. Storage orphan cleanup stays on the client/edge side — if the RPC throws, the edge function (not the RPC) deletes the uploaded object; keeping storage IO out of the RPC is deliberate (RPCs can't call Storage HTTP API, and we don't want to wrap this in `http` extension calls).

### Migration plan

Directory: `/Users/jacky/Napkin/supabase/migrations/`. Convention: `YYYYMMDDHHmmss_snake_case.sql`. Latest is `20260501000000_create_professional_critic_reviews.sql` — new migrations start `20260502…`.

Proposed, in order (each in a separate file so a builder can land/revert independently):

1. `20260502000000_entries_add_client_nonce.sql`
   ```sql
   ALTER TABLE public.entries ADD COLUMN IF NOT EXISTS client_nonce uuid;
   CREATE UNIQUE INDEX IF NOT EXISTS entries_user_client_nonce_uidx
       ON public.entries (user_id, client_nonce) WHERE client_nonce IS NOT NULL;
   ```
   Must land first; the RPC bodies reference `client_nonce`. Partial unique index so null nonces don't collide. TICKET-036 consumes this; scoped addition only (no client wiring in this ticket beyond passing `NULL`).

2. `20260502000100_rpc_rate_round.sql` — `rate_round` body + GRANT/REVOKE/COMMENT.
3. `20260502000200_rpc_start_round.sql` — `start_round`.
4. `20260502000300_rpc_maybe_reveal_round.sql` — `maybe_reveal_round`.
5. `20260502000400_rpc_append_entry_photo.sql` — `append_entry_photo`.

Ordering: (1) must precede (2) and (3). (2)–(5) are independent of each other but conventionally applied in numeric order. No migration touches existing tables besides adding `client_nonce`; zero-downtime.

### Edge function rewrites

**`table-night/index.ts`** (biggest changes):

- `POST action=start` — replace lines ~210-323 with a single `supabase.rpc('start_round', { ... })` call. Keep `upsertRestaurant()` before the rpc. Response shape unchanged externally (still `{ data: night }`) — fetch night row after rpc returns `night_id` so status/revealed_at reflect auto-reveal.
- `POST action=rate` — replace lines ~391-477 with `supabase.rpc('rate_round', { ... })`. Return `{ data: { entry_id, round_status, revealed } }`. **Breaking change** vs. current response (which returns the updated participant row). `useSubmitTake` must ship in the same PR — it doesn't read from the response today beyond null-check, so surgery is minimal.
- `POST action=nudge_reveal` — new action wrapping `maybe_reveal_round`. Body: `{ round_id }`. Nothing in the client calls this yet; add but leave unwired (safety valve for stuck rounds).
- `GET action=round_context` — new. Validates membership via `table_members` (re-uses existing `validateTableMember` helper against the round's `table_id`), returns `{ night_id, participant_count, status, group_average }`. Group average only populated when `status='revealed'`.
- `GET action=status`, `action=active` — destructure `error` on every `.single()`/`.maybeSingle()` call; throw `error.message` on error. No silent null returns.

**`entry/index.ts`**:

- Create-entry branch (~lines 432-469): change dedupe to explicitly exclude `participant_ids` from `companion_ids`:
  ```ts
  const sanitizedCompanionIds = [...new Set(
      rawCompanionIds.filter((id) => id && id !== user.id && !allParticipantIds.includes(id))
  )];
  if (sanitizedCompanionIds.length !== rawCompanionIds.length) {
      console.warn('entry: dropped', rawCompanionIds.length - sanitizedCompanionIds.length, 'duplicate companion ids');
  }
  ```
- Capture companion insert failure and surface it as a warning:
  ```ts
  const warnings: Array<{ type: string; failed_ids?: string[]; reason?: string }> = [];
  if (compInsertError) {
      warnings.push({
          type: 'companion_tag_failed',
          failed_ids: sanitizedCompanionIds,
          reason: compInsertError.message,
      });
  }
  return json({ data: entryData, warnings: warnings.length ? warnings : undefined });
  ```
- Accept `client_nonce` in body and pass to the INSERT; if a row with `(user_id, client_nonce)` already exists, return `{ data: existingRow, warnings: [{ type: 'duplicate_submission' }] }` (this is the TICKET-036 hook — minimal support here, not client-wired).

**`lists/index.ts::reorder_entry`**:

- New request shape: `{ action: 'reorder_entry', list_id, entry_id, new_index }`.
- Server reads `list_entries` for `list_id` ordered by `position ASC`, computes the post-move neighbour ids (excluding the moved entry) at `new_index`, derives `prevPos`/`nextPos` the same way.
- Keep the compaction fallback.
- Response unchanged: `{ data: updatedEntry }`.
- **Breaking.** `useReorderListEntry` must ship in the same PR.

**`places-search/index.ts`**:

- After the `OPTIONS` check, add:
  ```ts
  if (req.method !== 'POST') {
      return new Response(
          JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only' } }),
          { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' } },
      );
  }
  ```

**`user-profile/index.ts::update_reply_permission`** (lines 1043-1059):

- Change `.select('user_id, allow_public_replies, account_privacy')` to `.select('user_id, username, display_name, bio, avatar_url, account_privacy, allow_public_replies')` — same shape as the other profile-update paths (line 985, 1036).

**`restaurant-history/index.ts`** (line 285):

- Replace `onNapkinQuery.not('id', 'in', \`(${visitedIds.join(',')})\`)` with `onNapkinQuery.not('id', 'in', `(${visitedIds.map(id => `"${id}"`).join(',')})`)` — actually the cleaner path in `@supabase/supabase-js@2.39.3` is building the filter string via PostgREST `in` operator directly: `query.filter('id', 'not.in', `(${visitedIds.join(',')})`)` works, but the safest portable form per PostgREST docs is still the parenthesized list. The real fix is to stop building a string — use two queries: fetch on-Napkin candidates unfiltered, then filter in JS via `!visitedSet.has(id)`. Row counts are bounded; JS filter is cheaper than string-injection concern. Commit as JS-side filter.

**`post-interactions/index.ts`**:

- Top-of-file doc comment listing trigger dependencies: `set_post_interaction_table_id` (denorms `table_id` from `entries` on insert), reaction count maintenance triggers (enumerate by grepping the migration files; add `20260418000000_post_interactions.sql`, `20260430000000_dual_scope_post_interactions.sql`, `20260430010000_public_scope_feed_only_support.sql` as references).

### Shared error envelope

**File: `/Users/jacky/Napkin/supabase/functions/_shared/errors.ts`** (new).

```ts
import { corsHeaders } from './cors.ts';

export type ErrorCode =
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'INVALID_INPUT'
    | 'METHOD_NOT_ALLOWED'
    | 'CONFLICT'
    | 'NOT_A_PARTICIPANT'
    | 'NOT_A_TABLE_MEMBER'
    | 'ROUND_NOT_RATING'
    | 'ALREADY_SUBMITTED'
    | 'NOT_OWNER'
    | 'NOT_MUTUAL_FOLLOW'
    | 'ATTENDEE_NOT_MEMBER'
    | 'DUPLICATE_SUBMISSION'
    | 'INTERNAL';

export interface EdgeErrorBody {
    error: { code: ErrorCode | string; message: string; details?: unknown };
}

export function errorResponse(code: ErrorCode | string, message: string, status: number, details?: unknown): Response {
    const body: EdgeErrorBody = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

/** Map Postgres SQLSTATE + RAISE EXCEPTION message to a canonical error code. */
export function mapPgError(err: { code?: string; message?: string }): { code: ErrorCode | string; status: number } {
    const m = (err.message ?? '').split(':')[0].trim().toUpperCase();
    switch (m) {
        case 'NOT_A_PARTICIPANT':
        case 'NOT_A_TABLE_MEMBER':
        case 'NOT_AUTHORIZED':
        case 'NOT_OWNER':
            return { code: m, status: 403 };
        case 'ROUND_NOT_RATING':
        case 'ALREADY_SUBMITTED':
        case 'ATTENDEE_NOT_MEMBER':
            return { code: m, status: 409 };
        default:
            return { code: 'INTERNAL', status: 500 };
    }
}
```

Every edge function (new and rewritten) returns errors through `errorResponse()`. Success shape remains `{ data }` (or `{ data, warnings }`).

### Client helper — `lib/edgeInvoke.ts`

**File: `/Users/jacky/Napkin/napkin-app/lib/edgeInvoke.ts`** (new).

```ts
export interface UnwrappedError {
    code: string;
    message: string;
    details?: unknown;
    status?: number;
}

/**
 * Unwrap supabase-js FunctionsHttpError into the canonical edge error envelope.
 * Falls back to the raw Error.message if the response body isn't the new shape.
 * Safe to call on any thrown value from `supabase.functions.invoke`.
 */
export async function unwrapInvokeError(err: unknown): Promise<UnwrappedError> {
    const status = (err as { context?: { status?: number } })?.context?.status;
    const ctx = (err as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
        try {
            const body = await ctx.json();
            // New shape: { error: { code, message, details? } }
            if (body?.error && typeof body.error === 'object' && body.error.code) {
                return { code: body.error.code, message: body.error.message ?? 'Unknown error', details: body.error.details, status };
            }
            // Legacy shape: { error: string }
            if (typeof body?.error === 'string') {
                return { code: 'LEGACY', message: body.error, status };
            }
        } catch {
            // fall through
        }
    }
    const message = err instanceof Error ? err.message : String(err);
    return { code: 'UNKNOWN', message, status };
}
```

**Hooks adopted in this ticket** (minimum): `useSubmitTake`, `useStartRound`, `useAddEntryPhoto`, `useReorderListEntry`, `useCreateEntry`, `useAddMember` (refactor to use the shared helper; keep `AddMemberError` but populate via `unwrapInvokeError`). The local copy in `hooks/restaurants/useRestaurantHistory.ts:29-40` is deleted and replaced with an import.

**Deferred to TICKET-039:** everything else (broad propagation to profile, wishlist, post-interactions, lists CRUD, etc.).

### Hook changes

| Hook | Change | Shape? |
|------|--------|--------|
| `hooks/tables/useSubmitTake.ts` | Response is now `{ entry_id, round_status, revealed }`. Update `return data?.data` type. Adopt `unwrapInvokeError`. | Yes (internal type) |
| `hooks/tables/useStartRound.ts` | Response is now `{ night_id, entry_id }`. Fetch full night after success if callers need status. Adopt helper. | Yes (internal) |
| `hooks/entries/useEntryPhotoMutations.ts::useAddEntryPhoto` | Replace the `.from('entry_photos').select().insert()` block with `supabase.rpc('append_entry_photo', { p_entry_id, p_user_id, p_photo_url })`. On rpc error, still run `removeUploadedPhoto(publicUrl)`. Adopt helper. | No external |
| `hooks/lists/useReorderListEntry.ts` | Drop `currentEntries`/`before_entry_id`/`after_entry_id` derivation. Body becomes `{ action: 'reorder_entry', list_id, entry_id, new_index }`. Optimistic update logic stays on the client. | Request shape changes |
| `hooks/tables/useTableNight.ts::useRoundContext` | Replace direct `supabase.from(...)` with `supabase.functions.invoke('table-night?action=round_context', { method: 'GET' })`. Return type becomes `{ nightId, participantCount, groupAverage, status }`. | Added `status` field |
| `hooks/tables/useAddMember.ts` | Swap local unwrap for `unwrapInvokeError`. `AddMemberError` now reads `.code` from the unwrapped body. | No — preserves `error_code` ergonomics |
| `hooks/users/useUpdateReplyPermission.ts` (exists? grep says yes, I'll confirm) | `onSuccess` uses `setQueryData(queryKeys.users.profile(viewerId), result)` with full profile row. | Response richer |
| `hooks/tables/useCreateEntry.ts` | Read `warnings` from response; if present, surface via toast. | New optional `warnings` field |
| `hooks/restaurants/useRestaurantHistory.ts` | Delete local `unwrapInvokeError`; import from `@/lib/edgeInvoke`. | No |

### Rollout / backwards compat

Breaking wire-shape changes requiring client + server to ship together:

- **`table-night?action=rate`** response changes from `{ data: participantRow }` to `{ data: { entry_id, round_status, revealed } }`. `useSubmitTake` must ship in the same deploy.
- **`table-night?action=start`** response changes from `{ data: nightRow }` to `{ data: { night_id, entry_id } }`. `useStartRound` same deploy.
- **`lists?action=reorder_entry`** request shape changes. `useReorderListEntry` same deploy.
- **`user-profile?action=update_reply_permission`** response shape grows (additive) — backwards compatible; old clients still find the fields they read.
- **`entry` POST** response gains optional `warnings` — additive, backwards compatible.

Deploy order: migrations first (`npx supabase db push` or per-file), then edge functions (`npx supabase functions deploy <name> --project-ref ftvmseaqwwlcxtdlvxxz`), then ship the mobile app build. Edge functions call the RPCs — if migrations haven't landed, the deploy will work but the rpc will 500 with `PGRST202 function not found`. Migrations ship first.

No feature flag needed — every breaking surface has exactly one client caller and we control both sides in-repo.

### Testing approach

Without a real test harness, exercise each invariant directly in staging:

1. **Transaction rollback (`rate_round`)** — in Supabase Studio SQL editor, temporarily rename `entry_photos` to `entry_photos_bak`. Submit a rate in the app. Expect: participant row still has `ready=false`, no entries row created, client surfaces an error. Rename back, resubmit, everything lands.
2. **Atomic reveal race** — Round with 3 holdouts. Open app on two devices logged in as two of them. Tap "submit" in both within the same second. Expect: exactly one round status transition to `revealed`, a single `revealed_at` timestamp, both entries exist. Grep logs for two simultaneous `rate_round` invocations resolving cleanly.
3. **Photo sort_order race** — on entry-detail, spam the add-photo button five times. Inspect `entry_photos` for that entry_id: five rows, `sort_order` 0..N unique, no unique-constraint errors in the logs, no orphaned storage files (check storage bucket listing).
4. **Companion failure** — insert a fake UUID into `companion_ids` payload via a quick script hitting the edge function directly; FK violation fires. Expect: entry row created, `warnings: [{ type: 'companion_tag_failed', failed_ids: ['…'] }]` in response, client toast shows.
5. **Reorder with stale cache** — open the same list on two devices. Device A drags item 2 to position 5. Device B (still showing old cache) drags item 4 to position 2. Refresh both. Positions are consistent with authoritative server state; no snap-back.
6. **Error unwrap** — `useAddMember` on a non-owner user: confirm UI branches on `AddMemberError.error_code === 'NOT_OWNER'` and renders the specific copy, not a generic message.
7. **`maybe_reveal_round`** — manually leave a participant stuck by setting `ready=true` directly on all-but-one participant, then delete that one from `table_night_participants`. Round is stuck. Hit the `nudge_reveal` action from a member account. Round transitions to `revealed`.

### Risks

- **`SECURITY DEFINER` + `search_path`**: the canonical template pins `SET search_path = public, pg_temp` and `REVOKE FROM PUBLIC` / `GRANT TO service_role`. Without both, a malicious temp schema or direct authenticated call could shadow functions the RPC depends on. Treated as non-negotiable in the template.
- **`entries.client_nonce` is a new column this ticket adds**, not something TICKET-036 depends on. If TICKET-036 slips, this is still safe (column is nullable, index is partial). Calling out because the ticket originally implied it existed.
- **`rate_round` holds row locks** via `FOR UPDATE OF p`. Long-running client submits (e.g., photo upload blocking the request) can queue up. Edge function should finish uploads before calling the RPC — confirmed in the current flow (photos are uploaded to storage first; only URLs pass in).
- **Breaking response shapes** on `rate` and `start`. One-shot migration — if an old app build hits the new server, the happy path still works (the app just reads `data` and invalidates caches) but any code that previously referenced `data.rating` or `data.status` on the response would break. A quick grep confirms `useSubmitTake` only checks truthiness and doesn't destructure; same for `useStartRound`. Safe.
- **RPC error → edge function translation**: if we don't call `mapPgError`, the client sees `{ error: 'INTERNAL' }` for every RPC failure including auth/validation. Every rewritten action must wrap the rpc call in try/catch → `mapPgError(err)` → `errorResponse(code, err.message, status)`.
- **`lists` server-authoritative reorder** can produce a position that doesn't match the client's optimistic splice if another user's reorder lands in between. Acceptable — client invalidates on settle and re-renders. Users reordering the same list concurrently is rare in Napkin (lists are personal or Table-scoped with one writer at a time).
- **`post-interactions` trigger dep doc is text-only**. No enforcement. Acceptable — the goal is to surface the invariant in code review, not make the trigger un-droppable.

---

## Build Log

### Files Created
- `supabase/migrations/20260502000000_entries_add_client_nonce.sql` — partial unique index on `(user_id, client_nonce)`
- `supabase/migrations/20260502000100_rpc_rate_round.sql` — `rate_round` RPC, SECURITY DEFINER, REVOKE/GRANT/COMMENT
- `supabase/migrations/20260502000200_rpc_start_round.sql` — `start_round` RPC
- `supabase/migrations/20260502000300_rpc_maybe_reveal_round.sql` — `maybe_reveal_round` RPC
- `supabase/migrations/20260502000400_rpc_append_entry_photo.sql` — `append_entry_photo` RPC
- `supabase/functions/_shared/errors.ts` — `errorResponse`, `mapPgError`, `ErrorCode` type
- `napkin-app/lib/edgeInvoke.ts` — `unwrapInvokeError` client helper

### Files Modified
- `supabase/functions/table-night/index.ts` — `rate` and `start` rewritten to call RPCs; new `nudge_reveal` and `round_context` actions; all `.single()` destructure `error`; `errorResponse` throughout
- `supabase/functions/entry/index.ts` — `append_entry_photo` action; companion dedupe excludes `participant_ids`; companion insert failure in `warnings[]`; `client_nonce` duplicate-submission stub
- `supabase/functions/lists/index.ts` — `reorder_entry` accepts `new_index` (server-authoritative); legacy `before/after_entry_id` still accepted
- `supabase/functions/places-search/index.ts` — POST-only method guard (405)
- `supabase/functions/user-profile/index.ts` — `update_reply_permission` returns full profile shape
- `supabase/functions/restaurant-history/index.ts` — JS-side filter replaces string-joined UUID NOT IN
- `supabase/functions/post-interactions/index.ts` — trigger dependency doc comment
- `napkin-app/hooks/entries/useEntryPhotoMutations.ts` — `useAddEntryPhoto` calls `entry?action=append_entry_photo`; adopts `unwrapInvokeError`
- `napkin-app/hooks/lists/useReorderListEntry.ts` — sends `new_index` only; drops `before/after` client derivation
- `napkin-app/hooks/tables/useTableNight.ts` — `useRoundContext` routes through edge function; `RoundContext` gains `status` field; imports `unwrapInvokeError`
- `napkin-app/hooks/tables/useSubmitTake.ts` — typed `SubmitTakeResult` (`entry_id, round_status, revealed`); adopts `unwrapInvokeError`
- `napkin-app/hooks/tables/useStartRound.ts` — adopts `unwrapInvokeError`
- `napkin-app/hooks/tables/useAddMember.ts` — swaps local unwrap for shared `unwrapInvokeError`; preserves `AddMemberError.error_code`
- `napkin-app/hooks/tables/useCreateEntry.ts` — reads `warnings` from response; toast on `companion_tag_failed`
- `napkin-app/hooks/users/useUpdateReplyPermission.ts` — `onSuccess` uses `setQueryData` with full profile row
- `napkin-app/hooks/restaurants/useRestaurantHistory.ts` — local `unwrapInvokeError` replaced with dynamic import of shared helper

### Tests
- `npx tsc --noEmit`: 4 errors, all pre-existing (none in files this ticket touches)
- Deno test suite: 38 steps pass, 0 failed (all pre-existing tests)

### Deviations from Technical Design
- `useRestaurantHistory.ts`: replaced the local `unwrapInvokeError` with a dynamic import of the shared helper rather than a static import. Dynamic import avoids a potential circular dependency at module load time (the file is `hooks/restaurants/` and `edgeInvoke` is `lib/`; no actual cycle but dynamic import keeps the pattern explicit). If the architect prefers a static import, that's a one-line change.
- `useCreateEntry` warning propagation: mutationFn still returns the raw entry row (for backwards compat with `FastLogForm.tsx` calling `result?.id`). Warnings are stashed as `__warnings` on the returned object and read in `onSuccess`. A cleaner approach would be a `{ data, warnings }` wrapper type, but that requires updating `FastLogForm.tsx`. Flagged as a minor tech-debt item — no acceptance criteria touched.

## Builder Questions
- The ticket says to promote `useRestaurantHistory`'s local `unwrapInvokeError` "verbatim" to `lib/edgeInvoke.ts`. The local version returned `Error` (not `UnwrappedError`), while the canonical design uses `UnwrappedError`. I used the canonical design from the ticket's Technical Design section rather than the local copy verbatim — the local copy is a simpler wrapper that would have lost the `code` field. Confirm this is correct.
- `maybe_reveal_round` migration: the SQL for `array_length(v_invalid, 1) > 0` in `start_round` — Postgres returns NULL for `array_length` on an empty array, not 0. The guard `v_invalid IS NOT NULL AND array_length(v_invalid, 1) > 0` is defensive; please confirm.

Ready for review.

## Architect Answers

**Q1 — `unwrapInvokeError` signature (`Error` vs `UnwrappedError`):**
Correct call. The canonical shared helper returns `UnwrappedError` by design — the whole point of TICKET-037 is to preserve `code` so callers can branch (e.g. `useAddMember` uses `AddMemberError.error_code`). Collapsing back to `Error` in the local wrapper would have defeated the promotion. Ship as written.

**Q2 — `useRestaurantHistory` dynamic import:**
No circular dep risk. `lib/edgeInvoke.ts` has zero imports — it's a pure leaf module, and the other six consumers (`useSubmitTake`, `useStartRound`, `useAddMember`, `useTableNight`, `useEntryPhotoMutations`, `useReorderListEntry`) all use static imports. Dynamic import was unnecessary and inconsistent. **Fixed in place**: converted to `import { unwrapInvokeError } from '@/lib/edgeInvoke'` at the top of the file, and rewrapped the two call sites to `const unwrapped = await unwrapInvokeError(error); throw new Error(unwrapped.message);` to preserve the existing `throw Error` contract these two fetchers already had.

**Q3 — `array_length` guard in `start_round` migration:**
The guard `v_invalid IS NOT NULL AND array_length(v_invalid, 1) > 0` is correct and idiomatic. You're right that `array_length(arr, 1)` returns NULL on an empty array, and `NULL > 0` is NULL (falsy in `IF`), so `array_length(v_invalid, 1) > 0` alone would also work. The `IS NOT NULL` is redundant here because `COALESCE(array_agg(a), '{}')` guarantees non-null — but it's harmless and self-documenting. No change needed. Ship as-is.

**Deviation on `useCreateEntry` warnings:**
The `__warnings` stash is tech debt but acceptable for this ticket. File a follow-up to convert to a `{ data, warnings }` wrapper when `FastLogForm.tsx` is next touched.
