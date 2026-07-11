/**
 * SearchResultRow — single result in the tiered search list.
 *
 * TICKET-069 canvas restyle (Kit 07 · The Restaurant Row):
 *   [52px photo thumb — only if present]  italic serif 17 name
 *                                  sans 12 muted  neighborhood · cuisine
 *                                  [right-edge] your-signal slot:
 *                                    • amber italic 18 rating  (if visited + rating)
 *                                    • location-outline glyph  (if wishlisted)
 *                                    • nothing               (else)
 *
 * Logic unchanged. Only presentation updated.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { SearchResultRow as SearchResultRowType } from '@/hooks/search/useRestaurantSearch';

interface Props {
    item: SearchResultRowType;
    onPress: (item: SearchResultRowType) => void;
    /**
     * TICKET-097 — optional pre-formatted distance ("0.3 mi") appended to the
     * meta line (`city · cuisine · 0.3 mi`). Used by the empty-state
     * "Pinned near you" section; absent everywhere else.
     */
    distanceLabel?: string | null;
}

function buildPhotoUrl(_photoReference: string | null): string | null {
    // No Places photo proxy in v1 — ghosts render text-only (no thumb).
    return null;
}

export function SearchResultRow({ item, onPress, distanceLabel }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const [imgError, setImgError] = useState(false);

    const thumbUrl = item.photoUrl ?? buildPhotoUrl(item.photoReference);
    const hasPhoto = !!thumbUrl && !imgError;

    // Meta line: address · cuisine. TICKET-167 flips the preference to address
    // (falling back to city) so same-name venues at different addresses read as
    // distinct in the unified list. One line, tail-truncated.
    const metaParts: string[] = [];
    if (item.address) metaParts.push(item.address);
    else if (item.city) metaParts.push(item.city);
    if (item.cuisine) metaParts.push(item.cuisine);
    if (distanceLabel) metaParts.push(distanceLabel);
    const meta = metaParts.join(' · ');

    // Right-edge signal: canvas says "your rating | pin | nothing"
    // We don't have per-user rating in the search result shape yet, so:
    //   - tier === 'visited': show pin glyph as "been" indicator
    //   - else: nothing
    // ARCHITECT-REVIEW: wire actual user rating once search hook returns it.
    const showPin = item.tier === 'visited';

    return (
        <Pressable
            style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: palette.surfaceContainer },
            ]}
            onPress={() => onPress(item)}
            accessibilityRole="button"
            accessibilityLabel={item.name}
        >
            {/* Photo thumb — only when a real photo exists. No monogram
                placeholder: photoless results read as a clean text list. */}
            {hasPhoto ? (
                <Image
                    source={{ uri: thumbUrl! }}
                    style={styles.thumb}
                    onError={() => setImgError(true)}
                />
            ) : null}

            {/* Text block */}
            <View style={styles.textBlock}>
                <Text
                    style={[styles.name, { color: palette.text }]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                >
                    {item.name}
                </Text>
                {meta ? (
                    <Text
                        style={[styles.meta, { color: palette.textMuted }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                    >
                        {meta}
                    </Text>
                ) : null}
            </View>

            {/* Right-edge signal slot */}
            {showPin ? (
                <Ionicons
                    name="location-outline"
                    size={17}
                    color={palette.primary}
                    style={styles.signal}
                />
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm + 3,
        gap: 14,
    },
    thumb: {
        width: 52,
        height: 52,
        borderRadius: Radius.md,
        flexShrink: 0,
    },
    textBlock: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    name: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 22,
    },
    meta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    signal: {
        flexShrink: 0,
    },
});
