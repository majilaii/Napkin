/**
 * useNearbyLocation — lazy, one-time foreground location for "near me" sorting.
 *
 * Mirrors the established app idiom (app/(tabs)/search.tsx, create-entry.tsx):
 * requestForegroundPermissionsAsync → getLastKnownPositionAsync ?? getCurrentPositionAsync.
 *
 * Unlike those, the request is LAZY — call `request()` when the user actually opts
 * into a distance sort, so the lone-ledger first run stays calm (no permission
 * prompt on mount). Returns the coords + status; safe to call request() repeatedly
 * (it no-ops once resolved or in-flight).
 */
import { useCallback, useRef, useState } from 'react';
import * as Location from 'expo-location';
import type { LatLng } from '@/lib/geo';

type Status = 'idle' | 'pending' | 'granted' | 'denied';

export function useNearbyLocation() {
    const [coords, setCoords] = useState<LatLng | null>(null);
    const [status, setStatus] = useState<Status>('idle');
    const inFlight = useRef(false);

    const request = useCallback(async () => {
        if (inFlight.current || coords) return;
        inFlight.current = true;
        setStatus('pending');
        try {
            const { status: perm } = await Location.requestForegroundPermissionsAsync();
            if (perm !== 'granted') {
                setStatus('denied');
                return;
            }
            const loc =
                (await Location.getLastKnownPositionAsync()) ??
                (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
            if (loc) {
                setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
            }
            setStatus('granted');
        } catch {
            setStatus('denied');
        } finally {
            inFlight.current = false;
        }
    }, [coords]);

    return { coords, status, request };
}
