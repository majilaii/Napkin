/**
 * PendingSaveCard — TICKET-060.
 *
 * Three card states: pending → (resolved | needs_confirm).
 * pending: warm-paper placeholder, italic Newsreader "reading it..."
 * resolved: restaurant name + city · cuisine + photo.
 * needs_confirm: resolved-looking + quiet "tap to confirm" affordance.
 *
 * Heirloom Journal: warm paper surfaces, Newsreader italic for name,
 * Manrope body, no emoji in chrome, ambient shadows only.
 */
import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    ActivityIndicator,
    Image,
} from 'react-native';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { resolveSourcedPhoto } from '@/components/ui/PlacesCredit';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PendingSaveStatus = 'pending' | 'resolved' | 'needs_confirm' | 'failed';

export interface PendingSaveCardProps {
    status: PendingSaveStatus;
    restaurantName?: string | null;
    restaurantCity?: string | null;
    restaurantCuisine?: string | null;
    restaurantPhotoUrl?: string | null;
    restaurantPhotoSource?: 'user' | 'table' | 'places' | 'none' | null;
    restaurantPhotoAttributionHtml?: string | null;
    /** Called when the user taps "tap to confirm" on needs_confirm cards. */
    onConfirm?: () => void;
}

type Palette = typeof Colors.light;

// ── Component ─────────────────────────────────────────────────────────────────

export function PendingSaveCard({
    status,
    restaurantName,
    restaurantCity,
    restaurantCuisine,
    restaurantPhotoUrl,
    restaurantPhotoSource,
    restaurantPhotoAttributionHtml,
    onConfirm,
}: PendingSaveCardProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const resolvedPhoto = resolveSourcedPhoto({
        url: restaurantPhotoUrl,
        photoSource: restaurantPhotoSource,
        attributionHtml: restaurantPhotoAttributionHtml,
        restaurantName,
    });
    const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
    useEffect(() => setFailedPhoto(null), [resolvedPhoto.url]);
    const visiblePhoto = resolvedPhoto.url !== failedPhoto ? resolvedPhoto.url : null;

    const cityLine = [restaurantCity, restaurantCuisine].filter(Boolean).join(' · ');

    return (
        <View
            style={[
                styles.card,
                { backgroundColor: palette.surfaceJournalLow },
                Shadow.clip,
            ]}
        >
            {/* Photo or placeholder */}
            {visiblePhoto ? (
                <Image
                    source={{ uri: visiblePhoto }}
                    style={[styles.thumb, { borderRadius: Radius.sm }]}
                    accessibilityIgnoresInvertColors
                    onError={() => setFailedPhoto(visiblePhoto)}
                />
            ) : (
                <View
                    style={[
                        styles.thumb,
                        { backgroundColor: palette.surfaceContainerHigh, borderRadius: Radius.sm },
                    ]}
                >
                    {status === 'pending' && (
                        <ActivityIndicator color={palette.primary} size="small" />
                    )}
                </View>
            )}

            {/* Text block */}
            <View style={styles.textBlock}>
                {status === 'pending' ? (
                    <Text style={[Type.headlineItalic, { color: palette.textMuted, fontSize: 15 }]}>
                        reading it...
                    </Text>
                ) : (
                    <>
                        <Text
                            style={[styles.name, { color: palette.text }]}
                            numberOfLines={1}
                        >
                            {restaurantName ?? 'Unknown restaurant'}
                        </Text>
                        {cityLine ? (
                            <Text
                                style={[Type.bodySmall, { color: palette.textMuted }]}
                                numberOfLines={1}
                            >
                                {cityLine}
                            </Text>
                        ) : null}
                        {status === 'needs_confirm' && onConfirm ? (
                            <Pressable
                                onPress={onConfirm}
                                hitSlop={8}
                                style={styles.confirmRow}
                            >
                                <Text style={[Type.caption, { color: palette.textMuted }]}>
                                    tap to confirm
                                </Text>
                            </Pressable>
                        ) : null}
                    </>
                )}
            </View>
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: Spacing.md,
        borderRadius: Radius.md,
        marginBottom: Spacing.sm,
        minHeight: 72,
    },
    thumb: {
        width: 52,
        height: 52,
        marginRight: Spacing.md,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    textBlock: {
        flex: 1,
    },
    name: {
        ...Type.headlineItalic,
        fontSize: 15,
        marginBottom: 2,
    } as any,
    confirmRow: {
        marginTop: 4,
    },
});
