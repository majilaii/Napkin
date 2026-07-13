import { createManualImportSpot, reconcileImportSpotTables } from './importReview';
import type { PersistedImportSpot } from './importQueue';

function baseSpot(overrides: Partial<PersistedImportSpot> = {}): PersistedImportSpot {
    return {
        candidate_id: 'candidate-1',
        client_nonce: 'save-1',
        restaurant_id: 'restaurant-1',
        external_id: null,
        restaurant_name: 'Oranj',
        restaurant_city: 'London',
        table_id: null,
        table_client_nonce: null,
        table_shares: {},
        place: null,
        ...overrides,
    };
}

describe('createManualImportSpot', () => {
    it('creates a Google-backed row with frozen table nonces', () => {
        let n = 0;
        const spot = createManualImportSpot(
            { id: 'google-oranj', name: 'Oranj', city: 'London', cuisine: 'Wine bar' },
            ['table-a', 'table-b'],
            () => `nonce-${++n}`,
        );

        expect(spot).toMatchObject({
            candidate_id: 'nonce-3',
            client_nonce: 'nonce-4',
            restaurant_id: null,
            external_id: 'google-oranj',
            restaurant_name: 'Oranj',
            restaurant_city: 'London',
            table_id: 'table-a',
            table_client_nonce: 'nonce-1',
            table_shares: { 'table-a': 'nonce-1', 'table-b': 'nonce-2' },
            stance: 'recommended',
        });
        expect(spot.place).toMatchObject({ external_id: 'google-oranj', name: 'Oranj' });
    });

    it('uses an existing Napkin restaurant without a ghost payload', () => {
        const spot = createManualImportSpot(
            {
                id: '123e4567-e89b-12d3-a456-426614174000',
                name: 'Oranj',
                city: 'London',
                cuisine: null,
            },
            [],
            () => 'nonce',
        );

        expect(spot.restaurant_id).toBe('123e4567-e89b-12d3-a456-426614174000');
        expect(spot.external_id).toBeNull();
        expect(spot.place).toBeNull();
        expect(spot.table_id).toBeNull();
    });
});

describe('reconcileImportSpotTables', () => {
    it('preserves kept nonces, adds new ones, and prunes removed tables', () => {
        const spot = baseSpot({
            table_id: 'table-a',
            table_client_nonce: 'nonce-a',
            table_shares: { 'table-a': 'nonce-a', 'table-old': 'nonce-old' },
        });

        const reconciled = reconcileImportSpotTables(
            spot,
            ['table-a', 'table-b', 'table-a'],
            () => 'nonce-b',
        );

        expect(reconciled.table_shares).toEqual({
            'table-a': 'nonce-a',
            'table-b': 'nonce-b',
        });
        expect(reconciled.table_id).toBe('table-a');
        expect(reconciled.table_client_nonce).toBe('nonce-a');
        expect(spot.table_shares).toEqual({ 'table-a': 'nonce-a', 'table-old': 'nonce-old' });
    });

    it('preserves a legacy single-table nonce when that table remains selected', () => {
        const reconciled = reconcileImportSpotTables(
            baseSpot({
                table_id: 'legacy-table',
                table_client_nonce: 'legacy-nonce',
                table_shares: undefined,
            }),
            ['legacy-table'],
            () => 'should-not-mint',
        );

        expect(reconciled.table_shares).toEqual({ 'legacy-table': 'legacy-nonce' });
        expect(reconciled.table_client_nonce).toBe('legacy-nonce');
    });

    it('clears both modern and legacy table routing when no table is selected', () => {
        const reconciled = reconcileImportSpotTables(
            baseSpot({
                table_id: 'table-a',
                table_client_nonce: 'nonce-a',
                table_shares: { 'table-a': 'nonce-a' },
            }),
            [],
        );

        expect(reconciled.table_shares).toEqual({});
        expect(reconciled.table_id).toBeNull();
        expect(reconciled.table_client_nonce).toBeNull();
    });
});
