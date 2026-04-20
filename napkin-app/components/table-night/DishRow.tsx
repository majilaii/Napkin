/**
 * DishRow — a single row in the "On the Table" menu-card module.
 *
 * Renders:
 *   - Dish name (Newsreader italic, 20px) — left, wraps; truncated at 80 chars
 *   - Attribution line "— ordered by <name>" (Manrope caption, muted) — below dish name
 *   - Rating number (Newsreader italic, 22px, amber) — right, fixed-width column
 *   - Optional winner chrome: faint tertiaryFixed bg + amber star when isWinner
 *
 * Tapping the row navigates to entry-detail via the onPress prop.
 * No nested tap targets — attribution is plain Text.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { type TableNightParticipant } from '@/hooks/tables/useTableNight';

type Palette = typeof Colors.light;

interface DishRowProps {
    participant: TableNightParticipant & { rating: number };
    isWinner: boolean;
    palette: Palette;
    onPress: () => void;
}

function truncateDish(text: string): string {
    if (text.length > 80) {
        return text.slice(0, 79).trimEnd() + '\u2026';
    }
    return text;
}

export default function DishRow({ participant, isWinner, palette, onPress }: DishRowProps) {
    const dishText = truncateDish(participant.dish_description ?? '');
    const name = participant.profiles.display_name;

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                isWinner && {
                    backgroundColor: palette.tertiaryFixed,
                    padding: Spacing.sm,
                    borderRadius: Radius.sm,
                },
                { opacity: pressed ? 0.75 : 1 },
            ]}
        >
            {/* Left column: dish name + attribution */}
            <View style={styles.leftCol}>
                <Text
                    style={[
                        Type.headlineMedium,
                        { fontFamily: 'Newsreader_400Regular_Italic', color: palette.text },
                    ]}
                >
                    {dishText}
                </Text>
                <Text style={[Type.caption, { color: palette.textMuted, marginTop: 2 }]}>
                    {'\u2014'} ordered by {name}
                </Text>
            </View>

            {/* Right column: rating + optional star */}
            <View style={styles.rightCol}>
                {isWinner && (
                    <Ionicons
                        name="star"
                        size={12}
                        color={palette.tertiary}
                        style={{ marginBottom: 2 }}
                    />
                )}
                <Text style={[Type.rating, { color: palette.tertiary, fontSize: 22, textAlign: 'right' }]}>
                    {participant.rating.toFixed(1)}
                </Text>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: Spacing.sm,
    },
    leftCol: {
        flex: 1,
    },
    rightCol: {
        width: 44,
        alignItems: 'flex-end',
        paddingTop: 2,
    },
});
