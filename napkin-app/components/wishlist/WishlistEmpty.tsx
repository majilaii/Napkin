/**
 * WishlistEmpty — three stacked dashed posters above an italic headline.
 *
 * From `early-states.jsx::WishlistEmptyPhone`:
 *   The form of the populated state is visible — three ghost posters,
 *   each more ghosted than the last. Italic-serif headline, italic body,
 *   filled-ink "+ Pin a place" CTA.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';

type Palette = typeof Colors.light;

interface Props {
    palette: Palette;
    onPin: () => void;
}

export function WishlistEmpty({ palette, onPin }: Props) {
    return (
        <View style={styles.container}>
            <View style={styles.posterGrid}>
                {[0, 1, 2].map((i) => (
                    <View
                        key={i}
                        style={[
                            styles.poster,
                            {
                                backgroundColor: palette.surfaceJournalLow,
                                borderColor: palette.dividerSoft,
                                opacity: 1 - i * 0.22,
                            },
                        ]}
                    />
                ))}
            </View>

            <Text style={[styles.headline, { color: palette.text }]}>
                A list of places,{'\n'}waiting for their night.
            </Text>

            <Text style={[styles.body, { color: palette.textMuted }]}>
                Pin somewhere you&rsquo;ve been curious about. We&rsquo;ll
                nudge you next time you&rsquo;re nearby.
            </Text>

            <Pressable
                onPress={onPin}
                style={({ pressed }) => [
                    styles.cta,
                    {
                        backgroundColor: palette.text,
                        opacity: pressed ? 0.85 : 1,
                    },
                ]}
            >
                <Text style={[styles.ctaText, { color: palette.textInverse }]}>
                    + PIN A PLACE
                </Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 44,
        paddingTop: Spacing.xl,
        paddingBottom: 100,
    },
    posterGrid: {
        flexDirection: 'row',
        gap: 10,
        width: '100%',
        maxWidth: 240,
        marginBottom: 28,
    },
    poster: {
        flex: 1,
        aspectRatio: 3 / 4,
        borderRadius: 6,
        borderWidth: 1,
        borderStyle: 'dashed',
    },
    headline: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 22,
        fontWeight: '500',
        lineHeight: 28,
        textAlign: 'center',
    },
    body: {
        marginTop: 12,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 12,
        lineHeight: 19,
        textAlign: 'center',
        maxWidth: 260,
    },
    cta: {
        marginTop: 22,
        paddingHorizontal: 18,
        paddingVertical: 9,
        borderRadius: 9999,
    },
    ctaText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 0.5,
    },
});
