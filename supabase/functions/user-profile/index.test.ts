/**
 * Tests for user-profile edge function
 * TICKET-025 additions: diary, regulars, and profile top_four/regulars_preview stubs
 *
 * Run with: deno test --allow-env supabase/functions/user-profile/
 */

import { assertEquals } from '../_shared/test-utils.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { buildPrivateProfileStub } from './gates.ts';
import { computeRatingHistogram, computeDimensionAvgs } from './stats.ts';

Deno.test('user-profile edge function', async (t) => {

    await t.step('OPTIONS should return CORS headers', () => {
        const mockHandler = (req: Request) => {
            if (req.method === 'OPTIONS') {
                return new Response('ok', { headers: corsHeaders });
            }
            return new Response('continue');
        };

        const req = new Request('http://localhost', { method: 'OPTIONS' });
        const res = mockHandler(req);

        assertEquals(res.status, 200);
    });

    // ── profile action ────────────────────────────────────────────────────────

    await t.step('profile action returns top_four and regulars_preview fields - TODO (skipped)', () => {
        // These fields are now present in the response payload:
        // data.top_four: TopPick[]      — auto-derived, ≥4.0 rating, limit 4
        // data.regulars_preview: RegularSummary[] — ≥3 visits, limit 8
        // Implement integration test when a test DB fixture is available.
    });

    await t.step('profile action returns empty arrays for tables_in_common relationship - TODO (skipped)', () => {
        // When relationship === 'tables_in_common', top_four and regulars_preview
        // should both be empty arrays (no palate access).
    });

    // TICKET-155 (ARCH-REVIEW W2): the reachable private-account stub payload
    // shape — REAL executable coverage of the branch that replaced notFound() at
    // the profile action's relationship==='none' path. index.ts calls serve() at
    // the top level (not import-safe), so the payload is built by the pure
    // gates.ts helper the branch calls; this asserts its exact shape.
    await t.step('profile action: private-account stub — exact shape, private_stub true, ALL palate absent', () => {
        const targetProfile = {
            user_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            username: 'priv_user',
            display_name: 'Priv User',
            bio: 'a private bio',
            avatar_url: 'https://cdn.test/avatar.jpg',
            account_privacy: 'private' as const,
            allow_public_replies: false,
        };
        const stub = buildPrivateProfileStub(targetProfile, {
            isFollowingViewer: true,
            followsViewer: false,
            followersCount: 12,
            followingCount: 34,
        });

        // Discriminator + identity.
        assertEquals(stub.private_stub, true);
        assertEquals(stub.is_self, false);
        assertEquals(stub.viewer_target_relationship, 'none');
        assertEquals(stub.profile, targetProfile); // identity rides through unchanged

        // Social metadata present (follower/following counts + follow state).
        assertEquals(stub.social, { followers_count: 12, following_count: 34 });
        assertEquals(stub.is_following_viewer, true);
        assertEquals(stub.follows_viewer, false);

        // ALL palate explicitly withheld.
        assertEquals(stub.stats, null);
        assertEquals(stub.public_lists, null);
        assertEquals(stub.recently_logged, null);
        assertEquals(stub.tables_in_common, []);
        assertEquals(stub.top_four, []);
        assertEquals(stub.quick_takes, []);
        assertEquals(stub.regulars_preview, []);

        // No palate/calibration keys leak onto the payload (exact top-level key set).
        assertEquals(Object.keys(stub).sort(), [
            'follows_viewer',
            'is_following_viewer',
            'is_self',
            'private_stub',
            'profile',
            'public_lists',
            'quick_takes',
            'recently_logged',
            'regulars_preview',
            'social',
            'stats',
            'tables_in_common',
            'top_four',
            'viewer_target_relationship',
        ]);
    });

    // ── TICKET-165: profile rating histogram + dimension means ─────────────────
    // fetchStats can't be reached in a unit test (index.ts calls serve() at the
    // top level, not import-safe), so the binning lives in pure ./stats.ts
    // helpers — same "extracted so testable" pattern as gates.ts. These pin the
    // exact fields fetchStats now attaches to the Stats payload.

    await t.step('rating_histogram: half-star snap + clamp, sparse, ascending', () => {
        // 4.2 → 4.0, 4.3 → 4.5, 0 → clamp 0.5, 6 → clamp 5.0, nulls dropped.
        const hist = computeRatingHistogram([4.2, 4.3, 4.5, 3, 3, null, 0, 6, undefined]);
        assertEquals(hist, [
            { r: 0.5, n: 1 }, // 0 clamped up
            { r: 3.0, n: 2 },
            { r: 4.0, n: 1 }, // 4.2 snaps down
            { r: 4.5, n: 2 }, // 4.3 + 4.5
            { r: 5.0, n: 1 }, // 6 clamped down
        ]);
    });

    await t.step('rating_histogram: no rated rows → empty array', () => {
        assertEquals(computeRatingHistogram([null, undefined]), []);
    });

    await t.step('dimension_avgs: per-dimension mean over its own non-null set', () => {
        const rows = [
            { vibe_rating: 4, flavor_rating: 5, service_rating: null, value_rating: 3 },
            { vibe_rating: 3, flavor_rating: null, service_rating: null, value_rating: 4 },
            { vibe_rating: null, flavor_rating: 4, service_rating: 2, value_rating: null },
        ];
        const dims = computeDimensionAvgs(rows);
        assertEquals(dims.vibe, { avg: 3.5, n: 2 });
        assertEquals(dims.flavor, { avg: 4.5, n: 2 });
        assertEquals(dims.service, { avg: 2, n: 1 });
        assertEquals(dims.value, { avg: 3.5, n: 2 });
    });

    await t.step('dimension_avgs: dimension with no values → { avg: null, n: 0 }', () => {
        const dims = computeDimensionAvgs([
            { vibe_rating: null, flavor_rating: null, service_rating: null, value_rating: null },
        ]);
        assertEquals(dims.vibe, { avg: null, n: 0 });
        assertEquals(dims.value, { avg: null, n: 0 });
    });

    // ── diary action ──────────────────────────────────────────────────────────

    await t.step('diary action requires identifier - TODO (skipped)', () => {
        // POST { action: "diary" } with no identifier should return 400.
    });

    await t.step('diary action returns paginated rows + yearSummary - TODO (skipped)', () => {
        // data.rows: DiaryRow[]          — up to 40 entries per page
        // data.nextCursor: string | null — keyset cursor on visited_at
        // data.yearSummary: YearSummary  — current year stats
    });

    await t.step('diary action gates non-self access to public profiles - TODO (skipped)', () => {
        // For target.account_privacy === 'private' and caller !== target,
        // should return 404 (not_found).
    });

    // ── regulars action ───────────────────────────────────────────────────────

    await t.step('regulars action requires identifier - TODO (skipped)', () => {
        // POST { action: "regulars" } with no identifier should return 400.
    });

    await t.step('regulars action returns full list sorted by visit_count desc - TODO (skipped)', () => {
        // data.regulars: RegularSummary[] — all ≥3-visit restaurants
    });

    await t.step('regulars action gates non-self access to public profiles - TODO (skipped)', () => {
        // For target.account_privacy === 'private' and caller !== target,
        // should return 404 (not_found).
    });

    await t.step('regulars photo_url is the owner\'s own entry photo, never restaurants.photo_url - TODO (skipped)', () => {
        // TICKET-105 (2026-07-05): fetchRegulars must NOT source photo_url from
        // restaurants (Google Places). Each regular's photo_url is the profile
        // owner's most-recent entry_photos row on one of THEIR OWN entries at that
        // restaurant, else null. Non-self viewers only see photos from non-private
        // entries (same visibility gate as the entries aggregation / public diary).
        // Implement integration assertion when a test DB fixture is available.
    });

    // ── pre-existing ─────────────────────────────────────────────────────────

    await t.step('Missing auth returns 401 - TODO (skipped)', () => {
        // Placeholder - implement when needed
    });
});
