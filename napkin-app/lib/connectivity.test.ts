import { resolveConnectivityStatus } from './connectivity';

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
