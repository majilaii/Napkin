/**
 * Edge function smoke tests — happy-path call per (function, action).
 *
 * Why this exists:
 *   The TICKET-043 PGRST201 fire on 2026-04-30 took two days to detect because
 *   no test exercised the deployed edge function against the deployed schema.
 *   Mocked unit tests passed; reality was 500ing. This script closes that gap.
 *
 * What it does:
 *   For every endpoint listed in CHECKS, hit the deployed edge function on
 *   the configured Supabase project, send a minimal valid request, assert
 *   HTTP 200 and a shape sniff. Fail fast on the first 500 / PGRST201 /
 *   "function does not exist" / shape mismatch.
 *
 * What it does NOT do:
 *   Full integration coverage. Auth flows. Mutation semantics. Just enough
 *   to surface a deploy that broke a basic read path.
 *
 * Required env (read at runtime, not build):
 *   SUPABASE_URL              — e.g. https://<ref>.supabase.co
 *   SUPABASE_ANON_KEY         — anon key for the same project
 *   SMOKE_TEST_RESTAURANT_ID  — UUID of a seeded restaurant on the project
 * Auth (one of, checked in order):
 *   SMOKE_TEST_JWT            — a pre-minted test-user access token
 *   SMOKE_TEST_EMAIL + SMOKE_TEST_PASSWORD — smoke-user credentials; the script
 *       signs in at runtime (TICKET-091 — JWTs expire hourly, so static-JWT
 *       secrets rot; password sign-in gives CI a fresh token every run).
 * Optional env:
 *   SMOKE_TEST_ENTRY_ID       — overrides the runtime-discovered entry id for
 *       the post-interactions check (must be a public-eligible entry of the
 *       smoke user). Unset in CI — TICKET-121 self-discovers from the smoke
 *       user's reviews instead.
 *   PLACES_SMOKE=1            — enables the places-search check (REAL Google
 *       Places cost). Set only by prod-deploy.yml's smoke step, never by the
 *       scheduled smoke.
 *
 * Run locally:
 *   deno run --allow-env --allow-net scripts/smoke/edge-functions.ts
 *
 * Run in CI: see .github/workflows/prod-deploy.yml.
 */

