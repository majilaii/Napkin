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
 *   SMOKE_TEST_JWT            — a long-lived test-user access token (see runbook)
 *   SMOKE_TEST_RESTAURANT_ID  — UUID of a seeded restaurant on the project
 *
 * Run locally:
 *   deno run --allow-env --allow-net scripts/smoke/edge-functions.ts
 *
 * Run in CI: see .github/workflows/staging-deploy.yml + prod-deploy.yml.
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
const JWT = Deno.env.get('SMOKE_TEST_JWT');
const RESTAURANT_ID = Deno.env.get('SMOKE_TEST_RESTAURANT_ID');

function requireEnv(name: string, val: string | undefined): string {
    if (!val) {
        console.error(`✗ missing env: ${name}`);
        Deno.exit(2);
    }
    return val;
}

requireEnv('SUPABASE_URL', SUPABASE_URL);
requireEnv('SUPABASE_ANON_KEY', ANON_KEY);
requireEnv('SMOKE_TEST_JWT', JWT);
requireEnv('SMOKE_TEST_RESTAURANT_ID', RESTAURANT_ID);

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
    {
        name: 'feed?action=page (cross-Table aggregated feed)',
        method: 'POST',
        fn: 'feed',
        body: { action: 'page', limit: 5 },
        shape: (json) => {
            const data = (json as { data?: { rows?: unknown[] } }).data;
            if (!data) return 'missing data envelope';
            if (!Array.isArray(data.rows)) return 'data.rows is not an array';
            return null;
        },
    },
    {
        name: 'user-profile?action=profile (own profile)',
        method: 'GET',
        fn: 'user-profile',
        query: 'action=profile',
        shape: (json) => {
            const data = (json as { data?: unknown }).data;
            if (!data) return 'missing data envelope';
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
            if (!contentType.includes('text/html')) {
                return `expected text/html, got: ${contentType}`;
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
        body: check.body ? JSON.stringify(check.body) : undefined,
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

console.log(`\n${passed} passed, ${failed} failed (${CHECKS.length} total)`);

if (failed > 0) {
    console.error('\n--- failure summary ---');
    for (const f of failures) console.error(f);
    Deno.exit(1);
}
