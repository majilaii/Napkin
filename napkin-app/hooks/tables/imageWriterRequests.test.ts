import { act, waitFor } from '@testing-library/react-native';

import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { useStartRound } from './useStartRound';
import { useRateTableNight } from './useTableNight';

jest.mock('@/lib/edgeInvoke', () => ({
    callEdgeFn: jest.fn(),
    unwrapInvokeError: jest.fn(),
}));

const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;

describe('table-night image writer requests', () => {
    beforeEach(() => {
        mockCallEdgeFn.mockReset();
    });

    it('start forwards the hero and complete photo list used for entry_hero and entry_photo refs', async () => {
        mockCallEdgeFn.mockResolvedValue({ id: 'night-1' });
        const photoUrls = [
            'https://project.test/entry-photos/approved/user-1/a.jpg',
            'https://project.test/entry-photos/approved/user-1/b.jpg',
        ];
        const restaurant = {
            external_id: 'place-1',
            name: 'Round Restaurant',
            location: {
                address: '1 Test Street',
                locality: 'London',
                country: 'GB',
            },
            types: ['restaurant'],
            latitude: 51.5,
            longitude: -0.1,
            photoReference: 'places-photo-1',
        };
        const { result } = renderHookWithClient(() => useStartRound('user-1', 'table-1'));

        act(() => {
            result.current.mutate({
                table_id: 'table-1',
                restaurant,
                participant_ids: ['user-1', 'user-2'],
                rating: 4.5,
                notes: 'Round notes',
                dish_description: 'Pasta',
                photo_url: photoUrls[0],
                photo_urls: photoUrls,
                vibe_rating: 4,
                flavor_rating: 5,
                service_rating: 4.5,
                value_rating: 3.5,
            });
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockCallEdgeFn).toHaveBeenCalledTimes(1);
        expect(mockCallEdgeFn).toHaveBeenCalledWith('table-night', {
            action: 'start',
            body: {
                table_id: 'table-1',
                restaurant,
                participant_ids: ['user-1', 'user-2'],
                is_async: true,
                rating: 4.5,
                notes: 'Round notes',
                dish_description: 'Pasta',
                photo_url: photoUrls[0],
                photo_urls: photoUrls,
                vibe_rating: 4,
                flavor_rating: 5,
                service_rating: 4.5,
                value_rating: 3.5,
            },
        });
    });

    it('rate forwards the hero and complete photo list used for entry_hero and entry_photo refs', async () => {
        mockCallEdgeFn.mockResolvedValue({ ready: false });
        const photoUrls = [
            'https://project.test/entry-photos/approved/user-1/c.jpg',
            'https://project.test/entry-photos/approved/user-1/d.jpg',
        ];
        const { result } = renderHookWithClient(() => useRateTableNight());

        act(() => {
            result.current.mutate({
                table_night_id: 'night-1',
                rating: 4,
                notes: 'My take',
                dish_description: 'Curry',
                photo_url: photoUrls[0],
                photo_urls: photoUrls,
                vibe_rating: 4.5,
                flavor_rating: 4,
                service_rating: 3.5,
                value_rating: 5,
            });
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockCallEdgeFn).toHaveBeenCalledTimes(1);
        expect(mockCallEdgeFn).toHaveBeenCalledWith('table-night', {
            body: {
                action: 'rate',
                table_night_id: 'night-1',
                rating: 4,
                notes: 'My take',
                dish_description: 'Curry',
                photo_url: photoUrls[0],
                photo_urls: photoUrls,
                vibe_rating: 4.5,
                flavor_rating: 4,
                service_rating: 3.5,
                value_rating: 5,
            },
        });
    });
});
