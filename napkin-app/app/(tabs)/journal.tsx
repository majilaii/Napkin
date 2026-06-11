/**
 * Journal tab — viewer's own solo entries rendered as tick rows + entry cards.
 *
 * TICKET-069 canvas rebuild:
 *   Header: italic serif 26 "Journal" + right-aligned kicker "{N} meals · est. {month}"
 *           + quiet gear icon (top-right) → /settings
 *   List:   grouped by visited_at
 *             - "This week" / month name section headers
 *             - EntryCard if entry has note or photo, TickRow otherwise
 *   Empty:  canvas E·JOURNAL empty-state slab
 *
 * Data layer: useMySoloEntries unchanged. Grid/calendar view modes: code stays,
 * toggles removed from UI per canvas.
 */
import React, { useCallback, useMemo } from 'react';
import {
    View,
    Text,
    FlatList,
    ActivityIndicator,
    RefreshControl,
    Pressable,
    StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useMySoloEntries } from '@/hooks/entries';
import type { SoloShareActivity } from '@/hooks/tables/useTableActivity';
import { TickRow, EntryCard } from '@/components/journal';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a date into the short weekday + optional date for the right-edge slot. */
function formatWeekday(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);

    // Within this week: just weekday abbrev
    if (diffDays < 7) {
        return d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase().slice(0, 3);
    }
    // Older: "sat 23" or "fri 9"
    return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }).toLowerCase().replace(',', '');
}

/** Build the section header label for an entry. */
function getSectionLabel(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
    if (diffDays < 7) return 'This week';
    return d.toLocaleDateString('en-US', { month: 'long' });
}

/** Derive "est. {month}" from the earliest entry in the list. */
function getEstMonth(entries: SoloShareActivity[]): string | null {
    if (entries.length === 0) return null;
    const oldest = [...entries].sort(
        (a, b) => new Date(a.visited_at ?? a.created_at).getTime() - new Date(b.visited_at ?? b.created_at).getTime(),
    )[0];
    const d = new Date(oldest.visited_at ?? oldest.created_at);
    return d.toLocaleDateString('en-US', { month: 'long' }).toLowerCase();
}

// ── Flat list item types ──────────────────────────────────────────────────────

type SectionHeaderItem = { _type: 'section'; label: string; key: string };
type EntryItem = { _type: 'entry'; entry: SoloShareActivity; key: string };
type FlatItem = SectionHeaderItem | EntryItem;

