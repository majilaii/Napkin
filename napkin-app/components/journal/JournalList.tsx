/**
 * JournalList — shared date-grouped entry list.
 *
 * TICKET-070: extracted from app/(tabs)/journal.tsx so both the /journal route
 * and the new Profile tab can render the same TickRow/EntryCard list.
 *
 * Props: entries + onPressEntry. No data hooks inside — screens pass data in.
 * Renders: section headers, TickRow/EntryCard items, empty slab.
 *
 * Screens mount this component and pass their own ListHeaderComponent so the
 * header + list scroll as a single FlatList unit.
 */
import React, { useCallback, useMemo } from 'react';
import {
    View,
    Text,
    FlatList,
    Pressable,
    StyleSheet,
    StyleProp,
    ViewStyle,
    RefreshControlProps,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { SoloShareActivity } from '@/hooks/tables/useTableActivity';
import { TickRow } from './TickRow';
import { EntryCard } from './EntryCard';

// ── Helpers (exported so journal.tsx + profile.tsx can derive kicker text) ─────

/** Format a date into the short weekday + optional date for the right-edge slot. */
export function formatWeekday(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
    if (diffDays < 7) {
        return d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase().slice(0, 3);
    }
    return d
        .toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
        .toLowerCase()
        .replace(',', '');
}

/** Build the section header label for an entry. */
export function getSectionLabel(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
    if (diffDays < 7) return 'This week';
    return d.toLocaleDateString('en-US', { month: 'long' });
}

/** Derive "est. {month}" from the earliest entry in the list. */
export function getEstMonth(entries: SoloShareActivity[]): string | null {
    if (entries.length === 0) return null;
    const oldest = [...entries].sort(
        (a, b) =>
            new Date(a.visited_at ?? a.created_at).getTime() -
            new Date(b.visited_at ?? b.created_at).getTime(),
    )[0];
    const d = new Date(oldest.visited_at ?? oldest.created_at);
    return d.toLocaleDateString('en-US', { month: 'long' }).toLowerCase();
}

// ── Flat list item types ──────────────────────────────────────────────────────

type SectionHeaderItem = { _type: 'section'; label: string; key: string };
type EntryItem = { _type: 'entry'; entry: SoloShareActivity; key: string };
export type FlatItem = SectionHeaderItem | EntryItem;

export function buildFlatList(entries: SoloShareActivity[]): FlatItem[] {
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

// ── Component ─────────────────────────────────────────────────────────────────

export interface JournalListProps {
    entries: SoloShareActivity[];
    onPressEntry: (id: string) => void;
    /** Optional header rendered above the list items (e.g. profile hero or journal title). */
    ListHeaderComponent?: React.ReactElement | null;
    refreshControl?: React.ReactElement<RefreshControlProps>;
    contentContainerStyle?: StyleProp<ViewStyle>;
    showsVerticalScrollIndicator?: boolean;
}

export function JournalList({
    entries,
    onPressEntry,
    ListHeaderComponent,
    refreshControl,
    contentContainerStyle,
    showsVerticalScrollIndicator = false,
}: JournalListProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const flatData = useMemo(() => buildFlatList(entries), [entries]);

    // Empty state — canvas E·JOURNAL slab
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
                        {"— starts with one. log tonight’s."}
                    </Text>
                    <Pressable
                        onPress={() => router.push('/search')}
                        style={({ pressed }) => [
                            styles.emptyButton,
                            { borderColor: 'rgba(160,63,40,0.35)', opacity: pressed ? 0.7 : 1 },
                        ]}
                    >
                        <Text style={[styles.emptyButtonText, { color: palette.primary }]}>
                            {"Find tonight’s place"}
                        </Text>
                    </Pressable>
                </View>
            </View>
        ),
        [palette, router],
    );

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
            const dishMeta =
                [
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
                        onPress={() => onPressEntry(entry.id)}
                    />
                );
            }

            return (
                <TickRow
                    rating={entry.rating}
                    restaurantName={restaurantName}
                    city={city}
                    weekday={weekday}
                    onPress={() => onPressEntry(entry.id)}
                />
            );
        },
        [palette, onPressEntry],
    );

    return (
        <FlatList
            data={flatData}
            keyExtractor={(item) => item.key}
            ListHeaderComponent={ListHeaderComponent}
            renderItem={renderItem}
            ListEmptyComponent={EmptyState}
            refreshControl={refreshControl}
            contentContainerStyle={contentContainerStyle}
            showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        />
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
