/* eslint-disable import/first -- register storage mock before imports. */
jest.mock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: { getItem: jest.fn(), setItem: jest.fn() },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    dismissDiscoveryTip,
    enableDiscoveryGuide,
    getDiscoveryGuideSnapshot,
    subscribeDiscoveryGuide,
} from './discoveryGuide';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

async function readGuide(userId: string) {
    let unsubscribe = () => {};
    await new Promise<void>((resolve) => {
        unsubscribe = subscribeDiscoveryGuide(userId, resolve);
    });
    unsubscribe();
    return getDiscoveryGuideSnapshot(userId);
}

let identity = 0;
let userId: string;

beforeEach(() => {
    userId = `guide-user-${++identity}`;
    jest.resetAllMocks();
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    jest.mocked(AsyncStorage.setItem).mockResolvedValue();
});

describe('discovery guide persistence', () => {
    it('does not enable guidance for an existing user with no local preference', async () => {
        expect(getDiscoveryGuideSnapshot(userId)).toEqual({ enabled: false, dismissed: [], ready: false });
        expect(await readGuide(userId)).toEqual({ enabled: false, dismissed: [], ready: true });
        expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    });

    it('restores only known topics from the current schema version', async () => {
        jest.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({
            version: 1, enabled: true, dismissed: ['tables', 'unknown', 'tables', null, 'friends'],
        }));
        expect(await readGuide(userId)).toEqual({ enabled: true, dismissed: ['tables', 'friends'], ready: true });
    });

    it.each([
        '{invalid json',
        JSON.stringify({ version: 2, enabled: true, dismissed: ['tables'] }),
        JSON.stringify({ version: 1, enabled: 'true', dismissed: ['tables'] }),
    ])('ignores malformed or incompatible state: %s', async (stored) => {
        jest.mocked(AsyncStorage.getItem).mockResolvedValue(stored);
        expect(await readGuide(userId)).toEqual({ enabled: false, dismissed: [], ready: true });
    });

    it('merges a delayed read with local enable and dismissal without losing either', async () => {
        const read = deferred<string | null>();
        jest.mocked(AsyncStorage.getItem).mockReturnValue(read.promise);
        const unsubscribe = subscribeDiscoveryGuide(userId, jest.fn());
        const enable = enableDiscoveryGuide(userId);
        const dismiss = dismissDiscoveryTip(userId, 'tables');

        expect(getDiscoveryGuideSnapshot(userId)).toEqual({ enabled: true, dismissed: ['tables'], ready: false });
        expect(AsyncStorage.setItem).not.toHaveBeenCalled();
        read.resolve(JSON.stringify({ version: 1, enabled: false, dismissed: ['places'] }));
        await Promise.all([enable, dismiss]);

        expect(getDiscoveryGuideSnapshot(userId)).toEqual({ enabled: true, dismissed: ['places', 'tables'], ready: true });
        expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
        expect(JSON.parse(jest.mocked(AsyncStorage.setItem).mock.lastCall![1])).toEqual({
            version: 1, enabled: true, dismissed: ['places', 'tables'],
        });
        unsubscribe();
    });

    it('serializes writes so a slow enable cannot overwrite a later dismissal', async () => {
        const firstWrite = deferred<void>();
        const started = deferred<void>();
        jest.mocked(AsyncStorage.setItem).mockImplementationOnce(() => {
            started.resolve();
            return firstWrite.promise;
        });
        const enable = enableDiscoveryGuide(userId);
        await started.promise;
        const dismiss = dismissDiscoveryTip(userId, 'journal');
        expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
        expect(getDiscoveryGuideSnapshot(userId).dismissed).toEqual(['journal']);

        firstWrite.resolve();
        await Promise.all([enable, dismiss]);
        expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);
        expect(JSON.parse(jest.mocked(AsyncStorage.setItem).mock.calls[0][1]).dismissed).toEqual([]);
        expect(JSON.parse(jest.mocked(AsyncStorage.setItem).mock.calls[1][1]).dismissed).toEqual(['journal']);
    });

    it('keeps dismissed tips hidden for the session after read and write failures', async () => {
        jest.mocked(AsyncStorage.getItem).mockRejectedValue(new Error('read unavailable'));
        jest.mocked(AsyncStorage.setItem).mockRejectedValue(new Error('disk unavailable'));
        await enableDiscoveryGuide(userId);
        await dismissDiscoveryTip(userId, 'places');
        const unsubscribe = subscribeDiscoveryGuide(userId, jest.fn());

        expect(getDiscoveryGuideSnapshot(userId)).toEqual({ enabled: true, dismissed: ['places'], ready: true });
        expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
        // A failed write must not poison the queue for subsequent preferences.
        jest.mocked(AsyncStorage.setItem).mockResolvedValue();
        await dismissDiscoveryTip(userId, 'lists');
        expect(JSON.parse(jest.mocked(AsyncStorage.setItem).mock.lastCall![1]).dismissed).toEqual(['places', 'lists']);
        unsubscribe();
    });

    it('isolates users and never reads or writes a signed-out identity', async () => {
        const otherId = `${userId}-other`;
        await enableDiscoveryGuide(userId);
        await dismissDiscoveryTip(userId, 'friends');
        expect(await readGuide(otherId)).toEqual({ enabled: false, dismissed: [], ready: true });
        expect(getDiscoveryGuideSnapshot(userId)).toEqual({ enabled: true, dismissed: ['friends'], ready: true });

        const reads = jest.mocked(AsyncStorage.getItem).mock.calls.length;
        const writes = jest.mocked(AsyncStorage.setItem).mock.calls.length;
        const unsubscribe = subscribeDiscoveryGuide(null, jest.fn());
        await enableDiscoveryGuide('');
        await dismissDiscoveryTip('', 'tables');
        expect(getDiscoveryGuideSnapshot(null)).toEqual({ enabled: false, dismissed: [], ready: true });
        expect(AsyncStorage.getItem).toHaveBeenCalledTimes(reads);
        expect(AsyncStorage.setItem).toHaveBeenCalledTimes(writes);
        expect(jest.mocked(AsyncStorage.setItem).mock.calls.every(([key]) => key === `napkin.discoveryGuide.v1.${userId}`)).toBe(true);
        unsubscribe();
    });
});