type Check = {
    name: string;
    method: 'GET' | 'POST';
    fn: string;
    /** Query string (without leading ?) or null. */
    query?: string;
    /** JSON body for POST. */
    body?: unknown;
    /** Expected HTTP status. Defaults to 200. */
    expectedStatus?: number;
    /** Skip Authorization + apikey headers (for public endpoints). */
    noAuth?: boolean;
    /** Optional shape sniff on parsed JSON (only for JSON responses). */
    shape?: (json: unknown) => string | null;
    /** Optional shape sniff on raw text + Content-Type (for non-JSON responses). */
    rawShape?: (body: string, contentType: string) => string | null;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const RESTAURANT_ID = Deno.env.get('SMOKE_TEST_RESTAURANT_ID');
// Optional OVERRIDE for the post-interactions read-path guard (TICKET-121):
// must be a public-eligible entry of the smoke user. Unset in CI — the guard
// self-discovers a fixture entry from the smoke user's reviews at runtime,
// so the check always runs (it was inert for weeks when it depended on this
// env being seeded).
const ENTRY_ID = Deno.env.get('SMOKE_TEST_ENTRY_ID');

function requireEnv(name: string, val: string | undefined): string {
    if (!val) {
        console.error(`✗ missing env: ${name}`);
        Deno.exit(2);
    }
    return val;
}

requireEnv('SUPABASE_URL', SUPABASE_URL);
requireEnv('SUPABASE_ANON_KEY', ANON_KEY);
requireEnv('SMOKE_TEST_RESTAURANT_ID', RESTAURANT_ID);

// ── Auth: static JWT, or password sign-in for a runtime-fresh token ─────────
async function resolveJwt(): Promise<string> {
    const staticJwt = Deno.env.get('SMOKE_TEST_JWT');
    if (staticJwt) return staticJwt;

    const email = Deno.env.get('SMOKE_TEST_EMAIL');
    const password = Deno.env.get('SMOKE_TEST_PASSWORD');
    if (!email || !password) {
        console.error('✗ missing auth: set SMOKE_TEST_JWT, or SMOKE_TEST_EMAIL + SMOKE_TEST_PASSWORD');
        Deno.exit(2);
    }

    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY! },
        body: JSON.stringify({ email, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.access_token) {
        console.error(`✗ smoke-user sign-in failed (HTTP ${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
        Deno.exit(2);
    }
    return json.access_token as string;
}

const JWT = await resolveJwt();

/** The smoke user's own id, from the JWT sub claim — some checks self-target. */
function jwtSub(jwt: string): string {
    try {
        const payload = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const sub = JSON.parse(atob(payload))?.sub;
        if (typeof sub === 'string' && sub) return sub;
    } catch { /* fall through */ }
    console.error('✗ could not decode JWT sub claim');
    Deno.exit(2);
}

const SMOKE_USER_ID = jwtSub(JWT);

// ── Checks ─────────────────────────────────────────────────────────────────
//
// Add one entry per (function, action) you want guarded. Keep this list small
// and high-signal: any read path whose breakage would block the app for users.
// Mutations are out of scope (would require seed cleanup) — read paths catch
// 90% of schema/embed/contract drift for ~zero maintenance cost.

const CHECKS: Check[] = [
    // Boot check only: an SSRF-rejected URL exercises module load + routing +
    // the validation path without touching Google/Places. A broken import in
    // the resolver (maps-list import, TICKET pending) turns this into a 500.
    {
        name: 'resolve-url (boot + validation path, no upstream)',
        method: 'POST',
        fn: 'resolve-url',
        body: { url: 'http://localhost/nope' },
        expectedStatus: 400,
        shape: (json) => {
            const code = (json as { error?: { code?: string } }).error?.code;
            if (code !== 'INVALID_URL') return `expected error.code INVALID_URL, got ${code}`;
            return null;
        },
    },
    {
        name: 'restaurant-history?action=page (the one that 500d on 2026-04-30)',
        method: 'GET',
        fn: 'restaurant-history',
        query: `action=page&restaurant_id=${RESTAURANT_ID}`,
        shape: (json) => {
            const data = (json as { data?: { restaurant?: unknown; visits?: unknown[] } }).data;
            if (!data) return 'missing data envelope';
            if (!('restaurant' in data)) return 'missing data.restaurant';
            if (!('visits' in data)) return 'missing data.visits';
            return null;
        },
    },
    // TICKET-154: paginated public reviews (all-reviews page). Empty rows is a
    // legitimate state for the fixture — assert the Page envelope shape.
    {
        name: 'restaurant-history?action=reviews (TICKET-154 all-reviews page)',
        method: 'POST',
        fn: 'restaurant-history',
        // restaurant_id mirrored in query (clients do the same) — the fn has a
        // global query-param guard; body remains the canonical carrier.
        query: `action=reviews&restaurant_id=${RESTAURANT_ID}`,
        body: { restaurant_id: RESTAURANT_ID, limit: 5 },
        shape: (json) => {
            const data = (json as { data?: { rows?: unknown[]; has_more?: unknown } }).data;
            if (!data) return 'missing data envelope';
            if (!Array.isArray(data.rows)) return 'data.rows is not an array';
            if (typeof data.has_more !== 'boolean') return 'data.has_more is not a boolean';
            return null;
        },
    },
    // TICKET-156: On Socials rail read path (social clippings). Calls TICKET-155's
    // block-aware saves predicate + joins the clip_thumbs cache. An empty rows
    // array is the legitimate state for the smoke user (no visible social saves) —
    // assert the { rows: [] } envelope shape only. restaurant_id mirrored in the
    // query (the fn has a global query-param guard; body is the canonical carrier).
    {
        name: 'restaurant-history?action=social_clippings (TICKET-156 On Socials rail)',
        method: 'POST',
        fn: 'restaurant-history',
        query: `action=social_clippings&restaurant_id=${RESTAURANT_ID}`,
        body: { restaurant_id: RESTAURANT_ID },
        shape: (json) => {
            const data = (json as { data?: { rows?: unknown[] } }).data;
            if (!data) return 'missing data envelope';
            if (!Array.isArray(data.rows)) return 'data.rows is not an array';
            return null;
        },
    },
    // TICKET-149: booking-page resolver behind the Reserve pill. Value is
    // fixture-dependent (usually null, cached on the row after first run) —
    // assert the envelope key only.
    {
        name: 'restaurant-history?action=reserve_link (TICKET-149 Reserve pill)',
        method: 'GET',
        fn: 'restaurant-history',
        query: `action=reserve_link&restaurant_id=${RESTAURANT_ID}`,
        shape: (json) => {
            const data = (json as { data?: Record<string, unknown> }).data;
            if (!data) return 'missing data envelope';
            if (!('reserve_url' in data)) return 'missing data.reserve_url';
            return null;
        },
    },
    // TICKET-098: feed-friends replaces the deleted legacy `feed` fn. Page
    // envelope check — an empty rows array is a legitimate zero-follow state.
    {
        name: 'feed-friends (TICKET-098 friends-only reviews feed)',
        method: 'POST',
        fn: 'feed-friends',
        body: { limit: 5 },
        shape: (json) => {
            const data = (json as { data?: { rows?: unknown[]; has_more?: unknown } }).data;
            if (!data) return 'missing data envelope';
            if (!Array.isArray(data.rows)) return 'data.rows is not an array';
            if (typeof data.has_more !== 'boolean') return 'data.has_more is not a boolean';
            return null;
        },
    },
    {
        name: 'user-profile?action=profile (own profile)',
        // POST-only fn (405s GET); identifier = the smoke user itself, decoded
        // from the JWT sub claim at runtime (works for both auth modes).
        method: 'POST',
        fn: 'user-profile',
        body: { action: 'profile', identifier: '__SMOKE_USER_ID__' },
        shape: (json) => {
            const data = (json as { data?: { profile?: unknown; is_self?: boolean } }).data;
            if (!data) return 'missing data envelope';
            if (!data.profile) return 'missing data.profile';
            if (data.is_self !== true) return 'expected is_self=true for own profile';
            return null;
        },
    },
    // TICKET-150: taste drill-in v2 — exercises fn_user_taste (histogram +
    // junk-filtered, disjoint cuisine lists) end-to-end. Owner-only action, so
    // the identifier is the smoke user itself. Zero rated meals is a legitimate
    // state — assert envelope keys + types only.
    {
        name: 'user-profile?action=taste (TICKET-150 fn_user_taste v2)',
        method: 'POST',
        fn: 'user-profile',
        body: { action: 'taste', identifier: '__SMOKE_USER_ID__' },
        shape: (json) => {
            const data = (json as {
                data?: {
                    entry_count?: unknown;
                    top_cuisines?: unknown;
                    bottom_cuisines?: unknown;
                    rating_histogram?: unknown;
                };
            }).data;
            if (!data) return 'missing data envelope';
            if (typeof data.entry_count !== 'number') return 'data.entry_count is not a number';
            if (!Array.isArray(data.top_cuisines)) return 'data.top_cuisines is not an array';
            if (!Array.isArray(data.bottom_cuisines)) return 'data.bottom_cuisines is not an array';
            if (!Array.isArray(data.rating_histogram)) return 'data.rating_histogram is not an array';
            return null;
        },
    },
    {
        // TICKET-144 pt2: chosen-memory hero picker (self-only own photos). An
        // empty photos array is legit (the smoke user has no photos there).
        name: 'top-fours?action=my_restaurant_photos (TICKET-144 pt2 hero picker)',
        method: 'POST',
        fn: 'top-fours',
        body: { action: 'my_restaurant_photos', restaurant_id: RESTAURANT_ID },
        shape: (json) => {
            const data = (json as { data?: { photos?: unknown[] } }).data;
            if (!data) return 'missing data envelope';
            if (!Array.isArray(data.photos)) return 'data.photos is not an array';
            return null;
        },
    },
    {
        name: 'notifications?action=inbox',
        method: 'POST',
        fn: 'notifications',
        body: { action: 'inbox', limit: 5 },
        shape: (json) => {
            const data = (json as { data?: { rows?: unknown[] } }).data;
            if (!data) return 'missing data envelope';
            if (!Array.isArray(data.rows)) return 'data.rows is not an array';
            return null;
        },
    },
    // TICKET-060: wishlist list_personal smoke — verifies the import_jobs join
    // added in TICKET-060 (extraction_status + job_id columns) doesn't 500.
    // This endpoint is the read path for pending/needs_confirm cards in the wishlist.
    //
    // NOTE (N9 — deploy-time requirement):
    //   Both ANTHROPIC_API_KEY and INTERNAL_CALL_SECRET must be set in Supabase
    //   secrets before the extraction pipeline is live. If INTERNAL_CALL_SECRET is
    //   unset, every async extract call 401s and jobs stay pending forever.
    //   Set both via:
    //     npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... \
    //       INTERNAL_CALL_SECRET=$(openssl rand -hex 32) \
    //       --project-ref ftvmseaqwwlcxtdlvxxz
    {
        name: 'wishlist?action=list_personal (TICKET-060 import_jobs join)',
        method: 'POST',
        fn: 'wishlist',
        body: { action: 'list_personal', limit: 5 },
        shape: (json) => {
            const data = (json as { data?: unknown }).data;
            if (!data) return 'missing data envelope';
            return null;
        },
    },
    // TICKET-082: entry?action=supper-detail smoke. A bogus supper_id the caller
    // is not a member of → HTTP 404 (membership gate) with a JSON error envelope.
    // This exercises the new GET read path: the function parses, hits the suppers /
    // supper_members schema (catches a missing-table / column-grant / embed drift),
    // and the membership gate denies a non-member. We assert 404 (not 200) because a
    // random UUID is never a supper the SMOKE_TEST_JWT user belongs to. A 500 here
    // would mean the schema or query drifted — exactly what this guard catches.
    {
        name: 'entry?action=supper-detail bogus id → 404 membership gate (TICKET-082)',
        method: 'GET',
        fn: 'entry',
        query: 'action=supper-detail&supper_id=00000000-0000-0000-0000-000000000000',
        expectedStatus: 404,
        shape: (json) => {
            const err = (json as { error?: { code?: string } }).error;
            if (!err) return 'missing error envelope';
            if (err.code !== 'NOT_FOUND') return `expected error.code NOT_FOUND, got ${err.code}`;
            return null;
        },
    },
    // TICKET-136: gatherings action=get bogus id → HTTP 404 (missing-row / not-found
    // gate). Mirrors the supper-detail bogus-id smoke: a random UUID is never a
    // gathering the SMOKE_TEST_JWT user can read, so the single-row read path
    // (parse + gatherings/gathering_rsvps/table_members/profiles schema hits) is
    // exercised and the missing row denies with NOT_FOUND. A 500 here means the
    // read assembly or a table/column drifted — exactly what this guard catches.
    {
        name: 'gatherings?action=get bogus id → 404 not-found gate (TICKET-136)',
        method: 'POST',
        fn: 'gatherings',
        body: { action: 'get', gathering_id: '00000000-0000-0000-0000-000000000000' },
        expectedStatus: 404,
        shape: (json) => {
            const err = (json as { error?: { code?: string } }).error;
            if (!err) return 'missing error envelope';
            if (err.code !== 'NOT_FOUND') return `expected error.code NOT_FOUND, got ${err.code}`;
            return null;
        },
    },
    // TICKET-133: respond_invitation read-safe guard. A bogus invitation id →
    // HTTP 404 (invitation not found). This exercises the new POST action's
    // routing + the table_invitations read path post-migration (catches a
    // missing-table / column / RLS drift), like the supper-detail guard. The
    // mutation branches (accept/decline) never run — the row doesn't exist.
    // table-management uses the flat { error, error_code } envelope, so we
    // assert only that an error field is present.
    {
        name: 'table-management?action=respond_invitation bogus id → 404 (TICKET-133)',
        method: 'POST',
        fn: 'table-management',
        query: 'action=respond_invitation',
        body: {
            action: 'respond_invitation',
            invitation_id: '00000000-0000-0000-0000-000000000000',
            response: 'decline',
        },
        expectedStatus: 404,
        shape: (json) => {
            const err = (json as { error?: unknown }).error;
            if (!err) return 'missing error envelope';
            return null;
        },
    },
    // TICKET-139: table-atlas map_pins member-gate guard. A random UUID is never a
    // table the SMOKE_TEST_JWT user belongs to, so checkMembership → false and the
    // main handler denies with fail('Forbidden', 403) BEFORE handleMapPins runs.
    // This exercises the new action's routing + the membership gate; the suppers /
    // supper_members / table_nights read assembly is only reached for a member (not
    // this bogus id), so a 500 here would mean the routing / gate drifted. table-atlas
    // returns a flat { error } envelope (not the structured shape), so we assert only
    // that an error field is present — matching the fn's real behavior.
    {
        name: 'table-atlas?action=map_pins bogus table id → 403 membership gate (TICKET-139)',
        method: 'POST',
        fn: 'table-atlas',
        body: { action: 'map_pins', table_id: '00000000-0000-0000-0000-000000000000' },
        expectedStatus: 403,
        shape: (json) => {
            const err = (json as { error?: unknown }).error;
            if (!err) return 'missing error envelope';
            return null;
        },
    },
    // TICKET-098 Phase B + TICKET-102 + TICKET-114 v2: two-mode rail read path.
    // [ARCH-REVIEW-5] assert Array.isArray on BOTH rows AND fallback ONLY — an
    // empty array is the legitimate below-floor state for each mode (rows: <3
    // qualifiers; fallback: nothing passing the quality floor), so no
    // length/content check. Both arrays live INSIDE data (callEdgeFn strips the
    // outer envelope). TICKET-114: when rows is NON-empty, assert the v2 count
    // fields are numbers (imports_30d/saves_30d/list_adds_30d) so a shape drift
    // back to the old saver_count_7d payload is caught. Lenient on empty rows.
    {
        name: 'feed-trending (TICKET-098/102/114 two-mode rail — empty rows/fallback is legitimate)',
        method: 'POST',
        fn: 'feed-trending',
        body: {},
        shape: (json) => {
            const data = (json as { data?: { rows?: unknown; fallback?: unknown } }).data;
            if (!data) return 'missing data envelope';
            if (!Array.isArray(data.rows)) return 'data.rows is not an array';
            if (!Array.isArray(data.fallback)) return 'data.fallback is not an array';
            if (data.rows.length > 0) {
                const r = data.rows[0] as Record<string, unknown>;
                if (typeof r.imports_30d !== 'number') return 'rows[0].imports_30d is not a number';
                if (typeof r.saves_30d !== 'number') return 'rows[0].saves_30d is not a number';
                if (typeof r.list_adds_30d !== 'number') return 'rows[0].list_adds_30d is not a number';
            }
            return null;
        },
    },
    // TICKET-101: co-diner candidates read path — backs the zero-follow feed
    // empty state (tier 1). callEdgeFn unwraps { data: [...] } to the array, so
    // the smoke asserts Array.isArray(data) ONLY — an empty array is the
    // legitimate tier-2 signal (the smoke user may have no unfollowed co-diners),
    // never a failure. A 500 here means the fn_co_diner_candidates RPC / union
    // drifted — exactly what this guard catches.
    {
        name: 'user-profile?action=co_diners (TICKET-101 empty state — empty array is legitimate)',
        method: 'POST',
        fn: 'user-profile',
        body: { action: 'co_diners' },
        shape: (json) => {
            const data = (json as { data?: unknown }).data;
            if (!Array.isArray(data)) return 'data is not an array';
            return null;
        },
    },
    // TICKET-124: network map pins read path — backs the /dining-map network
    // layer toggle. callEdgeFn unwraps { data: { pins } }; the smoke asserts
    // Array.isArray(data.pins) ONLY — an empty array is the legitimate
    // zero-follow / no-network-log state, never a failure. A 500 here means the
    // fn_network_map_pins RPC (follow-set fan-out, block/public gates, window +
    // GROUP BY) drifted — exactly what this guard catches.
    // NOTE: the CI smoke fixture user follows no one, so this exercises the EMPTY
    // path ONLY — it catches a hard 500 (SQL drift), NOT a mis-shaped pin. The
    // join / ROW_NUMBER / others_count / has_review shaping is only covered by the
    // manual iOS passes (a fixture with a coord-bearing followee log would be
    // needed to guard the populated shape). Behavior left as-is intentionally.
    {
        name: 'user-profile?action=network_map_pins (TICKET-124 — empty array is legitimate)',
        method: 'POST',
        fn: 'user-profile',
        body: { action: 'network_map_pins' },
        shape: (json) => {
            const data = (json as { data?: { pins?: unknown } }).data;
            if (!data) return 'missing data envelope';
            if (!Array.isArray(data.pins)) return 'data.pins is not an array';
            return null;
        },
    },
    // TICKET-090: account fn read path — backs the Blocked settings screen and
    // is the same fn that performs account deletion. blocked_list on the smoke
    // user must return the rows envelope (200 + data.rows array).
    {
        name: 'account?action=blocked_list (TICKET-090 safety surface)',
        method: 'POST',
        fn: 'account',
        body: { action: 'blocked_list' },
        shape: (json) => {
            const data = (json as { data?: { rows?: unknown[] } }).data;
            if (!data) return 'missing data envelope';
            if (!Array.isArray(data.rows)) return 'data.rows is not an array';
            return null;
        },
    },
    // TICKET-072: share-page public endpoint smoke — bogus token → HTTP 410 + text/html.
    // This check is UNAUTHENTICATED (no Authorization header) because the function
    // is deployed with verify_jwt=false. The smoke asserts:
    //   1. Supabase does NOT 401 the unauthenticated request (verify_jwt=false working)
    //   2. Bogus token renders the tombstone (410, text/html, no PII, no raw error)
    {
        name: 'share-page?t=<bogus> unauthenticated → 410 tombstone (TICKET-072)',
        method: 'GET',
        fn: 'share-page',
        query: 't=ZZZbogusZZZbogusZZZbXA',   // 22 chars, valid base64url format, unknown token → DB-miss → 410
        expectedStatus: 410,
        noAuth: true,
        rawShape: (body, contentType) => {
            // Free-tier gateway rewrites HTML responses to text/plain (see
            // memory/reference_supabase_html_limit) — accept either; the body
            // checks are the real guard.
            if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
                return `expected text/html or text/plain, got: ${contentType}`;
            }
            if (body.includes('Internal Server Error') || body.includes('stack') || body.includes('Error:')) {
                return 'tombstone must not expose raw error or stack trace';
            }
            if (!body.includes('folded away')) {
                return 'tombstone body should include journal-voice copy ("folded away")';
            }
            return null;
        },
    },
    // Table invite links: table-invite-page is the second public (verify_jwt=false)
    // HTML endpoint — same guard as share-page. A bogus code must render the 410
    // tombstone, proving both that verify_jwt=false took effect (no 401) and that
    // the table_invites read path is alive.
    {
        name: 'table-invite-page?c=<bogus> unauthenticated → 410 tombstone',
        method: 'GET',
        fn: 'table-invite-page',
        query: 'c=ZZZbogusZZZbogusZZZbXA',   // 22 chars, valid base64url format, unknown code → DB-miss → 410
        expectedStatus: 410,
        noAuth: true,
        rawShape: (body, contentType) => {
            if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
                return `expected text/html or text/plain, got: ${contentType}`;
            }
            if (body.includes('Internal Server Error') || body.includes('stack') || body.includes('Error:')) {
                return 'tombstone must not expose raw error or stack trace';
            }
            if (!body.includes('folded away')) {
                return 'tombstone body should include journal-voice copy ("folded away")';
            }
            return null;
        },
    },
    // TICKET-121: table-management GET list — the Tables tab's primary read
    // (memberships + tables embed). An empty array here would be a legitimate
    // response shape; the runtime discovery below independently fails loudly
    // if the smoke user has no table (ensure-fixtures guarantees ≥1).
    {
        name: 'table-management GET list (TICKET-121 coverage)',
        method: 'GET',
        fn: 'table-management',
        shape: (json) => {
            const data = (json as { data?: unknown }).data;
            if (!Array.isArray(data)) return 'data is not an array';
            return null;
        },
    },
    // TICKET-121: lists list_mine — the Lists rail read path (own + Table
    // lists, entry counts via list_entries + restaurants!inner embeds — the
    // exact join class that drifts into PGRST201 500s). Empty array is a
    // legitimate no-lists state; the guard is 200 + array envelope.
    {
        name: 'lists?action=list_mine (TICKET-121 coverage)',
        method: 'POST',
        fn: 'lists',
        body: { action: 'list_mine' },
        shape: (json) => {
            const data = (json as { data?: unknown }).data;
            if (!Array.isArray(data)) return 'data is not an array';
            return null;
        },
    },
];

// TICKET-121: places-search costs a REAL Google Places request per call, so it
// only runs when PLACES_SMOKE=1 — set by prod-deploy.yml's smoke step
// (deploy-time only), deliberately NOT by the scheduled smoke (4 runs/day
// would be pure spend for zero deploy-drift signal).
if (Deno.env.get('PLACES_SMOKE') === '1') {
    CHECKS.push({
        name: 'places-search POST fixed query (PLACES_SMOKE=1 — deploy-time only, real Google cost)',
        method: 'POST',
        fn: 'places-search',
        body: { query: 'blue bottle coffee san francisco' },
        shape: (json) => {
            const data = (json as { data?: unknown }).data;
            if (!Array.isArray(data)) return 'data is not an array';
            if (data.length === 0) return 'no places returned for a fixed well-known query';
            const first = data[0] as Record<string, unknown>;
            if (typeof first.id !== 'string') return 'places[0].id is not a string';
            // sanitizePlace maps name to displayName?.text ?? null — a degraded
            // Places payload can legitimately carry null, so string OR null.
            if (typeof first.name !== 'string' && first.name !== null) {
                return 'places[0].name is not a string or null';
            }
            return null;
        },
    });
}

// ── Runner state ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function recordFailure(name: string, detail: string) {
    failed++;
    const msg = `✗ ${name}\n   ${detail}`;
    console.error(msg);
    failures.push(msg);
}

// ── TICKET-121: runtime fixture discovery ───────────────────────────────────
// Some checks need real row ids that only exist on the target project. Rather
// than adding CI secrets that rot, discover them at runtime through the same
// read paths the app uses. ensure-fixtures.ts (run by CI immediately before
// this suite) guarantees the rows exist — a discovery miss is therefore a real
// failure, never a skip.

/** Minimal authed POST used by discovery (checks themselves stay in CHECKS). */
async function discoveryPost(fn: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${JWT}`,
            apikey: ANON_KEY!,
        },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${fn} HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
}

// post-interactions read-path guard. This endpoint backs every reaction/comment
// container on entries. It was NOT in the smoke list when the table-scope
// entry react/comment fire was investigated (2026-06-15); per CLAUDE.md deploy
// doctrine it was added — but stayed INERT because SMOKE_TEST_ENTRY_ID was
// never set in CI. TICKET-121 activates it: self-discover a review-bearing
// entry from the smoke user's own reviews. The ensure-fixtures entries are
// feed-only + rated + note ≥ 20 chars — exactly the is_entry_publicly_eligible
// predicate (smoke profile is public-default), so scope=public is the correct
// read: scope=table resolves via entry_tables / entries.table_id, which a
// feed-only entry doesn't have → 404, not 200.
try {
    let entryId = ENTRY_ID ?? null;
    if (!entryId) {
        const json = await discoveryPost('user-profile', {
            action: 'reviews',
            identifier: SMOKE_USER_ID,
            limit: 10,
        }) as { data?: { rows?: Array<{ entry_id?: string; note?: string }> } };
        const rows = json?.data?.rows ?? [];
        // Prefer the ensure-fixtures entries — guaranteed public-eligible.
        const fixture = rows.find((r) => typeof r.note === 'string' && r.note.includes('Smoke fixture'));
        entryId = fixture?.entry_id ?? rows[0]?.entry_id ?? null;
    }
    if (!entryId) {
        throw new Error('no review-bearing entry found — run scripts/smoke/ensure-fixtures.ts first');
    }
    CHECKS.push({
        name: 'post-interactions GET target_type=entry scope=public (react/comment fire 2026-06-15; activated TICKET-121)',
        method: 'GET',
        fn: 'post-interactions',
        query: `target_type=entry&target_id=${entryId}&scope=public`,
        shape: (json) => {
            const data = (json as { data?: { reactions?: unknown[]; comments?: unknown[]; counts?: unknown } }).data;
            if (!data) return 'missing data envelope';
            if (!Array.isArray(data.reactions)) return 'data.reactions is not an array';
            if (!Array.isArray(data.comments)) return 'data.comments is not an array';
            if (!data.counts) return 'missing data.counts';
            return null;
        },
    });
} catch (err) {
    recordFailure('post-interactions entry discovery (TICKET-121)', (err as Error).message);
}

// table-activity + member-profile need a table the smoke user belongs to.
// ensure-fixtures guarantees ≥1 (created through table-management, the app
// write path). The tables embed off table_members is many-to-one → object,
// but tolerate an array shape defensively.
try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/table-management`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${JWT}`, apikey: ANON_KEY! },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`table-management HTTP ${res.status}: ${text.slice(0, 200)}`);
    const memberships = (JSON.parse(text) as {
        data?: Array<{ tables?: { id?: string } | Array<{ id?: string }> }>;
    }).data ?? [];
    const embedded = memberships[0]?.tables;
    const tableId = Array.isArray(embedded) ? embedded[0]?.id : embedded?.id;
    if (!tableId) {
        throw new Error('smoke user has no table — run scripts/smoke/ensure-fixtures.ts first');
    }
    CHECKS.push(
        {
            name: 'table-activity POST page 1 (TICKET-121 coverage)',
            method: 'POST',
            fn: 'table-activity',
            body: { table_id: tableId },
            shape: (json) => {
                const data = (json as { data?: { rows?: unknown; next_cursor?: unknown; has_more?: unknown } }).data;
                if (!data) return 'missing data envelope';
                if (!Array.isArray(data.rows)) return 'data.rows is not an array';
                if (typeof data.has_more !== 'boolean') return 'data.has_more is not a boolean';
                if (!('next_cursor' in data)) return 'missing data.next_cursor';
                return null;
            },
        },
        {
            name: 'member-profile?action=profile self-target (TICKET-121 coverage)',
            method: 'GET',
            fn: 'member-profile',
            query: `action=profile&user_id=${SMOKE_USER_ID}&table_id=${tableId}`,
            shape: (json) => {
                const data = (json as {
                    data?: { profile?: unknown; top_entries?: unknown; recent_activity?: unknown };
                }).data;
                if (!data) return 'missing data envelope';
                if (!data.profile) return 'missing data.profile';
                if (!Array.isArray(data.top_entries)) return 'data.top_entries is not an array';
                if (!Array.isArray(data.recent_activity)) return 'data.recent_activity is not an array';
                return null;
            },
        },
        // TICKET-139 follow-up: map_pins MEMBER path. The bogus-id guard above only
        // proves the 403 gate; this exercises the real read assembly (suppers ∪
        // legacy rounds join, participant hydration, cap). STRICT ≥1 row:
        // ensure-fixtures seeds a host-only supper into this same first-listed
        // table and hard-fails if map_pins stays empty, so an empty array here
        // means the read path regressed after seeding — exactly what we want loud.
        {
            name: 'table-atlas?action=map_pins member path → pin rows (TICKET-139)',
            method: 'POST',
            fn: 'table-atlas',
            query: 'action=map_pins',
            body: { action: 'map_pins', table_id: tableId },
            shape: (json) => {
                const rows = (json as { data?: { rows?: unknown } }).data?.rows;
                if (!Array.isArray(rows)) return 'data.rows is not an array';
                if (rows.length === 0) {
                    return 'no pin rows — ensure-fixtures seeds a supper; empty means the map_pins read path regressed (or SMOKE_TEST_RESTAURANT_ID lost its coords)';
                }
                const r = rows[0] as Record<string, unknown>;
                if (typeof r.lat !== 'number' || typeof r.lng !== 'number') return 'row missing numeric lat/lng';
                if (!Array.isArray(r.participants) || r.participants.length === 0) return 'row missing participants';
                if (typeof r.suppers_count !== 'number' || r.suppers_count < 1) return 'suppers_count < 1';
                if ('photo_url' in r) return 'photo_url leaked into a map_pins row (banned surface)';
                return null;
            },
        },
    );
} catch (err) {
    recordFailure('table fixture discovery (TICKET-121)', (err as Error).message);
}

