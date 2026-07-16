/**
 * Local-only developer preferences. These are best-effort conveniences, never
 * product state: storage failures fall back quietly and must not block launch.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const PREVIEW_ONBOARDING_ON_LAUNCH_KEY =
    'napkin.dev.previewOnboardingOnLaunch';

const TRUE_VALUE = '1';
const FALSE_VALUE = '0';

let cachedPreviewOnLaunch = false;
let primed = false;
let loadPromise: Promise<boolean> | null = null;

/** Synchronous cache read for render-time seeds and already-gated flows. */
export function getPreviewOnboardingOnLaunchCached(): boolean {
    return cachedPreviewOnLaunch;
}

/** Read and cache the durable preference. Never throws. */
export async function getPreviewOnboardingOnLaunch(): Promise<boolean> {
    if (primed) return cachedPreviewOnLaunch;
    if (!loadPromise) {
        loadPromise = (async () => {
            try {
                const raw = await AsyncStorage.getItem(
                    PREVIEW_ONBOARDING_ON_LAUNCH_KEY,
                );
                // An explicit setter wins over a slower module-load read.
                if (!primed) {
                    cachedPreviewOnLaunch = raw === TRUE_VALUE;
                    primed = true;
                }
            } catch {
                if (!primed) primed = true;
            }
            return cachedPreviewOnLaunch;
        })();
    }
    return loadPromise;
}

/** Update the cache immediately, then persist best-effort. Never throws. */
export async function setPreviewOnboardingOnLaunch(value: boolean): Promise<void> {
    cachedPreviewOnLaunch = value;
    primed = true;
    try {
        await AsyncStorage.setItem(
            PREVIEW_ONBOARDING_ON_LAUNCH_KEY,
            value ? TRUE_VALUE : FALSE_VALUE,
        );
    } catch {
        // The in-memory preference still applies for this app session.
    }
}

// Prime once so synchronous consumers become accurate as early as possible.
void getPreviewOnboardingOnLaunch();
