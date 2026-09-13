import { waitFor } from '@testing-library/react-native';
import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { fetchVisitReviewDraft, useVisitReviewDraft } from './useVisitReviewDraft';

jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const entry = {
    id: 'older-visit', user_id: 'owner', restaurant_id: 'brawn',
    created_at: '2026-08-10T18:00:00.000Z', visited_at: null,
    rating: 4.5, content: 'A birthday dinner', liked: true, visibility: 'private',
    vibe_rating: 3, flavor_rating: 4.5, service_rating: 4, value_rating: 3.5,
    photo_url: 'https://photos.example/hero.jpg', supper_id: null, table_night_id: null,
};

type Response = { data: any; error: Error | null };
function fixture(overrides: Record<string, Partial<Response>> = {}) {
    const responses: Record<string, Response> = {
        entries: { data: { ...entry }, error: null },
        entry_photos: { data: [{ id: 'photo-1', photo_url: 'https://photos.example/second.jpg' }], error: null },
        entry_companions: { data: [{ user_id: 'carmen' }], error: null },
        entry_tables: { data: [{ table_id: 'old-table' }], error: null },
        profiles: { data: [{ user_id: 'carmen', display_name: 'Carmen', avatar_url: null }], error: null },
    };
    const builders: Record<string, any> = {};
    (supabase.from as jest.Mock).mockImplementation((table: string) => {
        const response = { ...responses[table], ...overrides[table] };
        const builder: any = {};
        builder.select = jest.fn((columns: string) => {
            // Production has no entry_companions -> public.profiles relationship.
            // Do not let a permissive query mock hide another PGRST200 regression.
            if (table === 'entry_companions' && columns.includes('(')) {
                throw Object.assign(new Error('No profile relationship exists'), { code: 'PGRST200' });
            }
            return builder;
        });
        builder.eq = jest.fn(() => builder);
        builder.in = jest.fn(() => builder);
        builder.order = jest.fn(() => builder);
        builder.single = jest.fn(() => Promise.resolve(response));
        builder.then = (resolve: (value: Response) => unknown, reject: (error: unknown) => unknown) =>
            Promise.resolve(response).then(resolve, reject);
        builders[table] = builder;
        return builder;
    });
    return builders;
}

beforeEach(() => jest.clearAllMocks());

it('loads the exact owned visit with all original review collections and its undated value', async () => {
    const builders = fixture();
    const draft = await fetchVisitReviewDraft('owner', 'older-visit');
    expect(builders.entries.eq.mock.calls).toEqual([['id', 'older-visit'], ['user_id', 'owner']]);
    for (const table of ['entry_photos', 'entry_companions', 'entry_tables']) {
        expect(builders[table].eq).toHaveBeenCalledWith('entry_id', 'older-visit');
    }
    expect(builders.entry_companions.select).toHaveBeenCalledWith('user_id');
    expect(builders.profiles.select).toHaveBeenCalledWith('user_id,display_name,avatar_url');
    expect(builders.profiles.in).toHaveBeenCalledWith('user_id', ['carmen']);
    expect(draft).toMatchObject({
        ...entry,
        photos: [
            { id: 'hero:older-visit', url: entry.photo_url },
            { id: 'photo-1', url: 'https://photos.example/second.jpg' },
        ],
        companions: [{ user_id: 'carmen', display_name: 'Carmen', avatar_url: null }],
        table_ids: ['old-table'],
    });
});

it('retains eight existing photos in order without duplicating a hero already in the collection', async () => {
    const photos = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, photo_url: i === 2 ? entry.photo_url : `https://photos.example/${i}.jpg` }));
    fixture({ entry_photos: { data: photos } });
    const draft = await fetchVisitReviewDraft('owner', entry.id);
    expect(draft.photos).toEqual(photos.map((p) => ({ id: p.id, url: p.photo_url })));
});

it('resolves companion display rows in one batch and associates them by identity rather than response order', async () => {
    const builders = fixture({
        entry_companions: { data: [{ user_id: 'carmen' }, { user_id: 'priya' }] },
        profiles: { data: [
            { user_id: 'priya', display_name: 'Priya', avatar_url: 'priya-avatar' },
            { user_id: 'carmen', display_name: 'Carmen', avatar_url: 'carmen-avatar' },
        ] },
    });
    expect((await fetchVisitReviewDraft('owner', entry.id)).companions).toEqual([
        { user_id: 'carmen', display_name: 'Carmen', avatar_url: 'carmen-avatar' },
        { user_id: 'priya', display_name: 'Priya', avatar_url: 'priya-avatar' },
    ]);
    expect(builders.entry_companions.select).toHaveBeenCalledWith('user_id');
    expect(builders.profiles.in).toHaveBeenCalledWith('user_id', ['carmen', 'priya']);
    expect((supabase.from as jest.Mock).mock.calls.filter(([table]) => table === 'profiles')).toHaveLength(1);
});

it('retains a companion without a visible profile row using the fallback display name', async () => {
    fixture({
        entry_companions: { data: [{ user_id: 'missing-profile' }, { user_id: 'carmen' }] },
    });
    expect((await fetchVisitReviewDraft('owner', entry.id)).companions).toEqual([
        { user_id: 'missing-profile', display_name: 'User', avatar_url: null },
        { user_id: 'carmen', display_name: 'Carmen', avatar_url: null },
    ]);
});

it('skips the profile query entirely when the visit has no companions', async () => {
    fixture({
        entry_companions: { data: [] },
        profiles: { data: null, error: new Error('An unnecessary profile query must not block this draft') },
    });
    expect((await fetchVisitReviewDraft('owner', entry.id)).companions).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalledWith('profiles');
});

it.each(['entries', 'entry_photos', 'entry_companions', 'entry_tables', 'profiles'])('rejects a failed %s read instead of replacing existing content with empty defaults', async (table) => {
    const failure = new Error(`${table} unavailable`);
    fixture({ [table]: { data: null, error: failure } });
    await expect(fetchVisitReviewDraft('owner', entry.id)).rejects.toBe(failure);
});

it.each([
    ['another owner', { ...entry, user_id: 'stranger' }],
    ['a Supper take', { ...entry, supper_id: 'supper-1' }],
    ['a Round entry', { ...entry, table_night_id: 'round-1' }],
    ['an entry without a restaurant', { ...entry, restaurant_id: null }],
    ['a missing entry', null],
])('refuses %s before loading editable collections', async (_label, data) => {
    fixture({ entries: { data } });
    await expect(fetchVisitReviewDraft('owner', entry.id)).rejects.toThrow('Open this meal to edit its review.');
    expect(supabase.from).toHaveBeenCalledTimes(1);
});

it('keeps the cached draft scoped to both its owner and exact entry', async () => {
    fixture();
    const { result, client } = renderHookWithClient(() => useVisitReviewDraft('owner', entry.id));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(queryKeys.entries.visitDraft('owner', entry.id))).toMatchObject({ id: entry.id });
    expect(client.getQueryData(queryKeys.entries.visitDraft('stranger', entry.id))).toBeUndefined();
    expect(client.getQueryData(queryKeys.entries.visitDraft('owner', 'another-visit'))).toBeUndefined();
});

it.each([[undefined, entry.id], ['owner', undefined]])('does not load a draft without both owner and entry identity', (ownerId, entryId) => {
    fixture();
    renderHookWithClient(() => useVisitReviewDraft(ownerId, entryId));
    expect(supabase.from).not.toHaveBeenCalled();
});
