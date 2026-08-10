/**
 * localNotify — device-LOCAL notifications for async import completion (TICKET-120).
 *
 * Imports (video/TikTok shares → OCR/resolve → save or review-hold) finish silently
 * when the app is backgrounded. This posts a device-scheduled notification the moment
 * a drain checkpoint lands while the app isn't foregrounded, and gates a soft
 * pre-permission sheet on a quiet cadence. NO remote push, NO APNs token, NO server —
 * CLAUDE.md's "push deferred" still holds for remote; this is local-only.
 *
 * expo-notifications is LAZILY required inside try/catch (mirrors the media-extract
 * accessor discipline) so Expo Go / web / a build without the native module degrades
 * to a no-op instead of crashing at import time. The cadence gate is pure + storage-
 * backed only — it never touches native, so it stays unit-testable without a build.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';

// LAZY native binding. `require('expo-notifications')` throws when the module isn't
// present in this build — resolve it on first CALL, cache the null so we probe once.
type ExpoNotifications = typeof import('expo-notifications');
let notifModule: ExpoNotifications | null | undefined;

const IMPORTS_NOTIFICATION_CHANNEL_ID = 'imports';

function getNotif(): ExpoNotifications | null {
    if (notifModule !== undefined) return notifModule;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        notifModule = require('expo-notifications') as ExpoNotifications;
    } catch {
        notifModule = null;
    }
    return notifModule;
}

/** True when expo-notifications is linked in this build (never throws). */
export function isNotifAvailable(): boolean {
    return getNotif() !== null;
}

// ── Foreground handler + Android channel (call once at launch) ─────────────────

/**
 * Configure the notification handler + Android channel. Suppresses the banner while
 * the app is foregrounded (belt-and-braces over the drain's AppState gate — the
 * in-app toast already covers the active case; never double-announce). Guarded.
 */
export function configureNotifications(): void {
    const N = getNotif();
    if (!N) return;
    try {
        N.setNotificationHandler({
            handleNotification: async () => ({
                // Suppress everything in-foreground — the toast is the active-state UI.
                shouldShowBanner: false,
                shouldShowList: false,
                shouldPlaySound: false,
                shouldSetBadge: false,
                // Deprecated field kept for older reads; harmless alongside the above.
                shouldShowAlert: false,
            }),
        });
        if (Platform.OS === 'android') {
            N.setNotificationChannelAsync(IMPORTS_NOTIFICATION_CHANNEL_ID, {
                name: 'Imports',
                importance: N.AndroidImportance?.DEFAULT ?? 3,
            }).catch(() => {
                /* channel setup is best-effort */
            });
        }
    } catch {
        /* native module absent — no-op */
    }
}

// ── Permission ─────────────────────────────────────────────────────────────────

export type NotifPermission = 'granted' | 'denied' | 'undetermined';

/** Current OS permission state. Module absent / error → 'denied' (never offers native). */
export async function getPermissionState(): Promise<NotifPermission> {
    const N = getNotif();
    if (!N) return 'denied';
    try {
        const perms = await N.getPermissionsAsync();
        if (perms.granted || perms.status === 'granted') return 'granted';
        if (perms.status === 'undetermined') return 'undetermined';
        return 'denied';
    } catch {
        return 'denied';
    }
}

/** Fire the OS permission prompt (only meaningful when currently 'undetermined'). */
export async function requestPermission(): Promise<NotifPermission> {
    const N = getNotif();
    if (!N) return 'denied';
    try {
        const perms = await N.requestPermissionsAsync();
        if (perms.granted || perms.status === 'granted') return 'granted';
        if (perms.status === 'undetermined') return 'undetermined';
        return 'denied';
    } catch {
        return 'denied';
    }
}

/** Deep-link out to system Settings (for an OS-level denial). Guarded. */
export function openNotificationSettings(): void {
    try {
        Linking.openSettings();
    } catch {
        /* best-effort */
    }
}

// ── Present a completion notification ──────────────────────────────────────────

/** The route a completion-notification tap opens (the imports hub — never deeper). */
export const IMPORT_NOTIF_URL = '/import-progress';

/**
 * Present a local notification immediately (null trigger). `data.url` routes the
 * tap to the imports hub. Best-effort — never throws into the drain.
 */
export async function presentImportNotification(content: {
    title: string;
    body: string;
}): Promise<void> {
    const N = getNotif();
    if (!N) return;
    try {
        await N.scheduleNotificationAsync({
            content: {
                title: content.title,
                body: content.body,
                data: { url: IMPORT_NOTIF_URL },
            },
            // A channel-aware trigger still presents immediately; unlike null it
            // routes Android 8+ notifications through the Imports channel above.
            trigger:
                Platform.OS === 'android'
                    ? { channelId: IMPORTS_NOTIFICATION_CHANNEL_ID }
                    : null,
        });
    } catch {
        /* best-effort — never break the drain */
    }
}

// ── Notification-tap routing (live listener + cold start) ──────────────────────

function urlFromResponse(response: unknown): string | null {
    const url = (
        response as { notification?: { request?: { content?: { data?: { url?: unknown } } } } } | null
    )?.notification?.request?.content?.data?.url;
    return typeof url === 'string' ? url : null;
}

