/**
 * TableHeader — masthead for the Tables tab.
 *
 * Layout:
 *   "TABLE" uppercase kicker label  (top)
 *   Italic serif table name + ▾ affordance when multi-table  (below kicker)
 *   Right-aligned: avatar stack + sub-label ("4 members · 23 rounds")
 *
 * Mirrors canvas TTableHeader.
 * Props: purely presentational — no hook calls inside.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { Avatar } from '@/components/feed/Avatar';

type Palette = typeof Colors.light;

export interface TableHeaderProps {
    tableName: string;
    isPersonal: boolean;
    memberCount: number;
    roundCount?: number;
    /** Top 3 member names to show as avatar stack */
    memberNames: string[];
    hasMultipleTables: boolean;
    onSwitcherPress: () => void;
    palette: Palette;
}

const MAX_STACK_AVATARS = 3;
const AVATAR_SIZE = 28;
const AVATAR_OFFSET = 10;

export function TableHeader({
    tableName,
    isPersonal,
    memberCount,
    roundCount,
    memberNames,
    hasMultipleTables,
    onSwitcherPress,
    palette,
}: TableHeaderProps) {
    const visibleAvatars = memberNames.slice(0, MAX_STACK_AVATARS);
    const stackWidth =
        AVATAR_SIZE + (visibleAvatars.length - 1) * (AVATAR_SIZE - AVATAR_OFFSET);

    const subParts: string[] = [];
    if (memberCount > 0) {
        subParts.push(`${memberCount} ${memberCount === 1 ? 'member' : 'members'}`);
    }
    if (roundCount != null && roundCount > 0) {
        subParts.push(`${roundCount} ${roundCount === 1 ? 'round' : 'rounds'}`);
    }
    const subLabel = subParts.join(' \u00B7 '); // middle dot

    const kicker = isPersonal ? 'YOUR JOURNAL' : 'TABLE';

    return (
        <View style={styles.container}>
            {/* Left column: kicker + name */}
            <Pressable
                onPress={() => hasMultipleTables && onSwitcherPress()}
                style={styles.nameBlock}
                accessibilityRole="button"
                accessibilityLabel={hasMultipleTables ? `Switch table, currently ${tableName}` : tableName}
            >
                <Text style={[styles.kicker, { color: palette.textMuted }]}>
                    {kicker}
                </Text>
                <View style={styles.nameRow}>
                    <Text
                        style={[
                            styles.tableName,
                            { color: palette.text },
                        ]}
                        numberOfLines={1}
                    >
                        {tableName}
                    </Text>
                    {hasMultipleTables && (
                        <Text style={[styles.chevron, { color: palette.textMuted }]}>
                            {'\u25BE'}
                        </Text>
                    )}
                </View>
            </Pressable>

            {/* Right column: stacked avatars + sub-label */}
            {visibleAvatars.length > 0 && (
                <View style={styles.rightBlock}>
                    <View style={[styles.avatarStack, { width: stackWidth }]}>
                        {visibleAvatars.map((name, i) => (
                            <View
                                key={i}
                                style={[
                                    styles.avatarWrapper,
                                    {
                                        left: i * (AVATAR_SIZE - AVATAR_OFFSET),
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
                    </View>
                    {subLabel ? (
                        <Text style={[styles.subLabel, { color: palette.textMuted }]}>
                            {subLabel}
                        </Text>
                    ) : null}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.md,
    },
    nameBlock: {
        flex: 1,
        marginRight: Spacing.md,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        marginBottom: 2,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    tableName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 28,
        lineHeight: 32,
        flex: 1,
    },
    chevron: {
        fontSize: 14,
        marginBottom: 2,
    },
    rightBlock: {
        alignItems: 'flex-end',
        gap: Spacing.xs,
    },
    avatarStack: {
        position: 'relative',
        height: AVATAR_SIZE,
    },
    avatarWrapper: {
        position: 'absolute',
        borderWidth: 2,
        borderRadius: AVATAR_SIZE / 2,
    },
    subLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        letterSpacing: 0.3,
    },
});
