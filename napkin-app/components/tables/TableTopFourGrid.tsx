/**
 * TableTopFourGrid — display component for a Table's Top 4 anchor restaurants.
 *
 * Spec (TICKET-046):
 *   - Section header: "THE TABLE'S TOP 4" kicker + right-aligned "EDIT" pill
 *   - Subtitle: italic "Four places. Anywhere in the world. Anyone can edit."
 *   - 4-column poster grid (3:4 aspect, gap 8, marginHorizontal 22)
 *   - Filled tiles: photo + Newsreader italic name + Manrope city
 *   - Empty slots in partial state: dashed terracotta tiles (tappable → edit sheet)
 *   - Last-edit attribution row (with 60-second self-attribution suppression)
 *
 * Returns null when slots.length === 0 (caller shows TableTopFourPlaceholder instead).
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    Image,
    useWindowDimensions,
} from 'react-native';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { resolveTilePhoto } from '@/lib/restaurantPhoto';
import type { TopFourSlot, TopFourLastEvent } from '@/hooks/tables/useTableTopFour';

type Palette = typeof Colors.light;

// ── Helpers ────────────────────────────────────────────────────────────────────

function relativeTimeShort(dateStr: string): string {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffS = Math.floor(diffMs / 1_000);
    const diffM = Math.floor(diffMs / 60_000);
    const diffH = Math.floor(diffMs / 3_600_000);
    const diffD = Math.floor(diffMs / 86_400_000);
    const diffW = Math.floor(diffD / 7);
    const diffMo = Math.floor(diffD / 30);
    const diffY = Math.floor(diffD / 365);

    if (diffS < 60) return 'just now';
    if (diffM < 60) return `${diffM}m ago`;
    if (diffH < 24) return `${diffH}h ago`;
    if (diffD < 7) return `${diffD}d ago`;
    if (diffW < 5) return `${diffW}w ago`;
    if (diffMo < 12) return `${diffMo}mo ago`;
    return `${diffY}y ago`;
}

function buildAttributionCopy(
    event: TopFourLastEvent,
    actorLabel: string,
): string {
    const time = relativeTimeShort(event.created_at);
    switch (event.event_type) {
        case 'added':
            return `${actorLabel} added ${event.next_restaurant?.name ?? 'a restaurant'} · ${time}`;
        case 'removed':
            return `${actorLabel} removed ${event.prev_restaurant?.name ?? 'a restaurant'} · ${time}`;
        case 'swapped':
            return `${actorLabel} swapped ${event.prev_restaurant?.name ?? 'a restaurant'} for ${event.next_restaurant?.name ?? 'a restaurant'} · ${time}`;
    }
}

// ── Tile components ────────────────────────────────────────────────────────────

interface FilledTileProps {
    slot: TopFourSlot;
    tileWidth: number;
    palette: Palette;
    onPress: () => void;
}

function FilledTile({ slot, tileWidth, palette, onPress }: FilledTileProps) {
    const [imgError, setImgError] = useState(false);
    const tileHeight = (tileWidth * 4) / 3;

    const photo = resolveTilePhoto({
        custom_photo_url: slot.custom_photo_url,
        primary_photo_url: slot.restaurant?.photo_url,
        restaurant_name: slot.restaurant?.name,
    });

    const showGhost = photo.kind === 'ghost' || imgError;

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={`Edit Top 4 — position ${slot.position}: ${slot.restaurant?.name ?? 'restaurant'}`}
        >
            <View
                style={[
                    styles.tile,
                    {
                        width: tileWidth,
                        height: tileHeight,
                        backgroundColor: palette.surfaceContainerHigh,
                        borderRadius: Radius.sm,
                        overflow: 'hidden',
                    },
                ]}
            >
                {showGhost ? (
                    <View
                        style={[
                            styles.ghostTile,
                            { backgroundColor: palette.surfaceJournalHi },
                        ]}
                    >
                        <Text
                            style={[styles.ghostInitial, { color: palette.textMuted }]}
                        >
                            {photo.kind === 'ghost' ? photo.initial : '?'}
                        </Text>
                    </View>
                ) : (
                    <Image
                        source={{ uri: (photo as any).url }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="cover"
                        onError={() => setImgError(true)}
                    />
                )}

                {/* Bottom label overlay */}
                <View style={[styles.tileOverlay, { backgroundColor: palette.scrimDark }]}>
                    <Text
                        style={[styles.tileName, { color: palette.textOnImage }]}
                        numberOfLines={2}
                    >
                        {slot.restaurant?.name ?? ''}
                    </Text>
                    {slot.restaurant?.city ? (
                        <Text
                            style={[styles.tileCity, { color: palette.textOnImage }]}
                            numberOfLines={1}
                        >
                            {slot.restaurant.city}
                        </Text>
                    ) : slot.restaurant?.country ? (
                        <Text
                            style={[styles.tileCity, { color: palette.textOnImage }]}
                            numberOfLines={1}
                        >
                            {slot.restaurant.country}
                        </Text>
                    ) : null}
                </View>
            </View>
        </Pressable>
    );
}

interface EmptySlotTileProps {
    position: 1 | 2 | 3 | 4;
    tileWidth: number;
    palette: Palette;
    onPress: () => void;
}

