#!/usr/bin/env node
/**
 * Seed script — populates Sunday Roast Club with realistic data.
 * Run: node scripts/seed.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_SB_URL = 'https://ftvmseaqwwlcxtdlvxxz.supabase.co';

function loadEnvFromFile(filePath) {
    if (!fs.existsSync(filePath)) return {};

    const entries = {};
    const content = fs.readFileSync(filePath, 'utf8');

    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;

        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim().replace(/^"|"$/g, '');
        entries[key] = value;
    }

    return entries;
}

const repoRoot = process.cwd();
const localEnv = loadEnvFromFile(path.join(repoRoot, 'supabase', '.env.local'));

const SB_URL = process.env.SUPABASE_URL ?? localEnv.SUPABASE_URL ?? DEFAULT_SB_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!SB_KEY) {
    console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
    console.error('   Set it in the shell or in supabase/.env.local before running the seed script.');
    process.exit(1);
}

const TABLE_ID = 'd33dc063-8957-4b6c-94ec-d5e9e272a370'; // Sunday Roast Club
const JACKY = 'dcfce66a-28f2-4019-935a-f7421f42e59b';
const MAJI = '785f0020-8b99-4a6f-9ef0-b0044f0c6e3f';

// Deterministic UUIDs for seed friends (so re-runs are idempotent)
const ELENA  = 'a1b2c3d4-1111-4aaa-bbbb-000000000001';
const DEREK  = 'a1b2c3d4-2222-4aaa-bbbb-000000000002';
const PRIYA  = 'a1b2c3d4-3333-4aaa-bbbb-000000000003';
const TOMOKO = 'a1b2c3d4-4444-4aaa-bbbb-000000000004';

const SEED_FRIENDS = [
    { id: ELENA,  email: 'elena.seed@napkin.test',  display_name: 'Elena' },
    { id: DEREK,  email: 'derek.seed@napkin.test',  display_name: 'Derek' },
    { id: PRIYA,  email: 'priya.seed@napkin.test',  display_name: 'Priya' },
    { id: TOMOKO, email: 'tomoko.seed@napkin.test', display_name: 'Tomoko' },
];

const headers = {
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
};

async function post(table, data) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) {
        console.error(`❌ POST ${table}:`, JSON.stringify(json, null, 2));
        throw new Error(`POST ${table} failed: ${res.status}`);
    }
    return json;
}

async function upsert(table, data, { onConflict } = {}) {
    const h = { ...headers, 'Prefer': 'return=representation,resolution=merge-duplicates' };
    let url = `${SB_URL}/rest/v1/${table}`;
    if (onConflict) url += `?on_conflict=${onConflict}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: h,
        body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) {
        console.error(`❌ UPSERT ${table}:`, JSON.stringify(json, null, 2));
        throw new Error(`UPSERT ${table} failed: ${res.status}`);
    }
    return json;
}

/** Create a Supabase auth user via the admin API (idempotent — skips if exists). */
async function createAuthUser({ id, email, display_name }) {
    const res = await fetch(`${SB_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
            'apikey': SB_KEY,
            'Authorization': `Bearer ${SB_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            id,
            email,
            password: 'seed-password-123!',
            email_confirm: true,
            user_metadata: { display_name },
        }),
    });
    if (res.status === 422) {
        // User already exists — that's fine
        console.log(`  ⏭️  ${display_name} already exists, skipping`);
        return;
    }
    if (!res.ok) {
        const err = await res.json();
        console.error(`❌ Create auth user ${display_name}:`, JSON.stringify(err, null, 2));
        throw new Error(`Create auth user failed: ${res.status}`);
    }
    console.log(`  ✅ Created auth user: ${display_name}`);
}

