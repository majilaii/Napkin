/**
 * GuestListScreen: signed-out, read-only view of one public list (TICKET-247).
 *
 * Reads `public-browse` action=list, which returns a list only when it is
 * public, not a Table list and owned by a public account, with verified
 * entries only. Reuses the signed-in ListDetailHeader so the list looks the
 * same; every account action (save list) opens /auth. Rows open the guest
 * restaurant page. No map, no pins, no editing.
 */
import React, { useCallback, useMemo } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, IconSize, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useGuestList, type GuestRestaurantRow } from '@/hooks/guest/usePublicBrowse';
import type { ListEntry } from '@/hooks/lists/useList';
import { ListDetailHeader } from '@/components/lists/ListDetailHeader';
import {
    deriveContextLine,
    deriveCover,
    deriveMetadataLine,
} from '@/components/lists/listHeaderUtils';
import { GuestPlaceRow } from './GuestPlaceRow';
import { GuestSignInBand } from './GuestSignInBand';
import { sendReport } from './guestReport';

type Palette = typeof Colors.light;

/** A list entry's restaurant in the guest row shape (no review count on lists). */
export function entryToGuestRow(entry: ListEntry): GuestRestaurantRow {
    const r = entry.restaurant;
    return {
        id: r.id,
        name: r.name,
        city: r.city,
        country: r.country,
        address: r.address,
        cuisine: r.cuisine,
        price_level: r.price_level,
        photo_url: r.photo_url,
        photo_source: r.photo_source ?? null,
        places_photo_attribution_html: r.places_photo_attribution_html ?? null,
        google_rating: r.google_rating,
        google_rating_count: null,
        review_count: 0,
    };
}

function GuestListEntryRow({
    entry,
    rank,
    onPress,
    palette,
}: {
    entry: ListEntry;
    rank: number | null;
    onPress: () => void;
    palette: Palette;
}) {
    return (
        <View style={styles.entry}>
            <View style={styles.entryRow}>
                {rank != null ? (
                    <Text style={[Type.label, styles.rank, { color: palette.terracottaWarm }]}>{rank}</Text>
                ) : null}
                <View style={styles.entryPlace}>
                    <GuestPlaceRow row={entryToGuestRow(entry)} onPress={onPress} palette={palette} />
                </View>
            </View>
            {entry.note ? (
                <Text
                    style={[Type.feedQuote, styles.note, rank != null && styles.noteRanked, { color: palette.textSecondary }]}
                    numberOfLines={3}
                >
                    {`— ${entry.note}`}
                </Text>
            ) : null}
        </View>
    );
}

