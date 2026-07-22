/**
 * TopFourCity — one claimed city block.
 *
 * Layout: italic Newsreader city name + HOME chip + terracotta EDIT (owner) +
 * sub-line (home · N places OR N places) + 4-column poster grid.
 * Owner long-press → action sheet: "Make home" / "Unclaim {city}".
 * Warm hairline top border (not first).
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActionSheetIOS, Alert, Platform } from 'react-native';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { HomeChip } from './HomeChip';
import { TopFourPosterSlot } from './TopFourPosterSlot';
import type { ClaimedCity, TopFourPick } from '@/hooks/top-fours/useTopFours';
import { useSetHomeCity } from '@/hooks/top-fours/useSetHomeCity';
import { useUnclaimCity } from '@/hooks/top-fours/useUnclaimCity';
import { resolveSourcedPhoto } from '@/components/ui/PlacesCredit';

interface Props {
    city: ClaimedCity;
    isFirst: boolean;
    isOwner: boolean;
    onEdit: (city: string) => void;   // opens EditTopFourSheet for this city
}

const POSITIONS: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];

export function TopFourCity({ city, isFirst, isOwner, onEdit }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const setHome = useSetHomeCity();
    const unclaim = useUnclaimCity();
    const [failedPhotos, setFailedPhotos] = useState<Set<string>>(() => new Set());

    const pickMap = new Map<number, TopFourPick>(
        city.picks.map(p => [p.position, p]),
    );
    const photoByPosition = useMemo(() => new Map(city.picks.map((pick) => {
        const photo = resolveSourcedPhoto({
            url: pick.restaurant.photo_url,
            photoSource: pick.restaurant.photo_source,
            attributionHtml: pick.restaurant.places_photo_attribution_html,
            restaurantName: pick.restaurant.name,
        });
        const failureKey = `${pick.restaurant.id}:${photo.url ?? ''}`;
        return [pick.position, {
            url: photo.url && !failedPhotos.has(failureKey) ? photo.url : null,
            failureKey,
        }] as const;
    })), [city.picks, failedPhotos]);

    const handleOpenMenu = useCallback(() => {
        const options: string[] = [];
        if (!city.is_home) options.push(`Make home`);
        options.push(`Unclaim ${city.city}`);
        options.push('Cancel');

        const cancelIndex = options.length - 1;

        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    options,
                    cancelButtonIndex: cancelIndex,
                    destructiveButtonIndex: options.indexOf(`Unclaim ${city.city}`),
                },
                (idx) => {
                    const label = options[idx];
                    if (label === `Make home`) {
                        setHome.mutate({ city: city.city });
                    } else if (label === `Unclaim ${city.city}`) {
                        Alert.alert(
                            `Unclaim ${city.city}?`,
                            'Your picks will be removed from your Top 4s.',
                            [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                    text: 'Unclaim',
                                    style: 'destructive',
                                    onPress: () => unclaim.mutate({ city: city.city }),
                                },
                            ],
                        );
                    }
                },
            );
        } else {
            // Android fallback: simple Alert with buttons
            const buttons: { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }[] = [];
            if (!city.is_home) {
                buttons.push({
                    text: 'Make home',
                    onPress: () => setHome.mutate({ city: city.city }),
                });
            }
            buttons.push({
                text: `Unclaim ${city.city}`,
                style: 'destructive',
                onPress: () => unclaim.mutate({ city: city.city }),
            });
            buttons.push({ text: 'Cancel', style: 'cancel' });
            Alert.alert(city.city, undefined, buttons);
        }
    }, [city, setHome, unclaim]);

    const subLine = city.is_home
        ? `home · ${city.distinct_restaurant_count} ${city.distinct_restaurant_count === 1 ? 'place' : 'places'}`
        : `${city.distinct_restaurant_count} ${city.distinct_restaurant_count === 1 ? 'place' : 'places'}`;

    return (
        <View
            style={[
                styles.container,
                !isFirst && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: palette.dividerSoft,
                },
            ]}
        >
            {/* City header row */}
            <View style={styles.headerRow}>
                <View style={styles.headerLeft}>
                    <Text
                        style={[
                            Type.headlineMedium,
                            {
                                fontFamily: 'Newsreader_400Regular_Italic',
                                fontStyle: 'italic',
                                fontSize: 22,
                                color: palette.text,
                            },
                        ]}
                    >
                        {city.city}
                    </Text>
                    {city.is_home && (
                        <View style={{ marginLeft: Spacing.sm, marginTop: 3 }}>
                            <HomeChip />
                        </View>
                    )}
                </View>

                <View style={styles.headerRight}>
                    {isOwner && (
                        <>
                            <Pressable
                                onPress={() => onEdit(city.city)}
                                hitSlop={8}
                                accessibilityLabel={`Edit Top 4 for ${city.city}`}
                            >
                                <Text style={[Type.labelSmall, { color: palette.primary }]}>EDIT</Text>
                            </Pressable>
                            <Pressable
                                onPress={handleOpenMenu}
                                hitSlop={8}
                                style={{ marginLeft: Spacing.md }}
                                accessibilityLabel={`More options for ${city.city}`}
                            >
                                <Text style={[Type.caption, { color: palette.textMuted, fontSize: 18 }]}>···</Text>
                            </Pressable>
                        </>
                    )}
                </View>
            </View>

            {/* Sub-line */}
            <Text
                style={[
                    Type.caption,
                    {
                        color: palette.textMuted,
                        marginHorizontal: 22,
                        marginBottom: Spacing.sm,
                        marginTop: 1,
                    },
                ]}
            >
                {subLine}
            </Text>

            {/* 4-poster grid */}
            <View style={styles.grid}>
                {POSITIONS.map(pos => (
                    <TopFourPosterSlot
                        key={pos}
                        pick={pickMap.get(pos) ?? null}
                        photoUrl={photoByPosition.get(pos)?.url ?? null}
                        isOwner={isOwner}
                        onOpenEdit={isOwner ? () => onEdit(city.city) : undefined}
                        onPhotoError={photoByPosition.has(pos) ? () => {
                            const failureKey = photoByPosition.get(pos)!.failureKey;
                            setFailedPhotos((current) => new Set(current).add(failureKey));
                        } : undefined}
                    />
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingBottom: Spacing.lg,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingTop: 14,
        paddingBottom: 4,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        flexShrink: 1,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 0,
    },
    grid: {
        flexDirection: 'row',
        paddingHorizontal: 22,
        gap: 8,
        justifyContent: 'flex-start',
    },
});
