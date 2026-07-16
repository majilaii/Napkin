/**
 * EditTopFourSheet — full-screen modal for picking & ordering a personal Top 4.
 * TICKET-047
 *
 * Top: 4 ordered slots (DraggableFlatList for reorder).
 * Below: scrollable list of EligibleRestaurantRow from useEligibleRestaurantsForCity.
 *
 * Save → useClaimCity (if city not yet claimed) or useUpdatePicks.
 * Save disabled when 0 picks (use unclaim path).
 * Cancel with unsaved diff → "Discard changes?"
 *
 * Drag-reorder: react-native-draggable-flatlist (already in package.json).
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    StyleSheet,
    Alert,
    ActivityIndicator,
    ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image as ExpoImage } from 'expo-image';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useEligibleRestaurantsForCity } from '@/hooks/top-fours/useEligibleRestaurantsForCity';
import { useClaimCity } from '@/hooks/top-fours/useClaimCity';
import { useUpdatePicks } from '@/hooks/top-fours/useUpdatePicks';
import { EligibleRestaurantRow } from './EligibleRestaurantRow';
import type { EligibleRestaurant } from '@/hooks/top-fours/useEligibleRestaurantsForCity';
import type { TopFourPick } from '@/hooks/top-fours/useTopFours';
import { PlacesCredit, resolveSourcedPhoto } from '@/components/ui/PlacesCredit';

// ── Types ──────────────────────────────────────────────────────────────────

interface DraftItem {
    key: string; // restaurant_id used as key
    restaurant_id: string;
    name: string;
    photo_url: string | null;
    photo_source?: 'user' | 'table' | 'places' | 'none' | null;
    places_photo_attribution_html?: string | null;
}

interface Props {
    visible: boolean;
    onClose: () => void;
    city: string;
    isClaimed: boolean;                     // false = first claim
    currentPicks: TopFourPick[];
}

// ── Slot list (draggable) ──────────────────────────────────────────────────

interface SlotItemProps {
    item: DraftItem;
    index: number;
    drag: () => void;
    isActive: boolean;
    palette: typeof Colors.light;
    photoUrl: string | null;
    onRemove: (id: string) => void;
    onPhotoError?: () => void;
}

function SlotItem({
    item,
    index,
    drag,
    isActive,
    palette,
    photoUrl,
    onRemove,
    onPhotoError,
}: SlotItemProps) {
    return (
        <ScaleDecorator>
            <Pressable
                onLongPress={drag}
                disabled={isActive}
                style={[
                    styles.slotRow,
                    {
                        backgroundColor: isActive
                            ? palette.surfaceContainerLow
                            : palette.card,
                        borderColor: palette.dividerSoft,
                    },
                ]}
            >
                {/* Position number */}
                <Text style={[Type.rating, { fontSize: 18, color: palette.textMuted, width: 20, textAlign: 'center' }]}>
                    {index + 1}
                </Text>

                {/* Thumbnail */}
                <View
                    style={[
                        styles.slotThumb,
                        { backgroundColor: palette.surfaceJournalHi, borderRadius: Radius.sm },
                    ]}
                >
                    {photoUrl ? (
                        <ExpoImage
                            source={{ uri: photoUrl }}
                            style={StyleSheet.absoluteFill}
                            contentFit="cover"
                            onError={onPhotoError}
                        />
                    ) : null}
                </View>

                {/* Name */}
                <Text
                    style={[
                        Type.headlineItalic,
                        {
                            fontFamily: 'Newsreader_400Regular_Italic',
                            fontStyle: 'italic',
                            fontSize: 15,
                            color: palette.text,
                            flex: 1,
                        },
                    ]}
                    numberOfLines={1}
                >
                    {item.name}
                </Text>

                {/* Drag handle hint */}
                <Text style={[Type.caption, { color: palette.textMuted, marginRight: Spacing.sm }]}>⠿</Text>

                {/* Remove */}
                <Pressable
                    onPress={() => onRemove(item.restaurant_id)}
                    hitSlop={8}
                    accessibilityLabel={`Remove ${item.name}`}
                >
                    <Text style={[Type.caption, { color: palette.textMuted, fontSize: 18 }]}>×</Text>
                </Pressable>
            </Pressable>
        </ScaleDecorator>
    );
}

// ── EditTopFourSheet ───────────────────────────────────────────────────────

