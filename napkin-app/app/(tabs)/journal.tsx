/**
 * Journal tab — viewer's own solo entries rendered as tick rows + entry cards.
 *
 * TICKET-069 canvas rebuild:
 *   Header: italic serif 26 "Journal" + right-aligned kicker "{N} meals · est. {month}"
 *   List:   grouped by visited_at
 *             - "This week" / month name section headers
 *             - EntryCard if entry has note or photo, TickRow otherwise
 *   Empty:  canvas E·JOURNAL empty-state slab
 *
 * TICKET-070: list rendering extracted to JournalList component (shared with
 * Profile tab). Settings gear moved to Profile tab header.
 */
import React, { useCallback, useMemo } from 'react';
import {
    View,
    Text,
    ActivityIndicator,
    RefreshControl,
    StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useMySoloEntries } from '@/hooks/entries';
import type { SoloShareActivity } from '@/hooks/tables/useTableActivity';
import { JournalList, getEstMonth } from '@/components/journal';

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

    const mealCount = sortedEntries.length;
    const estMonth = useMemo(() => getEstMonth(sortedEntries), [sortedEntries]);

    const handleEntry = useCallback(
        (id: string) => {
            router.push({ pathname: '/entry-detail', params: { entryId: id } });
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
                <View style={styles.headerRow}>
                    <Text style={[styles.title, { color: palette.text }]}>Journal</Text>
                    <View style={{ flex: 1 }} />
                    {mealCount > 0 && estMonth ? (
                        <Text style={[styles.kicker, { color: palette.textMuted }]}>
                            {`${mealCount} meal${mealCount !== 1 ? 's' : ''} · est. ${estMonth}`}
                        </Text>
                    ) : null}
                </View>
            </View>
        ),
        [insets.top, palette, mealCount, estMonth],
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
            <JournalList
                entries={sortedEntries}
                onPressEntry={handleEntry}
                ListHeaderComponent={ListHeader}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefetching}
                        onRefresh={refetch}
                        tintColor={palette.primary}
                    />
                }
                contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
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
});
