/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('@/lib/supabase', () => ({
    supabase: { supabaseUrl: 'https://project.test' },
}));

import { waitFor } from '@testing-library/react-native';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { makeTestClient, renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import {
    fetchRestaurantPage,
    useRestaurantPage,
    type RestaurantPageData,
} from './useRestaurantPage';

jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

function pageData(): RestaurantPageData {
    return {
        restaurant: null,
        personal: { average: null, visit_count: 0 },
        table_chip: null,
        whos_been: [],
        visits: [],
        visit_count: 0,
        public_reviews: [],
        public_reviews_total: 0,
        self_log: [],
        table_notes: [],
        distributions: { you: [], your_table: null, napkin: [] },
        distributions_half: { you: [], your_table: null, napkin: [] },
        napkin_aggregate: { average: null, count: 0 },
        photos: { from_your_table: [], from_others: [] },
        place_details: {
            hours_today: null,
            open_now: null,
            hours_week: null,
            website: null,
            phone: null,
            menu_url: null,
            lat: null,
            lng: null,
        },
        tables_count_with_logs: 0,
        first_logged_at_by_your_table: null,
        professional_critics: [],
    };
}

describe('useRestaurantPage cache + transport', () => {
    beforeEach(() => (callEdgeFn as jest.Mock).mockReset());

    it.each([
        ['scoped', 'table-a'],
        ['unscoped', undefined],
    ])('opens the history drill-in warm from the %s page key', (_label, tableId) => {
        const client = makeTestClient();
        const cached = pageData();
        client.setQueryData(queryKeys.restaurants.page('restaurant-a', tableId), cached);

        const { result } = renderHookWithClient(
            () => useRestaurantPage('restaurant-a', tableId),
            { client },
        );

        expect(result.current.data).toBe(cached);
        expect(result.current.isLoading).toBe(false);
        expect(callEdgeFn).not.toHaveBeenCalled();
    });

    it('uses callEdgeFn and forwards the optional table scope', async () => {
        (callEdgeFn as jest.Mock).mockResolvedValue(pageData());
        await fetchRestaurantPage('restaurant-a', 'table-a');

        expect(callEdgeFn).toHaveBeenCalledWith('restaurant-history', {
            method: 'GET',
            action: 'page',
            params: { restaurant_id: 'restaurant-a', table_id: 'table-a' },
        });
    });

    it('preserves omitted additive projections from a legacy server', async () => {
        const legacyData = pageData();
        delete legacyData.self_log;
        delete legacyData.table_notes;
        (callEdgeFn as jest.Mock).mockResolvedValue(legacyData);

        const data = await fetchRestaurantPage('restaurant-a');

        expect(data.self_log).toBeUndefined();
        expect(data.table_notes).toBeUndefined();
    });

    it('cold-loads a parameterless deep link', async () => {
        let resolvePage: ((value: RestaurantPageData) => void) | undefined;
        (callEdgeFn as jest.Mock).mockReturnValue(new Promise((resolve) => {
            resolvePage = resolve;
        }));
        const { result } = renderHookWithClient(() => useRestaurantPage('restaurant-a'));

        expect(result.current.isLoading).toBe(true);
        resolvePage?.(pageData());
        await waitFor(() => expect(result.current.data).toBeDefined());
    });
});
