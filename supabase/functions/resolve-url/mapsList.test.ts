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
    extractGetlistPreloadUrl,
    extractListIdFromMapsUrl,
    mapsItemsToStaged,
    parseGetlistResponse,
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
