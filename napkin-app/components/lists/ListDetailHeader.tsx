/**
 * ListDetailHeader — shown at the top of the list detail screen.
 *
 * Renders: title, optional description, author name/avatar row,
 * entry count + ranked/privacy badges, share button (owner + public),
 * edit button (owner only).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import type { ListDetail, OwnerProfile } from '@/hooks/lists/useList';

type Palette = typeof Colors.light;

interface Props {
    list: ListDetail;
    entryCount: number;
    ownerProfile: OwnerProfile;
    isOwner: boolean;
    onEdit: () => void;
}

export function ListDetailHeader({ list, entryCount, ownerProfile, isOwner, onEdit }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;
    const { show: showToast } = useToast();
    const router = useRouter();
    const { user } = useAuth();

    const handleShare = async () => {
        const url = `napkin://list/${list.id}`;
        try {
            await Clipboard.setStringAsync(url);
            showToast('Link copied to clipboard');
        } catch {
            Alert.alert('Could not copy', 'Please try again.');
        }
    };

    return (
        <View style={styles.container}>
            {/* Title */}
            <Text style={[Type.headlineLarge, { color: palette.text, fontFamily: 'Newsreader_400Regular_Italic' }]}>
                {list.title}
            </Text>

            {/* Description */}
            {list.description ? (
                <Text style={[Type.body, { color: palette.textSecondary, marginTop: Spacing.xs }]}>
                    {list.description}
                </Text>
            ) : null}

            {/* Author row — tappable when public or self (TICKET-020) */}
            {(() => {
                // When viewer is the owner, always route to /u/[currentUserId] (uuid)
                // When target is public, route to /u/[username]
                // Otherwise: plain text
                const authorIdentifier = isOwner
                    ? user?.id
                    : ownerProfile.account_privacy === 'public' && ownerProfile.username
                        ? ownerProfile.username
                        : null;
                const isTappable = !!authorIdentifier;

                const content = (
                    <View style={[styles.authorRow, { marginTop: Spacing.md }]}>
                        <View style={[styles.avatar, { backgroundColor: palette.surfaceContainerHigh }]}>
                            <Ionicons name="person" size={14} color={palette.textMuted} />
                        </View>
                        <Text style={[Type.bodySmall, { color: isTappable ? palette.primary : palette.textMuted }]}>
                            {ownerProfile.display_name ?? 'Unknown'}
                        </Text>
                    </View>
                );

                if (isTappable) {
                    return (
                        <Pressable
                            onPress={() => router.push(`/u/${authorIdentifier}`)}
                            hitSlop={8}
                        >
                            {content}
                        </Pressable>
                    );
                }
                return content;
            })()}

            {/* Badges row */}
            <View style={[styles.badgesRow, { marginTop: Spacing.sm }]}>
                <View style={[styles.badge, { backgroundColor: palette.surfaceContainerLow }]}>
                    <Text style={[Type.caption, { color: palette.textSecondary }]}>
                        {entryCount} {entryCount === 1 ? 'place' : 'places'}
                    </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: palette.surfaceContainerLow }]}>
                    <Text style={[Type.caption, { color: palette.textSecondary }]}>
                        {list.ranked ? 'Ranked' : 'Unranked'}
                    </Text>
                </View>
                {isOwner && list.privacy === 'private' && (
                    <View style={[styles.badge, { backgroundColor: palette.surfaceContainerLow }]}>
                        <Ionicons name="lock-closed" size={10} color={palette.textMuted} style={{ marginRight: 3 }} />
                        <Text style={[Type.caption, { color: palette.textMuted }]}>
                            Private
                        </Text>
                    </View>
                )}
            </View>

            {/* Action buttons */}
            {isOwner && (
                <View style={[styles.actionsRow, { marginTop: Spacing.md }]}>
                    {list.privacy === 'public' && (
                        <Pressable
                            onPress={handleShare}
                            style={({ pressed }) => [
                                styles.actionButton,
                                {
                                    backgroundColor: pressed
                                        ? palette.surfaceContainerHigh
                                        : palette.surfaceContainerLow,
                                },
                            ]}
                        >
                            <Ionicons name="share-outline" size={16} color={palette.primary} />
                            <Text style={[Type.titleSmall, { color: palette.primary, marginLeft: Spacing.xs }]}>
                                Share
                            </Text>
                        </Pressable>
                    )}
                    <Pressable
                        onPress={onEdit}
                        style={({ pressed }) => [
                            styles.actionButton,
                            {
                                backgroundColor: pressed
                                    ? palette.surfaceContainerHigh
                                    : palette.surfaceContainerLow,
                            },
                        ]}
                    >
                        <Ionicons name="pencil-outline" size={16} color={palette.textSecondary} />
                        <Text style={[Type.titleSmall, { color: palette.textSecondary, marginLeft: Spacing.xs }]}>
                            Edit
                        </Text>
                    </Pressable>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.md,
    },
    authorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
    },
    avatar: {
        width: 24,
        height: 24,
        borderRadius: Radius.full,
        justifyContent: 'center',
        alignItems: 'center',
    },
    badgesRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
        flexWrap: 'wrap',
    },
    badge: {
        borderRadius: Radius.sm,
        paddingHorizontal: 8,
        paddingVertical: 3,
        flexDirection: 'row',
        alignItems: 'center',
    },
    actionsRow: {
        flexDirection: 'row',
        gap: Spacing.sm,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.md,
    },
});
