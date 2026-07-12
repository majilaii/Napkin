import { createManualImportSpot } from './importReview';

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
