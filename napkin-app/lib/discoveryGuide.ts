/** Optional, user-scoped feature tips. Profile onboarding remains server-owned. */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const DISCOVERY_TOPICS = ['places', 'tables', 'journal', 'friends', 'lists'] as const;
export type DiscoveryTopic = typeof DISCOVERY_TOPICS[number];

export interface DiscoveryGuideState {
    readonly enabled: boolean;
    readonly dismissed: readonly DiscoveryTopic[];
    readonly ready: boolean;
}

const VERSION = 1;
const EMPTY: DiscoveryGuideState = { enabled: false, dismissed: [], ready: true };
const entries = new Map<string, GuideEntry>();

interface GuideEntry {
    snapshot: DiscoveryGuideState;
    listeners: Set<() => void>;
    loading?: Promise<void>;
    writes: Promise<void>;
}

function storageKey(userId: string): string {
    return `napkin.discoveryGuide.v${VERSION}.${encodeURIComponent(userId)}`;
}

function entryFor(userId: string): GuideEntry {
    let entry = entries.get(userId);
    if (!entry) {
        entry = {
            snapshot: { ...EMPTY, ready: false },
            listeners: new Set(),
            writes: Promise.resolve(),
        };
        entries.set(userId, entry);
    }
    return entry;
}

function publish(entry: GuideEntry, snapshot: DiscoveryGuideState): void {
    entry.snapshot = snapshot;
    entry.listeners.forEach((listener) => listener());
}

function parseStored(raw: string | null): Pick<DiscoveryGuideState, 'enabled' | 'dismissed'> {
    if (!raw) return EMPTY;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return EMPTY;
    const record = value as Record<string, unknown>;
    if (record.version !== VERSION || typeof record.enabled !== 'boolean') return EMPTY;
    const dismissed = record.dismissed;
    return {
        enabled: record.enabled,
        dismissed: Array.isArray(dismissed)
            ? DISCOVERY_TOPICS.filter((topic) => dismissed.includes(topic))
            : [],
    };
}

function hydrate(userId: string, entry: GuideEntry): Promise<void> {
    if (entry.snapshot.ready) return Promise.resolve();
    if (!entry.loading) {
        entry.loading = (async () => {
            let stored: Pick<DiscoveryGuideState, 'enabled' | 'dismissed'> = EMPTY;
            try {
                stored = parseStored(await AsyncStorage.getItem(storageKey(userId)));
            } catch {
                // A missing or unreadable preference never interrupts the app.
            }
            // Tips only enable/dismiss. Merge the latest in-memory state so an
            // older read cannot undo taps that happened while storage loaded.
            const current = entry.snapshot;
            publish(entry, {
                enabled: stored.enabled || current.enabled,
                dismissed: DISCOVERY_TOPICS.filter((topic) =>
                    stored.dismissed.includes(topic) || current.dismissed.includes(topic)),
                ready: true,
            });
        })();
    }
    return entry.loading;
}

function persist(userId: string, entry: GuideEntry): Promise<void> {
    const loading = hydrate(userId, entry);
    // Serialize writes for this user and read the latest snapshot at execution.
    // A slow earlier write can never land after a newer dismissal.
    entry.writes = entry.writes.then(async () => {
        await loading;
        try {
            await AsyncStorage.setItem(storageKey(userId), JSON.stringify({
                version: VERSION,
                enabled: entry.snapshot.enabled,
                dismissed: entry.snapshot.dismissed,
            }));
        } catch {
            // Keep the session state, including dismissals, after storage failure.
        }
    });
    return entry.writes;
}

export function getDiscoveryGuideSnapshot(userId?: string | null): DiscoveryGuideState {
    return userId ? entryFor(userId).snapshot : EMPTY;
}

export function subscribeDiscoveryGuide(userId: string | null | undefined, listener: () => void): () => void {
    if (!userId) return () => {};
    const entry = entryFor(userId);
    entry.listeners.add(listener);
    void hydrate(userId, entry);
    return () => entry.listeners.delete(listener);
}

export function enableDiscoveryGuide(userId: string): Promise<void> {
    if (!userId) return Promise.resolve();
    const entry = entryFor(userId);
    if (!entry.snapshot.enabled) publish(entry, { ...entry.snapshot, enabled: true });
    return persist(userId, entry);
}

export function dismissDiscoveryTip(userId: string, topic: DiscoveryTopic): Promise<void> {
    if (!userId || !DISCOVERY_TOPICS.includes(topic)) return Promise.resolve();
    const entry = entryFor(userId);
    if (!entry.snapshot.dismissed.includes(topic)) {
        publish(entry, { ...entry.snapshot, dismissed: [...entry.snapshot.dismissed, topic] });
    }
    return persist(userId, entry);
}
