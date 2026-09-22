import {
    isLaunchBusy,
    LAUNCH_COPY,
    launchStatusLine,
    resolveLaunchStatus,
    type AccountLaunchState,
    type ConnectivityLaunchState,
} from '../launchState';

const retry = jest.fn();
const checkingNet: ConnectivityLaunchState = { status: 'checking' };
const offline: ConnectivityLaunchState = { status: 'offline', retrying: false, retry };
const online: ConnectivityLaunchState = { status: 'ready' };
const checkingAccount: AccountLaunchState = { status: 'checking' };
const unreachable: AccountLaunchState = { status: 'unreachable', retry };
const accountReady: AccountLaunchState = { status: 'ready' };

describe('resolveLaunchStatus', () => {
    it('is ready only when connectivity, account and routing have all landed', () => {
        expect(resolveLaunchStatus(online, accountReady, true)).toEqual({ kind: 'ready' });
        expect(resolveLaunchStatus(online, accountReady, false)).toEqual({ kind: 'loading' });
        expect(resolveLaunchStatus(online, checkingAccount, true)).toEqual({ kind: 'loading' });
        expect(resolveLaunchStatus(checkingNet, accountReady, true)).toEqual({ kind: 'loading' });
    });

    it('puts a cold offline launch ahead of every other wait', () => {
        expect(resolveLaunchStatus(offline, unreachable, false)).toEqual({
            kind: 'offline',
            retrying: false,
            retry,
        });
    });

    it('surfaces an unreachable account check once the device is online', () => {
        expect(resolveLaunchStatus(online, unreachable, false)).toEqual({ kind: 'unreachable', retry });
        // The account state is stale until the app has mounted behind connectivity.
        expect(resolveLaunchStatus(checkingNet, unreachable, false)).toEqual({ kind: 'loading' });
    });
});

describe('launchStatusLine', () => {
    it('stays silent for a quick launch and speaks up only when slow', () => {
        expect(launchStatusLine({ kind: 'loading' }, false)).toBeNull();
        expect(launchStatusLine({ kind: 'loading' }, true)).toBe(LAUNCH_COPY.slow);
        expect(launchStatusLine({ kind: 'ready' }, true)).toBeNull();
    });

    it('names the problem immediately when the launch cannot continue', () => {
        expect(launchStatusLine({ kind: 'offline', retrying: false, retry }, false)).toBe(LAUNCH_COPY.offline);
        expect(launchStatusLine({ kind: 'unreachable', retry }, false)).toBe(LAUNCH_COPY.unreachable);
    });
});

describe('isLaunchBusy', () => {
    it('runs the pen stroke only while work is actually in flight', () => {
        expect(isLaunchBusy({ kind: 'loading' })).toBe(true);
        expect(isLaunchBusy({ kind: 'offline', retrying: true, retry })).toBe(true);
        expect(isLaunchBusy({ kind: 'offline', retrying: false, retry })).toBe(false);
        expect(isLaunchBusy({ kind: 'unreachable', retry })).toBe(false);
        expect(isLaunchBusy({ kind: 'ready' })).toBe(false);
    });
});
