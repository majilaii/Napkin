/**
 * ListDetailHeader — the fixed header block at the top of `ListDetailSheet`
 * (TICKET-186). This is the peek-visible identity: cover + title + metadata in
 * row one, then context + the mutually-exclusive text action in row two. Share
 * stays available as identity-row chrome. The old "map" chip, top-bar back
 * chevron, "List" eyebrow, and byline avatar row are gone — the map is always
 * behind now, and back is a floating chevron the host owns. The list
 * description moved to the sheet body.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, IconSize, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { tintFor } from '@/lib/engraving';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import type { ListDetail, OwnerProfile } from '@/hooks/lists/useList';
import type { ContextLine } from './listHeaderUtils';

type Palette = typeof Colors.light;

const HEADER_ACTION_SIZE = IconSize.xxl;
const HEADER_ACTION_MIN_TARGET = 44;
const HEADER_ACTION_HIT_SLOP = (HEADER_ACTION_MIN_TARGET - HEADER_ACTION_SIZE) / 2;
const HEADER_ACTION_GAP = HEADER_ACTION_HIT_SLOP * 2;

export interface ListDetailHeaderProps {
    list: ListDetail;
    /** Nullable (review F5a): a missing profile renders without the byline. */
    ownerProfile: OwnerProfile | null;
    /** deriveCover(entries).photoUrl — attributed restaurant hero, else tint plate. */
    cover: string | null;
    /** deriveCover(entries).attributionLabel — null for non-Places covers. */
    coverAttribution: string | null;
    /** deriveMetadataLine(...) — "{n} places" + optional " · saved {m} times". */
    metadata: string;
    /** deriveContextLine(...) — table / private / byline, or null. */
    contextLine: ContextLine | null;
    isOwner: boolean;
    canEditEntries: boolean;
    isEditingPlaces: boolean;
    isSaved: boolean;
    canSave: boolean;
    isSavePending?: boolean;
    isSharePending?: boolean;
    onToggleEditingPlaces: () => void;
    /** ⋯ owner-settings → push /list/[id]/edit. */
    onEditSettings: () => void;
    onShare?: () => void;
    onAddSpots?: () => void;
    onToggleSaved?: () => void;
}

