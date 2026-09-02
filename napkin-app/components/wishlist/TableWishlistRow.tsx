/**
 * TableWishlistRow — one restaurant in the Table wishlist, as a typographic
 * ledger row (Heirloom redesign).
 *
 * Mirrors WishlistSpotRow: italic-serif index · italic-serif name · quiet meta
 * (cuisine · city). NO photo thumbnail, NO description block — restaurants carry
 * no reliable photo/description source.
 *
 * The Table-specific signal is the saver cluster: faces instead of a numeric pill.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Avatar } from '@/components/feed/Avatar';
import { Colors, Spacing, Type } from '@/constants/theme';
import type { TableWishlistItem } from '@/hooks/wishlist/useTableWishlist';

interface Props {
    /** 1-based ledger ordinal. */
    index: number;
    item: TableWishlistItem;
    palette: typeof Colors.light;
    onPress: () => void;
}

export function TableWishlistRow({ index, item, palette, onPress }: Props) {
    const r = item.restaurant;
    if (!r) return null;

    const meta = [r.cuisine, r.city].filter(Boolean).join(' · ');
    const count = item.count;
    const visibleMembers = item.members.slice(0, 3);
    const namedMembers = item.members
        .map((member) => member.display_name)
        .filter((name): name is string => !!name);
    const accessibilityLabel = count > 3
        ? `saved by ${namedMembers.slice(0, 2).join(', ')} & ${count - 2} more`
        : `saved by ${namedMembers.length > 1
            ? `${namedMembers.slice(0, -1).join(', ')} & ${namedMembers.at(-1)}`
            : namedMembers[0] ?? 'a tablemate'}`;

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                { borderBottomColor: palette.dividerSoft, opacity: pressed ? 0.7 : 1 },
            ]}
            accessibilityLabel={`Open ${r.name} — ${accessibilityLabel}`}
        >
            <Text style={[styles.num, { color: palette.textMuted }]}>{index}</Text>

            <View style={styles.textBlock}>
                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                    {r.name}
                </Text>
                {meta ? (
                    <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                        {meta}
                    </Text>
                ) : null}
            </View>

            <View style={styles.rightCol}>
                <View style={styles.savers}>
                    {visibleMembers.map((member, memberIndex) => (
                        <View
                            key={member.user_id}
                            testID="table-wishlist-saver"
                            style={[
                                styles.avatarRing,
                                { backgroundColor: palette.background, borderColor: palette.background },
                                memberIndex > 0 && styles.overlapAvatar,
                            ]}
                        >
                            <Avatar
                                name={member.display_name ?? 'member'}
                                url={member.avatar_url}
                                size={Spacing.saverAvatar.size}
                                palette={palette}
                            />
                        </View>
                    ))}
                    {count > 3 ? (
                        <Text
                            style={[Type.labelSmall, styles.overflowCount, { color: palette.textMuted }]}
                        >
                            {`+${count - 3}`}
                        </Text>
                    ) : null}
                </View>
            </View>
        </Pressable>
    );
}

// Metrics stay in lockstep with WishlistSpotRow — the two ledgers must read as one.
const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    num: {
        width: 20,
        textAlign: 'center',
        paddingTop: 2,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
    },
    textBlock: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        letterSpacing: -0.3,
    },
    meta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        marginTop: 2,
    },
    rightCol: {
        alignItems: 'flex-end',
        flexShrink: 0,
    },
    savers: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatarRing: {
        borderWidth: Spacing.saverAvatar.ring,
        borderRadius: Spacing.saverAvatar.size / 2 + Spacing.saverAvatar.ring,
    },
    overlapAvatar: { marginLeft: -Spacing.saverAvatar.overlap },
    overflowCount: {
        marginLeft: Spacing.xs,
        letterSpacing: 0,
        textTransform: 'none',
    },
});
