/**
 * ComposerMasthead — restaurant name as Newsreader italic masthead + inline 5-star row.
 * Layout: restaurant name on left (flex:1), star row baseline-aligned on right.
 *
 * Wireframe A1/A2: compose-restaurant-row grammar.
 * Stars use amber fill for rated, muted rule for unset.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    restaurantName: string;
    /** 0 = unrated; 0.5–5 in half-star steps */
    rating: number;
    onRatingChange: (value: number) => void;
    onClearPlace?: () => void;
}

export function ComposerMasthead({ restaurantName, rating, onRatingChange, onClearPlace }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={styles.wrapper}>
            {/* Restaurant masthead row */}
            <View style={styles.row}>
                <Pressable
                    onPress={onClearPlace}
                    disabled={!onClearPlace}
                    style={styles.nameContainer}
                    accessibilityLabel={onClearPlace ? 'Change restaurant' : undefined}
                >
                    <Text
                        style={[styles.restaurantName, { color: palette.text }]}
                        numberOfLines={2}
                    >
                        {restaurantName}
                    </Text>
                </Pressable>

                {/* Inline star row — baseline-aligned right */}
                <View style={styles.starRow}>
                    {[1, 2, 3, 4, 5].map((star) => {
                        const filled = rating >= star;
                        const half = !filled && rating >= star - 0.5;
                        const color = (filled || half) ? palette.star : palette.divider;
                        return (
                            <Pressable
                                key={star}
                                onPress={() => onRatingChange(star === rating ? 0 : star)}
                                style={styles.starTap}
                                hitSlop={4}
                                accessibilityLabel={`Rate ${star} star${star !== 1 ? 's' : ''}`}
                            >
                                <Ionicons
                                    name={filled ? 'star' : half ? 'star-half' : 'star-outline'}
                                    size={18}
                                    color={color}
                                />
                            </Pressable>
                        );
                    })}
                    {rating > 0 ? (
                        <Text style={[styles.ratingNum, { color: palette.text }]}>
                            {String(rating)}
                        </Text>
                    ) : null}
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        paddingBottom: Spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(221,192,186,0.25)',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: Spacing.md,
    },
    nameContainer: {
        flex: 1,
        minWidth: 0,
    },
    restaurantName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 32,
        lineHeight: 36,
        letterSpacing: -0.4,
        fontWeight: '400',
    },
    starRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        flexShrink: 0,
        paddingBottom: 4, // baseline-align with text
    },
    starTap: {
        padding: 2,
    },
    ratingNum: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        marginLeft: 4,
        lineHeight: 22,
    },
});