// ── Runner ─────────────────────────────────────────────────────────────────

for (const check of CHECKS) {
    const url = `${SUPABASE_URL}/functions/v1/${check.fn}${check.query ? '?' + check.query : ''}`;

    // Build headers: omit auth for noAuth checks (e.g. public share-page endpoint)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!check.noAuth) {
        headers['Authorization'] = `Bearer ${JWT}`;
        headers['apikey'] = ANON_KEY!;
    }

    const init: RequestInit = {
        method: check.method,
        headers,
        // __SMOKE_USER_ID__ placeholder → the runtime smoke user's own id.
        body: check.body
            ? JSON.stringify(check.body).replaceAll('"__SMOKE_USER_ID__"', JSON.stringify(SMOKE_USER_ID))
            : undefined,
    };

    let res: Response;
    let bodyText = '';
    try {
        res = await fetch(url, init);
        bodyText = await res.text();
    } catch (err) {
        failed++;
        const msg = `✗ ${check.name}\n   network error: ${(err as Error).message}`;
        console.error(msg);
        failures.push(msg);
        continue;
    }

    const expectedStatus = check.expectedStatus ?? 200;
    if (res.status !== expectedStatus) {
        failed++;
        const msg = `✗ ${check.name}\n   HTTP ${res.status} (expected ${expectedStatus})\n   ${bodyText.slice(0, 500)}`;
        console.error(msg);
        failures.push(msg);
        continue;
    }

    // rawShape: inspect raw body text + Content-Type (for non-JSON responses like HTML)
    if (check.rawShape) {
        const contentType = res.headers.get('content-type') ?? '';
        const shapeErr = check.rawShape(bodyText, contentType);
        if (shapeErr) {
            failed++;
            const msg = `✗ ${check.name}\n   rawShape: ${shapeErr}\n   body: ${bodyText.slice(0, 300)}`;
            console.error(msg);
            failures.push(msg);
            continue;
        }
        passed++;
        console.log(`✓ ${check.name}`);
        continue;
    }

    let json: unknown;
    try {
        json = JSON.parse(bodyText);
    } catch {
        failed++;
        const msg = `✗ ${check.name}\n   non-JSON response: ${bodyText.slice(0, 200)}`;
        console.error(msg);
        failures.push(msg);
        continue;
    }

    if (check.shape) {
        const shapeErr = check.shape(json);
        if (shapeErr) {
            failed++;
            const msg = `✗ ${check.name}\n   shape: ${shapeErr}\n   body: ${bodyText.slice(0, 200)}`;
            console.error(msg);
            failures.push(msg);
            continue;
        }
    }

    passed++;
    console.log(`✓ ${check.name}`);
}

