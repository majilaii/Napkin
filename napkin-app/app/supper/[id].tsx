/**
 * Supper screen — the Supper v2 "gathered view" (TICKET-082 v2).
 *
 * Supper-anchored (keyed on supper_id), NOT entry-anchored — this is the whole point
 * of v2: a supper is owned by the table, not a person's review. Renders GatheredView
 * from useSupper(id). Tapping a filled seat opens that take's entry-detail.
 */
import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useSupper } from '@/hooks/suppers';
import { GatheredView } from '@/components/suppers';
import { FRIEND_TEST } from '@/constants/flags';

export default function SupperScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { user } = useAuth();

    const { data: detail, isLoading, isError } = useSupper(FRIEND_TEST.hideSuppers ? null : id);

    return (
        <SafeAreaView style={[styles.screen, { backgroundColor: palette.surface }]} edges={['top']}>
            <Stack.Screen options={{ headerShown: false }} />
            {isLoading || (!detail && !isError) ? (
                <View style={styles.center}>
                    <ActivityIndicator color={palette.textMuted} />
                </View>
            ) : !detail ? (
                <View style={styles.center}>
                    <Text style={[styles.error, { color: palette.textMuted }]}>this table isn&rsquo;t available.</Text>
                </View>
            ) : (
                <GatheredView
                    detail={detail}
                    viewerId={user?.id ?? ''}
                    palette={palette}
                    onBack={() => router.back()}
                    onOpenTake={(entryId) =>
                        router.push({ pathname: '/entry-detail', params: { entryId } })
                    }
                    onAddTake={() =>
                        router.push({
                            pathname: '/log-meal',
                            params: {
                                supperTakeId: id,
                                restaurant: JSON.stringify({
                                    id: detail.restaurant?.id,
                                    name: detail.restaurant?.name ?? 'Restaurant',
                                }),
                            },
                        })
                    }
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    error: { fontFamily: 'Manrope_500Medium', fontSize: 14 },
});
