import { assertEquals } from '../../supabase/functions/_shared/test-utils.ts';
import { assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    buildDryRunReport,
    executeBackfillRows,
    isPermanentBackfillOutcome,
    loadReferencedRestaurantIds,
    parseBackfillArgs,
    SpendMeter,
} from './restaurant-completeness.ts';

Deno.test('restaurant completeness backfill is dry-run by default', () => {
    const options = parseBackfillArgs(['--max-rows', '25']);
    assertEquals(options.execute, false);
    assertEquals(options.maxRows, 25);
});

Deno.test('execute requires every per-SKU currency ceiling', () => {
    assertThrows(
        () => parseBackfillArgs(['--execute', '--max-rows', '10']),
        Error,
        '--execute requires',
    );
});

Deno.test('execute accepts explicit hard ceilings and watermark', () => {
    const options = parseBackfillArgs([
        '--execute',
        '--max-rows', '10',
        '--max-details-usd', '1.25',
        '--max-media-usd', '0.50',
        '--max-textsearch-usd', '2.00',
        '--watermark', '19500000-0000-4000-8000-000000000001',
        '--watermark-file', '/tmp/napkin-completeness-watermark',
    ]);
    assertEquals(options.execute, true);
    assertEquals(options.maxDetailsUsd, 1.25);
    assertEquals(options.watermark, '19500000-0000-4000-8000-000000000001');
});

Deno.test('only genuinely unmatchable scorer outcomes may advance the watermark', () => {
    assertEquals(isPermanentBackfillOutcome(new Error('UNMATCHABLE_AMBIGUOUS')), true);
    assertEquals(isPermanentBackfillOutcome(new Error('UNMATCHABLE_MISSING_NAME_OR_CITY')), true);
    assertEquals(isPermanentBackfillOutcome(new Error('CURRENCY_CEILING:details')), false);
    assertEquals(isPermanentBackfillOutcome(new Error('provider unavailable')), false);
});

Deno.test('dry-run report includes per-SKU calls and total estimated spend', () => {
    const options = parseBackfillArgs(['--max-rows', '2']);
    const report = buildDryRunReport(9, [
        {
            id: '19500000-0000-4000-8000-000000000001',
            external_id: 'ChIJKnown',
            name: 'Known',
            city: 'London',
            address: null,
            photo_source: null,
        },
        {
            id: '19500000-0000-4000-8000-000000000002',
            external_id: 'ghost_owner_nonce',
            name: 'Ghost',
            city: 'London',
            address: null,
            photo_source: 'none',
        },
        {
            id: '19500000-0000-4000-8000-000000000003',
            external_id: 'ChIJOutsideCeiling',
            name: 'Outside',
            city: 'London',
            address: null,
            photo_source: null,
        },
    ], options, null);

    assertEquals(report.selected_rows, 2);
    assertEquals(report.estimated_calls, { details: 1, textsearch: 1, media: 1 });
    assertEquals(report.estimated_usd, {
        details: 0.017,
        textsearch: 0.032,
        media: 0.007,
        total: 0.056,
    });
});

Deno.test('holder scope excludes soft-deleted wishlist and Table-share references', async () => {
    const filteredTables: string[] = [];
    const supabase = {
        from(table: string) {
            const query = {
                select() {
                    return query;
                },
                not() {
                    return query;
                },
                is(column: string, value: unknown) {
                    if (column === 'deleted_at' && value === null) filteredTables.push(table);
                    return query;
                },
                range() {
                    return Promise.resolve({ data: [], error: null });
                },
            };
            return query;
        },
    };

    await loadReferencedRestaurantIds(supabase);
    assertEquals(filteredTables.sort(), ['table_shares', 'wishlist_items']);
});

Deno.test('execute stays under SKU ceilings and never advances past a retryable row', async () => {
    const options = parseBackfillArgs([
        '--execute',
        '--max-rows', '3',
        '--max-details-usd', '0.034',
        '--max-media-usd', '0.007',
        '--max-textsearch-usd', '0.032',
    ]);
    const meter = new SpendMeter(options);
    const watermarks: string[] = [];
    const persisted: string[] = [];
    const provider = {
        async attest(_ownerId: string, externalId: string) {
            meter.record('details');
            if (externalId === 'ChIJRetry') throw new Error('provider unavailable');
            return { place_id: externalId };
        },
        async searchText() {
            meter.record('textsearch');
            return [];
        },
        async persistAttestedRestaurant(
            _ownerId: string,
            restaurantId: string,
            _projection: unknown,
            _claimant: string,
            _persistHero: boolean,
            allowCanonicalize: boolean,
        ) {
            meter.record('media');
            assertEquals(allowCanonicalize, true);
            persisted.push(restaurantId);
        },
    };
    const rows = [
        {
            id: '19500000-0000-4000-8000-000000000001',
            external_id: 'ghost_unmatchable',
            name: null,
            city: null,
            address: null,
            photo_source: null,
        },
        {
            id: '19500000-0000-4000-8000-000000000002',
            external_id: 'ChIJComplete',
            name: 'Complete',
            city: 'London',
            address: null,
            photo_source: null,
        },
        {
            id: '19500000-0000-4000-8000-000000000003',
            external_id: 'ChIJRetry',
            name: 'Retry',
            city: 'London',
            address: null,
            photo_source: null,
        },
    ];

    const result = await executeBackfillRows({
        options,
        budgetUserId: '19500000-0000-4000-8000-000000000099',
        candidateRows: rows,
        provider,
        initialWatermark: null,
        persistWatermark: async (value) => {
            watermarks.push(value);
        },
        logger: { warn() {}, error() {} },
    });

    assertEquals(result, {
        selected_rows: 3,
        completed_rows: 1,
        permanently_unmatchable_rows: 1,
        retryable_rows: 1,
        watermark: '19500000-0000-4000-8000-000000000002',
    });
    assertEquals(watermarks, [
        '19500000-0000-4000-8000-000000000001',
        '19500000-0000-4000-8000-000000000002',
    ]);
    assertEquals(persisted, ['19500000-0000-4000-8000-000000000002']);
    assertEquals(meter.report(), {
        calls: { details: 2, textsearch: 0, media: 1 },
        estimated_usd: { details: 0.034, textsearch: 0, media: 0.007, total: 0.041 },
    });
    assertThrows(() => meter.record('details'), Error, 'CURRENCY_CEILING:details');
});
