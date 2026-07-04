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

async function main() {
    const { token, userId } = await signIn();
    const have = await reviewsCount(token, userId);
    if (have >= REQUIRED_REVIEWS) {
        console.log(`✓ smoke fixtures present (${have} review-bearing entries) — nothing to seed`);
        return;
    }

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

main().catch((e) => {
    console.error(`✗ ensure-fixtures failed: ${e.message}`);
    Deno.exit(1);
});
