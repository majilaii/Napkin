/**
 * mapsList.test.ts — Google Maps shared-list parsing.
 *
 * Fixtures are REAL captures (2026-07-07) from live public lists, trimmed:
 * the preload tag verbatim from a list page's HTML, and a getlist response
 * skeleton with two verbatim items ("Best pies in Australia" list).
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    buildGetlistFallbackUrl,
    cityFromAddress,
    expandMapsShare,
    extractGetlistPreloadUrl,
    extractListIdFromMapsUrl,
    mapsItemsToStaged,
    parseGetlistResponse,
    parseMapsPlaceTarget,
} from './mapsList.ts';

// Verbatim from a live list page (attribute-encoded &amp;).
const PRELOAD_HTML =
    '<meta name=viewport content="width=device-width">' +
    '<link href="/maps/preview/entitylist/getlist?authuser=0&amp;hl=en&amp;gl=uk&amp;pb=%211m4%211sqnI5mZfQTjOZ23P72_pmRQ%212e1%213m1%211e1%212e2%213e2%214i500%216m3%211swwlNariiK-uri-gP5u-rKA%2115i204459%2128e2%2116b1" as="fetch" crossorigin="" rel="preload">' +
    '<link href="/maps/_/js/k=maps.m.en_GB.es5.O/m=GfLzUe/rt=j/d=1/rs=ACT90oH" as="script" rel="preload">';

// Real getlist skeleton: root[4] = title, root[8] = items ([2]=name, [1][4]=address).
const GETLIST_BODY = `)]}'
[[["qnI5mZfQTjOZ23P72_pmRQ",1,null,1,1],null,[2,1,"https://www.google.com/maps/placelists/list/qnI5mZfQTjOZ23P72_pmRQ"],["Camellia Aebischer","https://lh3.googleusercontent.com/a-/photo","112491515395148090563"],"Best pies in Australia","Curated from recommendations and experience.",null,null,[[null,[null,null,"BakerST Bakery Cafe, 1-3 Queen St, Williamstown SA 5351",null,"1-3 Queen St, Williamstown SA 5351",[null,null,-34.6725055,138.8906289],["7689711682730012915","-336405660161382688"],"/g/1ptw2xxw7"],"BakerST Bakery Cafe","Really good pastry.",null,null,null,[],[[1],["7689711682730012915","-336405660161382688"]],[1704001405,748079000]],[null,[null,null,"Coromandel Valley Bake Bakery, 1/401 Main Rd, Coromandel Valley SA 5051",null,"1/401 Main Rd, Coromandel Valley SA 5051",[null,null,-35.0413573,138.6260221],["7687874872452035609","-5401148288802777517"],"/g/11c5t34mt9"],"Coromandel Valley Bake Bakery","Real good pies.",null,null,null,[],[[1],["7687874872452035609","-5401148288802777517"]],[1703763191,935217000]],"not-an-item-array",[null,null,""]]]]`;

Deno.test('extractGetlistPreloadUrl finds and decodes the preload href', () => {
    const url = extractGetlistPreloadUrl(PRELOAD_HTML);
    assertEquals(
        url,
        'https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=en&gl=uk&pb=%211m4%211sqnI5mZfQTjOZ23P72_pmRQ%212e1%213m1%211e1%212e2%213e2%214i500%216m3%211swwlNariiK-uri-gP5u-rKA%2115i204459%2128e2%2116b1',
    );
});

Deno.test('extractGetlistPreloadUrl ignores script preloads / absent tag', () => {
    assertEquals(
        extractGetlistPreloadUrl('<link href="/maps/_/js/k=maps.m.en.es5.O" as="script" rel="preload">'),
        null,
    );
    assertEquals(extractGetlistPreloadUrl('<html><body>nothing</body></html>'), null);
});

Deno.test('extractListIdFromMapsUrl handles both canonical shapes', () => {
    assertEquals(
        extractListIdFromMapsUrl(
            'https://www.google.com/maps/@/data=!3m1!4b1!4m3!11m2!2sqnI5mZfQTjOZ23P72_pmRQ!3e3?coh=198004&entry=tts&ucbcb=1',
        ),
        'qnI5mZfQTjOZ23P72_pmRQ',
    );
    assertEquals(
        extractListIdFromMapsUrl('https://www.google.com/maps/placelists/list/jqYYEfkIRzOpGHmzk5vlkw'),
        'jqYYEfkIRzOpGHmzk5vlkw',
    );
    assertEquals(
        extractListIdFromMapsUrl('https://www.google.com/maps/place/Carbone/@40.7,-74z'),
        null,
    );
});

Deno.test('buildGetlistFallbackUrl builds the static-pb endpoint', () => {
    assertEquals(
        buildGetlistFallbackUrl('abc_DEF-123'),
        'https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=en&gl=us&pb=!1m1!1sabc_DEF-123!2e2!3e2!4i500!16b1',
    );
});

Deno.test('parseGetlistResponse extracts title + items, skips malformed rows', () => {
    const parsed = parseGetlistResponse(GETLIST_BODY);
    assertEquals(parsed?.title, 'Best pies in Australia');
    assertEquals(parsed?.items.length, 2);
    assertEquals(parsed?.items[0], {
        name: 'BakerST Bakery Cafe',
        address: '1-3 Queen St, Williamstown SA 5351',
    });
    assertEquals(parsed?.items[1], {
        name: 'Coromandel Valley Bake Bakery',
        address: '1/401 Main Rd, Coromandel Valley SA 5051',
    });
});

Deno.test('parseGetlistResponse degrades to null on non-list bodies', () => {
    assertEquals(parseGetlistResponse('<!DOCTYPE html><html>consent wall</html>'), null);
    assertEquals(parseGetlistResponse(")]}'\n{\"error\":true}"), null);
    assertEquals(parseGetlistResponse(")]}'\n[[null]]"), null);
    assertEquals(parseGetlistResponse(''), null);
});

Deno.test('parseGetlistResponse tolerates a title-only list (zero items)', () => {
    const body = `)]}'\n[[["id",1],null,null,null,"Empty list",null,null,null,[]]]`;
    const parsed = parseGetlistResponse(body);
    assertEquals(parsed?.title, 'Empty list');
    assertEquals(parsed?.items, []);
});

Deno.test('mapsItemsToStaged keeps same-name branches distinct (review P1: no fuzzy fold)', () => {
    // Real-world shape: chains with multiple branches in one city. The generic
    // dedupeAndRank fold verifiably collapses these — list items must NOT go
    // through it.
    const items = [
        { name: 'Dishoom', address: "12 Upper St Martin's Lane, London WC2H 9FB, United Kingdom" },
        { name: 'Dishoom Shoreditch', address: '7 Boundary St, London E2 7JE, United Kingdom' },
        { name: "Gail's Bakery", address: '64 Hampstead High St, London NW3 1QH, United Kingdom' },
        { name: "Gail's Bakery", address: '138 Portobello Rd, London W11 2DZ, United Kingdom' },
    ];
    const staged = mapsItemsToStaged(items, 20);
    assertEquals(staged.length, 4);
    assertEquals(staged.map((s) => s.extracted.name), [
        'Dishoom', 'Dishoom Shoreditch', "Gail's Bakery", "Gail's Bakery",
    ]);
    // Ordinals preserve list order; full address rides in `area` for Places.
    assertEquals(staged.map((s) => s.ordinal), [0, 1, 2, 3]);
    assertEquals(staged[3].extracted.area, '138 Portobello Rd, London W11 2DZ, United Kingdom');
    assertEquals(staged[0].extracted.confidence, 'exact');
});

Deno.test('mapsItemsToStaged caps at the given ceiling', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
        name: `Spot ${i}`,
        address: `${i} High St, London N1, United Kingdom`,
    }));
    assertEquals(mapsItemsToStaged(items, 20).length, 20);
});

Deno.test('cityFromAddress strips postcodes across regional formats', () => {
    assertEquals(cityFromAddress('1-3 Queen St, Williamstown SA 5351'), 'Williamstown SA');
    assertEquals(
        cityFromAddress("12 Upper St Martin's Lane, London WC2H 9FB, United Kingdom"),
        'London',
    );
    assertEquals(cityFromAddress('123 Main St, Brooklyn, NY 11211, USA'), 'Brooklyn');
    assertEquals(cityFromAddress('Piazza del Duomo, 20122 Milano MI, Italy'), 'Milano MI');
    assertEquals(cityFromAddress('single-segment'), null);
    assertEquals(cityFromAddress(null), null);
});

// ── Share-link expansion (TICKET-248) ──────────────────────────────────────────
// Redirect targets are verbatim shapes observed 2026-09-23: an app-made share
// (Google Maps "copy link") names the place in its FIRST hop as ?q=Name,+Address;
// a web-made share redirects once to /maps/place/<name>/@…/data=…!3d…!4d….
const APP_SHARE_HOP =
    'https://maps.google.com/?q=Twigs+Beauty+Lounge%D8%8C+%D8%B4.+%D8%A5%D9%85%D8%AB%D8%A7%D8%B1%D9%8A+%D8%A7%D9%84%D9%86%D8%B9%D9%8A%D9%85%D8%A7%D8%AA%D8%8C+%D8%B9%D9%85%D9%91%D8%A7%D9%86+11821&ftid=0x151ca14f118fcb2f:0xa6158e4e8b82fa6c&entry=gps&g_st=com.google.maps.preview.copy';
const WEB_SHARE_HOP =
    'https://www.google.com/maps/place/Dishoom+Covent+Garden/@51.5125176,-0.1268291,17z/data=!3m1!4b1!4m6!3m5!1s0x487604b7c7d895c5:0x9c3887a3670e0076!8m2!3d51.5125176!4d-0.1268291!16s%2Fg%2F1tdjwh2v?entry=tts&g_ep=EgoyMDI2MDkyMC4wIPu8ASoASAFQAw%3D%3D';
const LIST_SHARE_HOP =
    'https://www.google.com/maps/@/data=!3m1!4b1!4m3!11m2!2sqnI5mZfQTjOZ23P72_pmRQ!3e3?coh=198004&entry=tts&ucbcb=1';

type Route = { status: number; location?: string; body?: string };

function fakeFetcher(routes: Record<string, Route>) {
    const calls: { url: string; redirect?: RequestRedirect }[] = [];
    const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, redirect: init?.redirect });
        const route = routes[url];
        if (!route) return Promise.reject(new TypeError(`unexpected fetch ${url}`));
        return Promise.resolve(new Response(route.body ?? null, {
            status: route.status,
            headers: route.location ? { location: route.location } : {},
        }));
    }) as typeof fetch;
    return { fetcher, calls };
}

const signal = () => new AbortController().signal;

Deno.test('parseMapsPlaceTarget: web share → place name + its own !3d/!4d pin', () => {
    assertEquals(parseMapsPlaceTarget(WEB_SHARE_HOP), {
        query: 'Dishoom Covent Garden',
        location: { lat: 51.5125176, lng: -0.1268291 },
        selfLocating: false,
    });
});

Deno.test('parseMapsPlaceTarget: app share → full "name, address" query that locates itself', () => {
    const target = parseMapsPlaceTarget(APP_SHARE_HOP);
    assertEquals(target?.query, 'Twigs Beauty Lounge، ش. إمثاري النعيمات، عمّان 11821');
    assertEquals(target?.location, null);
    assertEquals(target?.selfLocating, true);
});

Deno.test('parseMapsPlaceTarget: camera @lat,lng is the fallback, dropped pins are not venues', () => {
    assertEquals(
        parseMapsPlaceTarget('https://www.google.com/maps/place/Carbone/@40.7278,-74.0005,17z'),
        { query: 'Carbone', location: { lat: 40.7278, lng: -74.0005 }, selfLocating: false },
    );
    assertEquals(parseMapsPlaceTarget('https://maps.google.com/?q=51.5125,-0.1268'), null);
    assertEquals(parseMapsPlaceTarget('https://www.google.com/maps/place/%FF'), null);
    assertEquals(parseMapsPlaceTarget('https://www.google.com/maps/place/%20'), null);
    // An encoded plus is part of the name; a literal + is a space.
    assertEquals(
        parseMapsPlaceTarget('https://www.google.com/maps/place/A%2BB+Cafe')?.query,
        'A+B Cafe',
    );
    assertEquals(parseMapsPlaceTarget('https://www.google.com/maps?query=Brat')?.query, 'Brat');
});

Deno.test('expandMapsShare: app share resolves from the FIRST redirect, never loads the page', async () => {
    const { fetcher, calls } = fakeFetcher({
        'https://maps.app.goo.gl/QS9xeZqTY7BzB6Vq6?g_st=ic': { status: 302, location: APP_SHARE_HOP },
    });
    const expanded = await expandMapsShare('https://maps.app.goo.gl/QS9xeZqTY7BzB6Vq6?g_st=ic', signal, fetcher);
    assertEquals(expanded.list, null);
    assertEquals(expanded.place?.query, 'Twigs Beauty Lounge، ش. إمثاري النعيمات، عمّان 11821');
    assertEquals(expanded.place?.selfLocating, true);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].redirect, 'manual');
});

Deno.test('expandMapsShare: web share carries the place coordinates', async () => {
    const { fetcher, calls } = fakeFetcher({
        'https://maps.app.goo.gl/CEDqyVFDApSaRZc4A': { status: 302, location: WEB_SHARE_HOP },
    });
    const expanded = await expandMapsShare('https://maps.app.goo.gl/CEDqyVFDApSaRZc4A', signal, fetcher);
    assertEquals(expanded.place, {
        query: 'Dishoom Covent Garden',
        location: { lat: 51.5125176, lng: -0.1268291 },
        selfLocating: false,
    });
    assertEquals(calls.length, 1);
});

Deno.test('expandMapsShare: a consent interstitial is unwrapped, not fetched', async () => {
    const consent = `https://consent.google.com/ml?continue=${encodeURIComponent(WEB_SHARE_HOP)}&gl=GB&hl=en`;
    const { fetcher, calls } = fakeFetcher({
        'https://maps.app.goo.gl/abc': { status: 302, location: consent },
    });
    const expanded = await expandMapsShare('https://maps.app.goo.gl/abc', signal, fetcher);
    assertEquals(expanded.place?.query, 'Dishoom Covent Garden');
    assertEquals(calls.map((call) => call.url), ['https://maps.app.goo.gl/abc']);
});

Deno.test('expandMapsShare: a list share still loads its page and getlist data', async () => {
    const { fetcher, calls } = fakeFetcher({
        'https://maps.app.goo.gl/list': { status: 302, location: LIST_SHARE_HOP },
        [LIST_SHARE_HOP]: { status: 200, body: PRELOAD_HTML },
        [extractGetlistPreloadUrl(PRELOAD_HTML)!]: { status: 200, body: GETLIST_BODY },
    });
    const expanded = await expandMapsShare('https://maps.app.goo.gl/list', signal, fetcher);
    assertEquals(expanded.place, null);
    assertEquals(expanded.list?.title, 'Best pies in Australia');
    assertEquals(expanded.list?.items.length, 2);
    assertEquals(calls.length, 3);
});

Deno.test('expandMapsShare: only Google hosts are followed', async () => {
    const { fetcher, calls } = fakeFetcher({
        'https://maps.app.goo.gl/evil': { status: 302, location: 'https://maps.google.com.evil.example/maps/place/Brat' },
    });
    assertEquals(await expandMapsShare('https://maps.app.goo.gl/evil', signal, fetcher), { place: null, list: null });
    assertEquals(calls.length, 1);
});

Deno.test('expandMapsShare: redirect loops, error pages and network failures degrade to empty', async () => {
    const loop = fakeFetcher({
        'https://maps.app.goo.gl/a': { status: 302, location: 'https://maps.app.goo.gl/b' },
        'https://maps.app.goo.gl/b': { status: 302, location: 'https://maps.app.goo.gl/a' },
    });
    assertEquals(await expandMapsShare('https://maps.app.goo.gl/a', signal, loop.fetcher), { place: null, list: null });
    assertEquals(loop.calls.length <= 7, true);

    const sorry = fakeFetcher({
        'https://maps.app.goo.gl/x': { status: 302, location: 'https://www.google.com/sorry/index?continue=x&q=EgQtoken' },
        'https://www.google.com/sorry/index?continue=x&q=EgQtoken': { status: 429, body: 'unusual traffic' },
    });
    assertEquals(await expandMapsShare('https://maps.app.goo.gl/x', signal, sorry.fetcher), { place: null, list: null });

    const offline = fakeFetcher({});
    assertEquals(await expandMapsShare('https://maps.app.goo.gl/y', signal, offline.fetcher), { place: null, list: null });
});
