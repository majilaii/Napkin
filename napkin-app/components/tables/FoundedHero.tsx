/**
 * FoundedHero — "Founded today" centered block for brand-new named tables.
 *
 * Canvas WF3: centered founding date + invitation text + a
 * "Round the table" member block with a "Pull up a chair" invite CTA.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';
import { Avatar } from '@/components/feed/Avatar';
import { TableTopFourPlaceholder } from './TableTopFourPlaceholder';

type Palette = typeof Colors.light;

interface FoundedHeroProps {
    tableName: string;
    foundedAt: string;
    founderName?: string;
    palette: Palette;
    onInvite?: () => void;
    memberCount: number;
    /** Wire to open the Edit Top 4 sheet from the placeholder CTA. */
    onEditTopFour?: () => void;
}

function formatFoundedDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}

export function FoundedHero({
    tableName,
    foundedAt,
    founderName = 'You',
    palette,
    onInvite,
    memberCount,
    onEditTopFour,
}: FoundedHeroProps) {
    const dateLabel = formatFoundedDate(foundedAt);

    return (
        <View>
            <View style={styles.container}>
                <View style={[styles.rule, { backgroundColor: palette.outlineVariant }]} />
                <Text style={[styles.kicker, { color: palette.primary }]}>
                    {`Founded ${dateLabel} · by ${founderName.toLowerCase()}`}
                </Text>
                <Text style={[styles.tableName, { color: palette.text }]} numberOfLines={2}>
                    {tableName}
                </Text>
                <Text style={[Type.bodySmall, styles.body, { color: palette.textSecondary }]}>
                    The table is set. Log a meal or start a Round to begin your shared history.
                </Text>
                <View style={[styles.rule, { backgroundColor: palette.outlineVariant }]} />
            </View>

            {/* Round the table — founder block + invite */}
            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                ROUND THE TABLE
            </Text>
            <View
                style={[
                    styles.founderRow,
                    {
                        backgroundColor: palette.surfaceNote,
                        borderColor: palette.outlineVariant,
                    },
                ]}
            >
                <Avatar name={founderName} url={null} size={40} palette={palette} />
                <View style={{ flex: 1 }}>
                    <Text style={[styles.founderName, { color: palette.text }]}>
                        {founderName}
                    </Text>
                    <Text style={[styles.founderSub, { color: palette.textMuted }]}>
                        Founder
                    </Text>
                </View>
                {onInvite ? (
                    <Pressable
                        onPress={onInvite}
                        style={({ pressed }) => [
                            styles.inviteBtn,
                            {
                                backgroundColor: palette.primary,
                                opacity: pressed ? 0.88 : 1,
                            },
                        ]}
                    >
                        <Text style={[styles.inviteText, { color: palette.background }]}>
                            PULL UP A CHAIR
                        </Text>
                    </Pressable>
                ) : null}
            </View>

            {/* Top 4 placeholder — week-one waiting state from the design system. */}
            <TableTopFourPlaceholder palette={palette} onStart={onEditTopFour} />

            {/* Invite prompt — shown only when member count is under 6 and onInvite is wired */}
            {memberCount < 6 && !!onInvite ? (
                <Pressable
                    onPress={onInvite}
                    accessibilityRole="button"
                    accessibilityLabel="Invite another person to the table"
                    style={({ pressed }) => [
                        styles.inviteRow,
                        { borderColor: palette.outlineVariant, opacity: pressed ? 0.85 : 1 },
                    ]}
                >
                    <View style={[styles.inviteChip, { backgroundColor: palette.oliveCream }]}>
                        <Text style={[styles.inviteGlyph, { color: palette.secondary }]}>+</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.inviteHeadline, { color: palette.text }]}>
                            Invite another person
                        </Text>
                        <Text style={[styles.inviteSub, { color: palette.textMuted }]}>
                            Tables stay small. Six feels right.
                        </Text>
                    </View>
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.xxl,
        gap: Spacing.sm,
    },
    rule: {
        width: 40,
        height: 1,
        marginBottom: Spacing.sm,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
    },
    tableName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 28,
        lineHeight: 34,
        textAlign: 'center',
        marginTop: Spacing.xs,
    },
    body: {
        textAlign: 'center',
        marginTop: Spacing.sm,
        fontStyle: 'italic',
        lineHeight: 20,
    },
    sectionLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 0.8,
        marginHorizontal: 22,
        marginTop: Spacing.sm,
        marginBottom: Spacing.sm,
    },
    founderRow: {
        marginHorizontal: 22,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: Spacing.lg,
    },
    founderName: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
    },
    founderSub: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        marginTop: 2,
    },
    inviteBtn: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
    },
    inviteText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 0.8,
    },
    inviteRow: {
        marginHorizontal: 22,
        marginTop: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderRadius: 10,
        borderWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    inviteChip: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    inviteGlyph: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 16,
        lineHeight: 16,
        textAlign: 'center',
    },
    inviteHeadline: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    inviteSub: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        marginTop: 2,
        lineHeight: 14,
    },
});
