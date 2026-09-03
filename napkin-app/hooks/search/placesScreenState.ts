import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { FULL, PEEK, type Snap } from '@/components/sheets/snapSheetMath';
import type { SearchMode } from '@/components/search/searchModeTabsGate';
import type { Region } from 'react-native-maps';

export type PlacesViewMode = 'map' | 'list';

export interface PlacesScreenSnapshot {
    query: string;
    sheetSnap: Snap;
    selectedPinId: string | null;
    scrollOffset: number;
    activeSegment: SearchMode;
    layerFilter: PlacesLayerFilter;
    viewMode: PlacesViewMode;
    region: Region | null;
    previousNonPeopleSnap: Snap | null;
    previousNonSearchSnap: Snap | null;
}

export type PlacesLayerFilter = 'all' | 'pinned' | 'been' | 'friends';

const INITIAL_STATE: PlacesScreenSnapshot = Object.freeze({
    query: '',
    sheetSnap: PEEK,
    selectedPinId: null,
    scrollOffset: 0,
    activeSegment: 'places',
    layerFilter: 'all',
    viewMode: 'map',
    region: null,
    previousNonPeopleSnap: null,
    previousNonSearchSnap: null,
});

let activeUserId: string | null = null;
let snapshot: PlacesScreenSnapshot = INITIAL_STATE;
const listeners = new Set<() => void>();

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

function emit(): void {
    for (const listener of listeners) listener();
}

export const placesScreenState = {
    setActiveUser(userId: string | null | undefined): void {
        const next = cleanUserId(userId);
        if (next === activeUserId) return;
        activeUserId = next;
        snapshot = INITIAL_STATE;
        emit();
    },

    get(userId: string | null | undefined): PlacesScreenSnapshot {
        return cleanUserId(userId) === activeUserId ? snapshot : INITIAL_STATE;
    },

    patch(
        userId: string | null | undefined,
        value: Partial<PlacesScreenSnapshot>,
    ): void {
        const key = cleanUserId(userId);
        if (!key) return;
        if (activeUserId !== key) this.setActiveUser(key);
        const next = { ...snapshot, ...value };
        if (Object.keys(value).every((field) => (
            next[field as keyof PlacesScreenSnapshot]
            === snapshot[field as keyof PlacesScreenSnapshot]
        ))) return;
        snapshot = next;
        emit();
    },

    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export function usePlacesScreenState(userId: string | null | undefined) {
    const identity = userId ?? null;
    useEffect(() => placesScreenState.setActiveUser(identity), [identity]);
    const getSnapshot = useCallback(() => placesScreenState.get(identity), [identity]);
    const value = useSyncExternalStore(
        placesScreenState.subscribe,
        getSnapshot,
        getSnapshot,
    );
    const patch = useCallback(
        (next: Partial<PlacesScreenSnapshot>) => placesScreenState.patch(identity, next),
        [identity],
    );
    return { value, patch };
}
