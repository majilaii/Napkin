#!/usr/bin/env node
/**
 * Seed script — populates Sunday Roast Club with realistic data.
 * Run: node scripts/seed.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

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

async function main() {
    console.log('🌱 Seeding Sunday Roast Club...\n');

    // 1. Restaurants
    console.log('📍 Creating restaurants...');
    const restaurants = await post('restaurants', [
        { external_id: 'gp-carbone-nyc', name: 'Carbone', address: '181 Thompson St, New York, NY 10012', city: 'New York', country: 'United States', lat: 40.7277, lng: -73.9993 },
        { external_id: 'gp-buvette-nyc', name: 'Buvette', address: '42 Grove St, New York, NY 10014', city: 'New York', country: 'United States', lat: 40.7329, lng: -74.0029 },
        { external_id: 'gp-tatiana-nyc', name: 'Tatiana by Kwame Onwuachi', address: '10 Lincoln Center Plaza, New York, NY 10023', city: 'New York', country: 'United States', lat: 40.7725, lng: -73.9835 },
        { external_id: 'gp-apotheke-nyc', name: 'Apothéke', address: '9 Doyers St, New York, NY 10013', city: 'New York', country: 'United States', lat: 40.7139, lng: -73.9981 },
    ]);
    const rMap = {};
    for (const r of restaurants) rMap[r.name] = r.id;
    console.log('  ✅', Object.keys(rMap).join(', '));

    // 2. Solo entries shared to the table
    console.log('\n📝 Creating solo entries...');
    const entries = await post('entries', [
        {
            user_id: MAJI,
            restaurant_id: rMap['Tatiana by Kwame Onwuachi'],
            rating: 4.5,
            content: 'The egusi with short rib was insane. Plantain dessert might be the best thing I\'ve eaten this year.',
            dish_description: 'Egusi, jollof rice, plantain dessert',
            visited_at: '2026-04-10T19:30:00Z',
            table_id: TABLE_ID,
            visibility: 'table',
        },
        {
            user_id: JACKY,
            restaurant_id: rMap['Apothéke'],
            rating: null,
            content: 'Need to come back for dinner — only had drinks. The opium den vibes are immaculate.',
            dish_description: null,
            visited_at: '2026-04-08T21:00:00Z',
            table_id: TABLE_ID,
            visibility: 'table',
        },
        {
            user_id: JACKY,
            restaurant_id: rMap['Tatiana by Kwame Onwuachi'],
            rating: 4.0,
            content: 'Finally tried it. The suya-spiced prawns lived up to the hype but the wait was brutal even with a res.',
            dish_description: 'Suya prawns, oxtail, rum punch',
            visited_at: '2026-04-06T20:00:00Z',
            table_id: TABLE_ID,
            visibility: 'table',
        },
        {
            user_id: MAJI,
            restaurant_id: rMap['Carbone'],
            rating: 3.5,
            content: 'Spicy rigatoni is a religious experience but the markup is borderline criminal. Still going back.',
            dish_description: 'Spicy rigatoni, veal parm, Caesar salad',
            visited_at: '2026-04-02T19:00:00Z',
            table_id: TABLE_ID,
            visibility: 'table',
        },
    ]);
    console.log(`  ✅ ${entries.length} solo entries created`);

    // 3. Revealed Table Night at Buvette
    console.log('\n🍷 Creating Table Night at Buvette...');
    const [buvetteNight] = await post('table_nights', [{
        table_id: TABLE_ID,
        restaurant_id: rMap['Buvette'],
        host_user_id: JACKY,
        status: 'revealed',
        created_at: '2026-04-05T19:00:00Z',
        revealed_at: '2026-04-05T21:30:00Z',
    }]);
    console.log('  ✅ Table Night:', buvetteNight.id);

    const buvParticipants = await post('table_night_participants', [
        {
            table_night_id: buvetteNight.id,
            user_id: JACKY,
            rating: 4.0,
            notes: 'Croque madame was perfect. Wine list is chef\'s kiss. Felt like a Parisian weekend.',
            ready: true,
            vibe_rating: 4.5,
            flavor_rating: 4.0,
            service_rating: 3.5,
            value_rating: 3.0,
        },
        {
            table_night_id: buvetteNight.id,
            user_id: MAJI,
            rating: 4.5,
            notes: 'Tartine and the chocolate mousse were dreamy. Tiny tables but that\'s the charm.',
            ready: true,
            vibe_rating: 5.0,
            flavor_rating: 4.5,
            service_rating: 4.0,
            value_rating: 3.5,
        },
    ]);
    console.log(`  ✅ ${buvParticipants.length} participants rated`);

    // 4. Revealed Table Night at Carbone
    console.log('\n🥩 Creating Table Night at Carbone...');
    const [carboneNight] = await post('table_nights', [{
        table_id: TABLE_ID,
        restaurant_id: rMap['Carbone'],
        host_user_id: MAJI,
        status: 'revealed',
        created_at: '2026-03-28T19:30:00Z',
        revealed_at: '2026-03-28T22:00:00Z',
    }]);
    console.log('  ✅ Table Night:', carboneNight.id);

    const carbParticipants = await post('table_night_participants', [
        {
            table_night_id: carboneNight.id,
            user_id: JACKY,
            rating: 4.5,
            notes: 'The veal parm is genuinely life-changing. Mario\'s Caesar might be the GOAT.',
            ready: true,
            vibe_rating: 4.5,
            flavor_rating: 5.0,
            service_rating: 4.0,
            value_rating: 2.5,
        },
        {
            table_night_id: carboneNight.id,
            user_id: MAJI,
            rating: 3.5,
            notes: 'Food is elite but waiting 45 min past our res killed the mood. Spicy rig still slaps though.',
            ready: true,
            vibe_rating: 3.0,
            flavor_rating: 4.5,
            service_rating: 2.5,
            value_rating: 2.0,
        },
    ]);
    console.log(`  ✅ ${carbParticipants.length} participants rated`);

    console.log('\n🎉 Done! Sunday Roast Club is loaded with data.');
    console.log('   - 4 restaurants');
    console.log('   - 4 solo entries');
    console.log('   - 2 revealed table nights (Buvette + Carbone)');
}

main().catch(e => { console.error(e); process.exit(1); });
