/**
 * Tests for lib/sentry.ts — TICKET-121 DSN gating.
 *
 * Everything must no-op with no EXPO_PUBLIC_SENTRY_DSN (today's reality) and
 * forward to @sentry/react-native once the DSN exists. The SDK module is
 * mocked globally in jest.setup.js; resetModules gives each test a fresh
 * `initialized` flag.
 */

const DSN = 'https://key@o0.ingest.sentry.io/0';

type SentryMock = {
    init: jest.Mock;
    wrap: jest.Mock;
    captureException: jest.Mock;
    addBreadcrumb: jest.Mock;
};

function load(): { mock: SentryMock; lib: typeof import('@/lib/sentry') } {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mock = require('@sentry/react-native') as SentryMock;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lib = require('@/lib/sentry') as typeof import('@/lib/sentry');
    return { mock, lib };
}

describe('lib/sentry DSN gating', () => {
    const previousDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

    afterEach(() => {
        if (previousDsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
        else process.env.EXPO_PUBLIC_SENTRY_DSN = previousDsn;
    });

    it('no DSN → init never called, everything no-ops', () => {
        delete process.env.EXPO_PUBLIC_SENTRY_DSN;
        const { mock, lib } = load();

        lib.initSentry();
        expect(mock.init).not.toHaveBeenCalled();
        expect(lib.isSentryEnabled()).toBe(false);

        lib.captureError(new Error('boom'), { context: 'x' });
        lib.addBreadcrumb({ category: 'edge', message: 'fn:action' });
        expect(mock.captureException).not.toHaveBeenCalled();
        expect(mock.addBreadcrumb).not.toHaveBeenCalled();

        const Component = () => null;
        expect(lib.wrapRootComponent(Component)).toBe(Component);
        expect(mock.wrap).not.toHaveBeenCalled();
    });

    it('DSN set → init with errors+sessions config, no tracing options', () => {
        process.env.EXPO_PUBLIC_SENTRY_DSN = DSN;
        const { mock, lib } = load();

        lib.initSentry();
        expect(mock.init).toHaveBeenCalledTimes(1);
        expect(mock.init).toHaveBeenCalledWith({
            dsn: DSN,
            sendDefaultPii: false,
            enableAutoSessionTracking: true,
        });
        expect(lib.isSentryEnabled()).toBe(true);

        // Idempotent — a second call must not re-init.
        lib.initSentry();
        expect(mock.init).toHaveBeenCalledTimes(1);
    });

    it('DSN set → captureError forwards tags + context, breadcrumbs pass through', () => {
        process.env.EXPO_PUBLIC_SENTRY_DSN = DSN;
        const { mock, lib } = load();
        lib.initSentry();

        const err = new Error('boom');
        lib.captureError(err, { context: 'edge:wishlist:add', tags: { fn: 'wishlist' } });
        expect(mock.captureException).toHaveBeenCalledWith(err, {
            tags: { fn: 'wishlist' },
            extra: { context: 'edge:wishlist:add' },
        });

        lib.addBreadcrumb({ category: 'edge', message: 'wishlist:add' });
        expect(mock.addBreadcrumb).toHaveBeenCalledWith({
            category: 'edge',
            message: 'wishlist:add',
        });
    });

    it('DSN set → non-Error values are wrapped before capture', () => {
        process.env.EXPO_PUBLIC_SENTRY_DSN = DSN;
        const { mock, lib } = load();
        lib.initSentry();

        lib.captureError('string failure');
        const [captured] = mock.captureException.mock.calls[0];
        expect(captured).toBeInstanceOf(Error);
        expect((captured as Error).message).toBe('string failure');
    });

    it('DSN set → wrapRootComponent applies Sentry.wrap', () => {
        process.env.EXPO_PUBLIC_SENTRY_DSN = DSN;
        const { mock, lib } = load();
        lib.initSentry();

        const Component = () => null;
        expect(lib.wrapRootComponent(Component)).toBe(Component); // identity mock
        expect(mock.wrap).toHaveBeenCalledWith(Component);
    });
});
