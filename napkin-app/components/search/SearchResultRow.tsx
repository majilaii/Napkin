/**
 * SearchResultRow — single result in the tiered search list.
 *
 * Shows: photo thumb (or glyph fallback), bold name, muted city · cuisine,
 * and optional inline social tag ("visited by [Table]").
 *
 * Photo thumb for tier 3 (ghost) uses the Places photo reference name to
 * construct a URL via the photos edge function. For tier 1/2 it uses photo_url.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { SearchResultRow as SearchResultRowType } from '@/hooks/search/useRestaurantSearch';

interface Props {
    item: SearchResultRowType;
    onPress: (item: SearchResultRowType) => void;
}

function buildPhotoUrl(_photoReference: string | null): string | null {
    // No Places photo proxy in v1 — ghosts fall back to the glyph thumb.
    // The AC permits "fallback glyph when absent" and a proxy edge function
    // is tracked as a follow-up.
    return null;
}

export function SearchResultRow({ item, onPress }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const [imgError, setImgError] = useState(false);

    const thumbUrl = item.photoUrl ?? buildPhotoUrl(item.photoReference);
    const showGlyph = !thumbUrl || imgError;

    // Prefer address for chains (more specific), fall back to city · cuisine
    let meta = '';
    if (item.address) {
        meta = item.address;
    } else {
        const metaParts: string[] = [];
        if (item.city) metaParts.push(item.city);
        if (item.cuisine) metaParts.push(item.cuisine);
        meta = metaParts.join(' · ');
    }

    return (
        <Pressable
            style={({ pressed }) => [
                styles.row,
                { borderBottomColor: palette.divider },
                pressed && { backgroundColor: palette.surfaceContainer },
            ]}
            onPress={() => onPress(item)}
        >
            {/* Thumb */}
            <View
                style={[
                    styles.thumb,
                    { backgroundColor: palette.surfaceContainerHigh },
                ]}
            >
                {showGlyph ? (
                    <Ionicons name="restaurant-outline" size={20} color={palette.textMuted} />
                ) : (
                    <Image
                        source={{ uri: thumbUrl! }}
                        style={styles.thumbImage}
                        onError={() => setImgError(true)}
                    />
                )}
            </View>

            {/* Text */}
            <View style={styles.textBlock}>
                <Text
                    style={[Type.titleSmall, { color: palette.text }]}
                    numberOfLines={1}
                >
                    {item.name}
                </Text>

                {meta ? (
                    <Text
                        style={[Type.caption, styles.meta, { color: palette.textMuted }]}
                        numberOfLines={1}
                    >
                        {meta}
                    </Text>
                ) : null}

                {item.socialTag ? (
                    <Text
                        style={[Type.caption, styles.socialTag, { color: palette.primary }]}
                        numberOfLines={1}
                    >
                        {item.socialTag}
                    </Text>
                ) : null}
            </View>

            <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm + 2,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: Spacing.sm,
    },
    thumb: {
        width: 44,
        height: 44,
        borderRadius: Radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
    },
    thumbImage: {
        width: 44,
        height: 44,
    },
    textBlock: {
        flex: 1,
        gap: 2,
    },
    meta: {
        marginTop: 1,
    },
    socialTag: {
        marginTop: 2,
    },
});
