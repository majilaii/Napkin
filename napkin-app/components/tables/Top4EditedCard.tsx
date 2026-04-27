/**
 * Top4EditedCard — compact feed card for top_4_edited activity events.
 *
 * Mirrors the TickRow pattern with an avatar instead of an icon,
 * and verb copy from the spec:
 *   added   → "Clara added St. John"
 *   removed → "Clara removed Estela"
 *   swapped → "Clara swapped Estela for St. John"
 */

import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '@/constants/theme';
import type { TopFourEditedActivity } from '@/hooks/tables/useTableActivity';

type Palette = typeof Colors.light;

interface Props {
    item: TopFourEditedActivity;
    palette: Palette;
    currentUserId?: string | null;
}

function relativeTimeShort(dateStr: string): string {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffS = Math.floor(diffMs / 1_000);
    const diffM = Math.floor(diffMs / 60_000);
    const diffH = Math.floor(diffMs / 3_600_000);
    const diffD = Math.floor(diffMs / 86_400_000);
    const diffW = Math.floor(diffD / 7);
    const diffMo = Math.floor(diffD / 30);
    const diffY = Math.floor(diffD / 365);
    if (diffS < 60) return 'just now';
    if (diffM < 60) return `${diffM}m ago`;
    if (diffH < 24) return `${diffH}h ago`;
    if (diffD < 7) return `${diffD}d ago`;
    if (diffW < 5) return `${diffW}w ago`;
    if (diffMo < 12) return `${diffMo}mo ago`;
    return `${diffY}y ago`;
}

function buildCopy(item: TopFourEditedActivity, actorLabel: string): string {
    switch (item.event_type) {
        case 'added':
            return `added ${item.next_restaurant?.name ?? 'a restaurant'} to the Top 4`;
        case 'removed':
            return `removed ${item.prev_restaurant?.name ?? 'a restaurant'} from the Top 4`;
        case 'swapped':
            return `swapped ${item.prev_restaurant?.name ?? 'a restaurant'} for ${item.next_restaurant?.name ?? 'a restaurant'} in the Top 4`;
    }
}

export function Top4EditedCard({ item, palette, currentUserId }: Props) {
    const isSelf = item.actor_id === currentUserId;
    const actorLabel = isSelf ? 'You' : (item.actor_name ?? 'Someone');
    const verbCopy = buildCopy(item, actorLabel);
    const time = relativeTimeShort(item.created_at);

    return (
        <View style={styles.row}>
            {/* Avatar or icon */}
            {item.actor_avatar_url ? (
                <Image
                    source={{ uri: item.actor_avatar_url }}
                    style={[styles.avatar, { borderColor: palette.outlineVariant }]}
                />
            ) : (
                <View style={[styles.avatarFallback, { backgroundColor: palette.terracottaScrim }]}>
                    <Ionicons name="star-outline" size={12} color={palette.primary} />
                </View>
            )}

            {/* Text */}
            <Text style={[styles.text, { color: palette.textSecondary }]} numberOfLines={2}>
                <Text style={[styles.actor, { color: palette.text }]}>{actorLabel} </Text>
                {verbCopy}
            </Text>

            {/* Time */}
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
    text: {
        flex: 1,
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        lineHeight: 17,
    },
    actor: {
        fontFamily: 'Manrope_600SemiBold',
    },
    time: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
    },
});