// A launching tap surfaces through BOTH paths — getLastNotificationResponseAsync
// AND a replay to the live listener — so each response id is claimed once, shared
// across both. Without this, /import-progress gets pushed twice and back lands on
// a duplicate hub (hierarchical back-nav is sacred).
const claimedResponseIds = new Set<string>();

function claimResponseUrl(response: unknown): string | null {
    const url = urlFromResponse(response);
    if (!url) return null;
    const id = (response as { notification?: { request?: { identifier?: unknown } } } | null)
        ?.notification?.request?.identifier;
    if (typeof id === 'string') {
        if (claimedResponseIds.has(id)) return null;
        claimedResponseIds.add(id);
    }
    return url;
}

/** Subscribe to notification taps → hands back the `data.url`. Returns an unsub. */
export function addNotificationResponseListener(handler: (url: string) => void): () => void {
    const N = getNotif();
    if (!N) return () => {};
    try {
        const sub = N.addNotificationResponseReceivedListener((response) => {
            const url = claimResponseUrl(response);
            if (url) handler(url);
        });
        return () => {
            try {
                sub.remove();
            } catch {
                /* best-effort */
            }
        };
    } catch {
        return () => {};
    }
}

/** The tap that cold-started the app (if any), so a killed-state tap still routes. */
export async function getInitialNotificationUrl(): Promise<string | null> {
    const N = getNotif();
    if (!N) return null;
    try {
        const response = await N.getLastNotificationResponseAsync();
        return claimResponseUrl(response);
    } catch {
        return null;
    }
}

// ── Soft-prompt request signal (drain → root layout) ───────────────────────────

type PromptListener = () => void;
const promptListeners = new Set<PromptListener>();

/** Subscribe to "offer the notif prompt now" requests (root layout renders the sheet). */
export function onNotifPromptRequest(fn: PromptListener): () => void {
    promptListeners.add(fn);
    return () => {
        promptListeners.delete(fn);
    };
}

function emitNotifPromptRequest(): void {
    promptListeners.forEach((l) => {
        try {
            l();
        } catch {
            /* a bad listener must not break the drain */
        }
    });
}

// ── Prompt cadence gate (pure + AsyncStorage; NO native — unit-testable) ────────

export const NOTIF_PROMPT_KEY = 'napkin.notifPrompt.v1';
/** Minimum gap between showing the sheet (14 days) — quiet, not a nag. */
export const MIN_PROMPT_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;
/** Hard stop: after this many "not now" declines, never show again. */
export const MAX_PROMPT_DECLINES = 3;

export interface NotifPromptState {
    /** epoch ms the sheet was last shown; 0 = never. */
    lastShownAt: number;
    /** count of "not now" presses. */
    declines: number;
}

const EMPTY_PROMPT_STATE: NotifPromptState = { lastShownAt: 0, declines: 0 };

async function readPromptState(): Promise<NotifPromptState> {
    try {
        const raw = await AsyncStorage.getItem(NOTIF_PROMPT_KEY);
        if (!raw) return { ...EMPTY_PROMPT_STATE };
        const p = JSON.parse(raw) as Partial<NotifPromptState>;
        return {
            lastShownAt: typeof p.lastShownAt === 'number' ? p.lastShownAt : 0,
            declines: typeof p.declines === 'number' ? p.declines : 0,
        };
    } catch {
        return { ...EMPTY_PROMPT_STATE };
    }
}

async function writePromptState(state: NotifPromptState): Promise<void> {
    try {
        await AsyncStorage.setItem(NOTIF_PROMPT_KEY, JSON.stringify(state));
    } catch {
        /* best-effort — the sheet still worked; only the cadence memory is lost */
    }
}

/**
 * Pure cadence decision (all inputs explicit → the whole matrix is unit-testable):
 * never once granted; hard stop after MAX_PROMPT_DECLINES; otherwise only when
 * MIN_PROMPT_INTERVAL_MS has passed since the last show.
 */
export function shouldOfferNotifPrompt(
    permission: NotifPermission,
    state: NotifPromptState,
    now: number,
): boolean {
    if (permission === 'granted') return false;
    if (state.declines >= MAX_PROMPT_DECLINES) return false;
    if (state.lastShownAt > 0 && now - state.lastShownAt < MIN_PROMPT_INTERVAL_MS) return false;
    return true;
}

/** Stamp "shown now" — starts the 14-day clock so a re-drain won't re-emit. */
export async function recordNotifPromptShown(): Promise<void> {
    const state = await readPromptState();
    await writePromptState({ ...state, lastShownAt: Date.now() });
}

/** Record a "not now" — bumps declines toward the hard stop. */
export async function recordNotifPromptDecline(): Promise<void> {
    const state = await readPromptState();
    await writePromptState({ lastShownAt: Date.now(), declines: state.declines + 1 });
}

/**
 * The drain's demonstrated-value beat: an import is in flight and the user is here.
 * Checks availability + permission + cadence; if all pass, stamps "shown" (so a
 * near-simultaneous re-drain won't double-fire) and emits the request. Fire-and-
 * forget — never lets the prompt gate break the drain.
 */
export async function maybeOfferNotifPrompt(): Promise<void> {
    try {
        if (!isNotifAvailable()) return;
        const permission = await getPermissionState();
        const state = await readPromptState();
        if (!shouldOfferNotifPrompt(permission, state, Date.now())) return;
        await recordNotifPromptShown();
        emitNotifPromptRequest();
    } catch {
        /* never let the prompt gate break the drain */
    }
}
