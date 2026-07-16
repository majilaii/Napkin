/**
 * ListAddLedgerLine — TICKET-115 "Table lists".
 *
 * A quiet ledger line (NOT a card): a member added spot(s) to one of the Table's
 * shared lists. Mirrors Top4EditedCard's ledger grammar exactly.
 *   single  → "Clara added St. John to Amsterdam"
 *   batched → "Clara added 3 spots to Amsterdam"
 * Verb is lowercase past-tense per brand rules. List names use upright serif.
 */
import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '@/constants/theme';
import type { ListAddActivityItem } from '@/hooks/tables/useTableActivity';
import { ledgerActorLabel, ledgerTargetFragment, ledgerListName } from './listAddLedger';

type Palette = typeof Colors.light;

interface Props {
    item: ListAddActivityItem;
    palette: Palette;
    currentUserId?: string | null;
}

function relativeTimeShort(dateStr: string): string {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffM = Math.floor(diffMs / 60_000);
    const diffH = Math.floor(diffMs / 3_600_000);
    const diffD = Math.floor(diffMs / 86_400_000);
    const diffW = Math.floor(diffD / 7);
    const diffMo = Math.floor(diffD / 30);
    const diffY = Math.floor(diffD / 365);
    if (diffM < 1) return 'just now';
    if (diffM < 60) return `${diffM}m ago`;
    if (diffH < 24) return `${diffH}h ago`;
    if (diffD < 7) return `${diffD}d ago`;
    if (diffW < 5) return `${diffW}w ago`;
    if (diffMo < 12) return `${diffMo}mo ago`;
    return `${diffY}y ago`;
}

export function ListAddLedgerLine({ item, palette, currentUserId }: Props) {
    const actorLabel = ledgerActorLabel(item, currentUserId);
    const listName = ledgerListName(item);
    const target = ledgerTargetFragment(item);
    const time = relativeTimeShort(item.created_at);

    const avatarUrl = item.added_by_profile?.avatar_url ?? null;

    return (
        <View style={styles.row}>
            {avatarUrl ? (
                <Image
                    source={{ uri: avatarUrl }}
                    style={[styles.avatar, { borderColor: palette.outlineVariant }]}
                />
            ) : (
                <View style={[styles.avatarFallback, { backgroundColor: palette.terracottaScrim }]}>
                    {item.list_emoji ? (
                        <Text style={styles.emoji}>{item.list_emoji}</Text>
                    ) : (
                        <Ionicons name="list-outline" size={12} color={palette.primary} />
                    )}
                </View>
            )}

            <Text style={[styles.text, { color: palette.textSecondary }]} numberOfLines={2}>
                <Text style={[styles.actor, { color: palette.text }]}>{actorLabel} </Text>
                {`added ${target} to `}
                <Text style={[styles.listName, { color: palette.text }]}>{listName}</Text>
            </Text>

            <Text style={[styles.time, { color: palette.textMuted }]}>{time}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        marginHorizontal: 22,
        marginBottom: 10,
        paddingVertical: 8,
        paddingHorizontal: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    avatar: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1,
        flexShrink: 0,
    },
    avatarFallback: {
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    emoji: {
        fontSize: 12,
    },
    text: {
        flex: 1,
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        lineHeight: 17,
    },
    actor: {
        fontFamily: 'Manrope_600SemiBold',
    },
    listName: {
        fontFamily: 'Newsreader_500Medium',
    },
    time: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
    },
});
