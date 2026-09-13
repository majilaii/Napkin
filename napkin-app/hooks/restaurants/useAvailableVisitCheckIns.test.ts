import { waitFor } from '@testing-library/react-native';
import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { fetchRestaurantPage, type SelfLogRow } from './useRestaurantPage';
import { isAvailableVisitCheckIn, useAvailableVisitCheckIns } from './useAvailableVisitCheckIns';

jest.mock('./useRestaurantPage', () => ({ fetchRestaurantPage: jest.fn() }));

const bare = (id: string, visited_at = '2026-09-01T12:00:00Z'): SelfLogRow => ({
    id: `entry:${id}`, entry_id: id, source: 'solo', supper_id: null, table_night_id: null,
    visited_at, created_at: visited_at, is_bare: true,
    rating: null, note: null, photos: [], companions: [],
});

beforeEach(() => jest.resetAllMocks());

it.each([
    ['a star rating', { rating: 0.5 }],
    ['a written note', { note: 'Soup was excellent.' }],
    ['a photo', { photos: [{ id: 'p', url: 'https://photos.example/lunch.jpg' }] }],
    ['a Supper source', { source: 'supper' as const }],
    ['a Supper entry', { supper_id: 'supper' }],
    ['a Round entry', { table_night_id: 'round' }],
    ['a visit with no editable entry', { entry_id: null }],
])('does not suggest a visit containing %s', (_label, content) => {
    // Trust actual content/context rather than a potentially stale bare flag.
    expect(isAvailableVisitCheckIn({ ...bare('visit'), ...content })).toBe(false);
});

it('keeps an eligible unreviewed check-in with whitespace-only notes and a stale non-bare flag available', () => {
    expect(isAvailableVisitCheckIn({ ...bare('visit'), note: ' \n ', is_bare: false })).toBe(true);
});

it('fetches authenticated self history and retains distinct same-day occasions in newest-first order', async () => {
    const lunch = bare('lunch');
    const dinner = bare('dinner', '2026-09-01T19:00:00Z');
    const reviewed = { ...bare('reviewed', '2026-09-01T21:00:00Z'), note: 'Already reviewed.' };
    (fetchRestaurantPage as jest.Mock).mockResolvedValue({
        self_log: [lunch, reviewed, dinner],
        visits: [bare('someone-elses-visit', '2026-09-01T22:00:00Z')],
    });
    const { result } = renderHookWithClient(() => useAvailableVisitCheckIns('owner', 'restaurant'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchRestaurantPage).toHaveBeenCalledWith('restaurant');
    expect(result.current.data).toEqual([dinner, lunch]);
});

it('does not reuse the previous owner or restaurant suggestions while a new query is pending', async () => {
    (fetchRestaurantPage as jest.Mock).mockResolvedValueOnce({ self_log: [bare('owners-visit')] })
        .mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHookWithClient(
        ({ owner, page }: { owner: string; page: string }) => useAvailableVisitCheckIns(owner, page),
        { initialProps: { owner: 'first-owner', page: 'first-place' } },
    );
    await waitFor(() => expect(result.current.data?.[0].entry_id).toBe('owners-visit'));
    rerender({ owner: 'second-owner', page: 'first-place' });
    expect(result.current.data).toBeUndefined();
    rerender({ owner: 'first-owner', page: 'second-place' });
    expect(result.current.data).toBeUndefined();
});

it('keeps a failed suggestions read distinct from a confirmed empty history', async () => {
    const failure = new Error('History unavailable');
    (fetchRestaurantPage as jest.Mock).mockRejectedValue(failure);
    const { result } = renderHookWithClient(() => useAvailableVisitCheckIns('owner', 'restaurant'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
    expect(fetchRestaurantPage).toHaveBeenCalledTimes(1);
});

it.each([
    [undefined, 'restaurant', true],
    ['owner', undefined, true],
    ['owner', 'restaurant', false],
] as const)('does not fetch suggestions without the required identity or while disabled', (owner, page, enabled) => {
    renderHookWithClient(() => useAvailableVisitCheckIns(owner, page, enabled));
    expect(fetchRestaurantPage).not.toHaveBeenCalled();
});
