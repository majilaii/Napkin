/**
 * TopFour — the profile's four favourite restaurants, as a Letterboxd-class
 * marquee row (TICKET-025 · TICKET-146 "the engraving system", B — the marquee).
 *
 * Four compact 2:3 plates sit in one Letterboxd-style row. The compact
 * MarqueePlate treatment prioritizes the restaurant name and rating; decorative
 * mark/city details stay on larger plate contexts. Each plate draws tint from
 * the shared engraving registries (MarqueePlate), so the same restaurant reads
 * identically here and on the map. Rank ghosted top-left, rating terracotta,
 * upright restaurant name, and city letterspaced caps.
 *
 * Auto-derived or curated from `top_four` in the profile payload. Empty slots
 * show a tappable '+' for the owner. Public profile reuses this component.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FRIEND_TEST } from '@/constants/flags';
import { resolveTilePhoto } from '@/lib/restaurantPhoto';
import { PlacesCredit, resolveSourcedPhoto } from '@/components/ui/PlacesCredit';
import { SectionHeader } from './SectionHeader';
import { MarqueePlate } from './MarqueePlate';
import type { TopPick } from '@/hooks/users/useUserProfile';

interface Props {
    picks: TopPick[];
    /** When true (own profile), shows an "edit" affordance + tappable empty slots. */
    isOwner?: boolean;
    onEdit?: () => void;
}

export function TopFour({ picks, isOwner = false, onEdit }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { width: viewportWidth } = useWindowDimensions();
    const plateWidth = (viewportWidth - (Spacing.lg * 2) - (Spacing.sm * 3)) / 4;
    const plateDimensions = { width: plateWidth, height: plateWidth * 1.5 };
    const [failedPhotoKeys, setFailedPhotoKeys] = React.useState<Set<string>>(() => new Set());

    const slots: (TopPick | null)[] = [
        picks[0] ?? null,
        picks[1] ?? null,
        picks[2] ?? null,
        picks[3] ?? null,
    ];

    // Resolve the final image once so the aggregate credit describes only the
    // photos that actually reach the grid. A chosen-memory photo wins over the
    // restaurant's Places hero and therefore contributes no Places credit.
    const resolvedSlots = slots.map((pick) => {
        if (!pick) return null;
        const sourced = resolveSourcedPhoto({
            url: pick.photo_url,
            photoSource: pick.photo_source,
            attributionHtml: pick.places_photo_attribution_html,
            restaurantName: pick.name,
        });
        const photo = resolveTilePhoto({
            custom_photo_url: pick.hero_photo_url,
            primary_photo_url: sourced.url,
            photo_source: pick.photo_source,
            places_hero_enabled: FRIEND_TEST.topFourPlacesHero,
            restaurant_name: pick.name,
        });
        return {
            pick,
            photo,
            credit: photo.kind === 'url' && photo.isPlaces ? sourced.credit : null,
        };
    });
    const renderedPlacesPhotos = resolvedSlots.flatMap((slot) => {
        if (!slot?.credit || slot.photo.kind !== 'url') return [];
        const key = `${slot.pick.restaurant_id}:${slot.photo.url}`;
        return failedPhotoKeys.has(key) ? [] : [slot];
    });

    const openPick = (pick: TopPick) =>
        // Tap a pick with a review → open the review. Gated to the owner so a
        // public-profile viewer can't deep-link into a Table-visibility entry —
        // they get the restaurant page.
        pick.review_entry_id && isOwner
            ? router.push({ pathname: '/entry-detail', params: { entryId: pick.review_entry_id } })
            : router.push(`/restaurant/${pick.restaurant_id}` as any);

    return (
        <View style={[styles.section, { backgroundColor: palette.surfaceContainerLow }]}>
            <SectionHeader
                title="Top 4"
                rightLabel={isOwner && onEdit ? 'edit' : undefined}
                onRightLabelPress={onEdit}
            />
            <View style={styles.row}>
                {resolvedSlots.map((slot, i) => {
                    if (!slot) {
                        return (
                            <Pressable
                                key={i}
                                style={[
                                    styles.plate,
                                    plateDimensions,
                                    styles.emptyPlate,
                                    { borderColor: palette.outlineVariant, backgroundColor: palette.surfaceContainerHigh },
                                ]}
                                onPress={isOwner && onEdit ? onEdit : undefined}
                                accessibilityRole={isOwner && onEdit ? 'button' : undefined}
                                accessibilityLabel={isOwner && onEdit ? 'Add to your Top 4' : undefined}
                            >
                                <Text
                                    style={[styles.plus, { color: palette.textMuted }]}
                                    maxFontSizeMultiplier={1.2}
                                >
                                    +
                                </Text>
                            </Pressable>
                        );
                    }
                    const { pick, photo } = slot;
                    return (
                        <MarqueePlate
                            key={i}
                            style={[styles.plate, plateDimensions]}
                            restaurantId={pick.restaurant_id}
                            name={pick.name}
                            cuisine={pick.cuisine}
                            listEmoji={null}
                            city={pick.city}
                            rating={pick.max_rating}
                            rank={i + 1}
                            compact
                            photoUrl={photo.kind === 'url' ? photo.url : null}
                            placesWash={photo.kind === 'url' && photo.isPlaces}
                            onPress={() => openPick(pick)}
                            onPhotoError={(url) => setFailedPhotoKeys(
                                (current) => new Set(current).add(`${pick.restaurant_id}:${url}`),
                            )}
                        />
                    );
                })}
            </View>
            {renderedPlacesPhotos.length > 0 ? (
                <View style={styles.placesCreditRow}>
                    <PlacesCredit
                        credits={renderedPlacesPhotos.map((slot) => slot.credit)}
                        photoCount={renderedPlacesPhotos.length}
                        testID="profile-top-four-places-credit"
                    />
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        marginTop: Spacing.sm,
        paddingBottom: Spacing.md,
    },
    row: {
        flexDirection: 'row',
        paddingHorizontal: Spacing.lg,
        gap: Spacing.sm,
    },
    placesCreditRow: {
        marginHorizontal: Spacing.lg,
        marginTop: Spacing.sm,
    },
    plate: {
        flexGrow: 0,
        flexShrink: 0,
    },
    emptyPlate: {
        aspectRatio: 2 / 3,
        borderRadius: Radius.md,
        borderWidth: 1,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
    },
    plus: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 28,
        fontWeight: '300',
    },
});