export function GuestListScreen({ listId }: { listId: string }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const query = useGuestList(listId);
    const detail = query.data?.data ?? null;
    const entries = useMemo(() => detail?.entries ?? [], [detail]);

    const goBack = useCallback(() => {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)/places');
    }, [router]);

    const openRestaurant = useCallback((entry: ListEntry) => {
        router.push({ pathname: '/restaurant/[id]', params: { id: entry.restaurant.id } });
    }, [router]);

    const backButton = (
        <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="back"
            hitSlop={12}
            style={[styles.back, { marginTop: insets.top + Spacing.sm }]}
        >
            <Ionicons name="chevron-back" size={IconSize.lg} color={palette.textMuted} />
        </Pressable>
    );

    if (query.isLoading) {
        return (
            <View style={[styles.root, { backgroundColor: palette.background }]}>
                <Stack.Screen options={{ headerShown: false }} />
                {backButton}
                <View style={styles.center}><ActivityIndicator color={palette.primary} /></View>
            </View>
        );
    }

    if (query.isError || query.data?.isNotFound || !detail) {
        const notFound = !!query.data?.isNotFound;
        return (
            <View style={[styles.root, { backgroundColor: palette.background }]}>
                <Stack.Screen options={{ headerShown: false }} />
                {backButton}
                <View style={styles.center}>
                    <Text style={[Type.headlineMedium, styles.centerText, { color: palette.text }]}>
                        {notFound ? 'Not found' : 'Couldn’t open this list'}
                    </Text>
                    <Text style={[Type.bodySmall, styles.centerText, { color: palette.textMuted }]}>
                        {notFound ? 'This list is private or no longer exists.' : 'Check your connection and try once more.'}
                    </Text>
                    {!notFound ? (
                        <Pressable
                            onPress={() => void query.refetch()}
                            accessibilityRole="button"
                            hitSlop={12}
                            style={styles.retry}
                        >
                            <Text style={[Type.label, { color: palette.primary }]}>Try again</Text>
                        </Pressable>
                    ) : null}
                </View>
            </View>
        );
    }

    const { list, owner_profile: owner, save_count: saveCount } = detail;
    const context = deriveContextLine(list, false, owner);
    // Profiles are not guest-readable, so the byline is plain text, never a door to /auth.
    const contextLine = context?.kind === 'byline' ? { ...context, profileHandle: null } : context;

    return (
        <View style={[styles.root, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />
            <FlatList
                data={entries}
                keyExtractor={(entry) => entry.id}
                contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xxl }}
                ListHeaderComponent={(
                    <View>
                        {backButton}
                        <ListDetailHeader
                            list={list}
                            ownerProfile={owner}
                            cover={deriveCover(entries)?.photoUrl ?? null}
                            metadata={deriveMetadataLine(entries.length, saveCount, list.privacy, list.table_id ?? null)}
                            contextLine={contextLine}
                            isOwner={false}
                            canEditEntries={false}
                            isEditingPlaces={false}
                            isSaved={false}
                            canSave
                            onToggleSaved={() => router.push('/auth')}
                            onToggleEditingPlaces={() => undefined}
                            onEditSettings={() => undefined}
                        />
                        {list.description ? (
                            <Text style={[Type.body, styles.description, { color: palette.textSecondary }]}>
                                {list.description}
                            </Text>
                        ) : null}
                    </View>
                )}
                renderItem={({ item, index }) => (
                    <GuestListEntryRow
                        entry={item}
                        rank={list.ranked ? index + 1 : null}
                        onPress={() => openRestaurant(item)}
                        palette={palette}
                    />
                )}
                ListEmptyComponent={(
                    <Text style={[Type.bodySmall, styles.empty, { color: palette.textMuted }]}>
                        no spots here yet.
                    </Text>
                )}
                ListFooterComponent={(
                    <View>
                        {/* Guideline 1.2: the title, description and notes are user content. */}
                        <Text style={[Type.metadata, styles.report, { color: palette.textMuted }]}>
                            see something wrong?{' '}
                            <Text
                                accessibilityRole="link"
                                accessibilityLabel="report this list"
                                onPress={() => sendReport({
                                    kind: 'list',
                                    list: { id: list.id, title: list.title },
                                    ownerName: owner.display_name ?? (owner.username ? `@${owner.username}` : null),
                                })}
                                style={[styles.reportLink, { color: palette.textSecondary }]}
                            >
                                report
                            </Text>
                        </Text>
                        <GuestSignInBand />
                    </View>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    back: {
        marginLeft: Spacing.md,
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: Spacing.xl,
        gap: Spacing.sm,
    },
    centerText: { textAlign: 'center' },
    retry: { marginTop: Spacing.md, minHeight: 44, justifyContent: 'center' },
    description: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        paddingBottom: Spacing.md,
    },
    entry: { paddingBottom: Spacing.xs },
    entryRow: { flexDirection: 'row', alignItems: 'center' },
    rank: {
        width: 28,
        textAlign: 'right',
        marginLeft: Spacing.sm,
        textTransform: 'none',
        letterSpacing: 0,
    },
    entryPlace: { flex: 1 },
    note: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        marginLeft: 44 + Spacing.md,
    },
    noteRanked: { marginLeft: 44 + Spacing.md + 28 + Spacing.sm },
    empty: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        paddingVertical: Spacing.lg,
    },
    report: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        paddingTop: Spacing.lg,
    },
    reportLink: { textDecorationLine: 'underline' },
});
