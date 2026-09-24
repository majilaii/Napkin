/* eslint-disable @typescript-eslint/no-require-imports */
type AlertButton = { text: string; style?: string; onPress?: () => void };
const mockAlert = jest.fn();

jest.mock('react-native', () => ({
    Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    AI_CONSENT_PROMPT,
    AI_CONSENT_QUIET_AFTER_PROMPT_MS,
    AI_IMPORT_CONSENT_VERSION,
    aiConsentPromptRecentlyAnswered,
    __resetAiConsentForTests,
    declinedAiImportConsentThisSession,
    hasAiImportConsent,
    importNeedsAiConsent,
    isAiBoundUrl,
    requestAiImportConsent,
    setAiImportConsent,
    subscribeAiImportConsent,
} from '../aiConsent';

function lastButtons(): AlertButton[] {
    const call = mockAlert.mock.calls[mockAlert.mock.calls.length - 1];
    return call[2] as AlertButton[];
}

/** Wait until the alert has been shown `count` times (AsyncStorage reads are async). */
async function alerts(count: number): Promise<void> {
    for (let i = 0; i < 50 && mockAlert.mock.calls.length < count; i += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

function press(label: string): void {
    const button = lastButtons().find((b) => b.text === label);
    if (!button?.onPress) throw new Error(`no button ${label}`);
    button.onPress();
}

describe('aiConsent', () => {
    beforeEach(async () => {
        mockAlert.mockReset();
        __resetAiConsentForTests();
        await AsyncStorage.clear();
    });

    it('treats only Google Maps links as model-free', () => {
        expect(isAiBoundUrl('https://maps.app.goo.gl/yMEXGo9h9PAqKQfZ6')).toBe(false);
        expect(isAiBoundUrl('https://www.tiktok.com/@a/video/1')).toBe(true);
        expect(isAiBoundUrl('https://www.instagram.com/reel/abc/')).toBe(true);
        expect(isAiBoundUrl('https://example.com/best-pasta')).toBe(true);
        expect(isAiBoundUrl(null)).toBe(true);
    });

    it('asks once, names the provider, and remembers an Allow per user', async () => {
        const pending = requestAiImportConsent('user-a');
        await alerts(1);
        expect(mockAlert).toHaveBeenCalledTimes(1);
        expect(mockAlert.mock.calls[0][0]).toBe(AI_CONSENT_PROMPT.title);
        expect(mockAlert.mock.calls[0][1]).toContain('Anthropic');
        press('Allow');
        await expect(pending).resolves.toEqual({ granted: true, prompted: true });

        await expect(requestAiImportConsent('user-a')).resolves.toEqual({ granted: true, prompted: false });
        expect(mockAlert).toHaveBeenCalledTimes(1);

        const stored = JSON.parse((await AsyncStorage.getItem('napkin.aiImportConsent.v1:user-a')) ?? '{}');
        expect(stored.version).toBe(AI_IMPORT_CONSENT_VERSION);
        // Another account on the same phone starts un-asked.
        await expect(hasAiImportConsent('user-b')).resolves.toBe(false);
    });

    it('shares one alert between concurrent callers', async () => {
        const first = requestAiImportConsent('user-a');
        const second = requestAiImportConsent('user-a');
        await alerts(1);
        await alerts(2);
        expect(mockAlert).toHaveBeenCalledTimes(1);
        press('Allow');
        await expect(first).resolves.toEqual({ granted: true, prompted: true });
        await expect(second).resolves.toEqual({ granted: true, prompted: true });
    });

    it('never stores a refusal and marks the session declined', async () => {
        const pending = requestAiImportConsent('user-a');
        await alerts(1);
        press('Not now');
        await expect(pending).resolves.toEqual({ granted: false, prompted: true });
        await expect(hasAiImportConsent('user-a')).resolves.toBe(false);
        expect(await AsyncStorage.getItem('napkin.aiImportConsent.v1:user-a')).toBeNull();
        expect(declinedAiImportConsentThisSession('user-a')).toBe(true);

        // A user-started import asks again.
        const again = requestAiImportConsent('user-a');
        await alerts(2);
        expect(mockAlert).toHaveBeenCalledTimes(2);
        press('Allow');
        await again;
        expect(declinedAiImportConsentThisSession('user-a')).toBe(false);
    });

    it('asks again when the stored grant names another provider', async () => {
        // Build 266 stored OpenAI grants; they do not cover Anthropic.
        await AsyncStorage.setItem(
            'napkin.aiImportConsent.v1:user-a',
            JSON.stringify({ version: 'import-v1:openai', at: '2026-09-24T00:00:00.000Z' }),
        );
        await expect(hasAiImportConsent('user-a')).resolves.toBe(false);
    });

    it('withdraws from Settings and tells subscribers', async () => {
        const listener = jest.fn();
        subscribeAiImportConsent(listener);
        await setAiImportConsent('user-a', true);
        await expect(hasAiImportConsent('user-a')).resolves.toBe(true);
        await setAiImportConsent('user-a', false);
        await expect(hasAiImportConsent('user-a')).resolves.toBe(false);
        expect(await AsyncStorage.getItem('napkin.aiImportConsent.v1:user-a')).toBeNull();
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('keeps other modals quiet for a moment after any answer', async () => {
        expect(aiConsentPromptRecentlyAnswered()).toBe(false);
        const pending = requestAiImportConsent('user-a');
        await alerts(1);
        press('Not now');
        await pending;
        expect(aiConsentPromptRecentlyAnswered()).toBe(true);
        expect(aiConsentPromptRecentlyAnswered(Date.now() + AI_CONSENT_QUIET_AFTER_PROMPT_MS + 1)).toBe(false);
    });

    it('treats a withdrawal as Not now for the rest of the session', async () => {
        await setAiImportConsent('user-a', true);
        await setAiImportConsent('user-a', false);
        expect(declinedAiImportConsentThisSession('user-a')).toBe(true);
    });

    it('holds only imports that still have to reach the model', () => {
        const tiktok = 'https://www.tiktok.com/@a/video/1';
        expect(importNeedsAiConsent({ kind: 'url', url: tiktok })).toBe(true);
        expect(importNeedsAiConsent({ kind: 'video' })).toBe(true);
        expect(importNeedsAiConsent({ kind: 'url', url: 'https://maps.app.goo.gl/abc' })).toBe(false);
        // A held review already carries resolved spots: confirming it only saves.
        expect(importNeedsAiConsent({ kind: 'url', url: tiktok, spots: [{}] })).toBe(false);
        expect(importNeedsAiConsent({ kind: 'url', url: tiktok, spots: [] })).toBe(true);
    });

    it('never prompts without a signed-in user', async () => {
        await expect(requestAiImportConsent(null)).resolves.toEqual({ granted: false, prompted: false });
        expect(mockAlert).not.toHaveBeenCalled();
    });
});
