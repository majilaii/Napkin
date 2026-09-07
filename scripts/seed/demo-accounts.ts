/**
 * App Review demo-account seeder (TICKET-090).
 *
 * Creates two populated accounts on prod so the Apple reviewer lands in a
 * living app: a journal with rated logs, a wishlist, a shared Table with a
 * second member, and comments to exercise report/block (guideline 1.2).
 *
 * Everything goes through the SAME edge functions the app uses — no direct
 * DB writes, so RLS + contracts are exercised, not bypassed.
 *
 * Required env:
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *   DEMO_EMAIL_A, DEMO_PASSWORD_A   — the account that goes in the review notes
 *   DEMO_EMAIL_B, DEMO_PASSWORD_B   — the tablemate
 *
 * Run:
 *   deno run --allow-env --allow-net scripts/seed/demo-accounts.ts
 *
 * Idempotency: sign-up of an existing email falls back to sign-in; entries
 * re-seed harmlessly (dup logs on the same restaurant are valid product-wise),
 * so re-running tops the accounts up rather than erroring.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

function req(name: string): string {
    const v = Deno.env.get(name);
    if (!v) {
        console.error(`✗ missing env: ${name}`);
        Deno.exit(2);
    }
    return v;
}

const ACCOUNTS = {
    a: { email: req('DEMO_EMAIL_A'), password: req('DEMO_PASSWORD_A') },
    b: { email: req('DEMO_EMAIL_B'), password: req('DEMO_PASSWORD_B') },
};

if (!SUPABASE_URL || !ANON_KEY) {
    console.error('✗ missing env: SUPABASE_URL / SUPABASE_ANON_KEY');
    Deno.exit(2);
}

// ── Auth ─────────────────────────────────────────────────────────────────────

type Session = { access_token: string; user_id: string };

async function authFetch(path: string, init: RequestInit): Promise<Response> {
    return fetch(`${SUPABASE_URL}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            apikey: ANON_KEY,
            ...(init.headers ?? {}),
        },
    });
}

async function signUpOrIn(email: string, password: string): Promise<Session> {
    const signUp = await authFetch('/auth/v1/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
    const upJson = await signUp.json().catch(() => ({}));
    if (signUp.ok && upJson?.access_token) {
        return { access_token: upJson.access_token, user_id: upJson.user.id };
    }
    // Already registered (or confirmation flow) → password sign-in.
    const signIn = await authFetch('/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
    const inJson = await signIn.json().catch(() => ({}));
    if (!signIn.ok || !inJson?.access_token) {
        console.error(`✗ auth failed for ${email}: ${JSON.stringify(inJson).slice(0, 300)}`);
        Deno.exit(1);
    }
    return { access_token: inJson.access_token, user_id: inJson.user.id };
}

// ── Edge helpers ─────────────────────────────────────────────────────────────

async function edge(
    session: Session,
    fn: string,
    body: unknown,
    query = '',
): Promise<any> {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}${query}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            apikey: ANON_KEY,
            Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`${fn}${query} → HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return json?.data ?? json;
}

// ── Seed content ─────────────────────────────────────────────────────────────

// Ghost payloads with REAL Google place ids (stable public identifiers, same
// ones the search flow would send). Server upserts by external_id, so if the
// row already exists on prod this attaches to it instead of duplicating.
const SPOTS = [
    {
        // ROOT CAUSE OF THE 2026-09-07 DUPLICATE: this used to carry
        // 'ChIJy8yepQkbdkgRb-jkyrEa1Ns', a stale Google place id for Padella that
        // no longer resolves — Places returned nothing, so every seed run upserted
        // a second, metadata-less Padella row alongside the real one and logged its
        // entries there. The id below is the live place, and it is the row the
        // 20260907130000 merge migration keeps. Do not "restore" the old id.
        external_id: 'ChIJdZ6paFcDdkgRpPUHPngIeq8',
        name: 'Padella Borough Market',
        location: { address: '6 Southwark St, London SE1 1TQ, UK', locality: 'London', country: 'United Kingdom' },
        cuisine: 'Italian',
        latitude: 51.5051655,
        longitude: -0.0899202,
    },
    {
        external_id: 'ChIJC8Ir_JMEdkgRvBWTh-X-P-U',
        name: 'BRAT',
        location: { address: '4 Redchurch St, London', locality: 'London', country: 'United Kingdom' },
        cuisine: 'British',
        latitude: 51.5237,
        longitude: -0.0723,
    },
    {
        external_id: 'ChIJ97cWJ84adkgRR_1yTVBnLKQ',
        name: 'St. JOHN',
        location: { address: '26 St John St, London', locality: 'London', country: 'United Kingdom' },
        cuisine: 'British',
        latitude: 51.5208,
        longitude: -0.1017,
    },
    {
        external_id: 'ChIJn0BUb0IbdkgRlkVDD-yny_k',
        name: 'Tayyabs',
        location: { address: '83-89 Fieldgate St, London', locality: 'London', country: 'United Kingdom' },
        cuisine: 'Pakistani',
        latitude: 51.5170,
        longitude: -0.0646,
    },
    {
        external_id: 'ChIJhx2Ll7wZdkgRPyHcAmiPFbo',
        name: 'Barrafina',
        location: { address: '26-27 Dean St, London', locality: 'London', country: 'United Kingdom' },
        cuisine: 'Spanish',
        latitude: 51.5138,
        longitude: -0.1323,
    },
];

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/**
 * Review copy, one pool per seeded spot. Each demo generation draws a different
 * line so re-seeding prod does not stamp the same sentence onto a restaurant
 * again — see the note at the entryNotes call site. Keep every pool the same
 * length, and keep `padella` and `padellaSecond` disjoint: Alex and Billie both
 * log that one.
 */
