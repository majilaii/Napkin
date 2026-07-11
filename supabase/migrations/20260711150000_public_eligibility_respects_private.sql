-- TICKET-173 — is_entry_publicly_eligible respects visibility='private'
-- (founder verdict 2026-07-11, doctrine-locked).
--
-- The public-review SSOT gated on account_privacy + rating + ≥20 trimmed chars
-- and NEVER read entries.visibility — so entries the author marked 'private'
-- were served on every public surface (restaurant Voices, /restaurant-reviews,
-- profile reviews, post-interaction gates) while TICKET-034 correctly hid the
-- same entries from tablemates. Prod audit 2026-07-11: 7 rows exposed
-- (4 private / 3 table, 2 authors).
--
-- Verdict: 'private' hides EVERYWHERE. 'table'-shared review content on public
-- accounts REMAINS publicly eligible (2026-04-17 doctrine: review content +
-- public profile = the public expression layer; prod carries no 'public'
-- visibility value — ring-scoping 'table' would zero the layer).
--
-- `e.visibility <> 'private'` fails CLOSED on NULL (NULL <> 'private' is NULL
-- → not eligible): an unset visibility can never leak publicly.
--
-- COMPLETENESS AUDIT (TICKET-173) — every public read path that serves entry
-- review CONTENT to non-ring viewers was enumerated and classified. The SSOT was
-- the ONLY public path missing the visibility guard; no cross-patch is required.
--
--   (a) SSOT consumers — inherit this fix automatically:
--       • post_reactions_select_public / post_comments_select_public /
--         post_comments_insert_public RLS (20260430000000:90/123/138 — each
--         calls is_entry_publicly_eligible(target_id))
--       • get_public_reviews        (20260430010000 — restaurant Voices)
--       • get_public_reviews_page   (20260710130000 — all-reviews page)
--
--   (b) Inline re-implementations — audited, each ALREADY carries
--       `visibility <> 'private'` independently (written later off the TICKET-092
--       diary-base predicate), so nothing to patch here:
--       • can_view_entry Branch 4   (20260707172000 — entry-detail RLS public branch)
--       • fn_public_eligible_entries(20260704120000 — friends feed / fn_friends_feed)
--       • fn_network_map_pins       (20260707171000 — network map)
--       • fn_user_diary_page        (20260704200000 — profile diary + reviews;
--                                    gated `p_include_private OR visibility<>'private'`,
--                                    caller passes include_private = isSelf)
--       (restaurant-history's aggregate distribution + photo pool and the Ring-2
--        calibration helper filter private TS-side via .neq('visibility','private').)
--
--   (c) Out of scope — NON-entry semantics or ring-only: fn_restaurant_saves_visible
--       (saves doctrine), fn_search_public_lists (list curation), user/profile
--       top-4 read policies, fn_user_taste (owner-only aggregate), table-activity
--       feeds & can_view_entry Branch 2 (tablemate ring — a private entry carries
--       no entry_tables row, so TICKET-034 already hides it there).
--
-- Body otherwise byte-identical to 20260430000000.

CREATE OR REPLACE FUNCTION is_entry_publicly_eligible(p_entry_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT EXISTS (
        SELECT 1
        FROM entries e
        JOIN profiles p ON p.user_id = e.user_id
        WHERE e.id = p_entry_id
          AND p.account_privacy = 'public'
          AND e.visibility <> 'private'
          AND e.rating IS NOT NULL
          AND char_length(trim(COALESCE(e.content, ''))) >= 20
    );
$$;

-- ── Adjacent hardening (same verdict, dual-review cycle 1) ──────────────────
-- The entry-photos bucket is PUBLIC (20260416100000) and carried a blanket
-- storage.objects SELECT policy — which public-URL serving does not need
-- (public buckets bypass RLS for /object/public/), but which let ANY caller
-- LIST/enumerate the bucket via the Storage API. The app performs only
-- upload / getPublicUrl / remove (verified: no .list(), no .download()), so
-- dropping the policy removes anonymous enumeration with zero behavior change.
-- Full private-photo protection (signed URLs, URL migration) = TICKET-174.
DROP POLICY IF EXISTS "Public read entry-photos" ON storage.objects;