async function main() {
    console.log('🌱 Seeding Sunday Roast Club...\n');

    // 0. Create seed friend auth users
    // The handle_new_user trigger auto-creates profiles, value_profiles, and personal tables.
    console.log('👥 Creating seed friend accounts...');
    for (const friend of SEED_FRIENDS) {
        await createAuthUser(friend);
    }

    // 0b. Add seed friends as members of Sunday Roast Club
    console.log('\n🪑 Adding friends to Sunday Roast Club...');
    await upsert('table_members', SEED_FRIENDS.map(f => ({
        table_id: TABLE_ID,
        member_id: f.id,
        role: 'member',
    })));
    console.log(`  ✅ ${SEED_FRIENDS.length} friends added to the table`);

    // 1. Restaurants (added more spots)
    console.log('\n📍 Creating restaurants...');
    const restaurants = await upsert('restaurants', [
        { external_id: 'gp-carbone-nyc', name: 'Carbone', address: '181 Thompson St, New York, NY 10012', city: 'New York', country: 'United States', lat: 40.7277, lng: -73.9993 },
        { external_id: 'gp-buvette-nyc', name: 'Buvette', address: '42 Grove St, New York, NY 10014', city: 'New York', country: 'United States', lat: 40.7329, lng: -74.0029 },
        { external_id: 'gp-tatiana-nyc', name: 'Tatiana by Kwame Onwuachi', address: '10 Lincoln Center Plaza, New York, NY 10023', city: 'New York', country: 'United States', lat: 40.7725, lng: -73.9835 },
        { external_id: 'gp-apotheke-nyc', name: 'Apothéke', address: '9 Doyers St, New York, NY 10013', city: 'New York', country: 'United States', lat: 40.7139, lng: -73.9981 },
        { external_id: 'gp-lsede-nyc', name: "L'Artusi", address: '228 W 10th St, New York, NY 10014', city: 'New York', country: 'United States', lat: 40.7340, lng: -74.0030 },
        { external_id: 'gp-joes-nyc', name: "Joe's Pizza", address: '7 Carmine St, New York, NY 10014', city: 'New York', country: 'United States', lat: 40.7306, lng: -74.0021 },
        { external_id: 'gp-russ-nyc', name: "Russ & Daughters Cafe", address: '127 Orchard St, New York, NY 10002', city: 'New York', country: 'United States', lat: 40.7204, lng: -73.9892 },
        { external_id: 'gp-xian-nyc', name: "Xi'an Famous Foods", address: '45 Bayard St, New York, NY 10013', city: 'New York', country: 'United States', lat: 40.7155, lng: -73.9990 },
    ], { onConflict: 'external_id' });
    const rMap = {};
    for (const r of restaurants) rMap[r.name] = r.id;
    console.log('  ✅', Object.keys(rMap).join(', '));

    // Helper: fetch existing rows
    async function get(table, query = '') {
        const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, { headers });
        if (!res.ok) return [];
        return res.json();
    }

    // 2. Solo entries — only insert new ones from friends (skip if they already have entries)
    console.log('\n📝 Creating solo entries...');

    // Check which friends already have entries in this table
    const existingEntries = await get('entries', `table_id=eq.${TABLE_ID}&select=user_id`);
    const usersWithEntries = new Set(existingEntries.map(e => e.user_id));

    const newEntries = [];
    // --- Elena's entries ---
    if (!usersWithEntries.has(ELENA)) {
        newEntries.push(
            {
                user_id: ELENA,
                restaurant_id: rMap["L'Artusi"],
                rating: 4.5,
                content: 'The spaghetti cacio e pepe is worth the 2-hour wait. Burrata was pillowy perfection. Bring wine friends.',
                dish_description: 'Cacio e pepe, burrata, grilled octopus',
                visited_at: '2026-04-11T20:00:00Z',
                table_id: TABLE_ID,
                visibility: 'table',
            },
            {
                user_id: ELENA,
                restaurant_id: rMap['Carbone'],
                rating: 4.0,
                content: 'Went back after Maji hyped the rigatoni. Can confirm it\'s elite. The meatball is slept on though.',
                dish_description: 'Spicy rigatoni, meatball, tiramisu',
                visited_at: '2026-04-03T19:30:00Z',
                table_id: TABLE_ID,
                visibility: 'table',
            },
        );
    }
    // --- Derek's entries ---
    if (!usersWithEntries.has(DEREK)) {
        newEntries.push(
            {
                user_id: DEREK,
                restaurant_id: rMap["Joe's Pizza"],
                rating: 3.5,
                content: 'Look, it\'s a perfect slice. No notes. The pepperoni has the right amount of grease cup action.',
                dish_description: 'Pepperoni slice, plain slice',
                visited_at: '2026-04-09T13:00:00Z',
                table_id: TABLE_ID,
                visibility: 'table',
            },
            {
                user_id: DEREK,
                restaurant_id: rMap["Russ & Daughters Cafe"],
                rating: 4.0,
                content: 'The classic board with nova and cream cheese is undefeated. Egg cream was a revelation.',
                dish_description: 'Nova board, egg cream, babka',
                visited_at: '2026-04-07T11:00:00Z',
                table_id: TABLE_ID,
                visibility: 'table',
            },
            {
                user_id: DEREK,
                restaurant_id: rMap['Tatiana by Kwame Onwuachi'],
                rating: 5.0,
                content: 'I don\'t give 5s. But the oxtail was transcendent. Literally teared up. Kwame is a genius.',
                dish_description: 'Oxtail, cornbread, suya prawns',
                visited_at: '2026-04-01T19:00:00Z',
                table_id: TABLE_ID,
                visibility: 'table',
            },
        );
    }
    // --- Priya's entries ---
    if (!usersWithEntries.has(PRIYA)) {
        newEntries.push(
            {
                user_id: PRIYA,
                restaurant_id: rMap["Xi'an Famous Foods"],
                rating: 4.5,
                content: 'The hand-pulled noodles with cumin lamb are everything. Spicy level 3 almost took me out. Worth it.',
                dish_description: 'Cumin lamb noodles, liang pi cold skin noodles',
                visited_at: '2026-04-12T12:30:00Z',
                table_id: TABLE_ID,
                visibility: 'table',
            },
            {
                user_id: PRIYA,
                restaurant_id: rMap['Buvette'],
                rating: 4.0,
                content: 'Perfect brunch spot. The tartine with smoked salmon was gorgeous. Great people-watching from the window seat.',
                dish_description: 'Smoked salmon tartine, café au lait, croissant',
                visited_at: '2026-04-04T10:30:00Z',
                table_id: TABLE_ID,
                visibility: 'table',
            },
        );
    }
    // --- Tomoko's entries ---
    if (!usersWithEntries.has(TOMOKO)) {
        newEntries.push(
            {
                user_id: TOMOKO,
                restaurant_id: rMap["L'Artusi"],
                rating: 3.5,
                content: 'Pasta was solid but didn\'t blow my mind the way everyone said. The lavender panna cotta was the real star.',
                dish_description: 'Pappardelle, panna cotta, bruschetta',
                visited_at: '2026-04-13T19:00:00Z',
                table_id: TABLE_ID,
                visibility: 'table',
            },
            {
                user_id: TOMOKO,
                restaurant_id: rMap['Apothéke'],
                rating: 4.5,
                content: 'Best cocktail bar in the city and I will die on this hill. The Opium was dangerously good.',
                dish_description: null,
                visited_at: '2026-04-08T22:00:00Z',
                table_id: TABLE_ID,
                visibility: 'table',
            },
            {
                user_id: TOMOKO,
                restaurant_id: rMap["Joe's Pizza"],
                rating: 3.0,
                content: 'Controversial take: it\'s good but Prince Street pepperoni squares are better. Please don\'t kick me out of the table.',
                dish_description: 'Plain slice',
                visited_at: '2026-04-05T14:00:00Z',
                table_id: TABLE_ID,
                visibility: 'table',
            },
        );
    }

    let allEntries;
    if (newEntries.length > 0) {
        const created = await post('entries', newEntries);
        console.log(`  ✅ ${created.length} new entries created`);
        // Fetch all entries for likes/comments later
        allEntries = await get('entries', `table_id=eq.${TABLE_ID}&order=visited_at.desc&select=id,user_id`);
    } else {
        console.log('  ⏭️  Friend entries already exist, skipping');
        allEntries = await get('entries', `table_id=eq.${TABLE_ID}&order=visited_at.desc&select=id,user_id`);
    }

    // 3. Table Nights — check what already exists
    const existingNights = await get('table_nights', `table_id=eq.${TABLE_ID}&select=id,restaurant_id`);
    const nightRestaurantIds = new Set(existingNights.map(n => n.restaurant_id));

    // Add extra participants to existing table nights that only have 2 participants
    for (const night of existingNights) {
        const participants = await get('table_night_participants', `table_night_id=eq.${night.id}&select=user_id`);
        const existingUserIds = new Set(participants.map(p => p.user_id));

        if (night.restaurant_id === rMap['Buvette'] && !existingUserIds.has(ELENA)) {
            console.log('\n🍷 Adding extra participants to Buvette Table Night...');
            await post('table_night_participants', [
                {
                    table_night_id: night.id,
                    user_id: ELENA,
                    rating: 4.0,
                    notes: 'The wine selection carried this for me. Food was great but the vibe is what makes Buvette special.',
                    ready: true,
                    vibe_rating: 5.0,
                    flavor_rating: 3.5,
                    service_rating: 4.0,
                    value_rating: 3.0,
                },
                {
                    table_night_id: night.id,
                    user_id: PRIYA,
                    rating: 3.5,
                    notes: 'Cute spot but portions are tiny for the price. Chocolate mousse was amazing though.',
                    ready: true,
                    vibe_rating: 4.5,
                    flavor_rating: 4.0,
                    service_rating: 3.5,
                    value_rating: 2.0,
                },
            ]);
            console.log('  ✅ Elena + Priya added to Buvette night');
        }

        if (night.restaurant_id === rMap['Carbone'] && !existingUserIds.has(DEREK)) {
            console.log('\n🥩 Adding extra participants to Carbone Table Night...');
            await post('table_night_participants', [
                {
                    table_night_id: night.id,
                    user_id: DEREK,
                    rating: 4.0,
                    notes: 'Old-school Italian done right. The garlic bread alone is worth the trip. Felt like a scene from Goodfellas.',
                    ready: true,
                    vibe_rating: 5.0,
                    flavor_rating: 4.5,
                    service_rating: 3.5,
                    value_rating: 2.0,
                },
                {
                    table_night_id: night.id,
                    user_id: TOMOKO,
                    rating: 3.0,
                    notes: 'Overhyped honestly. The rigatoni was great but everything else felt like a flex. Way too loud.',
                    ready: true,
                    vibe_rating: 2.5,
                    flavor_rating: 4.0,
                    service_rating: 3.0,
                    value_rating: 1.5,
                },
            ]);
            console.log('  ✅ Derek + Tomoko added to Carbone night');
        }
    }

    // 4. NEW: In-progress Table Night at L'Artusi (only if it doesn't exist)
    const artusiRestId = rMap["L'Artusi"];
    const existingArtusiNight = existingNights.find(n => n.restaurant_id === artusiRestId);
    let artusiNightId;

    if (!existingArtusiNight) {
        console.log("\n🍝 Creating Table Night at L'Artusi (in progress)...");
        const [artusiNight] = await post('table_nights', [{
            table_id: TABLE_ID,
            restaurant_id: artusiRestId,
            host_user_id: ELENA,
            status: 'rating',
            created_at: '2026-04-14T19:00:00Z',
        }]);
        artusiNightId = artusiNight.id;
        console.log('  ✅ Table Night:', artusiNightId);
    } else {
        artusiNightId = existingArtusiNight.id;
        console.log(`\n  ⏭️  L'Artusi table night already exists (${artusiNightId})`);
    }

    // Add participants if missing
    const artusiParticipantsExisting = await get('table_night_participants', `table_night_id=eq.${artusiNightId}&select=user_id`);
    if (artusiParticipantsExisting.length === 0) {
        console.log("  🍝 Adding participants to L'Artusi night...");
        const artusiParticipants = await post('table_night_participants', [
            {
                table_night_id: artusiNightId,
                user_id: ELENA,
                rating: 4.5,
                notes: 'Host pick and I stand by it. The cacio e pepe was heavenly. Best pasta night we\'ve had.',
                ready: true,
                vibe_rating: 4.5,
                flavor_rating: 5.0,
                service_rating: 4.0,
                value_rating: 3.5,
            },
            {
                table_night_id: artusiNightId,
                user_id: JACKY,
                rating: 4.0,
                notes: 'Really solid pick Elena. The octopus was incredible.',
                ready: true,
                vibe_rating: 4.0,
                flavor_rating: 4.5,
                service_rating: 4.0,
                value_rating: 3.0,
            },
            {
                table_night_id: artusiNightId,
                user_id: DEREK,
                rating: null,
                notes: null,
                ready: false,
                vibe_rating: null,
                flavor_rating: null,
                service_rating: null,
                value_rating: null,
            },
            {
                table_night_id: artusiNightId,
                user_id: PRIYA,
                rating: null,
                notes: null,
                ready: false,
                vibe_rating: null,
                flavor_rating: null,
                service_rating: null,
                value_rating: null,
            },
            {
                table_night_id: artusiNightId,
                user_id: TOMOKO,
                rating: 3.5,
                notes: 'The panna cotta was the standout. Pasta was good but not life-changing for me.',
                ready: true,
                vibe_rating: 3.5,
                flavor_rating: 3.5,
                service_rating: 4.0,
                value_rating: 3.0,
            },
        ]);
        console.log(`  ✅ ${artusiParticipants.length} participants (3 rated, 2 pending)`);
    } else {
        console.log(`  ⏭️  L'Artusi participants already exist (${artusiParticipantsExisting.length})`);
    }

    // 5. Likes and comments on entries (only if none exist yet)
    const existingLikes = await get('table_activity_likes', `select=entry_id&limit=1`);
    if (existingLikes.length === 0 && allEntries.length > 0) {
        console.log('\n💬 Adding likes and comments...');
        // Build a map of entries by user for targeted likes/comments
        const entryByUser = {};
        for (const e of allEntries) {
            if (!entryByUser[e.user_id]) entryByUser[e.user_id] = [];
            entryByUser[e.user_id].push(e.id);
        }

        const likesData = [];
        const addLike = (userId, targetUserId, idx = 0) => {
            const entries = entryByUser[targetUserId];
            if (entries && entries[idx]) likesData.push({ entry_id: entries[idx], user_id: userId });
        };

        // Cross-like each other's entries
        addLike(JACKY, MAJI, 0);
        addLike(ELENA, MAJI, 0);
        addLike(DEREK, MAJI, 0);
        addLike(MAJI, JACKY, 0);
        addLike(PRIYA, JACKY, 0);
        addLike(JACKY, ELENA, 0);
        addLike(TOMOKO, ELENA, 0);
        addLike(ELENA, DEREK, 0);
        addLike(MAJI, DEREK, 1);
        addLike(JACKY, DEREK, 1);
        addLike(PRIYA, DEREK, 1);
        addLike(DEREK, PRIYA, 0);
        addLike(JACKY, TOMOKO, 1);
        addLike(MAJI, TOMOKO, 1);

        if (likesData.length > 0) {
            await post('table_activity_likes', likesData);
            console.log(`  ✅ ${likesData.length} likes`);
        }

        const commentsData = [];
        const addComment = (userId, targetUserId, idx, content) => {
            const entries = entryByUser[targetUserId];
            if (entries && entries[idx]) commentsData.push({ entry_id: entries[idx], user_id: userId, content });
        };

        addComment(JACKY, MAJI, 0, 'The plantain dessert is INSANE agree 100%');
        addComment(DEREK, MAJI, 0, 'Need to go back just for that egusi');
        addComment(ELENA, JACKY, 0, 'The wait is real but so worth it');
        addComment(PRIYA, ELENA, 0, 'Adding this to my must-try list!!');
        addComment(TOMOKO, DEREK, 0, 'Joe\'s is good but have you tried Prince St??? 👀');
        addComment(DEREK, DEREK, 0, 'Don\'t start this debate again Tomoko 😂');
        addComment(ELENA, DEREK, 1, 'A FIVE?! Derek never gives 5s this must be legit');
        addComment(MAJI, DEREK, 1, 'Told you. Kwame doesn\'t miss.');
        addComment(DEREK, TOMOKO, 1, 'The cocktails there are next level fr');
        addComment(PRIYA, TOMOKO, 2, 'Tomoko you\'re brave for that take 😅');

        if (commentsData.length > 0) {
            await post('table_activity_comments', commentsData);
            console.log(`  ✅ ${commentsData.length} comments`);
        }
    } else {
        console.log('\n  ⏭️  Likes/comments already exist, skipping');
    }

    console.log('\n🎉 Done! Sunday Roast Club is loaded with data.');
    console.log('   - 6 members (Jacky, Maji, Elena, Derek, Priya, Tomoko)');
    console.log('   - 8 restaurants');
    console.log('   - 14 solo entries');
    console.log('   - 2 revealed table nights (Buvette + Carbone) with 4 participants each');
    console.log('   - 1 in-progress table night (L\'Artusi) with 3/5 rated');
    console.log('   - likes + comments on entries');
}

main().catch(e => { console.error(e); process.exit(1); });
