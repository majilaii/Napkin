/* eslint-disable import/first */
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

import { waitFor } from '@testing-library/react-native';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { mockEdgeFnResolves } from '@/__tests__/utils/mockEdgeFn';
import { useNetworkMapPins } from './useNetworkMapPins';

describe('useNetworkMapPins', () => {
    it('defaults enabled but makes no request behind an explicit disabled gate', async () => {
        const disabled = renderHookWithClient(() => (
            useNetworkMapPins('viewer', { enabled: false })
        ));
        expect(disabled.result.current.fetchStatus).toBe('idle');
        expect(callEdgeFn).not.toHaveBeenCalled();
        disabled.unmount();

        mockEdgeFnResolves({ pins: [] });
        const enabled = renderHookWithClient(() => useNetworkMapPins('viewer'));
        await waitFor(() => expect(enabled.result.current.isSuccess).toBe(true));
        expect(callEdgeFn).toHaveBeenCalledWith('user-profile', {
            action: 'network_map_pins',
            body: {},
        });
    });
});
