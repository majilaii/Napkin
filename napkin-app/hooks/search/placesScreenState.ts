import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { FULL, PEEK, type Snap } from '@/components/sheets/snapSheetMath';
import type { SearchMode } from '@/components/search/searchModeTabsGate';

export interface PlacesScreenSnapshot {
    query: string;
    sheetSnap: Snap;
    selectedPinId: string | null;
    scrollOffset: number;
    activeSegment: SearchMode;
    previousNonPeopleSnap: Snap | null;
}

const INITIAL_STATE: PlacesScreenSnapshot = Object.freeze({
    query: '',
    sheetSnap: PEEK,
    selectedPinId: null,
    scrollOffset: 0,
    activeSegment: 'places',
    previousNonPeopleSnap: null,
});

let activeUserId: string | null = null;
let snapshot: PlacesScreenSnapshot = INITIAL_STATE;
const listeners = new Set<() => void>();

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
