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
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import type { LatLng } from '@/lib/geo';

type Status = 'idle' | 'pending' | 'granted' | 'denied';

/**
 * @param options.watch when true (and permission granted), subscribes to live
 *   position updates so distances refresh as the user moves — no app restart.
 *   Pass `watch: sortMode === 'near' || mapOpen` and it only runs while relevant.
 */
export function useNearbyLocation(options?: { watch?: boolean }) {
    const watch = options?.watch ?? false;
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

    /**
     * TICKET-097 — silent, granted-only path. Obtains coords ONLY when
     * foreground permission was already granted elsewhere; NEVER prompts.
     * If permission is absent (or anything fails) it no-ops and status stays
     * `idle` — consumers hide their location-dependent UI, no CTA, no nag.
     */
    const requestIfGranted = useCallback(async () => {
        if (inFlight.current || coords) return;
        inFlight.current = true;
        try {
            const { status: perm } = await Location.getForegroundPermissionsAsync();
            if (perm !== 'granted') return;
            const loc =
                (await Location.getLastKnownPositionAsync()) ??
                (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
            if (loc) {
                setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
            }
            setStatus('granted');
        } catch {
            // Silent path — swallow; the dependent section simply stays absent.
        } finally {
            inFlight.current = false;
        }
    }, [coords]);

    // Live updates while `watch` is active (the "nearest" sort or the map view), so
    // distances re-rank as the user walks instead of staying frozen until restart.
    // Only after permission is granted; torn down when watch turns off / on unmount.
    useEffect(() => {
        if (!watch || status !== 'granted') return;
        let sub: Location.LocationSubscription | null = null;
        let cancelled = false;
        (async () => {
            try {
                sub = await Location.watchPositionAsync(
                    {
                        accuracy: Location.Accuracy.Balanced,
                        distanceInterval: 25, // metres moved before an update
                        timeInterval: 12000,  // …or every 12s, whichever first
                    },
                    (loc) => {
                        if (cancelled) return;
                        setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
                    },
                );
            } catch {
                // Non-fatal — keep the last-known coords.
            }
        })();
        return () => {
            cancelled = true;
            sub?.remove();
        };
    }, [watch, status]);

    return { coords, status, request, requestIfGranted };
}
