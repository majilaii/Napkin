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

    return <View style={styles.wrap}>
        <Text style={[styles.line, { color: palette.textMuted }]}>Your activity lands here, alongside your friends’.</Text>
        <Pressable onPress={handleInvite} accessibilityRole="button" accessibilityLabel="Invite a friend to Napkin"
            style={({ pressed }) => [styles.inviteBtn, { borderColor: palette.terracottaBorderStrong, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={[styles.inviteText, { color: palette.primary }]}>invite a friend</Text>
        </Pressable>
        <Pressable onPress={onSwitchToForYou} accessibilityRole="button" accessibilityLabel="Find people in For You" style={styles.link}>
            <Text style={[styles.line, { color: palette.textMuted }]}>find people in For You</Text>
        </Pressable>
    </View>;
}
const styles = StyleSheet.create({
    wrap: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl, gap: Spacing.sm },
    line: { fontFamily: 'Manrope_400Regular', fontSize: 16, lineHeight: 22 },
    inviteBtn: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', borderWidth: 1.5,
        borderRadius: Radius.full, paddingHorizontal: Spacing.md, marginTop: Spacing.md },
    inviteText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
    link: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginTop: Spacing.sm },
});
