jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

import { waitFor } from '@testing-library/react-native';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { useIsWishlisted } from './useIsWishlisted';

describe('useIsWishlisted', () => {
    beforeEach(() => {
        (callEdgeFn as jest.Mock).mockReset();
    });

    it('keeps a persisted restaurant unknown until the server check resolves', async () => {
        let resolveCheck: ((value: { wishlisted: boolean }) => void) | undefined;
        (callEdgeFn as jest.Mock).mockReturnValue(
            new Promise((resolve) => { resolveCheck = resolve; }),
        );
        const { result } = renderHookWithClient(() => useIsWishlisted(
            '11111111-1111-4111-8111-111111111111',
            'viewer-1',
        ));

        expect(result.current).toBeUndefined();
        resolveCheck?.({ wishlisted: true });
        await waitFor(() => expect(result.current).toBe(true));
    });

    it('opens a five-card rail with zero check calls for unselected cards', async () => {
        const ids = [
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            '33333333-3333-4333-8333-333333333333',
            '44444444-4444-4444-8444-444444444444',
            '55555555-5555-4555-8555-555555555555',
        ] as const;
        const loadedSavedIds = new Set<string>([ids[0], ids[3]]);
        (callEdgeFn as jest.Mock).mockImplementation(() => new Promise(() => {}));

        const { result, rerender } = renderHookWithClient(
            ({ selectedId }: { selectedId: string }) => {
                const first = useIsWishlisted(ids[0], 'viewer-1', { enabled: selectedId === ids[0] });
                const second = useIsWishlisted(ids[1], 'viewer-1', { enabled: selectedId === ids[1] });
                const third = useIsWishlisted(ids[2], 'viewer-1', { enabled: selectedId === ids[2] });
                const fourth = useIsWishlisted(ids[3], 'viewer-1', { enabled: selectedId === ids[3] });
                const fifth = useIsWishlisted(ids[4], 'viewer-1', { enabled: selectedId === ids[4] });
                return [
                    first ?? loadedSavedIds.has(ids[0]),
                    second ?? loadedSavedIds.has(ids[1]),
                    third ?? loadedSavedIds.has(ids[2]),
                    fourth ?? loadedSavedIds.has(ids[3]),
                    fifth ?? loadedSavedIds.has(ids[4]),
                ];
            },
            { initialProps: { selectedId: ids[2] as string } },
        );

        // Every mounted heart has its screen-level state immediately.
        expect(result.current).toEqual([true, false, false, true, false]);
        await waitFor(() => expect(callEdgeFn).toHaveBeenCalledTimes(1));
        expect(callEdgeFn).toHaveBeenLastCalledWith('wishlist', {
            action: 'check',
            body: { restaurant_id: ids[2] },
        });

        // Swiping enables exactly the newly selected card, never its neighbors.
        rerender({ selectedId: ids[4] });
        await waitFor(() => expect(callEdgeFn).toHaveBeenCalledTimes(2));
        expect(callEdgeFn).toHaveBeenLastCalledWith('wishlist', {
            action: 'check',
            body: { restaurant_id: ids[4] },
        });
    });
});
