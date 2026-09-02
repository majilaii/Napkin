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

export type NearbyLocationStatus = 'idle' | 'pending' | 'granted' | 'denied';

// A cold GPS fix can take many seconds; consumers (search, sort) must not sit
// behind it. Deadline the fresh read and settle with no coords — the watch
// subscription or a later request fills them in.
const CURRENT_POSITION_DEADLINE_MS = 2000;

async function currentPositionWithDeadline(): Promise<Location.LocationObject | null> {
    return await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), CURRENT_POSITION_DEADLINE_MS),
        ),
    ]);
}
export type NearbyPermissionStatus = Location.PermissionStatus | 'unavailable';

/**
 * @param options.watch when true (and permission granted), subscribes to live
 *   position updates so distances refresh as the user moves — no app restart.
 *   Pass `watch: sortMode === 'near' || mapOpen` and it only runs while relevant.
 */
export function useNearbyLocation(options?: { watch?: boolean }) {
    const watch = options?.watch ?? false;
    const [coords, setCoords] = useState<LatLng | null>(null);
    const [permissionStatus, setPermissionStatus] = useState<NearbyPermissionStatus | null>(null);
    const [settled, setSettled] = useState(false);
    const [pending, setPending] = useState(false);
    const inFlight = useRef(false);

    const status: NearbyLocationStatus = pending
        ? 'pending'
        : permissionStatus === 'granted'
        ? 'granted'
        : permissionStatus === 'denied' || permissionStatus === 'unavailable'
        ? 'denied'
        : 'idle';

    const request = useCallback(async () => {
        if (inFlight.current || coords) return;
        inFlight.current = true;
        setSettled(false);
        setPending(true);
        let permissionReadSucceeded = false;
        try {
            const { status: perm } = await Location.requestForegroundPermissionsAsync();
            permissionReadSucceeded = true;
            setPermissionStatus(perm);
            if (perm !== 'granted') {
                return;
            }
            const loc =
                (await Location.getLastKnownPositionAsync()) ??
                (await currentPositionWithDeadline());
            if (loc) {
                setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
            }
        } catch {
            // A transient permission API failure is not a durable denial. Leave
            // the status unresolved so a later mount can retry the read.
            if (permissionReadSucceeded) setPermissionStatus('unavailable');
        } finally {
            setPending(false);
            setSettled(true);
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
        setSettled(false);
        let permissionReadSucceeded = false;
        try {
            const { status: perm } = await Location.getForegroundPermissionsAsync();
            permissionReadSucceeded = true;
            setPermissionStatus(perm);
            if (perm !== 'granted') return;
            const loc =
                (await Location.getLastKnownPositionAsync()) ??
                (await currentPositionWithDeadline());
            if (loc) {
                setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
            }
        } catch {
            if (permissionReadSucceeded) setPermissionStatus('unavailable');
        } finally {
            setSettled(true);
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

    return { coords, status, permissionStatus, settled, request, requestIfGranted };
}
