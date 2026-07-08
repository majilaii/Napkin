/**
 * TableHeader — masthead for the Tables tab.
 *
 * Canvas-faithful (TTableHeader in tables-screens.jsx):
 *   Left column:
 *     "TABLE" kicker (10pt, 0.8 letter-spacing, uppercase, muted)
 *     Italic serif name (Newsreader italic, 24pt / 500 weight) + ▾ caret inline
 *     Sub label directly under the name (11pt muted, e.g. "4 members · 23 rounds")
 *   Right column:
 *     Avatar stack — 22px circles, overlapping -6px, 2px border in surface color
 *     Shows up to 3 avatars + "+N" overflow chip
 *
 * Purely presentational — no hook calls inside.
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
    roundCount?: number;
    /** Member names to show as avatar stack (first 3 render, rest counted) */
    memberNames: string[];
    onSwitcherPress: () => void;
    palette: Palette;
    /** When provided, a subtle settings gear icon appears right of the avatar stack (TICKET-029). */
    onSettingsPress?: () => void;
    /** When provided (owner only), a designated + for seating people — the
     * invite path no longer hides behind the gear (founder, 2026-07-03). */
    onInvitePress?: () => void;
    /** TICKET-133: bell on the Tables header — same dot/source as Profile. */
    onBellPress?: () => void;
    bellUnread?: boolean;
}

const MAX_STACK_AVATARS = 3;
const AVATAR_SIZE = 22;
const AVATAR_OVERLAP = 6;

export function TableHeader({
    tableName,
    memberCount,
    roundCount,
    memberNames,
    onSwitcherPress,
    palette,
    onSettingsPress,
    onInvitePress,
    onBellPress,
    bellUnread,
}: TableHeaderProps) {
    const visibleAvatars = memberNames.slice(0, MAX_STACK_AVATARS);
    const overflow = Math.max(memberNames.length - MAX_STACK_AVATARS, 0);
    const stackCells = visibleAvatars.length + (overflow > 0 ? 1 : 0);
    const stackWidth =
        stackCells > 0 ? AVATAR_SIZE + (stackCells - 1) * (AVATAR_SIZE - AVATAR_OVERLAP) : 0;

    const subParts: string[] = [];
    if (memberCount > 0) {
        subParts.push(`${memberCount} ${memberCount === 1 ? 'member' : 'members'}`);
    }
    if (roundCount != null && roundCount > 0) {
        subParts.push(`${roundCount} ${roundCount === 1 ? 'round' : 'rounds'}`);
    }
    const subLabel = subParts.join(' \u00B7 '); // middle dot

    const kicker = 'TABLE';

    return (
        <View style={styles.container}>
            {/* Left column: kicker + name + sub
                TICKET-070: chevron always visible \u2014 the switcher sheet is the
                home of "gather a new table" (the only table-creation path).
                Single-table users see it to reach that CTA. */}
            <Pressable
                onPress={onSwitcherPress}
                style={styles.nameBlock}
                accessibilityRole="button"
                accessibilityLabel={`Switch table, currently ${tableName}`}
            >
                <Text style={[styles.kicker, { color: palette.textMuted }]}>
                    {kicker}
                </Text>
                <View style={styles.nameRow}>
                    <Text
                        style={[styles.tableName, { color: palette.text }]}
                        numberOfLines={1}
                    >
                        {tableName}
                    </Text>
                    <Text style={[styles.chevron, { color: palette.textMuted }]}>
                        {'\u25BE'}
                    </Text>
                </View>
                {subLabel ? (
                    <Text style={[styles.subLabel, { color: palette.textMuted }]}>
                        {subLabel}
                    </Text>
                ) : null}
            </Pressable>

            {/* Right column: bell + stacked avatars + optional settings gear */}
            <View style={styles.rightColumn}>
                {onBellPress && (
                    <NotifBell
                        unread={bellUnread}
                        onPress={onBellPress}
                        ringColor={palette.background}
                    />
                )}
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
                                <Avatar
                                    name={name}
                                    url={null}
                                    size={AVATAR_SIZE}
                                    palette={palette}
                                />
                            </View>
                        ))}
                        {overflow > 0 && (
                            <View
                                style={[
                                    styles.avatarWrapper,
                                    styles.overflowChip,
                                    {
                                        left:
                                            visibleAvatars.length *
                                            (AVATAR_SIZE - AVATAR_OVERLAP),
                                        borderColor: palette.background,
                                        backgroundColor: palette.surfaceContainerHigh,
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.overflowText,
                                        { color: palette.textSecondary },
                                    ]}
                                >
                                    +{overflow}
                                </Text>
                            </View>
                        )}
                    </View>
                )}
                {onInvitePress && (
                    <Pressable
                        onPress={onInvitePress}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel="Invite to this table"
                        style={[styles.inviteButton, { borderColor: 'rgba(160,63,40,0.35)' }]}
                    >
                        <Ionicons
                            name="person-add-outline"
                            size={15}
                            color={palette.primary}
                        />
                    </Pressable>
                )}
                {onSettingsPress && (
                    <Pressable
                        onPress={onSettingsPress}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel="Table settings"
                        style={styles.settingsButton}
                    >
                        <Ionicons
                            name="settings-outline"
                            size={18}
                            color={palette.textMuted}
                        />
                    </Pressable>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingTop: Spacing.sm,
        paddingBottom: 14,
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
    subLabel: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        marginTop: 3,
        letterSpacing: 0.2,
    },
    rightColumn: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 8,
        marginBottom: 3,
    },
    avatarStack: {
        position: 'relative',
        height: AVATAR_SIZE,
    },
    settingsButton: {
        padding: 2,
    },
    inviteButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
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
});
