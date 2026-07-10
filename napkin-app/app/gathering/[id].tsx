/**
 * Gathering detail screen — TICKET-136.
 *
 * The card, unfolded. A thin screen (mirrors app/supper/[id].tsx): reads one
 * gathering via useGathering(id) — which seeds instantly from the feed cache and
 * reconciles in the background — and renders GatheringDetail. Back lands one
 * level up on the feed (hierarchical back-nav doctrine); "see the table" pushes
 * onward to the supper; "open restaurant →" is the ONLY path to the restaurant.
 */
import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useGathering, GONE_CODES } from '@/hooks/gatherings';
import { GatheringDetail } from '@/components/gatherings';

export default function GatheringScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { user } = useAuth();

    const { data, isLoading, isError, error } = useGathering(id);

    // The server says this gathering is gone/forbidden (host cancelled it, or the
    // viewer left the table between feed-load and tap) → the not-available branch
    // must win even though a stale feed seed still sits in `data`. A *transient*
    // error (network blip, 500) is NOT terminal — keep showing the valid seed.
    const goneCode = (error as { cause?: { code?: string } } | null)?.cause?.code;
    const isGone = isError && !!goneCode && GONE_CODES.has(goneCode);

    return (
        <SafeAreaView style={[styles.screen, { backgroundColor: palette.surface }]} edges={['top']}>
            <Stack.Screen options={{ headerShown: false }} />
            {/* Only spin on a cold deep-link (nothing cached to seed from). */}
            {isLoading || (!data && !isError) ? (
                <View style={styles.center}>
                    <ActivityIndicator color={palette.textMuted} />
                </View>
            ) : !data || isGone ? (
                <View style={styles.notAvailable}>
                    <Pressable
                        onPress={() => router.back()}
                        hitSlop={10}
                        style={styles.backRow}
                        accessibilityRole="button"
                        accessibilityLabel="back to the feed"
                    >
                        <Ionicons name="chevron-back" size={22} color={palette.text} />
                        <Text style={[styles.backText, { color: palette.textMuted }]}>back</Text>
                    </Pressable>
                    <View style={styles.center}>
                        <Text style={[styles.error, { color: palette.textMuted }]}>
                            this gathering isn&rsquo;t available.
                        </Text>
                    </View>
                </View>
            ) : (
                <GatheringDetail
                    gathering={data}
                    viewerId={user?.id}
                    onBack={() => router.back()}
                    onOpenRestaurant={(restaurantId) =>
                        router.push({ pathname: '/restaurant/[id]', params: { id: restaurantId } })
                    }
                    onOpenSupper={(supperId) =>
                        router.push({ pathname: '/supper/[id]', params: { id: supperId } })
                    }
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    notAvailable: { flex: 1 },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingVertical: 10 },
    backText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    error: { fontFamily: 'Manrope_500Medium', fontSize: 14 },
});
