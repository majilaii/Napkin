/**
 * Consent to read imports with a third-party AI model (TICKET-250).
 *
 * App Store Guideline 5.1.2(i) (November 2025): an app must say what personal
 * data goes to a third-party AI, name who receives it, and get explicit
 * permission before sending it. Every import except a Google Maps link is read
 * by the extraction model behind resolve-url (supabase/functions/_shared/
 * importModel.ts, OpenAI `gpt-5.6-luna` by default): captions, on-screen text,
 * speech transcripts and screenshots. Nothing AI-bound may leave the phone
 * until this user said yes on this device.
 *
 * Stored per user in AsyncStorage, so a different account on the same phone
 * starts un-asked (per-user cache isolation). The stored value carries the
 * provider: switching the model provider bumps AI_IMPORT_CONSENT_VERSION and
 * asks everyone again. A refusal is never stored; the background drain just
 * stops asking for the rest of the app session, and any import the user starts
 * asks again.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import { isMapsShareUrl } from '@/lib/mapsShare';

/** Who receives import content. Must match the server's extraction provider. */
export const AI_IMPORT_PROVIDER_LABEL = 'OpenAI';
export const AI_IMPORT_CONSENT_VERSION = 'import-v1:openai';

/**
 * UIKit is still animating the alert away when its button handler runs.
 * Presenting a picker in that window is dropped silently, so a caller that
 * presents a controller after a prompt waits this long first.
 */
export const AI_CONSENT_PROMPT_SETTLE_MS = 450;

export const AI_CONSENT_PROMPT = {
    title: `Read imports with ${AI_IMPORT_PROVIDER_LABEL}?`,
    message:
        `To find the restaurants, Napkin sends what you import to ${AI_IMPORT_PROVIDER_LABEL}: ` +
        'the caption, on-screen text and speech of a post or video, or the screenshot you pick.',
    allow: 'Allow',
    decline: 'Not now',
} as const;

const KEY_PREFIX = 'napkin.aiImportConsent.v1:';

type StoredConsent = { version: string; at: string };

const cache = new Map<string, boolean>();
const listeners = new Set<() => void>();
const declinedThisSession = new Set<string>();
const inflight = new Map<string, Promise<ConsentAnswer>>();

export type ConsentAnswer = { granted: boolean; prompted: boolean };

function keyFor(userId: string): string {
    return `${KEY_PREFIX}${userId}`;
}

function notify(): void {
    for (const fn of listeners) fn();
}

/**
 * False for a Google Maps link (resolve-url matches those against Places with
 * no model); true for every other link.
 */
export function isAiBoundUrl(url: string | null | undefined): boolean {
    return !isMapsShareUrl(url);
}

/**
 * Does this queued import need consent before it runs? Every import except a
 * Google Maps link is read by the model: shared links and saved videos alike.
 */
export function importNeedsAiConsent(manifest: { kind: 'video' | 'url'; url?: string | null }): boolean {
    return manifest.kind !== 'url' || isAiBoundUrl(manifest.url);
}

/** Has this user allowed the current provider on this device? Never throws. */
export async function hasAiImportConsent(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false;
    const cached = cache.get(userId);
    if (cached !== undefined) return cached;
    let granted = false;
    try {
        const raw = await AsyncStorage.getItem(keyFor(userId));
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<StoredConsent>;
            granted = parsed?.version === AI_IMPORT_CONSENT_VERSION;
        }
    } catch {
        // Unreadable storage reads as "not asked": fail closed, ask again.
        granted = false;
    }
    cache.set(userId, granted);
    return granted;
}

/** Record a grant, or withdraw it (Settings). Persists best-effort. */
export async function setAiImportConsent(userId: string, granted: boolean): Promise<void> {
    cache.set(userId, granted);
    if (granted) declinedThisSession.delete(userId);
    notify();
    try {
        if (granted) {
            const value: StoredConsent = { version: AI_IMPORT_CONSENT_VERSION, at: new Date().toISOString() };
            await AsyncStorage.setItem(keyFor(userId), JSON.stringify(value));
        } else {
            await AsyncStorage.removeItem(keyFor(userId));
        }
    } catch {
        // The in-memory answer still holds for this session.
    }
}

/** Subscribe to grant/withdraw changes (Settings row, progress banner). */
export function subscribeAiImportConsent(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}

/** True once the user answered "Not now" to a prompt in this app session. */
export function declinedAiImportConsentThisSession(userId: string): boolean {
    return declinedThisSession.has(userId);
}

function prompt(): Promise<boolean> {
    return new Promise((resolve) => {
        Alert.alert(
            AI_CONSENT_PROMPT.title,
            AI_CONSENT_PROMPT.message,
            [
                { text: AI_CONSENT_PROMPT.decline, style: 'cancel', onPress: () => resolve(false) },
                { text: AI_CONSENT_PROMPT.allow, onPress: () => resolve(true) },
            ],
            // Android back/outside tap counts as "Not now".
            { cancelable: true, onDismiss: () => resolve(false) },
        );
    });
}

/**
 * Resolve to the user's answer, asking only when there is no grant yet. Callers
 * sharing a moment share one alert. `prompted` tells a caller that is about to
 * present a picker to wait AI_CONSENT_PROMPT_SETTLE_MS first.
 */
export async function requestAiImportConsent(userId: string | null | undefined): Promise<ConsentAnswer> {
    if (!userId) return { granted: false, prompted: false };
    if (await hasAiImportConsent(userId)) return { granted: true, prompted: false };
    const pending = inflight.get(userId);
    if (pending) return pending;
    const ask = (async (): Promise<ConsentAnswer> => {
        const granted = await prompt();
        if (granted) await setAiImportConsent(userId, true);
        else declinedThisSession.add(userId);
        return { granted, prompted: true };
    })();
    inflight.set(userId, ask);
    try {
        return await ask;
    } finally {
        inflight.delete(userId);
    }
}

/** Test-only: forget every cached answer and pending prompt. */
export function __resetAiConsentForTests(): void {
    cache.clear();
    listeners.clear();
    declinedThisSession.clear();
    inflight.clear();
}
