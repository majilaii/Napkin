import React, { useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/feed/Avatar';
import { Colors, IconSize, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    deviceTimeZone,
    ledgerMonthFor,
    useLedger,
    type LedgerRow,
} from '@/hooks/users/useLedger';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function shiftLedgerMonth(month: string, delta: -1 | 1): string {
    const [year, monthNumber] = month.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1, 12));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function ledgerMonthLabel(month: string): string {
    const [year, monthNumber] = month.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })
        .format(new Date(Date.UTC(year, monthNumber - 1, 1, 12)))
        .toLowerCase();
}

function LedgerStandingRow({
    row,
    rank,
    palette,
}: {
    row: LedgerRow;
    rank: number;
    palette: typeof Colors.light;
}) {
    return (
        <View
            style={[
                styles.standing,
                row.is_viewer && { backgroundColor: palette.primaryMuted },
            ]}
            accessibilityLabel={`${rank}. ${row.display_name}, ${row.napkins} napkins`}
        >
            <Text style={[Type.metadata, styles.rank, { color: palette.textMuted }]}>{rank}</Text>
            <Avatar
                name={row.display_name}
                url={row.avatar_url}
                size={28}
                palette={palette}
            />
            <View style={styles.identity}>
                <Text style={[Type.body, styles.name, { color: palette.text }]} numberOfLines={1}>
                    {row.display_name}
                </Text>
                <Text style={[Type.metadata, { color: palette.textMuted }]} numberOfLines={1}>
                    {`${row.meals} meals · ${row.new_places} new · ${row.crowns} crown${row.crowns === 1 ? '' : 's'}`}
                </Text>
            </View>
            <Text style={[Type.ledgerValue, styles.napkins, { color: palette.text }]}>
                {`${row.napkins} napkins`}
            </Text>
        </View>
    );
}

type Props = {
    viewerId: string | null | undefined;
    initialMonth?: string | null;
    tableId?: string | null;
};

export function LedgerScreen({ viewerId, initialMonth, tableId }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const tz = useMemo(() => deviceTimeZone(), []);
    const currentMonth = useMemo(() => ledgerMonthFor(new Date(), tz), [tz]);
    const [month, setMonth] = useState(
        initialMonth && MONTH_PATTERN.test(initialMonth) && initialMonth <= currentMonth
            ? initialMonth
            : currentMonth,
    );
    const ledger = useLedger(viewerId, month, tz, tableId ?? undefined);
    const canMoveForward = month < currentMonth;
    const hasFriends = (ledger.data?.rows ?? []).some((row) => !row.is_viewer);
    const scopeName = ledger.data?.scope.kind === 'table'
        ? ledger.data.scope.table_name
        : tableId
        ? 'the table'
        : 'friends';

    return (
        <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top }]}>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={styles.header}>
                <Pressable
                    onPress={() => router.back()}
                    accessibilityRole="button"
                    accessibilityLabel="back"
                    style={styles.headerAction}
                >
                    <Ionicons name="chevron-back" size={IconSize.lg} color={palette.text} />
                </Pressable>
                <Text style={[Type.screenTitle, { color: palette.text }]}>the ledger</Text>
                <View style={styles.headerAction} />
            </View>

            <Text style={[Type.labelSmall, styles.scopeKicker, { color: palette.textMuted }]}>
                {`${scopeName} · ${ledgerMonthLabel(month)}`}
            </Text>

            <View style={styles.monthPicker}>
                <Pressable
                    onPress={() => setMonth((value) => shiftLedgerMonth(value, -1))}
                    accessibilityRole="button"
                    accessibilityLabel="previous month"
                    style={styles.monthAction}
                >
                    <Ionicons name="chevron-back" size={IconSize.md} color={palette.textMuted} />
                </Pressable>
                <Text style={[Type.metadata, styles.monthLabel, { color: palette.text }]}>
                    {ledgerMonthLabel(month)}
                </Text>
                <Pressable
                    onPress={() => {
                        if (canMoveForward) setMonth((value) => shiftLedgerMonth(value, 1));
                    }}
                    disabled={!canMoveForward}
                    accessibilityRole="button"
                    accessibilityLabel="next month"
                    accessibilityState={{ disabled: !canMoveForward }}
                    style={styles.monthAction}
                >
                    <Ionicons
                        name="chevron-forward"
                        size={IconSize.md}
                        color={canMoveForward ? palette.textMuted : palette.textFaint}
                    />
                </Pressable>
            </View>

            {ledger.isLoading ? (
                <ActivityIndicator color={palette.primary} style={styles.state} />
            ) : ledger.isError ? (
                <Text style={[Type.metadata, styles.state, { color: palette.textMuted }]}>
                    could not load the ledger
                </Text>
            ) : !tableId && !hasFriends ? (
                <Text style={[Type.metadata, styles.state, { color: palette.textMuted }]}>
                    follow a few friends and the ledger fills itself
                </Text>
            ) : (
                <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xxl }}
                >
                    {(ledger.data?.rows ?? []).map((row, index) => (
                        <LedgerStandingRow
                            key={row.user_id}
                            row={row}
                            rank={index + 1}
                            palette={palette}
                        />
                    ))}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        minHeight: Spacing.xxl,
        paddingHorizontal: Spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    headerAction: {
        width: Spacing.hitTarget,
        minHeight: Spacing.hitTarget,
        alignItems: 'center',
        justifyContent: 'center',
    },
    monthPicker: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.md,
    },
    scopeKicker: {
        textAlign: 'center',
        letterSpacing: 0.8,
    },
    monthAction: {
        width: Spacing.hitTarget,
        minHeight: Spacing.hitTarget,
        alignItems: 'center',
        justifyContent: 'center',
    },
    monthLabel: {
        minWidth: Spacing.hitTarget * 4,
        textAlign: 'center',
        fontVariant: ['tabular-nums'],
    },
    state: {
        marginTop: Spacing.xxl,
        marginHorizontal: Spacing.lg,
        textAlign: 'center',
    },
    standing: {
        minHeight: Spacing.xxl,
        marginHorizontal: Spacing.md,
        paddingHorizontal: Spacing.sm,
        paddingVertical: Spacing.sm,
        borderRadius: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    rank: {
        width: Spacing.lg,
        textAlign: 'center',
        fontVariant: ['tabular-nums'],
    },
    identity: { flex: 1, minWidth: 0 },
    name: { lineHeight: 20 },
    napkins: { textAlign: 'right' },
});
