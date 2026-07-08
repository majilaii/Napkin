/**
 * Smoke-fixture guarantor — makes the keyset walks in edge-functions.ts real.
 *
 * Why this exists:
 *   The TICKET-099 diary two-page keyset walk was vacuous from the day it
 *   landed: the smoke user had <2 diary entries, so page 1 came back with
 *   next_cursor=null and the check passed with a "(single page — keyset not
 *   exercised)" note. A keyset regression (the exact 42703 class the walk was
 *   built for) would have sailed through smoke. This script guarantees the
 *   fixtures the walks need, so the walks can be strict.
 *
 * What it does:
 *   Signs in as the smoke user, counts their review-bearing diary entries
 *   (user-profile?action=reviews — reviews ⊆ diary, so ≥2 reviews implies ≥2
 *   diary rows), and if short, creates solo feed-only entries through the
 *   `entry` edge function — same write path the app uses, RLS + contracts
 *   exercised, no direct DB writes. Entries get distinct backdated visited_at
 *   values so the keyset ORDER BY (sort_date DESC, id DESC) is genuinely
 *   exercised across pages. Idempotent: once the account holds ≥2 reviews it
 *   never writes again.
 *
 *   TICKET-121: also guarantees the smoke user belongs to ≥1 table (created
 *   through table-management, the app write path) so the table-activity and
 *   member-profile smoke checks can self-discover a table id at runtime, and
 *   that the smoke profile is account_privacy='public' (flipped via
 *   user-profile action=update_privacy) so the scope=public post-interactions
 *   check can never 403 on a fresh/reset account.
 *
 * Required env (same set as the smoke step in prod-deploy.yml):
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *   SMOKE_TEST_EMAIL + SMOKE_TEST_PASSWORD  — smoke-user credentials
 *   SMOKE_TEST_RESTAURANT_ID                — persisted restaurant to log against
 *
 * Run locally (against whatever project the env points at):
 *   deno run --allow-env --allow-net scripts/smoke/ensure-fixtures.ts
 *
 * Run in CI: prod-deploy.yml runs this immediately before the smoke step.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const RESTAURANT_ID = Deno.env.get('SMOKE_TEST_RESTAURANT_ID');
const EMAIL = Deno.env.get('SMOKE_TEST_EMAIL');
const PASSWORD = Deno.env.get('SMOKE_TEST_PASSWORD');

for (const [name, val] of Object.entries({
    SUPABASE_URL,
    SUPABASE_ANON_KEY: ANON_KEY,
    SMOKE_TEST_RESTAURANT_ID: RESTAURANT_ID,
    SMOKE_TEST_EMAIL: EMAIL,
    SMOKE_TEST_PASSWORD: PASSWORD,
})) {
    if (!val) {
        console.error(`✗ missing env: ${name}`);
        Deno.exit(2);
    }
}

// The walks page with limit=1, so 2 rows = 2 pages. Keep in sync with
// edge-functions.ts (REQUIRED_KEYSET_ROWS there asserts the same floor).
const REQUIRED_REVIEWS = 2;

// Backdated + fixed: never collides with anything a human does on this
// account, and the two sort dates are guaranteed distinct so the keyset
// tuple filter (sort_date, id) < (d, i) actually discriminates.
const FIXTURES = [
    {
        rating: 4,
        content: 'Smoke fixture — first of two entries that keep the diary keyset walk honest.',
        visited_at: '2025-01-01T12:00:00.000Z',
    },
    {
        rating: 4.5,
        content: 'Smoke fixture — second entry, distinct visited_at so page 2 exists at limit=1.',
        visited_at: '2025-01-02T12:00:00.000Z',
    },
];

async function signIn(): Promise<{ token: string; userId: string }> {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY! },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.access_token) {
        console.error(`✗ smoke-user sign-in failed (HTTP ${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
        Deno.exit(1);
    }
    return { token: json.access_token, userId: json.user.id };
}

async function edge(token: string, fn: string, body: unknown): Promise<any> {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            apikey: ANON_KEY!,
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`${fn} → HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return json?.data ?? json;
}

async function reviewsCount(token: string, userId: string): Promise<number> {
    const page = await edge(token, 'user-profile', {
        action: 'reviews',
        identifier: userId,
        limit: REQUIRED_REVIEWS,
    });
    if (!Array.isArray(page?.rows)) {
        throw new Error(`reviews returned no rows array: ${JSON.stringify(page).slice(0, 200)}`);
    }
    return page.rows.length;
}

// ── TICKET-121: the table-activity + member-profile smoke checks need the
// smoke user to belong to ≥1 table. Guarantee it through table-management —
// the app's write path (owner wiring + admin membership row included), NEVER
// a direct DB write. Idempotent: once any membership exists, never writes.
// The smoke suite self-discovers the table id at runtime (no new CI secrets).
async function ensureTable(token: string): Promise<void> {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/table-management`, {
        method: 'GET',
        headers: { apikey: ANON_KEY!, Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`table-management list → HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    }
    const memberships = Array.isArray(json?.data) ? json.data : [];
    if (memberships.length > 0) {
        console.log(`✓ smoke user belongs to ${memberships.length} table(s) — nothing to seed`);
        return;
    }

    console.log('→ smoke user has no table — creating one via table-management…');
    const created = await edge(token, 'table-management', { name: 'Smoke Table' });
    if (!created?.id) {
        throw new Error(`table create returned no id: ${JSON.stringify(created).slice(0, 200)}`);
    }
    console.log(`  ✓ table ${created.id} created`);
}

// ── TICKET-121 fix-pass: the activated post-interactions scope=public smoke
// check requires is_entry_publicly_eligible, which requires the smoke profile
// to be account_privacy='public' — the DB default is 'private', so a fresh (or
// founder-reset) smoke account would 403 that check. Self-heal through the
// user-profile edge fn (app write path, never direct DB). Idempotent: no-op
// once public. The first flip to public atomically requires a username in the
// same call; send a fixed deterministic one only when the profile has none.
// The server excludes self from the taken check, so re-running with an
// already-owned name succeeds; if another user ever claims it, fall back to a
// user-id-derived name (lowercase hex — always passes the username format).
async function ensureProfilePublic(token: string, userId: string): Promise<void> {
    const prof = await edge(token, 'user-profile', { action: 'profile', identifier: userId });
    const profile = prof?.profile;
    if (!profile) {
        throw new Error(`own profile lookup returned no profile: ${JSON.stringify(prof).slice(0, 200)}`);
    }
    if (profile.account_privacy === 'public') {
        console.log('✓ smoke profile already public — nothing to change');
        return;
    }

    console.log('→ smoke profile is private — flipping to public via user-profile…');
    const candidates: (string | undefined)[] = profile.username
        ? [undefined]  // already has a username — the flip needs no new one
        : ['napkin_smoke', `smoke_${userId.replace(/-/g, '').slice(0, 8)}`];
    let lastErr: Error | null = null;
    for (const username of candidates) {
        try {
            const updated = await edge(token, 'user-profile', {
                action: 'update_privacy',
                account_privacy: 'public',
                ...(username ? { username } : {}),
            });
            if (updated?.account_privacy !== 'public') {
                throw new Error(`update_privacy did not stick: ${JSON.stringify(updated).slice(0, 200)}`);
            }
            console.log(`  ✓ profile now public${username ? ` (username ${username})` : ''}`);
            return;
        } catch (e) {
            lastErr = e as Error;
            // Username taken by ANOTHER user → HTTP 409: try the derived
            // fallback. Anything else (format, 500, …) won't improve on retry.
            if (!String(lastErr.message).includes('HTTP 409')) break;
        }
    }
    throw lastErr ?? new Error('update_privacy failed');
}

// ── TICKET-139 follow-up: the table-atlas map_pins MEMBER-path smoke needs the
// smoke table to hold ≥1 group meal at a coord-bearing restaurant. Seed a
// host-only supper via entry?action=set-table — the app's write path (anchor +
// supper_members roster in one call), NEVER a direct DB write. Idempotent: once
// map_pins returns any row (any supper/round with coords), never writes again.
// The empty-seats supper card this creates is confined to the demo account's
// own solo "Smoke Table" feed — same fixture-noise budget as the entry fixtures.
// Discovery uses the SAME first-listed-table rule as edge-functions.ts, and the
// smoke step runs immediately after this script in the same workflow, so seed
// and check always target the same table.
async function discoverTableId(token: string): Promise<string> {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/table-management`, {
        method: 'GET',
        headers: { apikey: ANON_KEY!, Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`table-management list → HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    }
    const memberships: Array<{ tables?: { id?: string } | Array<{ id?: string }> }> =
        Array.isArray(json?.data) ? json.data : [];
    const embedded = memberships[0]?.tables;
    const tableId = Array.isArray(embedded) ? embedded[0]?.id : embedded?.id;
    if (!tableId) throw new Error('no table id discoverable after ensureTable — list shape drifted?');
    return tableId;
}

async function mapPinRows(token: string, tableId: string): Promise<unknown[]> {
    const rows = await edge(token, 'table-atlas', { action: 'map_pins', table_id: tableId });
    if (!Array.isArray(rows)) {
        throw new Error(`map_pins returned no array: ${JSON.stringify(rows).slice(0, 200)}`);
    }
    return rows;
}

async function ensureSupperPin(token: string): Promise<void> {
    const tableId = await discoverTableId(token);
    let rows = await mapPinRows(token, tableId);
    if (rows.length > 0) {
        console.log(`✓ smoke table has ${rows.length} map pin(s) — nothing to seed`);
        return;
    }

    console.log('→ smoke table has no group-meal pins — creating a host-only supper via entry set-table…');
    const supper = await edge(token, 'entry', {
        action: 'set-table',
        table_id: tableId,
        restaurant_id: RESTAURANT_ID,
        member_ids: [],
    });
    console.log(`  ✓ supper ${supper?.id ?? '(no id in response)'} created`);

    rows = await mapPinRows(token, tableId);
    if (rows.length === 0) {
        console.error(
            '✗ supper created but map_pins still returns 0 rows — SMOKE_TEST_RESTAURANT_ID most likely has no lat/lng. Point it at a coord-bearing persisted restaurant.',
        );
        Deno.exit(1);
    }
    console.log(`✓ map_pins fixture ready (${rows.length} row(s))`);
}

async function main() {
    const { token, userId } = await signIn();
    const have = await reviewsCount(token, userId);
    if (have >= REQUIRED_REVIEWS) {
        console.log(`✓ smoke fixtures present (${have} review-bearing entries) — nothing to seed`);
    } else {
        console.log(`→ smoke user has ${have}/${REQUIRED_REVIEWS} review-bearing entries — seeding…`);
        for (const fixture of FIXTURES.slice(0, REQUIRED_REVIEWS - have)) {
            // Solo feed-only entry (no table_ids): diary-as-self includes private
            // entries, and content makes it count for the reviews walk too.
            const created = await edge(token, 'entry', {
                restaurant_id: RESTAURANT_ID,
                ...fixture,
            });
            console.log(`  ✓ entry ${created?.id ?? '(no id in response)'} @ ${fixture.visited_at}`);
        }

        const now = await reviewsCount(token, userId);
        if (now < REQUIRED_REVIEWS) {
            console.error(`✗ seeded but reviews count is still ${now}/${REQUIRED_REVIEWS} — entry create or reviews read drifted`);
            Deno.exit(1);
        }
        console.log(`✓ smoke fixtures ready (${now} review-bearing entries)`);
    }

    // TICKET-121: table floor — always checked, independent of the entry floor.
    await ensureTable(token);

    // TICKET-121 fix-pass: public-profile floor — the scope=public
    // post-interactions check depends on it.
    await ensureProfilePublic(token, userId);
}

main().catch((e) => {
    console.error(`✗ ensure-fixtures failed: ${e.message}`);
    Deno.exit(1);
});
