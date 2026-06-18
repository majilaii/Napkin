/**
 * ExpandedTake — the expanded body of an accordion take row (TICKET-082).
 *
 * Renders one member's full take: the note (Newsreader italic ~18, em-dash
 * pull-quote idiom), a horizontal photo strip from `take.photos`, and the
 * vibe/flavor/service/value breakdown chips (only those present).
 *
 * Heirloom: warm paper, ink text, amber breakdown numerals on amber-cream chips,
 * Newsreader italic for prose. No 1px sectioning borders — spacing only.
 * Reuses the voiceRow / historyRow idioms from restaurant/[id].tsx:863-909.
 */
import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import type { SupperTake } from '@/hooks/suppers';

type Palette = typeof Colors.light;

const PHOTO = 132;

const CATEGORY_LABELS: { key: keyof SupperTake; label: string }[] = [
    { key: 'vibe_rating', label: 'vibe' },
    { key: 'flavor_rating', label: 'flavor' },
    { key: 'service_rating', label: 'service' },
    { key: 'value_rating', label: 'value' },
];

interface ExpandedTakeProps {
    take: SupperTake;
    palette: Palette;
}

export function ExpandedTake({ take, palette }: ExpandedTakeProps) {
    const hasBreakdown =
        take.vibe_rating != null ||
        take.flavor_rating != null ||
        take.service_rating != null ||
        take.value_rating != null;

    const hasNote = !!take.content?.trim();
    const hasDish = !!take.dish_description?.trim();
    const photos = take.photos ?? [];

    // A submitted take with nothing but a rating still gets a quiet murmur.
    const isBare = !hasNote && !hasDish && photos.length === 0 && !hasBreakdown;

    return (
        <View style={styles.wrap}>
            {/* Note — em-dash pull-quote, Newsreader italic 18 */}
            {hasNote ? (
                <Text style={[styles.note, { color: palette.text }]}>
                    {'—  '}
                    {take.content?.trim()}
                </Text>
            ) : null}

            {/* Dish line */}
            {hasDish ? (
                <Text style={[styles.dish, { color: palette.textSecondary }]}>
                    <Text style={[styles.dishLabel, { color: palette.textMuted }]}>dish{'  '}</Text>
                    {'—  '}
                    {take.dish_description?.trim()}
                </Text>
            ) : null}

            {/* Photo strip */}
            {photos.length > 0 ? (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.photoStrip}
                >
                    {photos.map((url, i) => (
                        <Image
                            key={`${url}-${i}`}
                            source={{ uri: url }}
                            style={styles.photo}
                            resizeMode="cover"
                        />
                    ))}
                </ScrollView>
            ) : null}

            {/* Breakdown chips — amber numerals on amber-cream */}
            {hasBreakdown ? (
                <View style={styles.chipRow}>
                    {CATEGORY_LABELS.filter(({ key }) => take[key] != null).map(({ key, label }) => (
                        <View
                            key={key}
                            style={[styles.chip, { backgroundColor: palette.tertiaryFixed }]}
                        >
                            <Text style={[styles.chipLabel, { color: palette.tertiary }]}>
                                {label}
                            </Text>
                            <Text style={[styles.chipNum, { color: palette.tertiary }]}>
                                {(take[key] as number).toFixed(1)}
                            </Text>
                        </View>
                    ))}
                </View>
            ) : null}

            {isBare ? (
                <Text style={[styles.murmur, { color: palette.textMuted }]}>
                    {'—  no words, just the score'}
                </Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingTop: 10,
        gap: 12,
    },
    note: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        lineHeight: 27,
    },
    dish: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 22,
    },
    dishLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
    },
    photoStrip: {
        gap: 8,
        paddingRight: 4,
    },
    photo: {
        width: PHOTO,
        height: PHOTO,
        borderRadius: 12,
    },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 999,
    },
    chipLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    chipNum: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
    },
    murmur: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        lineHeight: 20,
    },
});
