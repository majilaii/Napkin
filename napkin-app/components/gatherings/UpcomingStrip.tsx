/**
 * UpcomingStrip — the Table-screen "what's booked" ledger (TICKET-128 Part A).
 *
 * Compact rows under the masthead for proposed + dispatched gatherings whose day
 * hasn't passed: `sat 12 · Kono · 3 in`. This IS the calendar — a list, not a grid.
 *
 * Heirloom: no 1px sectioning borders — a warm background-shift block with ghosted
 * hairline rules between rows. The restaurant name is Newsreader italic (content);
 * the date and the in-count are Manrope (meta). One accent: terracotta. Renders
 * NOTHING when there are no upcoming rows (AC2 — no header, no empty copy).
 *
 * Tap: dispatched → the auto-created supper (/supper/[id]); proposed → the
 * restaurant page (the gathering's subject, matching GatheringCard's body tap).
 * The full gather card + RSVP lives in the feed below on this same screen, so the
 * strip is a jump-off, not a duplicate.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUpcomingGatherings, type UpcomingGathering } from '@/hooks/gatherings/useUpcomingGatherings';
import { useReminderWindow } from '@/hooks/gatherings/useReminderWindow';
import { reconcileGatherReminders } from '@/lib/gatherReminders';

type Palette = typeof Colors.light;

interface UpcomingStripProps {
    tableId: string;
    /** The table's display name — used only for the day-of reminder body (Part B). */
    tableName: string;
}

/** 'YYYY-MM-DD' → 'sat 12' (lowercase weekday + day number). */
function shortDate(ymd: string): string {
    const d = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(d.getTime())) return ymd;
    const wd = d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    return `${wd} ${d.getDate()}`;
}

function StripRow({
    row,
    isLast,
    palette,
    onPress,
}: {
    row: UpcomingGathering;
    isLast: boolean;
    palette: Palette;
    onPress: () => void;
}) {
    const name = row.restaurant?.name ?? 'a spot';
    const tail =
        row.status === 'dispatched'
            ? 'gathered'
            : `${row.in_count} in`;
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.divider },
                pressed && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${shortDate(row.gather_on)}, ${name}, ${tail}`}
        >
            <Text style={styles.rowText} numberOfLines={1}>
                <Text style={[styles.meta, { color: palette.textSecondary }]}>{shortDate(row.gather_on)}</Text>
                <Text style={[styles.dot, { color: palette.textMuted }]}>{'  ·  '}</Text>
                <Text style={[styles.name, { color: palette.text }]}>{name}</Text>
                <Text style={[styles.dot, { color: palette.textMuted }]}>{'  ·  '}</Text>
                <Text
                    style={[
                        styles.meta,
                        { color: row.status === 'dispatched' ? palette.textMuted : palette.primary },
                    ]}
                >
                    {tail}
                </Text>
            </Text>
        </Pressable>
    );
}

export function UpcomingStrip({ tableId, tableName }: UpcomingStripProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const router = useRouter();

    const { data: rows } = useUpcomingGatherings(tableId);

    // TICKET-159 — reconcile BOTH device pings (day-of + morning-after) against
    // the authoritative reconcile window (yesterday..+90d INCLUDING cancelled/
    // expired rows), whenever it (re)hydrates. Keep/cancel is decided from that
    // state — never from a row's absence in the upcoming strip. Fires on the
    // `windowRows` reference changing (a real refetch); also runs on an empty
    // (but loaded) window so dropped-off plans get cancelled. Must sit BEFORE
    // the empty early-return below (rules of hooks). Fully guarded / silent
    // without OS permission — reconcileGatherReminders never prompts.
    const { data: windowRows } = useReminderWindow(tableId);
    React.useEffect(() => {
        if (windowRows === undefined) return; // still loading — don't reconcile on nothing
        void reconcileGatherReminders(windowRows, tableName, tableId);
    }, [windowRows, tableName, tableId]);

    if (!rows || rows.length === 0) return null; // AC2 — render nothing when empty

    const handlePress = (row: UpcomingGathering) => {
        if (row.status === 'dispatched' && row.supper_id) {
            router.push({ pathname: '/supper/[id]', params: { id: row.supper_id } });
            return;
        }
        // Proposed → the gathering's subject (its restaurant), matching the feed
        // card's own body tap. The full card + RSVP sits in the feed below.
        if (row.restaurant?.id) {
            router.push({ pathname: '/restaurant/[id]', params: { id: row.restaurant.id } });
        }
    };

    return (
        <View style={styles.wrap}>
            <View style={[styles.block, { backgroundColor: palette.surfaceJournalLow }]}>
                <Text style={[styles.kicker, { color: palette.textMuted }]}>upcoming</Text>
                {rows.map((row, i) => (
                    <StripRow
                        key={row.id}
                        row={row}
                        isLast={i === rows.length - 1}
                        palette={palette}
                        onPress={() => handlePress(row)}
                    />
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
    },
    block: {
        borderRadius: 18,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 2,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    row: {
        paddingVertical: 12,
    },
    rowText: {
        fontSize: 15,
    },
    meta: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    dot: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
    name: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 17,
    },
});
