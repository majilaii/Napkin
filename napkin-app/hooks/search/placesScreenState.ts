import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { FULL, PEEK, type Snap } from '@/components/sheets/snapSheetMath';
import type { SearchMode } from '@/components/search/searchModeTabsGate';
import type { Region } from 'react-native-maps';

export type PlacesViewMode = 'map' | 'list';
export type PlacesScope =
    | { kind: 'you' }
    | { kind: 'friends' }
    | { kind: 'table'; tableId: string };

export interface PlacesScreenSnapshot {
    query: string;
    sheetSnap: Snap;
    selectedPinId: string | null;
    scrollOffset: number;
    activeSegment: SearchMode;
    layerFilter: PlacesLayerFilter;
    scope: PlacesScope;
    viewMode: PlacesViewMode;
    region: Region | null;
    previousNonPeopleSnap: Snap | null;
    previousNonSearchSnap: Snap | null;
}

export type PlacesLayerFilter = 'all' | 'pinned' | 'been';

const INITIAL_STATE: PlacesScreenSnapshot = Object.freeze({
    query: '',
    sheetSnap: PEEK,
    selectedPinId: null,
    scrollOffset: 0,
    activeSegment: 'places',
    layerFilter: 'all',
    scope: { kind: 'you' } as PlacesScope,
    viewMode: 'map',
    region: null,
    previousNonPeopleSnap: null,
    previousNonSearchSnap: null,
});

export function togglePlacesLayerFilter(
    current: PlacesLayerFilter,
    requested: Exclude<PlacesLayerFilter, 'all'>,
): PlacesLayerFilter {
    return current === requested ? 'all' : requested;
}

/** Search owns the paper page, exits list mode, and remembers the map detent exactly once. */
export function enterPlacesSearch(current: PlacesScreenSnapshot): PlacesScreenSnapshot {
    if (current.previousNonSearchSnap !== null) return current;
    return {
        ...current,
        viewMode: 'map',
        sheetSnap: FULL,
        previousNonSearchSnap: current.sheetSnap,
    };
}

/** Leaving search returns to Places browse with the prior detent and layer intact. */
export function leavePlacesSearch(current: PlacesScreenSnapshot): PlacesScreenSnapshot {
    if (current.previousNonSearchSnap === null) return current;
    return {
        ...current,
        query: '',
        sheetSnap: current.previousNonSearchSnap,
        selectedPinId: null,
        scrollOffset: 0,
        viewMode: 'map',
        previousNonPeopleSnap: null,
        previousNonSearchSnap: null,
    };
}

/** Pure segment transition: People owns full height, then restores the prior detent. */
export function transitionPlacesSegment(
    current: PlacesScreenSnapshot,
    requested: SearchMode,
    hidePeople: boolean,
): PlacesScreenSnapshot {
    const next = requested === 'people' && hidePeople ? 'places' : requested;
    if (next === current.activeSegment) return current;
    if (next === 'people') {
        return {
            ...current,
            activeSegment: next,
            previousNonPeopleSnap: current.sheetSnap,
            sheetSnap: FULL,
        };
    }
    if (current.activeSegment === 'people') {
        return {
            ...current,
            activeSegment: next,
            sheetSnap: current.previousNonPeopleSnap ?? PEEK,
            previousNonPeopleSnap: null,
        };
    }
    return { ...current, activeSegment: next };
}

/**
 * A routed Lists/People arrival is a fresh search intent. With no explicit `q`
 * it must open on that pane's guidance state instead of inheriting the last
 * query saved by the Places screen. Other arrivals retain the per-user query.
 */
export function queryForPlacesRouteArrival(
    persistedQuery: string,
    incomingQuery: string | undefined,
    requestedMode: SearchMode | null,
): string {
    if (incomingQuery !== undefined) return incomingQuery.trim();
    if (requestedMode === 'lists' || requestedMode === 'people') return '';
    return persistedQuery;
}

function cleanUserId(userId: string | null | undefined): string | null {
    return userId?.trim() || null;
}

export interface PlacesScreenStateStore {
    setActiveUser: (userId: string | null | undefined) => void;
    get: (userId: string | null | undefined) => PlacesScreenSnapshot;
    patch: (
        userId: string | null | undefined,
        value: Partial<PlacesScreenSnapshot>,
    ) => void;
    subscribe: (listener: () => void) => () => void;
}

/** Each mounted Places surface owns one auth-fenced snapshot and listener set. */
export function createPlacesScreenState(
    initial: Partial<PlacesScreenSnapshot> = {},
): PlacesScreenStateStore {
    const initialSnapshot: PlacesScreenSnapshot = Object.freeze({
        ...INITIAL_STATE,
        ...initial,
    });
    let activeUserId: string | null = null;
    let snapshot: PlacesScreenSnapshot = initialSnapshot;
    const listeners = new Set<() => void>();
    const emit = () => {
        for (const listener of listeners) listener();
    };

    const store: PlacesScreenStateStore = {
        setActiveUser(userId): void {
            const next = cleanUserId(userId);
            if (next === activeUserId) return;
            activeUserId = next;
            snapshot = initialSnapshot;
            emit();
        },

        get(userId): PlacesScreenSnapshot {
            return cleanUserId(userId) === activeUserId ? snapshot : initialSnapshot;
        },

        patch(userId, value): void {
            const key = cleanUserId(userId);
            if (!key) return;
            if (activeUserId !== key) store.setActiveUser(key);
            const next = { ...snapshot, ...value };
            if (Object.keys(value).every((field) => (
                next[field as keyof PlacesScreenSnapshot]
                === snapshot[field as keyof PlacesScreenSnapshot]
            ))) return;
            snapshot = next;
            emit();
        },

        subscribe(listener): () => void {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    return store;
}

export const placesScreenState = createPlacesScreenState();

export function usePlacesScreenState(
    userId: string | null | undefined,
    store: PlacesScreenStateStore = placesScreenState,
) {
    const identity = userId ?? null;
    useEffect(() => store.setActiveUser(identity), [identity, store]);
    const getSnapshot = useCallback(() => store.get(identity), [identity, store]);
    const value = useSyncExternalStore(
        store.subscribe,
        getSnapshot,
        getSnapshot,
    );
    const patch = useCallback(
        (next: Partial<PlacesScreenSnapshot>) => store.patch(identity, next),
        [identity, store],
    );
    return { value, patch };
}
