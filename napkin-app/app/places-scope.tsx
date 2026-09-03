import React, { useMemo } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { PlacesScreen } from '@/components/places/PlacesScreen';
import {
    createPlacesScreenState,
    type PlacesScope,
} from '@/hooks/search/placesScreenState';

export default function PlacesScopeRoute() {
    const router = useRouter();
    const { scope, tableId } = useLocalSearchParams<{ scope?: string; tableId?: string }>();
    const lockedScope = useMemo<PlacesScope>(
        () => scope === 'table' && tableId?.trim()
            ? { kind: 'table', tableId: tableId.trim() }
            : { kind: 'you' },
        [scope, tableId],
    );
    const stateStore = useMemo(
        () => createPlacesScreenState({ scope: lockedScope }),
        [lockedScope],
    );

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <PlacesScreen
                stateStore={stateStore}
                lockedScope={lockedScope}
                // Cold-start deep links land here with no back stack — fall
                // through to the Table tab (the pusher) instead of a dead
                // control (mirrors app/join-table.tsx).
                onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/tables'))}
                hasBottomNav={false}
                showImport={false}
            />
        </>
    );
}
