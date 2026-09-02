import { reconcileAcceptedCompanions } from './companions';

describe('reconcileAcceptedCompanions', () => {
    it('removes a companion the server dropped from the entry-detail preview', () => {
        const mutual = { user_id: 'mutual-id', display_name: 'Mutual friend' };
        const dropped = { user_id: 'stranger-id', display_name: 'Dropped stranger' };

        expect(reconcileAcceptedCompanions([mutual, dropped], [mutual.user_id])).toEqual([mutual]);
    });
});
