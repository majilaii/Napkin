/**
 * ChooseMemorySheet — TICKET-144 pt2. The per-slot Top-4 "choose a memory"
 * picker: a grid of the OWNER'S OWN entry photos at one restaurant (all their
 * visits). Pick one to feature as the plate's hero, or "none" to keep the
 * typographic plate.
 *
 * Consent doctrine: choosing a photo PUBLISHES it on the (public) profile — one
 * quiet line says exactly that. Nothing else from the entry is shown or exposed
 * (no note, no date, no rating). The only permissible image source is the user's
 * own entry photo (never Places, never restaurants.photo_url, never others').
 */
import React from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMyRestaurantPhotos } from '@/hooks/users/useMyRestaurantPhotos';

interface Props {
    visible: boolean;
    onClose: () => void;
    userId: string | null | undefined;
    restaurantId: string | null;
    restaurantName?: string | null;
    /** Currently-featured photo for this slot (shows a check). */
    currentPhotoId: string | null;
    /** photoUrl rides along so the caller can preview the hero without a refetch. */
    onSelect: (entryPhotoId: string | null, photoUrl: string | null) => void;
}

export function ChooseMemorySheet({
    visible,
    onClose,
    userId,
    restaurantId,
    restaurantName,
    currentPhotoId,
    onSelect,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    const { data: photos, isLoading } = useMyRestaurantPhotos(userId, visible ? restaurantId : null);

    const pick = (id: string | null, url: string | null) => {
        onSelect(id, url);
        onClose();
    };

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
                    <Pressable onPress={onClose} hitSlop={8}>
                        <Text style={[Type.body, { color: palette.textMuted }]}>Cancel</Text>
                    </Pressable>
                    <Text
                        style={[
                            Type.screenTitle,
                            { color: palette.text },
                        ]}
                        numberOfLines={1}
                    >
                        Choose a memory
                    </Text>
                    {/* Spacer to balance the Cancel label. */}
                    <View style={{ width: 48 }} />
                </View>

                {/* One quiet consent line — copy economy. */}
                <Text style={[styles.consent, { color: palette.textMuted }]}>
                    Choosing a photo publishes it on your profile.
                </Text>

                {isLoading ? (
                    <View style={styles.center}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                ) : (photos?.length ?? 0) === 0 ? (
                    <View style={styles.center}>
                        <Text style={[styles.empty, { color: palette.textMuted }]}>
                            No photos here yet — add one from this spot&apos;s entry.
                        </Text>
                    </View>
                ) : (
                    <ScrollView contentContainerStyle={styles.grid}>
                        {/* "None" → back to the typographic plate. */}
                        <Pressable
                            onPress={() => pick(null, null)}
                            style={[
                                styles.tile,
                                styles.noneTile,
                                {
                                    borderColor: currentPhotoId == null ? palette.primary : palette.outlineVariant,
                                    backgroundColor: palette.surfaceContainerLow,
                                },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="No photo — keep the typographic plate"
                        >
                            <Ionicons name="text-outline" size={22} color={palette.textMuted} />
                            <Text style={[styles.noneLabel, { color: palette.textMuted }]}>none</Text>
                            {currentPhotoId == null ? (
                                <View style={[styles.check, { backgroundColor: palette.primary }]}>
                                    <Ionicons name="checkmark" size={13} color={palette.textInverse} />
                                </View>
                            ) : null}
                        </Pressable>

                        {(photos ?? []).map((p) => {
                            const selected = p.entry_photo_id === currentPhotoId;
                            return (
                                <Pressable
                                    key={p.entry_photo_id}
                                    onPress={() => pick(p.entry_photo_id, p.photo_url)}
                                    style={[styles.tile, selected ? { borderColor: palette.primary, borderWidth: 2 } : null]}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Feature this photo of ${restaurantName ?? 'this restaurant'}`}
                                >
                                    <Image source={{ uri: p.photo_url }} style={styles.tileImage} contentFit="cover" />
                                    {selected ? (
                                        <View style={[styles.check, { backgroundColor: palette.primary }]}>
                                            <Ionicons name="checkmark" size={13} color={palette.textInverse} />
                                        </View>
                                    ) : null}
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                )}
            </View>
        </Modal>
    );
}

const GAP = 10;

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingBottom: Spacing.sm,
    },
    consent: {
        ...Type.metadata,
        marginHorizontal: 22,
        marginBottom: Spacing.lg,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 40,
    },
    empty: {
        ...Type.bodySmall,
        textAlign: 'center',
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: GAP,
        paddingHorizontal: 22,
        paddingBottom: 40,
    },
    tile: {
        width: `${(100 - 4) / 3}%`,
        aspectRatio: 1,
        borderRadius: Radius.sm,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'transparent',
    },
    tileImage: {
        width: '100%',
        height: '100%',
    },
    noneTile: {
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
    },
    noneLabel: {
        ...Type.metadata,
        fontFamily: 'Manrope_600SemiBold',
        fontWeight: '600',
        letterSpacing: 0.2,
        textTransform: 'lowercase',
    },
    check: {
        position: 'absolute',
        top: 5,
        right: 5,
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
