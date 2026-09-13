/** Native scheduling and shared cold/live tap routing, without posting an OS notification. */
jest.mock('expo-notifications', () => ({
    scheduleNotificationAsync: jest.fn(async () => 'scheduled-id'),
    getLastNotificationResponseAsync: jest.fn(async () => null),
    addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

type LocalNotify = typeof import('./localNotify');
type NativeMock = {
    scheduleNotificationAsync: jest.Mock;
    getLastNotificationResponseAsync: jest.Mock;
    addNotificationResponseReceivedListener: jest.Mock;
};

let localNotify: LocalNotify;
let native: NativeMock;
let platform: { OS: string };

const IMPORT_TARGET = '/import-progress?openJob=job-123&outcome=saved&owner=owner-123';
const GATHER_TARGET = '/gathering/gather-123';

function response(identifier: string, url: unknown) {
    return { notification: { request: { identifier, content: { data: { url } } } } };
}

function liveCallback(): (value: unknown) => void {
    return native.addNotificationResponseReceivedListener.mock.calls[0][0];
}

beforeEach(() => {
    // Both the lazy native binding and claimed-response set belong to one app
    // lifetime. Give each scenario a fresh lifetime without an implementation reset API.
    jest.isolateModules(() => {
        native = jest.requireMock('expo-notifications') as NativeMock;
        platform = jest.requireMock('react-native').Platform as { OS: string };
        localNotify = jest.requireActual<LocalNotify>('./localNotify');
        localNotify.isNotifAvailable();
    });
    platform.OS = 'ios';
    native.scheduleNotificationAsync.mockReset().mockResolvedValue('scheduled-id');
    native.getLastNotificationResponseAsync.mockReset().mockResolvedValue(null);
    native.addNotificationResponseReceivedListener.mockReset().mockImplementation(() => ({ remove: jest.fn() }));
});

afterEach(() => { platform.OS = 'ios'; });

describe('local notification destinations', () => {
    it('keeps the imports hub destination when no target is supplied', async () => {
        await localNotify.presentImportNotification({ title: '3 spots are ready', body: 'Your import is ready.' });

        expect(native.scheduleNotificationAsync).toHaveBeenCalledWith({
            content: {
                title: '3 spots are ready', body: 'Your import is ready.',
                data: { url: '/import-progress' },
            },
            trigger: null,
        });
    });

    it.each(['ios', 'android'])('preserves the chosen batch and owner destination on %s', async (os) => {
        platform.OS = os;
        await localNotify.presentImportNotification({ title: '3 spots are ready', body: 'Open your spots.', url: IMPORT_TARGET });

        expect(native.scheduleNotificationAsync).toHaveBeenCalledWith({
            content: {
                title: '3 spots are ready', body: 'Open your spots.',
                data: { url: IMPORT_TARGET },
            },
            trigger: os === 'android' ? { channelId: 'imports' } : null,
        });
    });

    it('does not turn a native scheduling failure into an import failure', async () => {
        native.scheduleNotificationAsync.mockRejectedValueOnce(new Error('notifications unavailable'));

        await expect(localNotify.presentImportNotification({ title: 'Ready', body: 'Open your spots.', url: IMPORT_TARGET }))
            .resolves.toBeUndefined();
    });

    it('routes an active tap to its exact destination and unsubscribes cleanly', () => {
        const handler = jest.fn();
        const unsubscribe = localNotify.addNotificationResponseListener(handler);
        liveCallback()(response('active-import', IMPORT_TARGET));

        expect(handler.mock.calls).toEqual([[IMPORT_TARGET]]);
        const subscription = native.addNotificationResponseReceivedListener.mock.results[0].value;
        unsubscribe();
        expect(subscription.remove).toHaveBeenCalledTimes(1);
    });

    it('claims a cold-start import once when the same response is replayed live', async () => {
        const tap = response('cold-first', IMPORT_TARGET);
        native.getLastNotificationResponseAsync.mockResolvedValue(tap);

        expect(await localNotify.getInitialNotificationUrl()).toBe(IMPORT_TARGET);
        const handler = jest.fn();
        localNotify.addNotificationResponseListener(handler);
        liveCallback()(tap);
        expect(handler).not.toHaveBeenCalled();
        expect(await localNotify.getInitialNotificationUrl()).toBeNull();
    });

    it('claims a live import once when the cold-response read resolves afterward', async () => {
        const tap = response('live-first', IMPORT_TARGET);
        let resolveCold!: (value: unknown) => void;
        native.getLastNotificationResponseAsync.mockReturnValue(new Promise((resolve) => { resolveCold = resolve; }));
        const coldRead = localNotify.getInitialNotificationUrl();
        const handler = jest.fn();
        localNotify.addNotificationResponseListener(handler);

        liveCallback()(tap);
        resolveCold(tap);

        expect(handler.mock.calls).toEqual([[IMPORT_TARGET]]);
        expect(await coldRead).toBeNull();
    });

    it('retains Gather routing through the shared active listener and cold-response reader', async () => {
        const handler = jest.fn();
        localNotify.addNotificationResponseListener(handler);
        const tap = response('gather-live', GATHER_TARGET);
        liveCallback()(tap);
        expect(handler.mock.calls).toEqual([[GATHER_TARGET]]);

        native.getLastNotificationResponseAsync.mockResolvedValue(tap);
        expect(await localNotify.getInitialNotificationUrl()).toBeNull();
        native.getLastNotificationResponseAsync.mockResolvedValue(response('gather-cold', GATHER_TARGET));
        expect(await localNotify.getInitialNotificationUrl()).toBe(GATHER_TARGET);
    });

    it('ignores malformed response data without blocking a later valid tap', () => {
        const handler = jest.fn();
        localNotify.addNotificationResponseListener(handler);
        const deliver = liveCallback();
        deliver(null);
        deliver(response('later-valid', { url: IMPORT_TARGET }));
        deliver(response('later-valid', null));
        expect(handler).not.toHaveBeenCalled();

        deliver(response('later-valid', IMPORT_TARGET));
        expect(handler.mock.calls).toEqual([[IMPORT_TARGET]]);
    });
});