function buildFlatList(entries: SoloShareActivity[]): FlatItem[] {
    const items: FlatItem[] = [];
    let lastSection = '';

    for (const entry of entries) {
        const label = getSectionLabel(entry.visited_at ?? entry.created_at);
        if (label !== lastSection) {
            items.push({ _type: 'section', label, key: `section-${label}` });
            lastSection = label;
        }
        items.push({ _type: 'entry', entry, key: `entry-${entry.id}` });
    }
    return items;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function JournalScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { data: entries, isLoading, isRefetching, refetch } = useMySoloEntries(user?.id);

    const sortedEntries: SoloShareActivity[] = useMemo(() => {
        if (!entries) return [];
        return [...entries].sort(
            (a, b) =>
                new Date(b.visited_at ?? b.created_at).getTime() -
                new Date(a.visited_at ?? a.created_at).getTime(),
        );
    }, [entries]);

    const flatData = useMemo(() => buildFlatList(sortedEntries), [sortedEntries]);
    const mealCount = sortedEntries.length;
    const estMonth = useMemo(() => getEstMonth(sortedEntries), [sortedEntries]);

    const handleEntry = useCallback(
        (id: string) => {
            router.push({ pathname: '/entry-detail', params: { id } });
        },
        [router],
    );

    // ── Header ────────────────────────────────────────────────────────────────
    const ListHeader = useMemo(
        () => (
            <View
                style={[
                    styles.header,
                    { paddingTop: insets.top + Spacing.sm },
                ]}
            >
                {/* Gear icon top-right — settings access without a Profile nav tab */}
                <View style={styles.headerRow}>
                    <Text style={[styles.title, { color: palette.text }]}>Journal</Text>
                    <View style={{ flex: 1 }} />
                    {mealCount > 0 && estMonth ? (
                        <Text style={[styles.kicker, { color: palette.textMuted }]}>
                            {`${mealCount} meal${mealCount !== 1 ? 's' : ''} · est. ${estMonth}`}
                        </Text>
                    ) : null}
                    <Pressable
                        onPress={() => router.push('/settings')}
                        hitSlop={8}
                        style={styles.gearButton}
                        accessibilityLabel="Settings"
                    >
                        <Ionicons name="settings-outline" size={20} color={palette.textMuted} />
                    </Pressable>
                </View>
            </View>
        ),
        [insets.top, palette, mealCount, estMonth, router],
    );

    // ── Empty state (E·JOURNAL canvas) ────────────────────────────────────────
    const EmptyState = useMemo(
        () => (
            <View style={[styles.emptyWrap, { paddingHorizontal: Spacing.lg }]}>
                <View
                    style={[
                        styles.emptySlab,
                        { backgroundColor: palette.surfaceJournalLow },
                    ]}
                >
                    <Text style={[styles.emptyKicker, { color: palette.primary }]}>
                        Your journal
                    </Text>
                    <Text style={[styles.emptyHeadline, { color: palette.text }]}>
                        Every meal worth remembering.
                    </Text>
                    <Text style={[styles.emptyMurmur, { color: palette.textMuted }]}>
                        {'— starts with one. log tonight’s.'}
                    </Text>
                    <Pressable
                        onPress={() => router.push('/search')}
                        style={({ pressed }) => [
                            styles.emptyButton,
                            { borderColor: 'rgba(160,63,40,0.35)', opacity: pressed ? 0.7 : 1 },
                        ]}
                    >
                        <Text style={[styles.emptyButtonText, { color: palette.primary }]}>
                            {`Find tonight’s place`}
                        </Text>
                    </Pressable>
                </View>
            </View>
        ),
        [palette, router],
    );

    // ── Render item ───────────────────────────────────────────────────────────
    const renderItem = useCallback(
        ({ item }: { item: FlatItem }) => {
            if (item._type === 'section') {
                return (
                    <View style={styles.sectionHeader}>
                        <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                            {item.label}
                        </Text>
                    </View>
                );
            }

            const { entry } = item;
            const restaurantName = entry.restaurants?.name ?? 'Unknown';
            const city = entry.restaurants?.city ?? undefined;
            const weekday = formatWeekday(entry.visited_at ?? entry.created_at);
            const hasBody = !!(entry.content || entry.photo_url);

            const companions = (entry.companions ?? [])
                .map((c) => c.display_name)
                .filter(Boolean);
            const dishMeta = [
                entry.dish_description,
                companions.length > 0
                    ? companions.length === 1
                        ? `with ${companions[0]}`
                        : `with ${companions[0]} & ${companions.length - 1} more`
                    : null,
            ]
                .filter(Boolean)
                .join(' · ') || null;

            if (hasBody) {
                return (
                    <EntryCard
                        rating={entry.rating}
                        restaurantName={restaurantName}
                        weekday={weekday}
                        photoUrl={entry.photo_url}
                        note={entry.content}
                        dishMeta={dishMeta}
                        onPress={() => handleEntry(entry.id)}
                    />
                );
            }

            return (
                <TickRow
                    rating={entry.rating}
                    restaurantName={restaurantName}
                    city={city}
                    weekday={weekday}
                    onPress={() => handleEntry(entry.id)}
                />
            );
        },
        [palette, handleEntry],
    );

    if (isLoading) {
        return (
            <View style={[styles.root, { backgroundColor: palette.background }]}>
                {ListHeader}
                <ActivityIndicator style={{ marginTop: Spacing.xl }} color={palette.primary} />
            </View>
        );
    }

    return (
        <View style={[styles.root, { backgroundColor: palette.background }]}>
            <FlatList
                data={flatData}
                keyExtractor={(item) => item.key}
                ListHeaderComponent={ListHeader}
                renderItem={renderItem}
                ListEmptyComponent={EmptyState}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefetching}
                        onRefresh={refetch}
                        tintColor={palette.primary}
                    />
                }
                contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
                showsVerticalScrollIndicator={false}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.sm,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.sm,
    },
    title: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 26,
        lineHeight: 30,
    },
    kicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        alignSelf: 'center',
        flexShrink: 1,
    },
    gearButton: {
        paddingLeft: 8,
        alignSelf: 'center',
    },
    sectionHeader: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.md,
        paddingBottom: 2,
    },
    sectionLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    emptyWrap: {
        marginTop: Spacing.lg,
    },
    emptySlab: {
        borderRadius: 24,
        padding: 30,
        gap: 12,
        alignItems: 'flex-start',
    },
    emptyKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.8,
        textTransform: 'uppercase',
    },
    emptyHeadline: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 23,
        lineHeight: 30,
    },
    emptyMurmur: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 22,
    },
    emptyButton: {
        borderWidth: 1.5,
        borderRadius: 9999,
        paddingVertical: 10,
        paddingHorizontal: 20,
        marginTop: 4,
    },
    emptyButtonText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
});
