import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
    searchLocalityStore,
    type SearchLocality,
} from './searchLocalityStore';

export function useSearchLocality(userId: string | null | undefined): {
    locality: SearchLocality;
    setAuto: () => void;
    setCity: (city: string) => void;
} {
    const identity = userId ?? null;

    useEffect(() => {
        searchLocalityStore.setActiveUser(identity);
    }, [identity]);

    const getSnapshot = useCallback(
        () => searchLocalityStore.get(identity),
        [identity],
    );
    const locality = useSyncExternalStore(
        searchLocalityStore.subscribe,
        getSnapshot,
        getSnapshot,
    );

    const setAuto = useCallback(() => {
        searchLocalityStore.set(identity, 'auto');
    }, [identity]);

    const setCity = useCallback((city: string) => {
        searchLocalityStore.set(identity, { city });
    }, [identity]);

    return { locality, setAuto, setCity };
}