export function EditTopFourSheet({ visible, onClose, city, isClaimed, currentPicks }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    const claimCity = useClaimCity();
    const updatePicks = useUpdatePicks();

    const { data: eligible, isLoading: eligibleLoading } =
        useEligibleRestaurantsForCity(user?.id, city || null);

    // Draft: ordered list of picked restaurants
    const [draft, setDraft] = useState<DraftItem[]>([]);
    const [failedPhotoKeys, setFailedPhotoKeys] = useState<Set<string>>(() => new Set());

    // Reset draft when sheet opens
    useEffect(() => {
        if (visible) {
            const initial = currentPicks
                .sort((a, b) => a.position - b.position)
                .map(p => ({
                    key: p.restaurant.id,
                    restaurant_id: p.restaurant.id,
                    name: p.restaurant.name,
                    photo_url: p.restaurant.photo_url,
                    photo_source: p.restaurant.photo_source,
                    places_photo_attribution_html: p.restaurant.places_photo_attribution_html,
                }));
            setDraft(initial);
            setFailedPhotoKeys(new Set());
        }
    }, [visible, currentPicks]);

    const pickedIds = useMemo(() => new Set(draft.map(d => d.restaurant_id)), [draft]);

    const hasDiff = useMemo(() => {
        if (draft.length !== currentPicks.length) return true;
        const sortedCurrent = [...currentPicks].sort((a, b) => a.position - b.position);
        return draft.some((d, i) => d.restaurant_id !== sortedCurrent[i]?.restaurant.id);
    }, [draft, currentPicks]);

    const canSave = draft.length >= 1 && hasDiff;

    const handleAdd = useCallback((restaurant: EligibleRestaurant) => {
        if (pickedIds.has(restaurant.restaurant_id)) return;
        if (draft.length >= 4) return;
        setDraft(prev => [
            ...prev,
            {
                key: restaurant.restaurant_id,
                restaurant_id: restaurant.restaurant_id,
                name: restaurant.name,
                photo_url: restaurant.photo_url,
                photo_source: restaurant.photo_source,
                places_photo_attribution_html: restaurant.places_photo_attribution_html,
            },
        ]);
    }, [pickedIds, draft.length]);

    const handleRemove = useCallback((id: string) => {
        setDraft(prev => prev.filter(d => d.restaurant_id !== id));
    }, []);

    const handleDragEnd = useCallback(({ data }: { data: DraftItem[] }) => {
        setDraft(data);
    }, []);

    const handleSave = useCallback(async () => {
        if (!canSave) return;
        const picks = draft.map((d, i) => ({
            position: (i + 1) as 1 | 2 | 3 | 4,
            restaurant_id: d.restaurant_id,
        }));

        try {
            if (isClaimed) {
                await updatePicks.mutateAsync({ city, picks });
            } else {
                await claimCity.mutateAsync({ city, picks });
            }
            onClose();
        } catch {
            Alert.alert('Could not save', 'Please try again.');
        }
    }, [canSave, draft, city, isClaimed, claimCity, updatePicks, onClose]);

    const handleCancel = useCallback(() => {
        if (hasDiff) {
            Alert.alert(
                'Discard changes?',
                'Your edits will be lost.',
                [
                    { text: 'Keep editing', style: 'cancel' },
                    { text: 'Discard', style: 'destructive', onPress: onClose },
                ],
            );
        } else {
            onClose();
        }
    }, [hasDiff, onClose]);

    const isPending = claimCity.isPending || updatePicks.isPending;

    const draftPhotos = useMemo(() => new Map(draft.map((item) => {
        const photo = resolveSourcedPhoto({
            url: item.photo_url,
            photoSource: item.photo_source,
            attributionHtml: item.places_photo_attribution_html,
            restaurantName: item.name,
        });
        const failureKey = `draft:${item.key}:${photo.url ?? ''}`;
        return [item.key, {
            url: photo.url && !failedPhotoKeys.has(failureKey) ? photo.url : null,
            credit: photo.url && !failedPhotoKeys.has(failureKey) ? photo.credit : null,
            failureKey,
        }] as const;
    })), [draft, failedPhotoKeys]);
    const eligiblePhotos = useMemo(() => new Map((eligible ?? []).map((item) => {
        const photo = resolveSourcedPhoto({
            url: item.photo_url,
            photoSource: item.photo_source,
            attributionHtml: item.places_photo_attribution_html,
            restaurantName: item.name,
        });
        const failureKey = `eligible:${item.restaurant_id}:${photo.url ?? ''}`;
        return [item.restaurant_id, {
            url: photo.url && !failedPhotoKeys.has(failureKey) ? photo.url : null,
            credit: photo.url && !failedPhotoKeys.has(failureKey) ? photo.credit : null,
            failureKey,
        }] as const;
    })), [eligible, failedPhotoKeys]);
    const renderedPlacesPhotos = [
        ...draftPhotos.values(),
        ...eligiblePhotos.values(),
    ].filter((photo) => photo.url && photo.credit);

    const markPhotoFailed = useCallback((failureKey: string) => {
        setFailedPhotoKeys((current) => new Set(current).add(failureKey));
    }, []);

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={handleCancel}
        >
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {/* Header */}
                <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
                    <Pressable onPress={handleCancel} hitSlop={8}>
                        <Text style={[Type.body, { color: palette.textMuted }]}>Cancel</Text>
                    </Pressable>
                    <Text
                        style={[
                            Type.headlineItalic,
                            {
                                fontFamily: 'Newsreader_400Regular_Italic',
                                fontStyle: 'italic',
                                fontSize: 18,
                                color: palette.text,
                            },
                        ]}
                    >
                        {city}
                    </Text>
                    <Pressable
                        onPress={handleSave}
                        hitSlop={8}
                        disabled={!canSave || isPending}
                    >
                        {isPending ? (
                            <ActivityIndicator color={palette.primary} size="small" />
                        ) : (
                            <Text
                                style={[
                                    Type.body,
                                    {
                                        color: canSave ? palette.primary : palette.textMuted,
                                        fontFamily: 'Manrope_700Bold',
                                    },
                                ]}
                            >
                                Save
                            </Text>
                        )}
                    </Pressable>
                </View>

                {/* Subtitle */}
                <Text
                    style={[
                        Type.bodySmall,
                        {
                            color: palette.textMuted,
                            fontFamily: 'Newsreader_400Regular_Italic',
                            fontStyle: 'italic',
                            marginHorizontal: 22,
                            marginBottom: Spacing.sm,
                        },
                    ]}
                >
                    {isClaimed
                        ? 'Drag to reorder. Tap + to swap.'
                        : 'Pick up to 4. You can always edit later.'}
                </Text>

                {renderedPlacesPhotos.length > 0 ? (
                    <PlacesCredit
                        credits={renderedPlacesPhotos.map((photo) => photo.credit)}
                        photoCount={renderedPlacesPhotos.length}
                        testID="regional-top-four-editor-places-credit"
                        style={styles.placesCredit}
                    />
                ) : null}

                {/* Draft slots (draggable) */}
                <View style={[styles.slotsSection, { borderBottomColor: palette.dividerSoft }]}>
                    {draft.length === 0 ? (
                        <View style={styles.emptyDraft}>
                            <Text style={[Type.bodySmall, { color: palette.textMuted }]}>
                                Tap restaurants below to add them
                            </Text>
                        </View>
                    ) : (
                        <DraggableFlatList
                            data={draft}
                            onDragEnd={handleDragEnd}
                            keyExtractor={item => item.key}
                            renderItem={({ item, drag, isActive, getIndex }) => (
                                <SlotItem
                                    item={item}
                                    index={getIndex() ?? 0}
                                    drag={drag}
                                    isActive={isActive}
                                    palette={palette}
                                    photoUrl={draftPhotos.get(item.key)?.url ?? null}
                                    onRemove={handleRemove}
                                    onPhotoError={() => {
                                        const failureKey = draftPhotos.get(item.key)?.failureKey;
                                        if (failureKey) markPhotoFailed(failureKey);
                                    }}
                                />
                            )}
                            scrollEnabled={false}
                            containerStyle={{ maxHeight: 4 * 60 }}
                        />
                    )}

                    {/* Slot count indicator */}
                    <Text
                        style={[
                            Type.labelSmall,
                            { color: palette.textMuted, margin: Spacing.sm, textAlign: 'center' },
                        ]}
                    >
                        {draft.length} / 4 selected
                    </Text>
                </View>

                {/* Eligible restaurants list */}
                <Text style={[Type.labelSmall, { color: palette.textMuted, marginHorizontal: 22, marginTop: Spacing.md, marginBottom: Spacing.xs }]}>
                    YOUR LOGS IN {city.toUpperCase()}
                </Text>

                {eligibleLoading ? (
                    <ActivityIndicator color={palette.primary} style={{ marginTop: Spacing.xl }} />
                ) : (
                    <ScrollView
                        style={{ flex: 1 }}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
                    >
                        {(eligible ?? []).map(r => (
                            <EligibleRestaurantRow
                                key={r.restaurant_id}
                                restaurant={r}
                                photoUrl={eligiblePhotos.get(r.restaurant_id)?.url ?? null}
                                isSelected={pickedIds.has(r.restaurant_id)}
                                onPhotoError={() => {
                                    const failureKey = eligiblePhotos.get(r.restaurant_id)?.failureKey;
                                    if (failureKey) markPhotoFailed(failureKey);
                                }}
                                onPress={
                                    draft.length < 4 || pickedIds.has(r.restaurant_id)
                                        ? handleAdd
                                        : () => {}
                                }
                            />
                        ))}
                        {(eligible ?? []).length === 0 && (
                            <Text
                                style={[
                                    Type.bodySmall,
                                    {
                                        color: palette.textMuted,
                                        textAlign: 'center',
                                        paddingHorizontal: Spacing.xl,
                                        paddingTop: Spacing.xl,
                                    },
                                ]}
                            >
                                No logged restaurants found in {city}.
                            </Text>
                        )}
                    </ScrollView>
                )}
            </View>
        </Modal>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingBottom: Spacing.sm,
    },
    slotsSection: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        marginHorizontal: 22,
        paddingBottom: Spacing.xs,
    },
    placesCredit: {
        marginHorizontal: 22,
        marginBottom: Spacing.sm,
    },
    slotRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: Spacing.sm,
        borderRadius: Radius.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: Spacing.sm,
        marginBottom: 4,
        ...Shadow.clip,
    },
    slotThumb: {
        width: 40,
        height: 40,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    emptyDraft: {
        paddingVertical: Spacing.md,
        alignItems: 'center',
    },
});
