/**
 * FastLogForm — stars-only fast log (per design bundle KesUvsKUncnW77HO079PDg).
 *
 * Reached ONLY from the restaurant page via FastLogSheet. The restaurant is
 * always locked — there is no search path here. The + tab button opens the
 * full composer (/create-entry) instead.
 *
 * Layout (top → bottom):
 *   RestaurantHeader (locked)
 *   Big stars (38px, half-step)
 *   Live caption ("4.5 / 5") — fades in once rated
 *   SAVE pill
 *   "⌃ pull up for the full log" italic whisper
 *
 * Note, breakdown, Post-to chips, "Break it down" expander and "open full
 * entry" link were removed. The pull-up gesture (handled in FastLogSheet) is
 * the single path to the full composer.
 */
import React, { useCallback, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
} from 'react-native';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCreateEntry } from '@/hooks/tables/useCreateEntry';
import { StarRating } from '@/components/StarRating';
import { placesPhotoProxyUrl } from '@/lib/placesPhoto';
import { RestaurantHeader } from '@/components/ui';

export interface LockedRestaurant {
    id?: string;
    external_id?: string;
    name: string;
    placePayload?: any;
}

export interface FastLogFormProps {
    lockedRestaurant: LockedRestaurant;
    initialTableId?: string;
    onSubmitted: (entryId: string) => void;
    /**
     * Controlled rating — state lives in FastLogSheet so the swipe-up
     * gesture can pass the current value to the full composer.
     */
    rating: number;
    onRatingChange: (rating: number) => void;
    /** Tap-fallback for the "⌃ pull up for the full log" whisper. */
    onOpenFullEntry: () => void;
}

function ratingCaption(value: number): { numeric: string | null } {
    if (value <= 0) return { numeric: 'Tap to rate · half steps' };
    const snapped = Math.round(value * 2) / 2;
    return { numeric: `${snapped} / 5` };
}

function metaFromLocked(r: LockedRestaurant): string | undefined {
    return r.placePayload?.formattedAddress ?? undefined;
}

function photoFromLocked(r: LockedRestaurant): string | null {
    return placesPhotoProxyUrl(r.placePayload?.photoReference);
}

export function FastLogForm({
    lockedRestaurant,
    initialTableId,
    onSubmitted,
    rating,
    onRatingChange,
    onOpenFullEntry,
}: FastLogFormProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { user } = useAuth();

    const selectedTableId = initialTableId ?? null;

    const createEntry = useCreateEntry(user?.id, selectedTableId);
    const canSubmit = rating > 0;
    const isSubmitting = createEntry.isPending;
    const [submitError, setSubmitError] = useState<string | null>(null);

    const handleSubmit = useCallback(async () => {
        if (!canSubmit || isSubmitting) return;
        setSubmitError(null);

        let restaurantData: any;
        const payload = lockedRestaurant.placePayload;
        if (payload) {
            restaurantData = {
                external_id: payload.id ?? payload.external_id ?? lockedRestaurant.external_id ?? '',
                name: payload.name ?? lockedRestaurant.name,
                location: payload.formattedAddress ? { address: payload.formattedAddress } : undefined,
                types: payload.categories ?? ['restaurant'],
                latitude: payload.latitude ?? undefined,
                longitude: payload.longitude ?? undefined,
                photoReference: payload.photoReference ?? undefined,
                photoAttributionHtml: payload.photoAttributionHtml ?? null,
            };
        } else {
            restaurantData = {
                external_id: lockedRestaurant.external_id ?? lockedRestaurant.id ?? `manual-${Date.now()}`,
                name: lockedRestaurant.name,
                types: ['restaurant'],
            };
        }

        const ratingValue = Math.round(rating * 2) / 2;

        try {
            const result = await createEntry.mutateAsync({
                restaurant: restaurantData,
                rating: ratingValue,
                table_id: selectedTableId ?? undefined,
                visibility: selectedTableId ? 'table' : 'private',
            });
            const entryId = result?.id ?? result?.entry?.id ?? '';
            onSubmitted(entryId);
        } catch (e: any) {
            setSubmitError(e.message ?? 'Could not save entry. Tap to retry.');
        }
    }, [
        canSubmit,
        isSubmitting,
        lockedRestaurant,
        rating,
        selectedTableId,
        createEntry,
        onSubmitted,
    ]);

    const caption = ratingCaption(rating);
    const restaurantPhoto = photoFromLocked(lockedRestaurant);
    const restaurantMeta = metaFromLocked(lockedRestaurant);

    return (
        <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
        >
            <RestaurantHeader
                name={lockedRestaurant.name}
                meta={restaurantMeta}
                photoUrl={restaurantPhoto}
                locked
            />

            <View style={styles.starsBlock}>
                <StarRating
                    value={rating}
                    size={38}
                    editable
                    onChange={onRatingChange}
                    showValue={false}
                />
                <View style={styles.captionRow}>
                    {caption.numeric ? (
                        <Text style={[styles.captionNumeric, { color: palette.textMuted }]}>
                            {caption.numeric}
                        </Text>
                    ) : null}
                </View>
            </View>

            {submitError ? (
                <View style={styles.errorRow}>
                    <Text style={[Type.bodySmall, { color: palette.error }]}>
                        {submitError}
                    </Text>
                    <Pressable onPress={handleSubmit}>
                        <Text style={[Type.caption, styles.retryLink, { color: palette.error }]}>
                            Retry
                        </Text>
                    </Pressable>
                </View>
            ) : null}

            <Pressable
                disabled={!canSubmit || isSubmitting}
                onPress={handleSubmit}
                style={({ pressed }) => [
                    styles.ctaButton,
                    {
                        backgroundColor: canSubmit ? palette.primary : palette.surfaceContainerHigh,
                        opacity: pressed ? 0.9 : isSubmitting ? 0.6 : 1,
                    },
                ]}
            >
                {isSubmitting ? (
                    <ActivityIndicator color={palette.textInverse} />
                ) : (
                    <Text
                        style={[
                            Type.label,
                            {
                                color: canSubmit ? palette.textInverse : palette.textMuted,
                                letterSpacing: 1.5,
                            },
                        ]}
                    >
                        SAVE
                    </Text>
                )}
            </Pressable>

            <Pressable
                onPress={onOpenFullEntry}
                disabled={createEntry.isPending || createEntry.isSuccess}
                hitSlop={10}
                style={({ pressed }) => [
                    styles.pullUpHint,
                    {
                        opacity:
                            pressed || createEntry.isPending || createEntry.isSuccess ? 0.5 : 1,
                    },
                ]}
            >
                <Text style={[styles.pullUpText, { color: palette.textMuted }]}>
                    ⌃ pull up for the full log
                </Text>
            </Pressable>
        </ScrollView>
    );
}

const PAGE_H = 20;

const styles = StyleSheet.create({
    scrollContent: {
        paddingHorizontal: PAGE_H,
        paddingTop: 18,
        paddingBottom: Spacing.xl,
    },
    starsBlock: {
        marginTop: 16,
        alignItems: 'center',
        gap: 12,
    },
    captionRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
        height: 18,
    },
    captionNumeric: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
    errorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginTop: Spacing.md,
    },
    retryLink: {
        textDecorationLine: 'underline',
        marginLeft: Spacing.xs,
    },
    ctaButton: {
        marginTop: Spacing.xl,
        height: 50,
        borderRadius: 9999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pullUpHint: {
        marginTop: 14,
        paddingVertical: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pullUpText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
        letterSpacing: 0.4,
    },
});
