import * as Application from 'expo-application';

/**
 * Measurable App Store/TestFlight build metadata for staged protocol sunsets.
 * It is deliberately NOT a v2 classifier field: updated legacy-shaped calls
 * carry it too, while older installed clients simply omit it.
 */
export function clientBuildMetadata(): { client_build: number } | Record<string, never> {
    const raw = Application.nativeBuildVersion;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return {};
    const build = Number(raw);
    return Number.isSafeInteger(build) && build >= 0 ? { client_build: build } : {};
}
