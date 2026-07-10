/**
 * Supper screen — the Supper v2 "gathered view" (TICKET-082 v2).
 *
 * Supper-anchored (keyed on supper_id), NOT entry-anchored — this is the whole point
 * of v2: a supper is owned by the table, not a person's review. Renders GatheredView
 * from useSupper(id). Tapping a filled seat opens that take's entry-detail.
 *
 * TICKET-161: the host gets an ⋯ overflow (via GatheredView's onRequestDelete) that
 * opens a confirm sheet to delete the supper. Deleting re-homes every take as an
 * individual review still visible in the Table feed (server-side); on success we drop
 * back to the previous screen — silent, no toast (the feed is the confirmation).
 */
import React, { useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useSupper, useDeleteSupper, isSupperGone } from '@/hooks/suppers';
import { GatheredView } from '@/components/suppers';
import { OwnerActionsSheet } from '@/components/common';
import { FRIEND_TEST } from '@/constants/flags';

export default function SupperScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { user } = useAuth();

    const { data: detail, isLoading, isError } = useSupper(FRIEND_TEST.hideSuppers ? null : id);
    const del = useDeleteSupper();
    const [sheetOpen, setSheetOpen] = useState(false);

    // Host-only affordance. GatheredView only mounts once `detail` has loaded, so
    // gating the ⋯ on this satisfies "appears only after host status confirmed".
    const isHost = !!detail && !!user && detail.supper.host_user_id === user.id;

    // Confirm-sheet copy — one line, chosen by what's actually true (UX Decisions).
    // Branches on the client-cached take count; the server acts on live rows, so the
    // action stays correct even if a take lands after the sheet opens.
    const takeCount = detail?.takes.length ?? 0;
    const hasTable = !!detail?.supper.table_id;
    const deleteSubtitle =
        takeCount === 0
            ? 'no takes yet — this just clears the table.'
            : hasTable
              ? 'takes stay — visible to the whole table now.'
              : 'takes go private — each stays visible only to whoever wrote it.';

    const handleDelete = () => {
        // isPending guard: a double-tap inside the sheet's dismiss window would fire
        // two deletes (the loser 404s into telemetry and both callbacks navigate).
        if (!detail || del.isPending) return;
        setSheetOpen(false);
        del.mutate(
            { supper_id: id, table_id: detail.supper.table_id },
            {
                onSuccess: () => router.back(),
                onError: (e) => {
                    // Already gone (double-tap / concurrent delete) → treat as done.
                    if (isSupperGone(e)) router.back();
                    else Alert.alert("Couldn't delete this supper", 'Try again.');
                },
            },
        );
    };

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
                <>
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
                        onRequestDelete={isHost ? () => setSheetOpen(true) : undefined}
                    />
                    <OwnerActionsSheet
                        visible={sheetOpen}
                        title={detail.restaurant?.name ?? 'this supper'}
                        subtitle={deleteSubtitle}
                        actions={[{ label: 'Delete supper', kind: 'destructive', onPress: handleDelete }]}
                        onCancel={() => setSheetOpen(false)}
                    />
                </>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    error: { fontFamily: 'Manrope_500Medium', fontSize: 14 },
});
