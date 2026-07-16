jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

import { callEdgeFn } from '@/lib/edgeInvoke';
import { buildMergeWithRequestBody, callMergeWith } from './mergeRequest';

const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;

describe('buildMergeWithRequestBody', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('forwards every staged photo URL to the merge-with Edge action', () => {
        const photoUrls = [
            'https://project.test/entry-photos/approved/u/a.jpg',
            'https://project.test/entry-photos/approved/u/b.jpg',
        ];

        expect(buildMergeWithRequestBody({
            entry_a_id: 'entry-a',
            table_id: 'table-1',
            restaurant_id: 'restaurant-1',
            visited_at: '2026-07-16T12:00:00.000Z',
            client_nonce: 'nonce-1',
            rating: 4.5,
            photo_urls: photoUrls,
        })).toEqual({
            action: 'merge_with',
            entry_a_id: 'entry-a',
            table_id: 'table-1',
            restaurant_id: 'restaurant-1',
            visited_at: '2026-07-16T12:00:00.000Z',
            client_nonce: 'nonce-1',
            rating: 4.5,
            photo_urls: photoUrls,
        });
    });

    it('uses that body on the real merge-with Edge invocation seam', async () => {
        mockCallEdgeFn.mockResolvedValue({ entry_id: 'entry-b' });
        const photoUrls = [
            'https://project.test/entry-photos/approved/u/a.jpg',
            'https://project.test/entry-photos/approved/u/b.jpg',
        ];

        await callMergeWith({
            entry_a_id: 'entry-a',
            table_id: 'table-1',
            restaurant_id: 'restaurant-1',
            visited_at: '2026-07-16T12:00:00.000Z',
            client_nonce: 'nonce-1',
            photo_urls: photoUrls,
        });

        expect(mockCallEdgeFn).toHaveBeenCalledWith('entry', {
            body: {
                action: 'merge_with',
                entry_a_id: 'entry-a',
                table_id: 'table-1',
                restaurant_id: 'restaurant-1',
                visited_at: '2026-07-16T12:00:00.000Z',
                client_nonce: 'nonce-1',
                photo_urls: photoUrls,
            },
        });
    });
});
