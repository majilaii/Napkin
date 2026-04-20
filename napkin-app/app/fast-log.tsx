/**
 * fast-log.tsx — full-screen modal host for FastLogForm.
 *
 * Reached by tapping the + tab (replaces direct push to /create-entry).
 * Reads optional params for prefill:
 *   - restaurantId / placePayload: passed when navigating from search or other deep-links
 *   - tableId: pre-selects a Table chip
 *
 * "Add details" pushes to /create-entry with the entered data preserved.
 *
 * UI kit migration (TICKET-023): header swapped for SheetHeader atom.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FastLogForm, type LockedRestaurant } from '@/components/logging/FastLogForm';
import { SheetHeader } from '@/components/ui';

export default function FastLogScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const { tableId, restaurantId, placePayload } = useLocalSearchParams<{
        tableId?: string;
        restaurantId?: string;
        placePayload?: string;
    }>();

    // Parse an optional locked restaurant from params
    // (used when navigating from a context that already has a restaurant selected)
    const lockedRestaurant = useMemo<LockedRestaurant | undefined>(() => {
        if (placePayload) {
            try {
                const p = JSON.parse(placePayload);
                return {
                    id: p.napkinId ?? undefined,
                    external_id: p.id ?? p.external_id ?? p.placeId ?? undefined,
                    name: p.name ?? '',
                    placePayload: p,
                };
            } catch {
                return undefined;
            }
        }
        if (restaurantId) {
            // We have a Napkin UUID — pass it through; FastLogForm will handle it
            return {
                id: restaurantId,
                name: '',
                external_id: undefined,
            };
        }
        return undefined;
    }, [placePayload, restaurantId]);

    const handleSubmitted = (_entryId: string) => {
        router.back();
    };

    const handleAddDetails = (prefill: {
        rating: number;
        restaurant: any;
        lockedRestaurant?: LockedRestaurant;
        tableId: string | null;
    }) => {
        const params: Record<string, string> = { mode: 'solo' };

        // Carry restaurant context
        if (prefill.lockedRestaurant?.placePayload) {
            params.placePayload = JSON.stringify(prefill.lockedRestaurant.placePayload);
        } else if (prefill.restaurant) {
            params.placePayload = JSON.stringify({
                id: prefill.restaurant.id,
                name: prefill.restaurant.name,
                formattedAddress: prefill.restaurant.formattedAddress,
                latitude: prefill.restaurant.latitude,
                longitude: prefill.restaurant.longitude,
                categories: prefill.restaurant.categories,
                photoReference: prefill.restaurant.photoReference,
            });
        } else if (restaurantId) {
            params.restaurantId = restaurantId;
        }

        if (prefill.rating > 0) {
            params.rating = String(prefill.rating);
        }
        if (prefill.tableId) {
            params.tableId = prefill.tableId;
        }

        router.push({ pathname: '/create-entry', params });
    };

    return (
        <>
            <Stack.Screen options={{ headerShown: false, presentation: 'modal' }} />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                <View style={{ paddingTop: insets.top }}>
                    <SheetHeader
                        title="Quick log"
                        leftLabel="Cancel"
                        rightLabel=""
                        onLeftPress={() => router.back()}
                    />
                </View>

                <FastLogForm
                    presentation="modal"
                    lockedRestaurant={lockedRestaurant}
                    initialTableId={tableId}
                    onSubmitted={handleSubmitted}
                    onAddDetails={handleAddDetails}
                />
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
});
