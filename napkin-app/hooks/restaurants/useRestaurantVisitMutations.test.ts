import { act } from '@testing-library/react-native';
import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useRestaurantVisitMutations, type SavedVisit } from './useRestaurantVisitMutations';

jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
const invoke = callEdgeFn as jest.Mock;
const visit = (id: string): SavedVisit => ({ id, restaurant_id: 'r', created_at: '2026-09-05T12:00:00Z', visited_at: null, rating: null, content: null, photos: [], is_bare: true });
const pageKey = queryKeys.restaurants.page('r');

it('records distinct visits, retains null dates, enriches the same ID and reconciles history without touching pins', async () => {
    const { result, client } = renderHookWithClient(() => useRestaurantVisitMutations('u', 'r'));
    client.setQueryData(pageKey, { restaurant: { id: 'r' }, self_log: [], personal: { visit_count: 0, average_rating: null } });
    const pinKey = queryKeys.wishlist.check('u', 'r');
    client.setQueryData(pinKey, true);
    for (const id of ['v1', 'v2']) {
        invoke.mockResolvedValueOnce({ entry: visit(id) });
        await act(async () => { await result.current.record.mutateAsync({ restaurant_id: 'r', client_nonce: id }); });
    }
    invoke.mockResolvedValueOnce({ entry: { ...visit('v1'), rating: 4.5, content: 'Lovely lunch', photos: [{ id: 'p', url: 'https://photo' }], is_bare: false } });
    await act(async () => { await result.current.save.mutateAsync({ entry_id: 'v1', patch: { rating: 4.5, content: 'Lovely lunch', photo_urls: ['https://photo'] } }); });
    const page = client.getQueryData<any>(pageKey);
    expect(page.self_log).toHaveLength(2);
    expect(page.self_log.find((v: any) => v.entry_id === 'v1')).toMatchObject({ visited_at: null, rating: 4.5, note: 'Lovely lunch', photos: [{ id: 'p', url: 'https://photo' }] });
    expect(page.personal.visit_count).toBe(2);
    expect(client.getQueryData(pinKey)).toBe(true);
    expect(invoke).toHaveBeenLastCalledWith('entry', { action: 'save_visit', body: { entry_id: 'v1', patch: { rating: 4.5, content: 'Lovely lunch', photo_urls: ['https://photo'] } } });
    client.clear();
});

it('keeps an existing visit after a refused undo; successful undo removes only its ID', async () => {
    const { result, client } = renderHookWithClient(() => useRestaurantVisitMutations('u', 'r'));
    const rows = ['v1', 'v2'].map((id) => ({ ...visit(id), entry_id: id }));
    client.setQueryData(pageKey, { restaurant: { id: 'r' }, self_log: rows, personal: { visit_count: 2 } });
    invoke.mockRejectedValueOnce(new Error('Visit changed'));
    await act(async () => { await expect(result.current.undo.mutateAsync('v2')).rejects.toThrow('Visit changed'); });
    expect(client.getQueryData<any>(pageKey).self_log).toEqual(rows);
    invoke.mockResolvedValueOnce({ deleted: true, entry_id: 'v2', restaurant_id: 'r' });
    await act(async () => { await result.current.undo.mutateAsync('v2'); });
    expect(client.getQueryData<any>(pageKey).self_log.map((v: any) => v.id)).toEqual(['v1']);
    client.clear();
});


it('shows the authoritative visit on an unpersisted Places page while its refresh has not completed', async () => {
    const routeId = 'places-external-id';
    const key = queryKeys.restaurants.page(routeId);
    const { result, client } = renderHookWithClient(() => useRestaurantVisitMutations('u', routeId));
    client.setQueryData(key, { restaurant: null, self_log: [], personal: { visit_count: 0, average: null } });
    const unrelated = queryKeys.restaurants.page('other-ghost');
    client.setQueryData(unrelated, { restaurant: null, self_log: [], personal: { visit_count: 0 } });
    const refresh = jest.spyOn(client, 'invalidateQueries').mockImplementation(() => new Promise(() => {}));
    invoke.mockResolvedValueOnce({ entry: visit('v1') });
    await act(async () => { await result.current.record.mutateAsync({ restaurant_id: 'r', client_nonce: 'nonce' }); });
    expect(client.getQueryData<any>(key)).toMatchObject({ self_log: [{ entry_id: 'v1', visited_at: null }], personal: { visit_count: 1 } });
    expect(client.getQueryData<any>(unrelated).self_log).toEqual([]);
    refresh.mockRestore();
    client.clear();
});
