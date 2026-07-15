jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

import { waitFor } from '@testing-library/react-native';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { useIsWishlisted } from './useIsWishlisted';

describe('useIsWishlisted', () => {
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
});