// ── TICKET-099: diary + reviews keyset pagination guards ────────────────────
// The profile diary (and its reviews-only sibling — same fetchDiary cursor
// path, reviewsOnly=true) are the user-profile paths that page via cursor. The
// 2026-07-04 bug (applyKeysetFilter emitting a phantom `sort_date` column
// filter against raw entries → 42703 → 500) ONLY fired on cursor requests, so
// a page-1 check can never catch its regression class. Walk two pages with
// limit=1. STRICT: a single page is a FAILURE — the walk ran vacuously for
// months ("keyset not exercised" pass-with-note) before ensure-fixtures.ts
// closed that hole. CI seeds the fixtures immediately before this suite
// (prod-deploy.yml "Ensure smoke fixtures" step); locally, run
// scripts/smoke/ensure-fixtures.ts once against the same project.
// (Single-request checks stay in CHECKS; these need the page-1 → page-2
// dependency.)
for (const walkAction of ['diary', 'reviews'] as const) {
    const name = `user-profile?action=${walkAction} two-page keyset walk (TICKET-099)`;
    const callPage = async (cursor: string | null) => {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/user-profile`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${JWT}`,
                apikey: ANON_KEY!,
            },
            body: JSON.stringify({ action: walkAction, identifier: SMOKE_USER_ID, limit: 1, cursor }),
        });
        const text = await res.text();
        let json: unknown = null;
        try {
            json = JSON.parse(text);
        } catch { /* non-JSON stays null; status check below reports it */ }
        return { status: res.status, json, text };
    };

    try {
        const p1 = await callPage(null);
        const d1 = (p1.json as { data?: { rows?: Array<{ entry_id?: string; note?: unknown }>; next_cursor?: string | null } } | null)?.data;
        if (p1.status !== 200) throw new Error(`page 1 HTTP ${p1.status}: ${p1.text.slice(0, 200)}`);
        if (!d1 || !Array.isArray(d1.rows)) throw new Error('page 1: missing data.rows envelope');
        if (walkAction === 'reviews') {
            const note = d1.rows[0]?.note;
            if (typeof note !== 'string' || note.trim().length === 0) {
                throw new Error('reviews page 1 row has no written note — reviewsOnly filter drifted');
            }
        }
        if (!d1.next_cursor) {
            throw new Error(
                `single page — smoke user has <2 ${walkAction} rows, keyset filter NOT exercised. ` +
                    'Run scripts/smoke/ensure-fixtures.ts (CI runs it before this suite).',
            );
        }

        const p2 = await callPage(d1.next_cursor);
        const d2 = (p2.json as { data?: { rows?: Array<{ entry_id?: string }> } } | null)?.data;
        if (p2.status !== 200) {
            throw new Error(`page 2 HTTP ${p2.status} (keyset filter broken?): ${p2.text.slice(0, 200)}`);
        }
        if (!d2 || !Array.isArray(d2.rows)) throw new Error('page 2: missing data.rows envelope');
        const id1 = d1.rows[0]?.entry_id;
        if (id1 && d2.rows[0]?.entry_id === id1) {
            throw new Error('page 2 repeated page 1 row — cursor silently no-oping');
        }
        passed++;
        console.log(`✓ ${name} (page 2 fetched via cursor)`);
    } catch (err) {
        failed++;
        const msg = `✗ ${name}\n   ${(err as Error).message}`;
        console.error(msg);
        failures.push(msg);
    }
}

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);

if (failed > 0) {
    console.error('\n--- failure summary ---');
    for (const f of failures) console.error(f);
    Deno.exit(1);
}
