/**
 * localNotify cadence-gate tests (TICKET-120).
 *
 * Covers the pure prompt-cadence decision + the AsyncStorage-backed record helpers.
 * Deliberately DOES NOT import/exercise expo-notifications — the gate is pure +
 * storage-only by design so it stays testable without a native build.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    shouldOfferNotifPrompt,
    recordNotifPromptShown,
    recordNotifPromptDecline,
    MIN_PROMPT_INTERVAL_MS,
    MAX_PROMPT_DECLINES,
    NOTIF_PROMPT_KEY,
    type NotifPromptState,
} from './localNotify';

const NOW = 1_800_000_000_000; // fixed epoch ms
const fresh: NotifPromptState = { lastShownAt: 0, declines: 0 };

describe('shouldOfferNotifPrompt', () => {
    it('offers on a fresh state (never shown, no declines)', () => {
        expect(shouldOfferNotifPrompt('undetermined', fresh, NOW)).toBe(true);
    });

    it('never offers once permission is granted', () => {
        expect(shouldOfferNotifPrompt('granted', fresh, NOW)).toBe(false);
        // granted outranks even an otherwise-eligible cadence
        expect(
            shouldOfferNotifPrompt('granted', { lastShownAt: 0, declines: 0 }, NOW),
        ).toBe(false);
    });

    it('still offers when OS-denied (so the settings path can trigger)', () => {
        expect(shouldOfferNotifPrompt('denied', fresh, NOW)).toBe(true);
    });

    it('suppresses within the 14-day window since last shown', () => {
        const oneDayAgo = NOW - 24 * 60 * 60 * 1000;
        expect(
            shouldOfferNotifPrompt('undetermined', { lastShownAt: oneDayAgo, declines: 0 }, NOW),
        ).toBe(false);
    });

    it('re-offers once ≥14 days have passed since last shown', () => {
        const fifteenDaysAgo = NOW - 15 * 24 * 60 * 60 * 1000;
        expect(
            shouldOfferNotifPrompt('undetermined', { lastShownAt: fifteenDaysAgo, declines: 0 }, NOW),
        ).toBe(true);
    });

    it('treats exactly-14-days as still within the window (strict <)', () => {
        const exactly = NOW - MIN_PROMPT_INTERVAL_MS;
        // now - lastShownAt === MIN_PROMPT_INTERVAL_MS → not < → eligible
        expect(
            shouldOfferNotifPrompt('undetermined', { lastShownAt: exactly, declines: 0 }, NOW),
        ).toBe(true);
        // one ms short of 14 days → suppressed
        expect(
            shouldOfferNotifPrompt('undetermined', { lastShownAt: exactly + 1, declines: 0 }, NOW),
        ).toBe(false);
    });

    it('hard-stops after 3 declines, even past the window', () => {
        const longAgo = NOW - 100 * 24 * 60 * 60 * 1000;
        expect(
            shouldOfferNotifPrompt(
                'undetermined',
                { lastShownAt: longAgo, declines: MAX_PROMPT_DECLINES },
                NOW,
            ),
        ).toBe(false);
    });

    it('still offers with 2 declines when the window has passed', () => {
        const longAgo = NOW - 100 * 24 * 60 * 60 * 1000;
        expect(
            shouldOfferNotifPrompt('undetermined', { lastShownAt: longAgo, declines: 2 }, NOW),
        ).toBe(true);
    });
});

describe('record helpers (AsyncStorage-backed)', () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
    });

    async function readState(): Promise<NotifPromptState | null> {
        const raw = await AsyncStorage.getItem(NOTIF_PROMPT_KEY);
        return raw ? (JSON.parse(raw) as NotifPromptState) : null;
    }

    it('recordNotifPromptShown stamps lastShownAt without touching declines', async () => {
        await recordNotifPromptShown();
        const state = await readState();
        expect(state?.lastShownAt).toBeGreaterThan(0);
        expect(state?.declines).toBe(0);
    });

    it('recordNotifPromptDecline increments declines each time', async () => {
        await recordNotifPromptDecline();
        expect((await readState())?.declines).toBe(1);
        await recordNotifPromptDecline();
        expect((await readState())?.declines).toBe(2);
        await recordNotifPromptDecline();
        expect((await readState())?.declines).toBe(3);
    });

    it('after 3 recorded declines the gate refuses (integration of both)', async () => {
        await recordNotifPromptDecline();
        await recordNotifPromptDecline();
        await recordNotifPromptDecline();
        const state = (await readState()) as NotifPromptState;
        expect(shouldOfferNotifPrompt('undetermined', state, Date.now())).toBe(false);
    });

    it('a fresh show then read is eligible again after the window (using stored state)', async () => {
        await recordNotifPromptShown();
        const state = (await readState()) as NotifPromptState;
        // Immediately after showing → suppressed
        expect(shouldOfferNotifPrompt('undetermined', state, Date.now())).toBe(false);
        // 15 days later → eligible
        const later = Date.now() + 15 * 24 * 60 * 60 * 1000;
        expect(shouldOfferNotifPrompt('undetermined', state, later)).toBe(true);
    });
});