const REVIEW_COPY = {
    padella: [
        'The pici cacio e pepe is still the benchmark. Queue moved fast at 5:45.',
        'Twenty minutes in the queue, eight for the pasta. Still the best £9 in the city.',
        'Tagliatelle with the ragu this time. The butter and sage is the one I keep coming back for.',
    ],
    padellaSecond: [
        'Brown crab tagliarini over the cacio e pepe — controversial but right.',
        'Sat at the counter and watched them roll it. The burrata starter is worth the extra tenner.',
        'Went at open on a Tuesday and walked straight in. Cacio e pepe, then a second bowl.',
    ],
    brat: [
        'Whole turbot over the fire — worth every minute of the wait. Burnt cheesecake to finish.',
        'The spider crab is the thing to order. Smoke gets into everything, in the best way.',
        'Grilled bread and anchovies, then the turbot to share. Slow lunch, no regrets.',
    ],
    stjohn: [
        'Bone marrow on toast, a glass of the house red. Quietly perfect lunch.',
        'Welsh rarebit and a madeleine. The dining room is as plain and as good as everyone says.',
        'Ate the whole parsley salad myself. Came for the marrow, stayed for the eccles cake.',
    ],
    tayyabs: [
        'Dry meat lamb chops, order double. BYOB keeps the bill honest.',
        'Lamb chops still spitting when they land. Karahi and naan, four of us, forty quid.',
        'Queued twenty minutes on a Thursday. Worth it for the chops and the seekh kebab.',
    ],
} as const;

/** Stable per demo generation: same accounts re-seed identically, new ones differ. */
function generationVariant(seed: string): number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return h;
}

function pick(pool: readonly string[], variant: number): string {
    return pool[variant % pool.length];
}

