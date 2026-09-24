/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
    __esModule: true,
    default: {
        getItem: (...args: unknown[]) => mockGetItem(...args),
        setItem: (...args: unknown[]) => mockSetItem(...args),
    },
}));

import { GUEST_MODE_KEY, GUEST_MODE_READ_TIMEOUT_MS, readGuestMode, writeGuestMode } from '../guestMode';

describe('guestMode', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        mockGetItem.mockReset();
        mockSetItem.mockReset();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('reads the stored flag', async () => {
        mockGetItem.mockResolvedValue('1');
        await expect(readGuestMode()).resolves.toBe(true);
        expect(mockGetItem).toHaveBeenCalledWith(GUEST_MODE_KEY);
        mockGetItem.mockResolvedValue('0');
        await expect(readGuestMode()).resolves.toBe(false);
    });

    it('reads a failing store as false', async () => {
        mockGetItem.mockRejectedValue(new Error('native store unavailable'));
        await expect(readGuestMode()).resolves.toBe(false);
    });

    it('gives up on a read that never settles, so the launch cover can lift', async () => {
        mockGetItem.mockReturnValue(new Promise(() => {}));
        const read = readGuestMode();
        await jest.advanceTimersByTimeAsync(GUEST_MODE_READ_TIMEOUT_MS);
        await expect(read).resolves.toBe(false);
    });

    it('never throws on a failed write', async () => {
        mockSetItem.mockRejectedValue(new Error('disk full'));
        await expect(writeGuestMode(true)).resolves.toBeUndefined();
    });
});
