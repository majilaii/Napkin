import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Avatar } from '@/components/feed/Avatar';
import { Colors, IconSize, Radius, Spacing, Type } from '@/constants/theme';
import type { TableMapPin } from '@/hooks/tables/useTableMapPins';
import type { TableWishlistItem, TableWishlistMember } from '@/hooks/wishlist/useTableWishlist';

type Palette = typeof Colors.light;

function firstName(value: string | null | undefined): string | null {
    const name = value?.trim().split(/\s+/)[0];
    return name ? name.toLocaleLowerCase() : null;
}

export function tablePinnedSignal(item: TableWishlistItem): string {
    if (item.count > 1) return `${item.count} of you pinned`;
    return `${firstName(item.members[0]?.display_name) ?? 'a tablemate'} pinned`;
}

export function formatGatheredDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const month = date.toLocaleDateString('en-GB', { month: 'short' }).toLocaleLowerCase();
    return `${date.getDate()} ${month}`;
}

type Props =
    | {
        kind: 'pinned';
        item: TableWishlistItem;
        palette: Palette;
        onPress: () => void;
    }
    | {
        kind: 'been';
        item: TableMapPin;
        palette: Palette;
        onPress: () => void;
    };

export function TableScopeRow(props: Props) {
    const pinned = props.kind === 'pinned' ? props.item : null;
    const gathered = props.kind === 'been' ? props.item : null;
    const restaurant = pinned?.restaurant ?? gathered;
    const members: readonly TableWishlistMember[] = pinned?.members
        ?? gathered?.participants.map((participant) => ({
            user_id: participant.user_id,
            display_name: participant.display_name,
            avatar_url: participant.avatar_url,
        }))
        ?? [];
    const signal = pinned
        ? tablePinnedSignal(pinned)
        : gathered
          ? `gathered ${formatGatheredDate(gathered.gathered_on)}`.trim()
          : '';
    const meta = pinned
        ? [restaurant?.cuisine, restaurant?.city, signal].filter(Boolean).join(' · ')
        : signal;

    if (!restaurant) return null;

    return (
        <Pressable
            onPress={props.onPress}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`open ${restaurant.name} — ${signal}`}
        >
            <View style={styles.copy}>
                <Text style={[styles.name, { color: props.palette.text }]} numberOfLines={1}>
                    {restaurant.name}
                </Text>
                {meta ? (
                    <Text style={[styles.meta, { color: props.palette.textMuted }]} numberOfLines={1}>
                        {meta}
                    </Text>
                ) : null}
            </View>
            <View style={styles.avatars}>
                {members.slice(0, 3).map((member, index) => (
                    <View
                        key={member.user_id}
                        testID="table-scope-avatar"
                        style={[
                            styles.avatarRing,
                            {
                                backgroundColor: props.palette.background,
                                borderColor: props.palette.background,
                            },
                            index > 0 && styles.avatarOverlap,
                        ]}
                    >
                        <Avatar
                            name={member.display_name ?? 'member'}
                            url={member.avatar_url}
                            size={Spacing.saverAvatar.size}
                            palette={props.palette}
                        />
                    </View>
                ))}
                {members.length > 3 ? (
                    <Text style={[styles.overflow, { color: props.palette.textMuted }]}>+{members.length - 3}</Text>
                ) : null}
            </View>
            <Ionicons
                name="chevron-forward-outline"
                size={IconSize.sm}
                color={props.palette.textFaint}
            />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        minHeight: Spacing.xxl + Spacing.md,
        paddingLeft: Spacing.pageGutter,
        paddingRight: Spacing.md,
        paddingVertical: Spacing.sm + Spacing.xs / 2,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm + Spacing.xs / 2,
    },
    pressed: {
        opacity: 0.72,
    },
    copy: {
        flex: 1,
        minWidth: 0,
        gap: Spacing.xs / 2,
    },
    name: {
        ...Type.feedNoteRestaurant,
    },
    meta: {
        ...Type.feedMeta,
    },
    avatars: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatarRing: {
        borderWidth: Spacing.saverAvatar.ring,
        borderRadius: Radius.full,
    },
    avatarOverlap: {
        marginLeft: -Spacing.saverAvatar.overlap,
    },
    overflow: {
        ...Type.feedMetaStrong,
        marginLeft: Spacing.xs,
    },
});
