import {
    isOfflineError,
    notifyNetworkFailure,
    onNetworkFailure,
    resolveConnectivityStatus,
} from './connectivity';

describe('isOfflineError', () => {
    it('recognises the NETWORK code callEdgeFn attaches to transport failures', () => {
        const err = Object.assign(new Error('Failed to send a request'), {
            cause: { code: 'NETWORK', message: 'Network request failed' },
        });
        expect(isOfflineError(err)).toBe(true);
    });

    it('does not mistake a server-side failure for being offline', () => {
        const err = Object.assign(new Error('boom'), {
            cause: { code: 'ALREADY_PROPOSED', status: 409 },
        });
        expect(isOfflineError(err)).toBe(false);
        expect(isOfflineError(new Error('plain'))).toBe(false);
        expect(isOfflineError(null)).toBe(false);
    });
});

describe('network-failure fanout', () => {
    // The registry is module-level, so every listener must be torn down or it
    // fires inside later tests.
    let cleanup: (() => void)[] = [];
    const track = (listener: () => void) => {
        cleanup.push(onNetworkFailure(listener));
    };
    afterEach(() => {
        cleanup.forEach((off) => off());
        cleanup = [];
    });

    it('notifies every listener and stops after unsubscribe', () => {
        const seen: string[] = [];
        const offA = onNetworkFailure(() => seen.push('a'));
        cleanup.push(offA);
        track(() => seen.push('b'));

        notifyNetworkFailure();
        expect(seen).toEqual(['a', 'b']);

        offA();
        notifyNetworkFailure();
        expect(seen).toEqual(['a', 'b', 'b']);
    });

    it('a throwing listener cannot stop the others — this runs inside an error path', () => {
        const seen: string[] = [];
        track(() => {
            throw new Error('bad listener');
        });
        track(() => seen.push('survivor'));

        expect(() => notifyNetworkFailure()).not.toThrow();
        expect(seen).toEqual(['survivor']);
    });
});

describe('resolveConnectivityStatus', () => {
    it('stays checking while native reachability is unknown', () => {
        expect(
            resolveConnectivityStatus({
                isConnected: null,
                isInternetReachable: null,
            }),
        ).toBe('checking');
    });

    it('is offline when there is no network interface', () => {
        expect(
            resolveConnectivityStatus({
                isConnected: false,
                isInternetReachable: null,
            }),
        ).toBe('offline');
    });

    it('is offline when Wi-Fi exists but the internet is unreachable', () => {
        expect(
            resolveConnectivityStatus({
                isConnected: true,
                isInternetReachable: false,
            }),
        ).toBe('offline');
    });

    it('keeps checking while only the network interface is connected', () => {
        expect(
            resolveConnectivityStatus({
                isConnected: true,
                isInternetReachable: null,
            }),
        ).toBe('checking');
    });

    it('is online only after internet reachability is confirmed', () => {
        expect(
            resolveConnectivityStatus({
                isConnected: null,
                isInternetReachable: true,
            }),
        ).toBe('online');
    });

    it('lets a definitive negative win over a conflicting positive', () => {
        expect(
            resolveConnectivityStatus({
                isConnected: false,
                isInternetReachable: true,
            }),
        ).toBe('offline');
    });
});
