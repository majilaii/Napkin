import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import type { ListDetail, OwnerProfile } from '@/hooks/lists/useList';

type Palette = typeof Colors.light;

interface Props {
    list: ListDetail;
    entryCount: number;
    saveCount: number;
    ownerProfile: OwnerProfile;
    isOwner: boolean;
    canEditEntries: boolean;
    isSaved: boolean;
    canSave: boolean;
    isEditingPlaces: boolean;
    topInset: number;
    isSavePending?: boolean;
    isSharePending?: boolean;
    onBack: () => void;
    onOpenMap: () => void;
    onToggleEditingPlaces: () => void;
    onEdit: () => void;
    onShare?: () => void;
    onAddSpots?: () => void;
    onToggleSaved?: () => void;
}

export function ListDetailHeader({
    list,
    entryCount,
    saveCount,
    ownerProfile,
    isOwner,
    canEditEntries,
    isSaved,
    canSave,
    isEditingPlaces,
    topInset,
    isSavePending,
    isSharePending,
    onBack,
    onOpenMap,
    onToggleEditingPlaces,
    onEdit,
    onShare,
    onAddSpots,
    onToggleSaved,
}: Props) {
    const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
    const palette = Colors[scheme] as Palette;
    const router = useRouter();
    const { user } = useAuth();

    const authorName = ownerProfile.display_name ?? ownerProfile.username ?? 'Unknown';
    const authorIdentifier = isOwner
        ? user?.id
        : ownerProfile.account_privacy === 'public' && ownerProfile.username
            ? ownerProfile.username
            : null;

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

    const metadata = [
        `${entryCount} ${entryCount === 1 ? 'place' : 'places'}`,
        saveCount > 0 ? `${saveCount} ${saveCount === 1 ? 'save' : 'saves'}` : null,
    ].filter(Boolean).join(' · ');

    return (
        <View
            style={[
                styles.header,
                {
                    backgroundColor: palette.background,
                    paddingTop: topInset + Spacing.sm,
                },
            ]}
        >
            <View style={styles.topBar}>
                <PressableScale
                    onPress={onBack}
                    haptic="selection"
                    style={[styles.topButton, { backgroundColor: palette.surfaceContainerLow }]}
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                >
                    <Ionicons name="chevron-back" size={21} color={palette.text} style={styles.backIcon} />
                </PressableScale>

                <Text style={[styles.eyebrow, { color: palette.textMuted }]}>List</Text>

                {isOwner ? (
                    <PressableScale
                        onPress={onEdit}
                        haptic="selection"
                        style={[styles.topButton, { backgroundColor: palette.surfaceContainerLow }]}
                        accessibilityRole="button"
                        accessibilityLabel="List settings"
                    >
                        <Ionicons name="ellipsis-horizontal" size={21} color={palette.text} />
                    </PressableScale>
                ) : <View style={styles.topButton} />}
            </View>

            <View style={styles.titleRow}>
                {list.emoji ? (
                    <View style={[styles.emojiTile, { backgroundColor: palette.secondaryContainer }]}>
                        <Text style={styles.emoji}>{list.emoji}</Text>
                    </View>
                ) : null}
                <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
                    {list.title}
                </Text>
            </View>

            <View style={styles.bylineRow}>
                <PressableScale
                    onPress={authorIdentifier ? () => router.push(`/u/${authorIdentifier}`) : undefined}
                    disabled={!authorIdentifier}
                    style={styles.authorTarget}
                    accessibilityRole={authorIdentifier ? 'button' : undefined}
                    accessibilityLabel={authorIdentifier ? `Open ${authorName}'s profile` : undefined}
                >
                    {ownerProfile.avatar_url ? (
                        <Image
                            source={{ uri: ownerProfile.avatar_url }}
                            style={[styles.avatar, { borderColor: palette.imageOutline }]}
                            contentFit="cover"
                            transition={160}
                        />
                    ) : (
                        <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: palette.primaryMuted }]}>
                            <Text style={[styles.avatarInitial, { color: palette.primary }]}>
                                {authorName.trim().charAt(0).toUpperCase() || '?'}
                            </Text>
                        </View>
                    )}
                    <Text style={[styles.author, { color: palette.textSecondary }]} numberOfLines={1}>
                        by {authorName}
                    </Text>
                </PressableScale>

                <Text style={[styles.metadata, { color: palette.textMuted }]} numberOfLines={1}>
                    {metadata}
                </Text>
            </View>

            {list.description ? (
                <Text style={[styles.description, { color: palette.textSecondary }]} numberOfLines={2}>
                    {list.description}
                </Text>
            ) : null}

            {primaryAction || onShare ? (
                <View style={styles.actionsRow}>
                    {primaryAction ? (
                        <View style={styles.primaryWrap}>
                            <PressableScale
                                onPress={primaryAction.onPress}
                                disabled={isSavePending}
                                haptic="medium"
                                style={[
                                    styles.primaryButton,
                                    Shadow.subtle,
                                    {
                                        backgroundColor: primaryAction.saved
                                            ? palette.secondaryContainer
                                            : palette.primary,
                                    },
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
                        </View>
                    ) : null}

                    {onShare ? (
                        <PressableScale
                            onPress={onShare}
                            disabled={isSharePending}
                            haptic="light"
                            style={[styles.actionButton, { backgroundColor: palette.surfaceContainerHigh }]}
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

            {/* Two honest actions, not a segmented control: "map" navigates to the
                scoped map (back-bridge returns here); "edit"/"done" toggles inline
                entry editing in place. No permanently-active inert chip (TICKET-185). */}
            <View style={styles.controlsRow}>
                <PressableScale
                    onPress={onOpenMap}
                    haptic="selection"
                    style={[styles.actionChip, { backgroundColor: palette.surfaceContainerLow }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${list.title} on the map`}
                >
                    <Ionicons name="map-outline" size={18} color={palette.textMuted} />
                    <Text style={[styles.actionChipLabel, { color: palette.text }]}>map</Text>
                </PressableScale>

                {canEditEntries ? (
                    <PressableScale
                        onPress={onToggleEditingPlaces}
                        haptic="selection"
                        style={[
                            styles.actionChip,
                            {
                                backgroundColor: isEditingPlaces
                                    ? palette.secondaryContainer
                                    : palette.surfaceContainerLow,
                            },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={isEditingPlaces ? 'Finish editing places' : 'Edit places'}
                    >
                        <Ionicons
                            name={isEditingPlaces ? 'checkmark' : 'create-outline'}
                            size={18}
                            color={isEditingPlaces ? palette.text : palette.textMuted}
                        />
                        <Text style={[styles.actionChipLabel, { color: isEditingPlaces ? palette.text : palette.textMuted }]}>
                            {isEditingPlaces ? 'done' : 'edit'}
                        </Text>
                    </PressableScale>
                ) : null}
            </View>

            {list.table_id ? (
                <View style={styles.privateLine}>
                    <Ionicons name="people-outline" size={14} color={palette.textMuted} />
                    <Text style={[styles.privateText, { color: palette.textMuted }]}>Shared with everyone at this Table</Text>
                </View>
            ) : isOwner && list.privacy === 'private' ? (
                <View style={styles.privateLine}>
                    <Ionicons name="lock-closed-outline" size={13} color={palette.textMuted} />
                    <Text style={[styles.privateText, { color: palette.textMuted }]}>Only you can find this list</Text>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        paddingHorizontal: Spacing.md,
        paddingBottom: Spacing.sm,
    },
    topBar: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    topButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backIcon: { marginLeft: -2 },
    eyebrow: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: Spacing.md,
    },
    emojiTile: {
        width: 42,
        height: 42,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    emoji: { fontSize: 22 },
    title: {
        flex: 1,
        fontFamily: 'Newsreader_700Bold',
        fontSize: 30,
        lineHeight: 34,
        letterSpacing: -0.6,
    },
    bylineRow: {
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginTop: Spacing.sm,
    },
    authorTarget: {
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        flexShrink: 1,
    },
    avatar: {
        width: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
    },
    avatarFallback: {
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 0,
    },
    avatarInitial: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
    },
    author: {
        flexShrink: 1,
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    metadata: {
        flex: 1,
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        fontVariant: ['tabular-nums'],
    },
    description: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 21,
        marginTop: Spacing.xs,
    },
    actionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginTop: Spacing.md,
    },
    primaryWrap: { flex: 1 },
    primaryButton: {
        width: '100%',
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
    actionButton: {
        width: 48,
        height: 48,
        borderRadius: Radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
    },
    controlsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginTop: Spacing.md,
    },
    actionChip: {
        flex: 1,
        minHeight: 48,
        borderRadius: Radius.lg,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        paddingHorizontal: 12,
    },
    actionChipLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 14,
    },
    privateLine: {
        minHeight: 32,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: Spacing.xs,
        marginTop: Spacing.xs,
    },
    privateText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
    },
});