async function main() {
    console.log('→ signing in demo accounts…');
    const a = await signUpOrIn(ACCOUNTS.a.email, ACCOUNTS.a.password);
    const b = await signUpOrIn(ACCOUNTS.b.email, ACCOUNTS.b.password);
    console.log(`  A=${a.user_id}  B=${b.user_id}`);

    // Display names + usernames (separate actions per user-profile contract).
    const soft = (p: Promise<any>, label: string) => p.catch((e) => console.log(`  (${label}: ${e.message.slice(0, 120)})`));
    const profileA = await soft(edge(a, 'user-profile', { action: 'update_profile', display_name: 'Alex Reviewer' }), 'profile A');
    // Handles are globally unique and are NEVER released except by account
    // deletion, so a previous seed run permanently owns its usernames. Override
    // via env when re-seeding onto fresh accounts, or the new profiles end up
    // with no handle at all (the 409 is soft-failed).
    const usernameA = Deno.env.get('DEMO_USERNAME_A') ?? 'alexeats';
    const usernameB = Deno.env.get('DEMO_USERNAME_B') ?? 'billietries';
    await soft(edge(a, 'user-profile', { action: 'update_username', username: usernameA }), 'username A');
    const profileB = await soft(edge(b, 'user-profile', { action: 'update_profile', display_name: 'Billie Tablemate' }), 'profile B');
    await soft(edge(b, 'user-profile', { action: 'update_username', username: usernameB }), 'username B');

    // ── Clear the onboarding gate ────────────────────────────────────────────
    // MUST NOT be soft-failed, and must run for BOTH accounts.
    //
    // `onboarded_at` is stamped by exactly one action — `complete_onboarding`
    // (user-profile). `update_profile` does NOT stamp it. Without this call the
    // seeded accounts carry onboarded_at = NULL, and app/_layout.tsx routes any
    // sign-in straight into /onboarding.
    //
    // That is a submission blocker, not a cosmetic one: onboarding's photo step
    // is MANDATORY as of 2026-07-26 (the Skip affordance was removed so every
    // account has an avatar). An App Review tester signing in with the demo
    // credentials would be walled behind a photo picker on a device whose
    // library they don't control, with Cloud Vision moderation in the path —
    // i.e. a Guideline 2.1 "unable to sign in / app incomplete" rejection.
    //
    // complete_onboarding also stamps terms_accepted_at and sets
    // account_privacy='public', both of which the reviewer's account wants.
    //
    // avatar_url is threaded back through DELIBERATELY. fn_complete_onboarding
    // assigns `avatar_url = v_avatar` UNCONDITIONALLY, so omitting it writes
    // NULL. This script is idempotent by design and meant to be re-run to top
    // the accounts up — without this, the second run would silently strip an
    // avatar someone had set on the review account by hand.
    const carryAvatar = (profile: any) =>
        typeof profile?.avatar_url === 'string' && profile.avatar_url
            ? { avatar_url: profile.avatar_url }
            : {};

    console.log('→ completing onboarding (clears the /onboarding gate)…');
    await edge(a, 'user-profile', {
        action: 'complete_onboarding',
        display_name: 'Alex Reviewer',
        home_city: 'London',
        ...carryAvatar(profileA),
    });
    await edge(b, 'user-profile', {
        action: 'complete_onboarding',
        display_name: 'Billie Tablemate',
        home_city: 'London',
        ...carryAvatar(profileB),
    });
    console.log('  ✓ onboarded_at stamped on both accounts');

    console.log('→ mutual follow…');
    await edge(a, 'user-profile', { action: 'follow', target_user_id: b.user_id });
    await edge(b, 'user-profile', { action: 'follow', target_user_id: a.user_id });

    console.log('→ table…');
    const table = await edge(a, 'table-management', { name: 'thursday club' });
    const tableId = table?.id ?? table?.table?.id;
    if (!tableId) throw new Error(`table create returned no id: ${JSON.stringify(table).slice(0, 200)}`);
    // add_member does NOT create a membership — it upserts a PENDING invitation
    // (TICKET-133) that the invitee must accept before a table_members row
    // exists. Without the accept below, Billie is not a member, and every entry
    // she posts to this table 403s with `table_not_authorized`, aborting the
    // seed partway through. The old script logged "Billie added" and moved on.
    const invite = await edge(
        a,
        'table-management',
        { table_id: tableId, target_user_id: b.user_id },
        '?action=add_member',
    );
    if (invite?.already_member) {
        console.log(`  ✓ "thursday club" (${tableId}) — Billie already a member`);
    } else {
        const invitationId = invite?.invitation_id;
        if (!invitationId) {
            throw new Error(
                `add_member returned no invitation_id: ${JSON.stringify(invite).slice(0, 200)}`,
            );
        }
        await edge(
            b,
            'table-management',
            { invitation_id: invitationId, response: 'accept' },
            '?action=respond_invitation',
        );
        console.log(`  ✓ "thursday club" (${tableId}) + Billie accepted`);
    }

    console.log('→ entries for A (shared to the table)…');
    // Review copy varies per demo generation. Re-seeding prod for a new review
    // cycle used to write the SAME sentence again, so after the 2026-09-07 Padella
    // merge the canonical page showed one identical review six times from four
    // "different" people — obviously synthetic to anyone reading it. The variant is
    // derived from the account email, so a given generation is stable across
    // re-runs (the seeder is idempotent) while a new generation reads differently.
    const variant = generationVariant(ACCOUNTS.a.email);
    const entryNotes: Array<[number, number, string]> = [
        [0, 4.5, pick(REVIEW_COPY.padella, variant)],
        [1, 5, pick(REVIEW_COPY.brat, variant)],
        [2, 4, pick(REVIEW_COPY.stjohn, variant)],
    ];
    let firstEntryId: string | null = null;
    let firstRestaurantId: string | null = null;
    for (const [i, rating, content] of entryNotes) {
        const created = await edge(a, 'entry', {
            restaurant: SPOTS[i],
            rating,
            content,
            visited_at: daysAgo(9 - i * 3),
            table_ids: [tableId],
            visibility: 'table',
        });
        if (!firstEntryId) firstEntryId = created?.id ?? null;
        if (!firstRestaurantId) firstRestaurantId = created?.restaurant_id ?? null;
        console.log(`  ✓ ${SPOTS[i].name} (${rating})`);
    }

    console.log('→ entries for B (shared to the table)…');
    await edge(b, 'entry', {
        restaurant: SPOTS[3],
        rating: 4.5,
        content: pick(REVIEW_COPY.tayyabs, variant),
        visited_at: daysAgo(4),
        table_ids: [tableId],
        visibility: 'table',
    });
    await edge(b, 'entry', {
        // Billie logs the same restaurant as Alex, so her line must come from a
        // different pool — otherwise the two accounts echo each other verbatim on
        // the one page a reviewer is most likely to open.
        restaurant: SPOTS[0],
        rating: 4,
        content: pick(REVIEW_COPY.padellaSecond, variant),
        visited_at: daysAgo(2),
        table_ids: [tableId],
        visibility: 'table',
    });
    console.log('  ✓ 2 entries');

    console.log('→ wishlist saves for A…');
    for (const spot of [SPOTS[3], SPOTS[4]]) {
        // Same ghost payload shape as entries (RestaurantPayload — external_id + location).
        await edge(a, 'wishlist', { action: 'add', restaurant: spot });
        console.log(`  ✓ saved ${spot.name}`);
    }

    console.log('→ comment from B on A’s first entry…');
    if (firstEntryId) {
        await edge(b, 'post-interactions', {
            action: 'comment',
            target_type: 'entry',
            target_id: firstEntryId,
            scope: 'table',
            table_id: tableId,
            body: 'Adding the burrata next time — split it?',
        });
        console.log('  ✓ comment');
    }

    console.log('\nDone. Review-notes account: A (Alex Reviewer).');
    // For the CI smoke secret — a real persisted restaurant on prod.
    console.log(`PROD_SMOKE_TEST_RESTAURANT_ID candidate: ${firstRestaurantId ?? '(entry returned no restaurant_id — query restaurants table)'}`);
}

main().catch((e) => {
    console.error(`✗ seed failed: ${e.message}`);
    Deno.exit(1);
});
