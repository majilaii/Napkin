/**
 * EntryCard — the richer variant of a journal entry.
 *
 * Canvas spec (Kit 06 + P·JOURNAL):
 *   surface-note card, r16, ghost warm border (rule-warm), shadow-note
 *   ┌── tick header: rating · name · weekday ────────────────────────┐
 *   │  [optional photo 148px, r12]                                   │
 *   │  — em-dash italic pull-quote 16/24 (ink-primary)               │
 *   │  dish · with companions  (sans 12 muted, single-line ellipsis) │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * A row earns the card by having a body (photo or note). Without a body,
 * render TickRow instead.
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    Image,
    Pressable,
    StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface EntryCardProps {
    rating: number | null;
    restaurantName: string;
    /** TICKET-075: show a small filled terracotta heart by the rating when true. */
    liked?: boolean;
    /** Right-edge of tick header — "sat", "tue", "sat 6 jun" etc. */
    weekday?: string;
    /** Full-width photo above the note. Canvas: 148px tall, r12. */
    photoUrl?: string | null;
    /** Note/content text. Em-dash + italic serif 16. */
    note?: string | null;
    /** Dish + companions meta line. */
    dishMeta?: string | null;
    onPress?: () => void;
}

export function EntryCard({
    rating,
    restaurantName,
    liked,
    weekday,
    photoUrl,
    note,
    dishMeta,
    onPress,
}: EntryCardProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const [imgError, setImgError] = useState(false);

    const showPhoto = !!photoUrl && !imgError;

    const inner = (
        <View
            style={[
                styles.card,
                {
                    backgroundColor: palette.surfaceNote,
                    borderColor: palette.divider,
                },
                Shadow.note,
            ]}
        >
            {/* Tick header row */}
            <View style={styles.header}>
                {rating != null && (
                    <>
                        <Text style={[styles.rating, { color: palette.amberBright }]}>
                            {rating % 1 === 0 ? `${rating}.0` : `${rating}`}
                        </Text>
                        <Text style={[styles.headerDot, { color: palette.textMuted }]}>·</Text>
                    </>
                )}
                {liked ? (
                    <Ionicons
                        name="heart"
                        size={13}
                        color={palette.primary}
                        style={styles.likedHeart}
                        accessibilityLabel="liked"
                    />
                ) : null}
                <Text
                    style={[styles.restaurantName, { color: palette.text }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                >
                    {restaurantName}
                </Text>
                <View style={{ flex: 1 }} />
                {weekday ? (
                    <Text style={[styles.weekday, { color: palette.textMuted }]}>{weekday}</Text>
                ) : null}
            </View>

            {/* Photo */}
            {showPhoto && (
                <Image
                    source={{ uri: photoUrl! }}
                    style={styles.photo}
                    resizeMode="cover"
                    onError={() => setImgError(true)}
                />
            )}

            {/* Note — em-dash italic serif */}
            {note ? (
                <Text style={[styles.note, { color: palette.text }]}>
                    {`— ${note}`}
                </Text>
            ) : null}

            {/* Dish / companions meta */}
            {dishMeta ? (
                <Text
                    style={[styles.meta, { color: palette.textMuted }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                >
                    {dishMeta}
                </Text>
            ) : null}
        </View>
    );

    if (onPress) {
        return (
            <Pressable
                onPress={onPress}
                style={({ pressed }) => [
                    styles.pressable,
                    pressed ? { opacity: 0.85 } : undefined,
                ]}
                accessibilityRole="button"
            >
                {inner}
            </Pressable>
        );
    }
    return inner;
}

const styles = StyleSheet.create({
    pressable: {
        paddingHorizontal: Spacing.lg,
        marginVertical: 4,
    },
    card: {
        borderRadius: 16,
        borderWidth: 1,
        padding: Spacing.md,
        gap: 12,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
    },
    rating: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 22,
    },
    headerDot: {
        fontSize: 12,
        lineHeight: 18,
    },
    likedHeart: {
        alignSelf: 'center',
        marginRight: 6,
    },
    restaurantName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 22,
        flexShrink: 1,
    },
    weekday: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        flexShrink: 0,
    },
    photo: {
        width: '100%',
        height: 148,
        borderRadius: 12,
    },
    note: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 24,
    },
    meta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
});