export function ListDetailHeader({
    list,
    ownerProfile,
    cover,
    coverAttribution,
    metadata,
    contextLine,
    isOwner,
    canEditEntries,
    isEditingPlaces,
    isSaved,
    canSave,
    isSavePending,
    isSharePending,
    onToggleEditingPlaces,
    onEditSettings,
    onShare,
    onAddSpots,
    onToggleSaved,
}: ListDetailHeaderProps) {
    const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
    const palette = Colors[scheme] as Palette;
    const router = useRouter();

    // Bind failures to the URI that emitted them. A late onError from cover A
    // must not suppress cover B after a reorder/refetch swaps the first entry.
    const [failedCover, setFailedCover] = useState<string | null>(null);
    useEffect(() => setFailedCover(null), [cover]);

    const captionAction = canEditEntries && onAddSpots
        ? {
            kind: 'add' as const,
            label: '+ add spots',
            accessibilityLabel: 'Add spots',
            onPress: onAddSpots,
            selected: false,
        }
        : canSave && onToggleSaved
            ? {
                kind: 'save' as const,
                label: isSaved ? 'saved' : 'save list',
                accessibilityLabel: isSaved ? 'Remove saved list' : 'Save list',
                onPress: onToggleSaved,
                selected: isSaved,
            }
            : null;

    const showCoverImage = !!cover && failedCover !== cover;

    return (
        <View style={styles.header}>
            <View testID="list-detail-header-identity" style={styles.identityRow}>
                <View style={[styles.cover, { backgroundColor: tintFor(list.id, palette) }]}>
                    {showCoverImage ? (
                        <Image
                            key={cover}
                            source={{ uri: cover! }}
                            style={StyleSheet.absoluteFillObject}
                            contentFit="cover"
                            recyclingKey={cover!}
                            transition={180}
                            onError={() => setFailedCover(cover!)}
                        />
                    ) : list.emoji ? (
                        <Text style={styles.coverEmoji}>{list.emoji}</Text>
                    ) : (
                        <Ionicons name="albums-outline" size={22} color={palette.textMuted} />
                    )}
                    <View
                        pointerEvents="none"
                        style={[StyleSheet.absoluteFillObject, styles.coverOutline, { borderColor: palette.imageOutline }]}
                    />
                </View>

                <View style={styles.identityCopy}>
                    <Text
                        testID="list-detail-header-title"
                        style={[styles.title, { color: palette.text }]}
                        numberOfLines={2}
                        ellipsizeMode="tail"
                    >
                        {list.title}
                    </Text>
                    <Text style={[styles.metadata, { color: palette.textMuted }]} numberOfLines={1}>
                        {metadata}
                    </Text>
                    {showCoverImage && coverAttribution ? (
                        <Text
                            testID="list-detail-cover-attribution"
                            style={[styles.coverCredit, { color: palette.textMuted }]}
                            numberOfLines={1}
                        >
                            {coverAttribution}
                        </Text>
                    ) : null}
                </View>

                <View style={styles.identityActions}>
                    {onShare ? (
                        <PressableScale
                            onPress={onShare}
                            disabled={isSharePending}
                            hitSlop={HEADER_ACTION_HIT_SLOP}
                            haptic="light"
                            style={[styles.iconButton, { opacity: isSharePending ? 0.5 : 1 }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Share ${list.title}`}
                            accessibilityState={{ busy: !!isSharePending, disabled: !!isSharePending }}
                        >
                            {isSharePending ? (
                                <ActivityIndicator size="small" color={palette.text} />
                            ) : (
                                <Ionicons name="share-outline" size={IconSize.md} color={palette.text} />
                            )}
                        </PressableScale>
                    ) : null}
                    {isOwner ? (
                        <PressableScale
                            onPress={onEditSettings}
                            hitSlop={HEADER_ACTION_HIT_SLOP}
                            haptic="selection"
                            style={styles.iconButton}
                            accessibilityRole="button"
                            accessibilityLabel="List settings"
                        >
                            <Ionicons name="ellipsis-horizontal" size={IconSize.md} color={palette.text} />
                        </PressableScale>
                    ) : null}
                    {canEditEntries ? (
                        <PressableScale
                            onPress={onToggleEditingPlaces}
                            hitSlop={HEADER_ACTION_HIT_SLOP}
                            haptic="selection"
                            style={isEditingPlaces
                                ? [styles.iconButton, { backgroundColor: palette.secondaryContainer }]
                                : styles.iconButton}
                            accessibilityRole="button"
                            accessibilityLabel={isEditingPlaces ? 'Finish editing places' : 'Edit places'}
                        >
                            <Ionicons
                                name={isEditingPlaces ? 'checkmark' : 'create-outline'}
                                size={IconSize.md}
                                color={isEditingPlaces ? palette.text : palette.textMuted}
                            />
                        </PressableScale>
                    ) : null}
                </View>
            </View>

            {contextLine || captionAction ? (
                <View testID="list-detail-header-caption-row" style={styles.captionRow}>
                    <View style={styles.contextSlot}>
                        {contextLine ? (
                            <ContextLineRow
                                line={contextLine}
                                palette={palette}
                                onOpenProfile={(handle) => router.push(`/u/${handle}`)}
                                ownerName={ownerProfile?.display_name ?? ownerProfile?.username ?? 'Unknown'}
                            />
                        ) : null}
                    </View>

                    {captionAction ? (
                        <PressableScale
                            onPress={captionAction.onPress}
                            disabled={captionAction.kind === 'save' && isSavePending}
                            haptic="medium"
                            style={styles.captionAction}
                            accessibilityRole="button"
                            accessibilityLabel={captionAction.accessibilityLabel}
                            accessibilityState={captionAction.kind === 'save'
                                ? {
                                    selected: captionAction.selected,
                                    busy: !!isSavePending,
                                    disabled: !!isSavePending,
                                }
                                : undefined}
                        >
                            {captionAction.kind === 'save' && isSavePending ? (
                                <ActivityIndicator size="small" color={palette.primary} />
                            ) : (
                                <Text style={[styles.captionActionLabel, { color: palette.primary }]}>
                                    {captionAction.label}
                                </Text>
                            )}
                        </PressableScale>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

function ContextLineRow({
    line,
    palette,
    onOpenProfile,
    ownerName,
}: {
    line: ContextLine;
    palette: Palette;
    onOpenProfile: (handle: string) => void;
    ownerName: string;
}) {
    if (line.kind === 'byline') {
        const tappable = !!line.profileHandle;
        return (
            <PressableScale
                onPress={tappable ? () => onOpenProfile(line.profileHandle!) : undefined}
                disabled={!tappable}
                style={styles.contextRow}
                accessibilityRole={tappable ? 'button' : undefined}
                accessibilityLabel={tappable ? `Open ${ownerName}'s profile` : undefined}
            >
                <Text style={[styles.contextText, { color: palette.textMuted }]} numberOfLines={1}>
                    {line.text}
                </Text>
            </PressableScale>
        );
    }
    const icon = line.kind === 'table' ? 'people-outline' : 'lock-closed-outline';
    return (
        <View style={styles.contextRow}>
            <Ionicons name={icon} size={14} color={palette.textMuted} />
            <Text style={[styles.contextText, { color: palette.textMuted }]} numberOfLines={1}>
                {line.text}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        paddingHorizontal: Spacing.md,
        paddingBottom: Spacing.sm,
    },
    identityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    cover: {
        width: 44,
        height: 44,
        borderRadius: Radius.md,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    coverEmoji: { fontSize: 22 },
    coverOutline: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: Radius.md,
    },
    identityCopy: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontFamily: 'Newsreader_700Bold',
        fontSize: 24,
        lineHeight: 28,
        letterSpacing: -0.4,
    },
    metadata: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        marginTop: 2,
        fontVariant: ['tabular-nums'],
    },
    coverCredit: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        lineHeight: 14,
        marginTop: 2,
        opacity: 0.85,
    },
    identityActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: HEADER_ACTION_GAP,
        paddingHorizontal: HEADER_ACTION_HIT_SLOP,
        paddingVertical: HEADER_ACTION_HIT_SLOP,
        marginHorizontal: -HEADER_ACTION_HIT_SLOP,
        flexShrink: 0,
    },
    iconButton: {
        width: HEADER_ACTION_SIZE,
        height: HEADER_ACTION_SIZE,
        borderRadius: HEADER_ACTION_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    captionRow: {
        minHeight: HEADER_ACTION_MIN_TARGET,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    contextSlot: {
        flex: 1,
        minWidth: 0,
    },
    captionAction: {
        minHeight: HEADER_ACTION_MIN_TARGET,
        flexShrink: 0,
        justifyContent: 'center',
        paddingHorizontal: Spacing.xs,
    },
    captionActionLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        lineHeight: 18,
    },
    contextRow: {
        minHeight: HEADER_ACTION_MIN_TARGET,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    contextText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13, // metadata floor (review G5)
        flexShrink: 1,
    },
});
