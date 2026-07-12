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
    isSavePending?: boolean;
    isSharePending?: boolean;
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
    isSavePending,
    isSharePending,
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
                icon: isSaved ? 'checkmark' as const : 'add' as const,
                onPress: onToggleSaved,
                saved: isSaved,
            }
            : null;

    return (
        <View style={[styles.sheet, { backgroundColor: palette.background }]}>
            <View style={[styles.grabber, { backgroundColor: palette.dividerSoft }]} />

            <View style={styles.titleRow}>
                {list.emoji ? (
                    <View style={[styles.emojiTile, { backgroundColor: palette.secondaryContainer }]}>
                        <Text style={styles.emoji}>{list.emoji}</Text>
                    </View>
                ) : null}
                <Text style={[styles.title, { color: palette.text }]}>{list.title}</Text>
            </View>

            <PressableScale
                onPress={authorIdentifier ? () => router.push(`/u/${authorIdentifier}`) : undefined}
                disabled={!authorIdentifier}
                style={styles.authorRow}
                accessibilityRole={authorIdentifier ? 'button' : undefined}
                accessibilityLabel={authorIdentifier ? `Open ${authorName}'s profile` : undefined}
            >
                {ownerProfile.avatar_url ? (
                    <Image
                        source={{ uri: ownerProfile.avatar_url }}
                        style={[
                            styles.avatar,
                            {
                                borderColor: scheme === 'dark'
                                    ? 'rgba(255, 255, 255, 0.1)'
                                    : 'rgba(0, 0, 0, 0.1)',
                            },
                        ]}
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
                <Text style={[styles.author, { color: authorIdentifier ? palette.textSecondary : palette.textMuted }]} numberOfLines={1}>
                    by {authorName}
                </Text>
                {authorIdentifier ? <Ionicons name="chevron-forward" size={13} color={palette.textMuted} /> : null}
            </PressableScale>

            {list.description ? (
                <Text style={[styles.description, { color: palette.textSecondary }]}>{list.description}</Text>
            ) : null}

            <View style={styles.statsRow}>
                <View style={styles.stat}>
                    <Text style={[styles.statNumber, { color: palette.text }]}>{entryCount}</Text>
                    <Text style={[styles.statLabel, { color: palette.textMuted }]}>
                        {entryCount === 1 ? 'Place' : 'Places'}
                    </Text>
                </View>
                <View style={[styles.statRule, { backgroundColor: palette.dividerSoft }]} />
                <View style={styles.stat}>
                    <Text style={[styles.statNumber, { color: palette.text }]}>{saveCount}</Text>
                    <Text style={[styles.statLabel, { color: palette.textMuted }]}>Saves</Text>
                </View>
            </View>

            {primaryAction || onShare || isOwner ? (
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
                                        size={21}
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
                            style={[styles.squareButton, { backgroundColor: palette.surfaceContainerHigh }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Share ${list.title}`}
                        >
                            {isSharePending ? (
                                <ActivityIndicator size="small" color={palette.text} />
                            ) : (
                                <Ionicons name="share-outline" size={22} color={palette.text} />
                            )}
                        </PressableScale>
                    ) : null}

                    {isOwner ? (
                        <PressableScale
                            onPress={onEdit}
                            haptic="selection"
                            style={[styles.squareButton, { backgroundColor: palette.surfaceContainerHigh }]}
                            accessibilityRole="button"
                            accessibilityLabel="Edit list"
                        >
                            <Ionicons name="ellipsis-horizontal" size={22} color={palette.text} />
                        </PressableScale>
                    ) : null}
                </View>
            ) : null}

            {isOwner && list.privacy === 'private' ? (
                <View style={styles.privateLine}>
                    <Ionicons name="lock-closed-outline" size={13} color={palette.textMuted} />
                    <Text style={[styles.privateText, { color: palette.textMuted }]}>Only you can find this list</Text>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    sheet: {
        marginTop: -28,
        borderTopLeftRadius: Radius.xxxl,
        borderTopRightRadius: Radius.xxxl,
        paddingTop: 10,
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.lg,
    },
    grabber: {
        width: 48,
        height: 5,
        borderRadius: Radius.full,
        alignSelf: 'center',
        marginBottom: Spacing.md,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    emojiTile: {
        width: 40,
        height: 40,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    emoji: { fontSize: 21 },
    title: {
        flex: 1,
        fontFamily: 'Newsreader_700Bold',
        fontSize: 32,
        lineHeight: 36,
        letterSpacing: -0.7,
    },
    authorRow: {
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 8,
        marginTop: Spacing.sm,
    },
    avatar: {
        width: 30,
        height: 30,
        borderRadius: 15,
        borderWidth: StyleSheet.hairlineWidth,
    },
    avatarFallback: {
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 0,
    },
    avatarInitial: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
    },
    author: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    description: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 23,
        marginTop: Spacing.sm,
    },
    statsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: Spacing.lg,
        paddingHorizontal: Spacing.md,
    },
    stat: { flex: 1, alignItems: 'center' },
    statRule: { width: StyleSheet.hairlineWidth, height: 42 },
    statNumber: {
        fontFamily: 'Newsreader_700Bold',
        fontSize: 25,
        fontVariant: ['tabular-nums'],
    },
    statLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        marginTop: 1,
    },
    actionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginTop: Spacing.lg,
    },
    primaryButton: {
        width: '100%',
        minHeight: 56,
        borderRadius: Radius.lg,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingHorizontal: Spacing.md,
    },
    primaryWrap: {
        flex: 1,
    },
    primaryLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 15,
    },
    squareButton: {
        width: 56,
        height: 56,
        borderRadius: Radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
    },
    privateLine: {
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        marginTop: Spacing.xs,
    },
    privateText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
    },
});