function EmptySlotTile({ position, tileWidth, palette, onPress }: EmptySlotTileProps) {
    const tileHeight = (tileWidth * 4) / 3;
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [{ opacity: pressed ? 0.72 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={`Add restaurant to Top 4 position ${position}`}
        >
            <View
                style={[
                    styles.tile,
                    styles.emptySlot,
                    {
                        width: tileWidth,
                        height: tileHeight,
                        backgroundColor: palette.terracottaScrim,
                        borderColor: palette.terracottaBorder,
                    },
                ]}
            />
        </Pressable>
    );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface TableTopFourGridProps {
    slots: TopFourSlot[];
    lastEvent: TopFourLastEvent | null;
    currentUserId: string | null | undefined;
    onEdit: () => void;
    onTapEmptySlot: (position: 1 | 2 | 3 | 4) => void;
    palette: Palette;
}

export function TableTopFourGrid({
    slots,
    lastEvent,
    currentUserId,
    onEdit,
    onTapEmptySlot,
    palette,
}: TableTopFourGridProps) {
    const { width: screenWidth } = useWindowDimensions();

    // Return null for 0/4 — caller shows the placeholder instead
    if (slots.length === 0) return null;

    // Compute tile width: marginHorizontal 22 each side, gap 8 between 4 tiles
    const containerWidth = screenWidth - 44;
    const tileWidth = Math.floor((containerWidth - 8 * 3) / 4);

    // Build the 4-slot grid (position 1–4), filling empties
    const slotMap = new Map(slots.map((s) => [s.position, s]));
    const positions: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];

    // ── Attribution row logic ──────────────────────────────────────────────────
    let attributionCopy: string | null = null;
    let attributionAvatarUrl: string | null = null;

    if (lastEvent) {
        const now = Date.now();
        const eventAge = now - new Date(lastEvent.created_at).getTime();
        const isSelfEvent = lastEvent.actor_id === currentUserId;
        const within60s = eventAge < 60_000;

        // Suppress self-attribution within the first 60 seconds
        if (!(isSelfEvent && within60s)) {
            const actorLabel = isSelfEvent ? 'You' : (lastEvent.actor_name ?? 'Someone');
            attributionCopy = buildAttributionCopy(lastEvent, actorLabel);
            attributionAvatarUrl = lastEvent.actor_avatar_url;
        }
    }

    return (
        <View style={styles.container}>
            {/* Warm rule above section */}
            <View style={styles.ruleRow}>
                <View style={[styles.rule, { backgroundColor: palette.ruleWarmNib }]} />
            </View>

            {/* Header row: kicker + EDIT pill */}
            <View style={styles.headerRow}>
                <Text style={[styles.kicker, { color: palette.textMuted }]}>
                    THE TABLE&rsquo;S TOP 4
                </Text>
                <Pressable
                    onPress={onEdit}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Edit Top 4"
                >
                    <Text style={[styles.editPill, { color: palette.primary }]}>
                        EDIT
                    </Text>
                </Pressable>
            </View>

            {/* Italic subtitle */}
            <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
                Four places. Anywhere in the world. Anyone can edit.
            </Text>

            {/* 4-column poster grid */}
            <View style={styles.grid}>
                {positions.map((pos) => {
                    const slot = slotMap.get(pos);
                    if (slot) {
                        return (
                            <FilledTile
                                key={pos}
                                slot={slot}
                                tileWidth={tileWidth}
                                palette={palette}
                                onPress={onEdit}
                            />
                        );
                    }
                    return (
                        <EmptySlotTile
                            key={pos}
                            position={pos}
                            tileWidth={tileWidth}
                            palette={palette}
                            onPress={() => onTapEmptySlot(pos)}
                        />
                    );
                })}
            </View>

            {/* Attribution row */}
            {attributionCopy ? (
                <View style={styles.attributionRow}>
                    {attributionAvatarUrl ? (
                        <Image
                            source={{ uri: attributionAvatarUrl }}
                            style={[styles.attributionAvatar, { borderColor: palette.outlineVariant }]}
                        />
                    ) : (
                        <View
                            style={[
                                styles.attributionAvatar,
                                { backgroundColor: palette.surfaceContainerHigh },
                            ]}
                        />
                    )}
                    <Text
                        style={[styles.attributionText, { color: palette.textMuted }]}
                        numberOfLines={2}
                    >
                        {attributionCopy}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        marginTop: Spacing.lg,
        paddingBottom: Spacing.sm,
    },
    ruleRow: {
        alignItems: 'center',
        marginBottom: Spacing.md,
    },
    rule: {
        width: 40,
        height: 1,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginHorizontal: 22,
        marginBottom: Spacing.xs,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.6,
    },
    editPill: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.2,
    },
    subtitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 14,
        lineHeight: 20,
        marginHorizontal: 22,
        marginBottom: Spacing.sm,
    },
    grid: {
        flexDirection: 'row',
        marginHorizontal: 22,
        gap: 8,
    },
    tile: {
        borderRadius: Radius.sm,
        overflow: 'hidden',
    },
    emptySlot: {
        borderWidth: 1,
        borderStyle: 'dashed',
    },
    ghostTile: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ghostInitial: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 22,
    },
    tileOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 5,
        paddingTop: 8,
        paddingBottom: 6,
    },
    tileName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 13,
        lineHeight: 16,
    },
    tileCity: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        lineHeight: 14,
        marginTop: 2,
    },
    attributionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginHorizontal: 22,
        marginTop: 10,
    },
    attributionAvatar: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 1,
        flexShrink: 0,
    },
    attributionText: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        lineHeight: 16,
        flex: 1,
    },
});
