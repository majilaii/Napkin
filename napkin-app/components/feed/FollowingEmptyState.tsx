/**
 * FollowingEmptyState — the zero-follow body of the Following tab (TICKET-125).
 *
 *   [monogram]  — your friends' meals land here
 *               [ invite a friend ]
 *   find people in For You →
 *
 * Following is pure chronological reviews from people you follow, so its empty
 * state is the honest "you don't follow anyone yet" home: one ghost card (waiting,
 * never broken) + an invite CTA (native share), plus one quiet line handing off
 * to For You where discovery + co-diner suggestions live. NO co-diner slab and NO
 * discovery ledger here — both re-homed to For You (TICKET-125). The ghost card +
 * invite are moved verbatim from the old FeedEmptyState tier-2.
 */
import React, { useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Share } from 'react-native';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { track } from '@/lib/track';
import { TESTFLIGHT_INVITE_URL } from '@/constants/links';

interface Props {
    /** Flip the Feed tab to For You (where discovery + people suggestions live). */
    onSwitchToForYou: () => void;
}

export function FollowingEmptyState({ onSwitchToForYou }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const handleInvite = useCallback(() => {
        track('invite_sent', { surface: 'following_empty_state' });
        void Share.share({
            message: TESTFLIGHT_INVITE_URL
                ? `come try Napkin with me — ${TESTFLIGHT_INVITE_URL}`
                : 'come try Napkin with me',
        });
        // Canceling the sheet resolves with dismissedAction — ignored, no toast.
    }, []);

    return (
        <View>
            <View style={styles.wrap}>
                <View
                    style={[
                        styles.ghostCard,
                        { backgroundColor: palette.surfaceNote, borderColor: palette.dividerSoft },
                    ]}
                    accessibilityLabel="Your friends' meals will land here"
                >
                    <View style={styles.ghostRow}>
                        <View style={[styles.monogram, { borderColor: palette.dividerSoft }]}>
                            <Text style={[styles.monogramMark, { color: palette.textMuted }]}>·</Text>
                        </View>
                        <Text style={[styles.ghostLine, { color: palette.textMuted }]}>
                            — your friends&rsquo; meals land here
                        </Text>
                    </View>

                    <Pressable
                        onPress={handleInvite}
                        style={({ pressed }) => [
                            styles.inviteBtn,
                            { borderColor: palette.terracottaBorderStrong, opacity: pressed ? 0.7 : 1 },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Invite a friend to Napkin"
                    >
                        <Text style={[styles.inviteText, { color: palette.primary }]}>invite a friend</Text>
                    </Pressable>
                </View>

                {/* One quiet hand-off to discovery — Manrope, not decorative italic. */}
                <Pressable
                    onPress={onSwitchToForYou}
                    hitSlop={8}
                    style={({ pressed }) => [styles.forYouLink, pressed && { opacity: 0.6 }]}
                    accessibilityRole="button"
                    accessibilityLabel="Find people in For You"
                >
                    <Text style={[styles.forYouText, { color: palette.textMuted }]}>
                        find people in For You
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingHorizontal: Spacing.lg,
        marginTop: Spacing.md,
    },
    ghostCard: {
        borderRadius: Radius.xl,
        borderWidth: 1,
        padding: 18,
    },
    ghostRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    monogram: {
        width: 44,
        height: 44,
        borderRadius: Radius.full,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    monogramMark: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 24,
        lineHeight: 26,
    },
    ghostLine: {
        flex: 1,
        fontFamily: 'Manrope_400Regular',
        fontSize: 16,
        lineHeight: 22,
    },
    inviteBtn: {
        alignSelf: 'flex-start',
        borderWidth: 1.5,
        borderRadius: Radius.full,
        paddingHorizontal: 16,
        paddingVertical: 7,
        marginTop: 14,
        marginLeft: 58,
    },
    inviteText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
    forYouLink: {
        alignSelf: 'center',
        marginTop: 26,
    },
    forYouText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12.5,
    },
});
