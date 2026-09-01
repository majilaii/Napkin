/**
 * Session-only locality choice for the Search tab.
 *
 * The store is keyed by user id, but an auth identity change clears every
 * entry before the new identity becomes active. That prevents a city chosen
 * by one account from leaking to another account on the same device.
 */

export type SearchLocality = 'auto' | { city: string };

const AUTO_LOCALITY = 'auto' as const;

let activeUserId: string | null = null;
const localityByUser = new Map<string, SearchLocality>();
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) listener();
}

function cleanUserId(userId: string | null | undefined): string | null {
    return userId?.trim() || null;
}

function cleanCity(city: string): string {
    return city.trim().replace(/\s+/g, ' ');
}

function cityName(city: string): string {
    return cleanCity(city).split(',')[0]?.trim().toLowerCase() ?? '';
}

export function cityLocalityBucket(city: string): string | null {
    const normalized = cleanCity(city).toLowerCase();
    return normalized ? `city:${normalized}` : null;
}

export function searchLocalityLabel(
    locality: SearchLocality,
    hasCoords: boolean,
    homeCity: string | null | undefined,
    homeCityKnown: boolean,
): string {
    if (locality !== 'auto') return cityName(locality.city);
    if (hasCoords) return 'current location';
    const homeCityLabel = cityName(homeCity ?? '');
    if (homeCityLabel) return homeCityLabel;
    return homeCityKnown ? 'anywhere' : '…';
}

export const searchLocalityStore = {
    setActiveUser(userId: string | null | undefined): void {
        const nextUserId = cleanUserId(userId);
        if (activeUserId === nextUserId) return;

        activeUserId = nextUserId;
        localityByUser.clear();
        emit();
    },

    get(userId: string | null | undefined): SearchLocality {
        const key = cleanUserId(userId);
        if (!key || key !== activeUserId) return AUTO_LOCALITY;
        return localityByUser.get(key) ?? AUTO_LOCALITY;
    },

    set(userId: string | null | undefined, locality: SearchLocality): void {
        const key = cleanUserId(userId);
        if (!key) return;
        if (activeUserId !== key) this.setActiveUser(key);

        if (locality === 'auto') {
            localityByUser.set(key, AUTO_LOCALITY);
        } else {
            const city = cleanCity(locality.city);
            localityByUser.set(key, city ? { city } : AUTO_LOCALITY);
        }
        emit();
    },

    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
};
