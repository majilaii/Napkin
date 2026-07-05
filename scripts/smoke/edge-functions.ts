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
// Optional: a real table-scoped entry id the SMOKE_TEST_JWT user can read.
// When set, enables the post-interactions read-path guard below. Left unset in
// CI until seeded — the check is appended conditionally so a missing value does
// not fail the suite.
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
    // TICKET-098 Phase B: trending rail read path. [ARCH-REVIEW-5] assert
    // Array.isArray(rows) ONLY — an empty array is the legitimate rail-hidden
    // state (fewer than 3 qualifying restaurants), so no length/content check.
    {
        name: 'feed-trending (TICKET-098 rail — empty rows is legitimate)',
        method: 'POST',
        fn: 'feed-trending',
        body: {},
        shape: (json) => {
            const data = (json as { data?: { rows?: unknown } }).data;
            if (!data) return 'missing data envelope';
            if (!Array.isArray(data.rows)) return 'data.rows is not an array';
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
];

// post-interactions read-path guard. This endpoint backs every reaction/comment
// container on entries. It was NOT in the smoke list when the table-scope
// entry react/comment fire was investigated (2026-06-15); per CLAUDE.md deploy
// doctrine ("the smoke test list is sacred — add the endpoint a fire traced to"),
// it is added here. Conditional on SMOKE_TEST_ENTRY_ID so it stays inert until a
// real table-scoped entry id is seeded into CI.
if (ENTRY_ID) {
    CHECKS.push({
        name: 'post-interactions GET target_type=entry scope=table (TICKET react/comment fire 2026-06-15)',
        method: 'GET',
        fn: 'post-interactions',
        query: `target_type=entry&target_id=${ENTRY_ID}&scope=table`,
        shape: (json) => {
            const data = (json as { data?: { reactions?: unknown[]; comments?: unknown[]; counts?: unknown } }).data;
            if (!data) return 'missing data envelope';
            if (!Array.isArray(data.reactions)) return 'data.reactions is not an array';
            if (!Array.isArray(data.comments)) return 'data.comments is not an array';
            if (!data.counts) return 'missing data.counts';
            return null;
        },
    });
}

// ── Runner ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

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
