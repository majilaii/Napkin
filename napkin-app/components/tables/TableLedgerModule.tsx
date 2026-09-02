import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Avatar } from '@/components/feed/Avatar';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    deviceTimeZone,
    ledgerMonthFor,
    useLedger,
} from '@/hooks/users/useLedger';

type Props = {
    viewerId: string | null | undefined;
    tableId: string;
};

function ordinal(rank: number): string {
    const mod100 = rank % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
    if (rank % 10 === 1) return `${rank}st`;
    if (rank % 10 === 2) return `${rank}nd`;
    if (rank % 10 === 3) return `${rank}rd`;
    return `${rank}th`;
}

function ledgerMonthName(month: string): string {
    const [year, monthNumber] = month.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', { month: 'long' })
        .format(new Date(Date.UTC(year, monthNumber - 1, 1, 12)))
        .toLowerCase();
}

export function TableLedgerModule({ viewerId, tableId }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const tz = useMemo(() => deviceTimeZone(), []);
    const month = useMemo(() => ledgerMonthFor(new Date(), tz), [tz]);
    const ledger = useLedger(viewerId, month, tz, tableId);
    const rows = ledger.data?.rows ?? [];

    if (ledger.isLoading || ledger.isError || rows.every((row) => row.napkins === 0)) {
        return null;
    }

    const trio = rows.slice(0, 3);
    const viewerIndex = rows.findIndex((row) => row.is_viewer);
    const viewer = viewerIndex >= 3 ? rows[viewerIndex] : null;

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="open the table ledger"
            onPress={() => router.push({ pathname: '/ledger', params: { tableId } })}
            style={({ pressed }) => [styles.module, pressed && styles.pressed]}
        >
            <View style={styles.kickerRow}>
                <Text style={[Type.labelSmall, styles.kicker, { color: palette.textMuted }]}>
                    {`THE LEDGER · ${ledgerMonthName(month)}`}
                </Text>
                <Text style={[Type.mapPeekMeta, styles.all, { color: palette.primary }]}>all ›</Text>
            </View>
            <View style={styles.trio}>
                {trio.map((row) => (
                    <View
                        key={row.user_id}
                        testID="table-ledger-person"
                        style={[
                            styles.person,
                            row.is_viewer && { backgroundColor: palette.primaryMuted },
                        ]}
                        accessibilityLabel={`${row.display_name}, ${row.napkins} napkins`}
                    >
                        <Avatar
                            name={row.display_name}
                            url={row.avatar_url}
                            size={28}
                            palette={palette}
                        />
                        <Text
                            style={[Type.metadata, styles.firstName, { color: palette.text }]}
                            numberOfLines={1}
                        >
                            {row.display_name.split(' ')[0]}
                        </Text>
                        <Text style={[Type.ledgerValue, { color: palette.text }]}>
                            {row.napkins}
                        </Text>
                    </View>
                ))}
            </View>
            {viewer ? (
                <Text style={[Type.metadata, styles.viewerTrail, { color: palette.textMuted }]}>
                    {`you're ${ordinal(viewerIndex + 1)} · ${viewer.napkins} napkins`}
                </Text>
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    module: {
        paddingHorizontal: Spacing.pageGutter,
        paddingVertical: Spacing.md,
    },
    pressed: { opacity: 0.72 },
    kickerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: Spacing.sm,
    },
    kicker: { letterSpacing: 0.8, textTransform: 'none' },
    all: { lineHeight: 19 },
    trio: { flexDirection: 'row', gap: Spacing.sm },
    person: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
        paddingVertical: Spacing.xs,
        paddingHorizontal: Spacing.xs,
        borderRadius: Radius.compact,
    },
    firstName: { flex: 1, minWidth: 0 },
    viewerTrail: { marginTop: Spacing.sm },
});
