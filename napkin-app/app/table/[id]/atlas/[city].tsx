/**
 * Atlas city deep-dive route — /table/[id]/atlas/[city]
 *
 * Renders AtlasCityPage with data from useTableAtlasCity.
 * Scope pills built from useTableMembers.
 * Tapping a tile navigates to /restaurant/[id].
 */
import React, { useMemo } from 'react';
import {
    View,
    ActivityIndicator,
    StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTableAtlasCity, flattenAtlasTiles, type TableAtlasCityData } from '@/hooks/tables/useTableAtlasCity';
import { useTableMembers } from '@/hooks/tables/useTableMembers';
import { AtlasCityPage } from '@/components/atlas';

export default function AtlasCityScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { id: tableId, city: cityParam } = useLocalSearchParams<{
        id: string;
        city: string;
    }>();

    // URL-decode city name
    const city = cityParam ? decodeURIComponent(cityParam) : '';

    const {
        data: pagedData,
        isLoading,
        isRefetching,
        refetch,
        error,
        fetchNextPage,
        hasNextPage,
    } = useTableAtlasCity(tableId, city);

    const { data: members } = useTableMembers(tableId);

    // Build flat legacy shape from all pages for AtlasCityPage component
    const data: TableAtlasCityData | null = pagedData
        ? {
              city: (pagedData.pages[0] as any)?.city ?? city,
              city_stats: (pagedData.pages[0] as any)?.city_stats ?? { city, spot_count: 0, member_count: 0 },
              restaurants: flattenAtlasTiles(pagedData),
          }
        : null;

    // AC 18: redirect on error (403 non-member or any failure) — avoid blank screen
    React.useEffect(() => {
        if (error) {
            router.replace('/tables');
        }
    }, [error, router]);

    const memberList = useMemo(
        () =>
            (members ?? []).map((m) => ({
                user_id: m.member_id,
                display_name: m.profiles?.display_name ?? 'Member',
                avatar_url: m.profiles?.avatar_url ?? null,
            })),
        [members],
    );

    const handleRestaurantPress = (restaurantId: string) => {
        router.push({
            pathname: '/restaurant/[id]',
            params: { id: restaurantId, tableId: tableId ?? undefined },
        });
    };

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar style="dark" />
            <View
                style={[
                    styles.container,
                    {
                        backgroundColor: palette.background,
                        paddingTop: insets.top,
                    },
                ]}
            >
                {isLoading && !data ? (
                    <View style={styles.center}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                ) : data ? (
                    <AtlasCityPage
                        data={data}
                        currentUserId={user?.id ?? ''}
                        members={memberList}
                        onBack={() => router.back()}
                        onRestaurantPress={handleRestaurantPress}
                        onRefresh={refetch}
                        onLoadMore={() => { if (hasNextPage) fetchNextPage(); }}
                        isRefreshing={isRefetching}
                        isLoading={isLoading}
                        palette={palette}
                    />
                ) : null}
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
