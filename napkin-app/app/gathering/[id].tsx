/**
 * Gathering detail screen — TICKET-136 (+ TICKET-159 rescue).
 *
 * The card, unfolded. A thin screen (mirrors app/supper/[id].tsx): reads one
 * gathering via useGathering(id) — which seeds instantly from the feed cache and
 * reconciles in the background — and renders GatheringDetail. Back lands one
 * level up on the feed (hierarchical back-nav doctrine); "see the table" pushes
 * onward to the supper; "open restaurant →" is the ONLY path to the restaurant.
 *
 * TICKET-159: this screen owns the ONE SetTableSheet for the expired-gather
 * rescue. The detail's (and, via the `rescue=1` param, the feed card's)
 * `it happened anyway — set the table` opens it pre-filled with the gather's
 * restaurant + the in/counter crew, table LOCKED to the gather's table, and a
 * submit-adapter that routes through useRescueGathering instead of set-table.
 */
import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useGathering, useRescueGathering, GONE_CODES } from '@/hooks/gatherings';
import { GatheringDetail } from '@/components/gatherings';
import { SetTableSheet } from '@/components/suppers';
import type { SetTableInput, SetTableResult } from '@/hooks/suppers';

export default function GatheringScreen() {
    const { id, rescue: rescueParam } = useLocalSearchParams<{ id: string; rescue?: string }>();
    const router = useRouter();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { user } = useAuth();

    const { data, isLoading, isError, error } = useGathering(id);
    const rescueGathering = useRescueGathering();

    const [rescueSheetOpen, setRescueSheetOpen] = React.useState(false);
    // A feed-card rescue tap arrives as ?rescue=1 — auto-open once the row is
    // loaded and actually rescuable (host-only, expired, unlinked). One-shot.
    const autoOpenedRef = React.useRef(false);
    React.useEffect(() => {
        if (autoOpenedRef.current || rescueParam !== '1' || !data) return;
        if (data.status === 'expired' && !data.supper_id && data.host_user_id === user?.id) {
            autoOpenedRef.current = true;
            setRescueSheetOpen(true);
        }
    }, [rescueParam, data, user?.id]);

    // The server says this gathering is gone/forbidden (host cancelled it, or the
    // viewer left the table between feed-load and tap) → the not-available branch
    // must win even though a stale feed seed still sits in `data`. A *transient*
    // error (network blip, 500) is NOT terminal — keep showing the valid seed.
    const goneCode = (error as { cause?: { code?: string } } | null)?.cause?.code;
    const isGone = isError && !!goneCode && GONE_CODES.has(goneCode);

    // Rescue prefill: the gather's restaurant + the members who answered in or
    // counter ("they signalled they'd come" — contrast set-a-table's whole-table
    // default). The host toggles freely inside the sheet.
    const rescueCrew = React.useMemo(
        () =>
            (data?.seats ?? [])
                .filter((s) => s.response === 'in' || s.response === 'counter')
                .map((s) => s.user_id)
                .filter((uid) => uid !== user?.id),
        [data?.seats, user?.id],
    );

    // Submit-adapter (finding 16): same SetTableInput in, same SetTableResult
    // out — the sheet never branches on a mode. restaurant_id is ignored
    // server-side (the gathering anchors the restaurant).
    const rescueSubmit = React.useCallback(
        async (input: SetTableInput): Promise<SetTableResult> =>
            rescueGathering.mutateAsync({
                gathering_id: id as string,
                table_id: input.table_id,
                member_ids: input.member_ids,
            }),
        [rescueGathering, id],
    );

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
                <>
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
                        onRescue={() => setRescueSheetOpen(true)}
                    />

                    {/* TICKET-159 rescue sheet — table locked, crew preselected. */}
                    <SetTableSheet
                        visible={rescueSheetOpen}
                        onClose={() => setRescueSheetOpen(false)}
                        restaurant={{
                            id: data.restaurant?.id ?? null,
                            name: data.restaurant?.name ?? 'a spot',
                            city: data.restaurant?.city ?? null,
                            photo_url: data.restaurant?.photo_url ?? null,
                        }}
                        lockedTableId={data.table_id}
                        initialMemberIds={rescueCrew}
                        onSubmit={rescueSubmit}
                    />
                </>
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
