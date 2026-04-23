/**
 * AtlasEmptyState — shown when a Table has no geo-tagged logs, or when a
 * city deep-link resolves to zero restaurants.
 *
 * Primary copy: italic Newsreader 22px "Your first spots land here."
 * Caption: uppercase Manrope 10px olive "noted · tried · pinned"
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    palette?: typeof Colors.light;
}

export function AtlasEmptyState({ palette: paletteProp }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = paletteProp ?? Colors[scheme];

    return (
        <View style={styles.wrap}>
            {/* Abstract illustration — three stacked circles evoking pins */}
            <View style={[styles.illustration, { borderColor: palette.outlineVariant }]}>
                <View style={[styles.pin, styles.pinBack, { backgroundColor: palette.surfaceContainerLow }]} />
                <View style={[styles.pin, styles.pinMid, { backgroundColor: palette.oliveCream }]} />
                <View
                    style={[
                        styles.pin,
                        styles.pinFront,
                        { backgroundColor: palette.terracottaBorder, borderColor: palette.primary },
                    ]}
                />
            </View>

            <Text style={[styles.primary, { color: palette.textSecondary }]}>
                Your first spots land here.
            </Text>
            <Text style={[styles.caption, { color: palette.secondary }]}>
                noted{' '}
                <Text style={[styles.dot, { color: palette.textMuted }]}>·</Text>{' '}
                tried{' '}
                <Text style={[styles.dot, { color: palette.textMuted }]}>·</Text>{' '}
                pinned
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingHorizontal: Spacing.xl,
        paddingTop: 88,
        paddingBottom: Spacing.xl,
        alignItems: 'center',
    },
    illustration: {
        width: 120,
        height: 120,
        marginBottom: 28,
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
    },
    pin: {
        position: 'absolute',
        borderRadius: 999,
    },
    pinBack: {
        width: 64,
        height: 64,
        top: 28,
        left: 12,
        opacity: 0.6,
    },
    pinMid: {
        width: 56,
        height: 56,
        top: 20,
        right: 16,
        opacity: 0.7,
    },
    pinFront: {
        width: 48,
        height: 48,
        top: 10,
        left: 30,
        borderWidth: 1.5,
        opacity: 0.9,
    },
    primary: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        lineHeight: 30,
        letterSpacing: -0.2,
        textAlign: 'center',
        maxWidth: 280,
        marginBottom: 18,
    },
    caption: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        textAlign: 'center',
    },
    dot: {
        fontFamily: 'Manrope_400Regular',
    },
});

export default AtlasEmptyState;
