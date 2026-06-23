/**
 * SupperNudgeBanner — the Supper v2 in-app reminder (TICKET-082 v2, design section 5b).
 *
 * One gentle, dismissible banner shown atop the Table feed when the viewer has a
 * pending seat in a supper. "your turn at the table" — never a nag. Lock-screen push
 * (design 5a) is OUT of scope (CLAUDE.md: push notifications deferred); this banner is
 * the in-app surface only, derived client-side from the feed (no new backend).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '@/constants/theme';

type Palette = typeof Colors.light;

interface SupperNudgeBannerProps {
    restaurantName: string;
    filledCount: number;
    seatCount: number;
    /** "Julian, Maya & Clara are in." — derived from filled seats. */
    othersLine?: string | null;
    onPress: () => void;
    onDismiss: () => void;
    palette: Palette;
}

export function SupperNudgeBanner({
    restaurantName,
    filledCount,
    seatCount,
    othersLine,
    onPress,
    onDismiss,
    palette,
}: SupperNudgeBannerProps) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [styles.wrap, { backgroundColor: palette.surfaceNote }, pressed ? { opacity: 0.94 } : undefined]}
            accessibilityRole="button"
            accessibilityLabel={`your turn at the table, supper at ${restaurantName}`}
        >
            {/* Left count block */}
            <View style={[styles.countBlock, { backgroundColor: palette.primary }]}>
                <Text style={styles.countNum}>{filledCount}</Text>
                <Text style={styles.countDenom}>of {seatCount}</Text>
            </View>

            {/* Body */}
            <View style={styles.body}>
                <Text style={[styles.kicker, { color: palette.primary }]}>your turn at the table</Text>
                <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>supper at {restaurantName}</Text>
                <Text style={[styles.sub, { color: palette.textMuted }]} numberOfLines={1}>
                    {othersLine ? `${othersLine} ` : ''}add your take.
                </Text>
            </View>

            {/* Dismiss */}
            <Pressable onPress={onDismiss} hitSlop={10} style={styles.dismiss} accessibilityRole="button" accessibilityLabel="dismiss">
                <Ionicons name="close" size={16} color={palette.textMuted} />
            </Pressable>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    wrap: {
        flexDirection: 'row',
        alignItems: 'stretch',
        borderRadius: 16,
        overflow: 'hidden',
        marginBottom: Spacing.md,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.05,
        shadowRadius: 22,
        elevation: 2,
    },
    countBlock: { width: 60, alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
    countNum: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 22, color: '#fdf6ec', lineHeight: 24 },
    countDenom: { fontFamily: 'Manrope_600SemiBold', fontSize: 8, color: 'rgba(253,246,236,0.75)', marginTop: 3 },
    body: { flex: 1, paddingHorizontal: 14, paddingVertical: 13, justifyContent: 'center' },
    kicker: { fontFamily: 'Manrope_700Bold', fontSize: 9, letterSpacing: 1.4, textTransform: 'uppercase' },
    title: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 16, marginTop: 5 },
    sub: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 4 },
    dismiss: { paddingHorizontal: 12, paddingTop: 12 },
});
