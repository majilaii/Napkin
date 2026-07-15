/**
 * ListDetailHeader — the fixed header block at the top of `ListDetailSheet`
 * (TICKET-186). This is the peek-visible identity: cover + title + metadata +
 * the mutually-exclusive primary action (+ share) + the conditional context
 * line. The old "map" chip, top-bar back chevron, "List" eyebrow, and byline
 * avatar row are gone — the map is always behind now, and back is a floating
 * chevron the host owns. The list description moved to the sheet body.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { tintFor } from '@/lib/engraving';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import type { ListDetail, OwnerProfile } from '@/hooks/lists/useList';
import type { ContextLine } from './listHeaderUtils';

type Palette = typeof Colors.light;

export interface ListDetailHeaderProps {
    list: ListDetail;
    /** Nullable (review F5a): a missing profile renders without the byline. */
    ownerProfile: OwnerProfile | null;
    /** deriveCover(entries) — first entry photo, else the emoji plate. */
    cover: string | null;
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

    // Codex #13: the failed-image state resets when the derived cover changes, so
    // a reorder/add that swaps the first entry re-attempts loading the new cover.
    const [imageFailed, setImageFailed] = useState(false);
    useEffect(() => setImageFailed(false), [cover]);

    const primaryAction = canEditEntries && onAddSpots
        ? { label: 'Add spots', icon: 'add' as const, onPress: onAddSpots, saved: false }
        : canSave && onToggleSaved
            ? {
                label: isSaved ? 'Saved' : 'Save list',
                icon: isSaved ? 'bookmark' as const : 'bookmark-outline' as const,
                onPress: onToggleSaved,
                saved: isSaved,
            }
            : null;

    const showCoverImage = !!cover && !imageFailed;

    return (
        <View style={styles.header}>
            <View style={styles.identityRow}>
                <View style={[styles.cover, { backgroundColor: tintFor(list.id, palette) }]}>
                    {showCoverImage ? (
                        <Image
                            source={{ uri: cover! }}
                            style={StyleSheet.absoluteFillObject}
                            contentFit="cover"
                            transition={180}
                            onError={() => setImageFailed(true)}
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
                    <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                        {list.title}
                    </Text>
                    <Text style={[styles.metadata, { color: palette.textMuted }]} numberOfLines={1}>
                        {metadata}
                    </Text>
                </View>

                <View style={styles.identityActions}>
                    {isOwner ? (
                        <PressableScale
                            onPress={onEditSettings}
                            haptic="selection"
                            style={styles.iconButton}
                            accessibilityRole="button"
                            accessibilityLabel="List settings"
                        >
                            <Ionicons name="ellipsis-horizontal" size={20} color={palette.text} />
                        </PressableScale>
                    ) : null}
                    {canEditEntries ? (
                        <PressableScale
                            onPress={onToggleEditingPlaces}
                            haptic="selection"
                            style={isEditingPlaces
                                ? [styles.iconButton, { backgroundColor: palette.secondaryContainer }]
                                : styles.iconButton}
                            accessibilityRole="button"
                            accessibilityLabel={isEditingPlaces ? 'Finish editing places' : 'Edit places'}
                        >
                            <Ionicons
                                name={isEditingPlaces ? 'checkmark' : 'create-outline'}
                                size={19}
                                color={isEditingPlaces ? palette.text : palette.textMuted}
                            />
                        </PressableScale>
                    ) : null}
                </View>
            </View>

            {primaryAction || onShare ? (
                <View style={styles.actionsRow}>
                    {primaryAction ? (
                        <PressableScale
                            onPress={primaryAction.onPress}
                            disabled={isSavePending}
                            haptic="medium"
                            style={[
                                styles.primaryButton,
                                Shadow.subtle,
                                { backgroundColor: primaryAction.saved ? palette.secondaryContainer : palette.primary },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={primaryAction.label}
                        >
                            {isSavePending ? (
                                <ActivityIndicator
                                    size="small"
                                    color={primaryAction.saved ? palette.text : palette.textInverse}
                                />
                            ) : (
                                <Ionicons
                                    name={primaryAction.icon}
                                    size={19}
                                    color={primaryAction.saved ? palette.text : palette.textInverse}
                                />
                            )}
                            <Text
                                style={[
                                    styles.primaryLabel,
                                    { color: primaryAction.saved ? palette.text : palette.textInverse },
                                ]}
                            >
                                {primaryAction.label}
                            </Text>
                        </PressableScale>
                    ) : null}

                    {onShare ? (
                        <PressableScale
                            onPress={onShare}
                            disabled={isSharePending}
                            haptic="light"
                            style={[styles.shareButton, { backgroundColor: palette.surfaceContainerHigh }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Share ${list.title}`}
                        >
                            {isSharePending ? (
                                <ActivityIndicator size="small" color={palette.text} />
                            ) : (
                                <Ionicons name="share-outline" size={20} color={palette.text} />
                            )}
                        </PressableScale>
                    ) : null}
                </View>
            ) : null}

            {contextLine ? (
                <ContextLineRow
                    line={contextLine}
                    palette={palette}
                    onOpenProfile={(handle) => router.push(`/u/${handle}`)}
                    ownerName={ownerProfile?.display_name ?? ownerProfile?.username ?? 'Unknown'}
                />
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
        gap: 10,
    },
    identityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
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
    identityActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        flexShrink: 0,
    },
    iconButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    primaryButton: {
        flex: 1,
        minHeight: 48,
        borderRadius: Radius.lg,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingHorizontal: Spacing.md,
    },
    primaryLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 14,
    },
    shareButton: {
        width: 48,
        height: 48,
        borderRadius: Radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
    },
    contextRow: {
        minHeight: 24,
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
