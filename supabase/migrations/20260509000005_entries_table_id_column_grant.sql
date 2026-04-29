-- TICKET-043: column-level grant — revoke direct-client SELECT of entries.table_id.
-- Service-role (edge fns) keep full access. Direct-client supabase-js callers
-- that select `*` or `table_id` from entries will receive null for that column
-- (PostgREST silently masks revoked columns with null).
--
-- Why this is required even though entry_tables RLS exists:
-- can_view_entry_v2 admits a B-only viewer to read the entries row (because the
-- row has Table B attached via entry_tables). Without this column-level revoke,
-- they would see entries.table_id = A (legacy primary). Column-level revocation
-- is the only mechanism that prevents that field from appearing in the response.
--
-- IMPORTANT: All supabase-js callsites that previously selected table_id from
-- entries have been remediated in this same PR (Group C in Implementation Order):
--   - app/entry-detail.tsx lines 126, 160
--   - hooks/entries/useUpdateEntry.ts line 60+
--   - hooks/entries/useMySoloEntries.ts (switched to fn_my_solo_entries RPC)
--
-- Addresses [ARCH-REVIEW] finding 1.

REVOKE SELECT (table_id) ON public.entries FROM authenticated;

-- Belt-and-suspenders: explicit positive grants for the columns that DO stay
-- accessible. Listing them keeps the grant set obvious to future readers.
-- If schema drift adds a new column, it won't be accessible until listed here.
GRANT SELECT (
    id,
    user_id,
    restaurant_id,
    place_id,
    user_place_id,
    rating,
    content,
    dish_description,
    cooked_by,
    value_profile,
    visited_at,
    created_at,
    updated_at,
    table_night_id,
    visibility,
    vibe_rating,
    flavor_rating,
    service_rating,
    value_rating,
    photo_url,
    client_nonce,
    reaction_count,
    comment_count,
    top_emojis,
    public_reaction_count,
    public_reply_count,
    public_top_emojis
) ON public.entries TO authenticated;

-- Service-role unchanged (already has GRANT ALL from initial schema).

COMMENT ON COLUMN public.entries.table_id IS
    'TICKET-043: legacy primary Table reference. SELECT revoked from authenticated; '
    'service-role only. Source of truth for "which Tables is this entry in" is entry_tables. '
    'Drop scheduled in follow-up ticket once all readers consume entry_tables.';
