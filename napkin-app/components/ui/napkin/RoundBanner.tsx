/**
 * RoundBanner — async Round is open; invites tablemates to weigh in.
 *
 * Layout:
 *   [sanguine tile: tally·count, label ROUND] | [content: kicker 'OPEN · YOUR TURN', place, detail, →]
 *
 * Canvas reference: primitives.jsx → RoundBanner.
 */
import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    place: string;
    tally: { done: number; total: number };
    detail?: string;
    onPress?: () => void;
    /** Override kicker copy. Default: "OPEN · YOUR TURN" */
    kicker?: string;
}

export function RoundBanner({
    place,
    tally,
    detail,
    onPress,
    kicker = 'OPEN \u00B7 YOUR TURN',
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const Container = onPress ? Pressable : View;

    return (
        <Container
            onPress={onPress}
            style={[styles.card, Shadow.note, { backgroundColor: palette.surfaceNote }]}
        >
            {/* Sanguine tally tile */}
            <View style={[styles.tally, { backgroundColor: palette.sanguine }]}>
                <Text style={[styles.tallyNum, { color: '#fef6e6' }]}>
                    {tally.done}
                </Text>
                <Text style={[styles.tallyTotal, { color: '#fef6e6' }]}>
                    of {tally.total}
                </Text>
                <View style={[styles.tallyRule, { backgroundColor: '#fef6e6' }]} />
                <Text style={[styles.tallyLabel, { color: '#fef6e6' }]}>ROUND</Text>
            </View>

            {/* Content */}
            <View style={styles.content}>
                <View style={styles.contentText}>
                    <Text style={[styles.kicker, { color: palette.sanguine }]}>
                        {kicker}
                    </Text>
                    <Text style={[styles.place, { color: palette.text }]}>
                        {place}
                    </Text>
                    {detail ? (
                        <Text style={[styles.detail, { color: palette.textMuted }]}>
                            {detail}
                        </Text>
                    ) : null}
                </View>
                <Text style={[styles.arrow, { color: palette.text }]}>{'\u2192'}</Text>
            </View>
        </Container>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        borderRadius: Radius.lg,
        overflow: 'hidden',
    },
    tally: {
        width: 64,
        padding: 6,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tallyNum: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        letterSpacing: -0.4,
        lineHeight: 24,
    },
    tallyTotal: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 9,
        marginTop: 2,
        letterSpacing: 0.3,
        opacity: 0.7,
    },
    tallyRule: {
        width: 20,
        height: 1,
        opacity: 0.35,
        marginVertical: 6,
    },
    tallyLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 8,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    content: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 18,
        paddingVertical: 14,
    },
    contentText: {
        flex: 1,
        minWidth: 0,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    place: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        letterSpacing: -0.2,
        marginTop: 2,
    },
    detail: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        marginTop: 2,
    },
    arrow: {
        fontSize: 18,
        opacity: 0.45,
    },
});

export default RoundBanner;
