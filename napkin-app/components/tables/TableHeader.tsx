/**
 * TableHeader — masthead for the Tables tab.
 *
 * TICKET-141 layout (locked):
 *   Top row:
 *     Left  — "TABLE" kicker + italic serif name + ▾ caret (the switcher).
 *     Right — ONLY the NotifBell + settings gear (22px, matched pair). No other
 *             icons up top; the masthead stays editorial (Heirloom: structure
 *             from spacing, not icon rows).
 *   Members row (under the name, one line):
 *     overlapping avatar stack (max 4) · "N members" · ghost `invite` chip ·
 *     ghost `map` chip. Actions sit with the content they act on. Manrope 13,
 *     frosted ghost pills (the map's chip grammar).
 *
 * Purely presentational — no hook calls inside. All handlers are supplied by
 * the Tables screen (re-plumbing, not new features).
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '@/constants/theme';
import { Avatar } from '@/components/feed/Avatar';
import { NotifBell } from '@/components/notifications';

type Palette = typeof Colors.light;

export interface TableHeaderProps {
    tableName: string;
    memberCount: number;
    /** @deprecated Rounds are retired — the header no longer surfaces a round
     * count. Still accepted so existing callers typecheck; unused. */
    roundCount?: number;
    /** Member names to show as avatar stack (first 4 render, rest counted) */
    memberNames: string[];
    onSwitcherPress: () => void;
    palette: Palette;
    /** Settings gear (top-right). Non-personal tables only. */
    onSettingsPress?: () => void;
    /** Owner-only `invite` chip in the members row — the invite path no longer
     * hides behind the gear (founder, 2026-07-03). */
    onInvitePress?: () => void;
    /** TICKET-133: bell on the Tables header — same dot/source as Profile. */
    onBellPress?: () => void;
    bellUnread?: boolean;
    /** TICKET-139/141: the table's territory map — a `map` chip in the members
     * row (any member may open it; the map is member-gated server-side). */
    onMapPress?: () => void;
}

const MAX_STACK_AVATARS = 4;
const AVATAR_SIZE = 22;
const AVATAR_OVERLAP = 6;

