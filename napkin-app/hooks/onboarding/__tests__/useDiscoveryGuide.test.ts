/* eslint-disable import/first -- register storage mock before imports. */
jest.mock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: { getItem: jest.fn(), setItem: jest.fn() },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { dismissDiscoveryTip, enableDiscoveryGuide } from '@/lib/discoveryGuide';
import { useDiscoveryGuide } from '../useDiscoveryGuide';

beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    jest.mocked(AsyncStorage.setItem).mockResolvedValue();
});

describe('useDiscoveryGuide', () => {
    it('updates subscribers immediately when guidance is enabled or dismissed', async () => {
        const { result } = renderHook(() => useDiscoveryGuide('guide-hook-subscriber'));
        await waitFor(() => expect(result.current.ready).toBe(true));
        await act(async () => { await enableDiscoveryGuide('guide-hook-subscriber'); });
        expect(result.current.enabled).toBe(true);
        await act(async () => { await dismissDiscoveryTip('guide-hook-subscriber', 'tables'); });
        expect(result.current.dismissed).toEqual(['tables']);
    });

    it('does not show the previous account state when an old read finishes after switching users', async () => {
        let finishRead!: (value: string | null) => void;
        jest.mocked(AsyncStorage.getItem).mockImplementation((key) => key.endsWith('guide-hook-user-a')
            ? new Promise((resolve) => { finishRead = resolve; })
            : Promise.resolve(null));
        const { result, rerender } = renderHook(
            ({ userId }: { userId: string | null }) => useDiscoveryGuide(userId),
            { initialProps: { userId: 'guide-hook-user-a' as string | null } },
        );
        expect(result.current.ready).toBe(false);
        rerender({ userId: 'guide-hook-user-b' });
        await waitFor(() => expect(result.current.ready).toBe(true));
        await act(async () => {
            finishRead(JSON.stringify({ version: 1, enabled: true, dismissed: ['tables'] }));
            await Promise.resolve();
        });
        expect(result.current).toEqual({ enabled: false, dismissed: [], ready: true });

        rerender({ userId: 'guide-hook-user-a' });
        expect(result.current).toEqual({ enabled: true, dismissed: ['tables'], ready: true });
        rerender({ userId: null });
        expect(result.current).toEqual({ enabled: false, dismissed: [], ready: true });
    });
});
