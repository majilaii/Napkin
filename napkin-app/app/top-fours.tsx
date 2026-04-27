/**
 * Top Fours screen — personal regional Top 4s.
 * TICKET-047
 *
 * Route: /top-fours?userId=<uuid> (userId defaults to auth user)
 *
 * Owner:  cold state + populated state + claim-nudge + edit chrome + Add a city pill
 * Viewer: populated state only (no nudge, no edit, no add)
 *
 * Cold state: no claimed cities → prompt + Add a city.
 * Populated: claimed cities stacked, each with TopFourCity.
 * Nudge: ClaimNudgeCard above the city list.
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    Pressable,
    ScrollView,
    ActivityIndicator,
    RefreshControl,
    StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTopFours } from '@/hooks/top-fours/useTopFours';
import { useDismissNudge } from '@/hooks/top-fours/useDismissNudge';

import {
    TopFourCity,
    ClaimNudgeCard,
    AddCityPicker,
    EditTopFourSheet,
} from '@/components/top-fours';
import type { AvailableCity } from '@/hooks/top-fours/useAvailableCities';
import type { ClaimedCity } from '@/hooks/top-fours/useTopFours';

export default function TopFoursScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { userId: paramUserId } = useLocalSearchParams<{ userId?: string }>();
    const targetUserId = paramUserId || user?.id || '';
    const isOwner = targetUserId === user?.id;

    const {
        data: payload,
        isLoading,
        isRefetching,
        refetch,
        error,
    } = useTopFours(targetUserId);

    const dismissNudge = useDismissNudge();

    // ── Local UI state ───────────────────────────────────────────────────
    const [addPickerVisible, setAddPickerVisible] = useState(false);
    // editSheet: city name + isClaimed flag
    const [editSheet, setEditSheet] = useState<{
        city: string;
        isClaimed: boolean;
        currentPicks: ClaimedCity['picks'];
    } | null>(null);

    // ── Handlers ─────────────────────────────────────────────────────────

    const handleEditCity = (city: string) => {
        const cityData = payload?.claimed_cities.find(c => c.city === city);
        setEditSheet({
            city,
            isClaimed: true,
            currentPicks: cityData?.picks ?? [],
        });
    };

    const handleClaimFromNudge = (city: string) => {
        setEditSheet({ city, isClaimed: false, currentPicks: [] });
    };

    const handleSelectAvailableCity = (city: AvailableCity) => {
        setAddPickerVisible(false);
        setEditSheet({ city: city.city, isClaimed: false, currentPicks: [] });
    };

    // ── Render ────────────────────────────────────────────────────────────

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />

            <View
                style={[
                    styles.container,
                    { backgroundColor: palette.background, paddingTop: insets.top },
                ]}
            >
                {/* Top bar */}
                <View style={styles.topBar}>
                    <Pressable onPress={() => router.back()} hitSlop={12}>
                        <Text style={[Type.body, { color: palette.primary }]}>{'‹ Back'}</Text>
                    </Pressable>
                    <Text
                        style={[
                            Type.headlineItalic,
                            {
                                fontFamily: 'Newsreader_400Regular_Italic',
                                fontStyle: 'italic',
                                fontSize: 20,
                                color: palette.text,
                            },
                        ]}
                    >
                        Top 4s
                    </Text>
                    <View style={{ width: 40 }} />
                </View>

                {/* Content */}
                {isLoading ? (
                    <View style={styles.center}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                ) : error ? (
                    <View style={styles.center}>
                        <Text style={[Type.bodySmall, { color: palette.textMuted, textAlign: 'center', paddingHorizontal: 20 }]}>
                            {error instanceof Error && (error as any).cause?.status === 404
                                ? 'This profile is private.'
                                : "Couldn’t load Top 4s. Pull to retry."}
                        </Text>
                    </View>
                ) : (
                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
                        refreshControl={
                            <RefreshControl
                                refreshing={isRefetching}
                                onRefresh={refetch}
                                tintColor={palette.primary}
                            />
                        }
                    >
                        {/* Claim nudge (owner only) */}
                        {isOwner && payload?.nudge && (
                            <View style={{ marginTop: Spacing.md }}>
                                <ClaimNudgeCard
                                    nudge={payload.nudge}
                                    onClaim={handleClaimFromNudge}
                                    onDismiss={(city) => dismissNudge.mutate({ city })}
                                />
                            </View>
                        )}

                        {/* Cold state */}
                        {(payload?.claimed_cities.length ?? 0) === 0 && (
                            <View style={styles.coldState}>
                                <Text
                                    style={[
                                        Type.headlineItalic,
                                        {
                                            fontFamily: 'Newsreader_400Regular_Italic',
                                            fontStyle: 'italic',
                                            fontSize: 18,
                                            color: palette.textSecondary,
                                            textAlign: 'center',
                                        },
                                    ]}
                                >
                                    {isOwner
                                        ? 'Name your Top 4 in a city you know well.'
                                        : 'No Top 4s yet.'}
                                </Text>
                                {isOwner && (
                                    <Text
                                        style={[
                                            Type.bodySmall,
                                            {
                                                color: palette.textMuted,
                                                textAlign: 'center',
                                                marginTop: Spacing.sm,
                                                lineHeight: 18,
                                            },
                                        ]}
                                    >
                                        Once you have at least one logged restaurant in a city, you can claim it.
                                    </Text>
                                )}
                            </View>
                        )}

                        {/* Populated: claimed cities */}
                        {(payload?.claimed_cities ?? []).map((city, i) => (
                            <TopFourCity
                                key={city.city}
                                city={city}
                                isFirst={i === 0}
                                isOwner={isOwner}
                                onEdit={handleEditCity}
                            />
                        ))}

                        {/* + Add a city pill (owner only) */}
                        {isOwner && (
                            <View style={styles.addCityRow}>
                                <Pressable
                                    onPress={() => setAddPickerVisible(true)}
                                    style={({ pressed }) => [
                                        styles.addCityPill,
                                        {
                                            borderColor: palette.terracottaBorder,
                                            backgroundColor: palette.terracottaScrim,
                                            opacity: pressed ? 0.7 : 1,
                                        },
                                    ]}
                                    accessibilityLabel="Add a city"
                                    accessibilityRole="button"
                                >
                                    <Text style={[Type.caption, { color: palette.primary }]}>
                                        + Add a city
                                    </Text>
                                </Pressable>
                            </View>
                        )}
                    </ScrollView>
                )}
            </View>

            {/* AddCityPicker sheet */}
            {isOwner && user?.id && (
                <AddCityPicker
                    visible={addPickerVisible}
                    userId={user.id}
                    onClose={() => setAddPickerVisible(false)}
                    onSelectCity={handleSelectAvailableCity}
                />
            )}

            {/* EditTopFourSheet */}
            {editSheet && (
                <EditTopFourSheet
                    visible={true}
                    onClose={() => setEditSheet(null)}
                    city={editSheet.city}
                    isClaimed={editSheet.isClaimed}
                    currentPicks={editSheet.currentPicks}
                />
            )}
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingVertical: Spacing.sm,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    coldState: {
        paddingHorizontal: 32,
        paddingTop: Spacing.xxl,
        paddingBottom: Spacing.xl,
        alignItems: 'center',
    },
    addCityRow: {
        alignItems: 'center',
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.md,
    },
    addCityPill: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        borderRadius: 99,
        borderWidth: 1,
    },
});