export function TableHeader({
    tableName,
    memberCount,
    memberNames,
    onSwitcherPress,
    palette,
    onSettingsPress,
    onInvitePress,
    onBellPress,
    bellUnread,
    onMapPress,
}: TableHeaderProps) {
    const visibleAvatars = memberNames.slice(0, MAX_STACK_AVATARS);
    const overflow = Math.max(memberNames.length - MAX_STACK_AVATARS, 0);
    const stackCells = visibleAvatars.length + (overflow > 0 ? 1 : 0);
    const stackWidth =
        stackCells > 0 ? AVATAR_SIZE + (stackCells - 1) * (AVATAR_SIZE - AVATAR_OVERLAP) : 0;

    const countLabel =
        memberCount > 0 ? `${memberCount} ${memberCount === 1 ? 'member' : 'members'}` : '';

    return (
        <View style={styles.container}>
            {/* Top row: name/switcher (left) · bell + gear (right). */}
            <View style={styles.topRow}>
                {/* TICKET-070: caret always visible — the switcher sheet is the
                    home of "gather a new table" (the only table-creation path). */}
                <Pressable
                    onPress={onSwitcherPress}
                    style={styles.nameBlock}
                    accessibilityRole="button"
                    accessibilityLabel={`Switch table, currently ${tableName}`}
                >
                    <Text style={[styles.kicker, { color: palette.textMuted }]}>TABLE</Text>
                    <View style={styles.nameRow}>
                        <Text
                            style={[styles.tableName, { color: palette.text }]}
                            numberOfLines={1}
                        >
                            {tableName}
                        </Text>
                        <Text style={[styles.chevron, { color: palette.textMuted }]}>
                            {'▾'}
                        </Text>
                    </View>
                </Pressable>

                <View style={styles.topActions}>
                    {onBellPress && (
                        <NotifBell
                            unread={bellUnread}
                            onPress={onBellPress}
                            ringColor={palette.background}
                        />
                    )}
                    {onSettingsPress && (
                        <Pressable
                            onPress={onSettingsPress}
                            hitSlop={10}
                            accessibilityRole="button"
                            accessibilityLabel="Table settings"
                            style={({ pressed }) => [styles.gearButton, { opacity: pressed ? 0.6 : 1 }]}
                        >
                            <Ionicons name="settings-outline" size={22} color={palette.textMuted} />
                        </Pressable>
                    )}
                </View>
            </View>

            {/* Members row: avatars · count · invite chip · map chip. */}
            <View style={styles.membersRow}>
                {stackCells > 0 && (
                    <View style={[styles.avatarStack, { width: stackWidth }]}>
                        {visibleAvatars.map((name, i) => (
                            <View
                                key={i}
                                style={[
                                    styles.avatarWrapper,
                                    {
                                        left: i * (AVATAR_SIZE - AVATAR_OVERLAP),
                                        zIndex: MAX_STACK_AVATARS - i,
                                        borderColor: palette.background,
                                    },
                                ]}
                            >
                                <Avatar name={name} url={null} size={AVATAR_SIZE} palette={palette} />
                            </View>
                        ))}
                        {overflow > 0 && (
                            <View
                                style={[
                                    styles.avatarWrapper,
                                    styles.overflowChip,
                                    {
                                        left: visibleAvatars.length * (AVATAR_SIZE - AVATAR_OVERLAP),
                                        borderColor: palette.background,
                                        backgroundColor: palette.surfaceContainerHigh,
                                    },
                                ]}
                            >
                                <Text style={[styles.overflowText, { color: palette.textSecondary }]}>
                                    +{overflow}
                                </Text>
                            </View>
                        )}
                    </View>
                )}

                {countLabel ? (
                    <Text style={[styles.countLabel, { color: palette.textMuted }]}>{countLabel}</Text>
                ) : null}

                {onInvitePress && (
                    <Pressable
                        onPress={onInvitePress}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Invite to this table"
                        style={({ pressed }) => [
                            styles.ghostChip,
                            { backgroundColor: palette.surfaceContainerHigh, opacity: pressed ? 0.6 : 1 },
                        ]}
                    >
                        <Ionicons name="person-add-outline" size={14} color={palette.textSecondary} />
                        <Text style={[styles.ghostChipLabel, { color: palette.textSecondary }]}>
                            invite
                        </Text>
                    </Pressable>
                )}

                {onMapPress && (
                    <Pressable
                        onPress={onMapPress}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="table map"
                        style={({ pressed }) => [
                            styles.ghostChip,
                            { backgroundColor: palette.surfaceContainerHigh, opacity: pressed ? 0.6 : 1 },
                        ]}
                    >
                        <Ionicons name="map-outline" size={14} color={palette.textSecondary} />
                        <Text style={[styles.ghostChipLabel, { color: palette.textSecondary }]}>map</Text>
                    </Pressable>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 22,
        paddingTop: Spacing.sm,
        paddingBottom: 14,
        gap: 12,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    nameBlock: {
        flex: 1,
        minWidth: 0,
    },
    kicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: 3,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
    },
    tableName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 24,
        lineHeight: 26,
        letterSpacing: -0.3,
        flexShrink: 1,
    },
    chevron: {
        fontSize: 14,
    },
    topActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    gearButton: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    membersRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    avatarStack: {
        position: 'relative',
        height: AVATAR_SIZE,
    },
    avatarWrapper: {
        position: 'absolute',
        top: 0,
        borderWidth: 2,
        borderRadius: AVATAR_SIZE / 2,
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        overflow: 'hidden',
    },
    overflowChip: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    overflowText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
    },
    countLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        letterSpacing: 0.2,
    },
    ghostChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    ghostChipLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
        letterSpacing: 0.2,
    },
});
