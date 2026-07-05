/**
 * CoDinerFollowCard — TICKET-101 tier 1. One row in the zero-follow feed empty
 * state: a person the viewer has actually eaten with on Napkin.
 *
 *   [avatar]  Name                              [ follow ]
 *             N meals together
 *
 * One metadata line ("N meals together" — the emergence arc's native metric,
 * exact not bucketed). Follow is optimistic: the card owns a local `followed`
 * flag so the tap "does something" instantly; the parent drives the actual
 * mutation + rollback. Once followed, the button flips to a quiet "following"
 * state before the card is removed on mutation success.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Avatar } from './Avatar';
import type { CoDinerCandidate } from '@/hooks/feed/useCoDiners';

interface CoDinerFollowCardProps {
    candidate: CoDinerCandidate;
    followed: boolean;
    onFollow: () => void;
    onOpenProfile: () => void;
}

export function CoDinerFollowCard({
    candidate,
    followed,
    onFollow,
    onOpenProfile,
}: CoDinerFollowCardProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const meals = candidate.meals_together;
    const metaLine = `${meals} ${meals === 1 ? 'meal' : 'meals'} together`;

    return (
        <View style={styles.row}>
            <Avatar
                name={candidate.display_name}
                url={candidate.avatar_url}
                size={40}
                palette={palette}
                onPress={onOpenProfile}
            />
            <Pressable
                onPress={onOpenProfile}
                style={styles.rowText}
                accessibilityRole="button"
                accessibilityLabel={`Open ${candidate.display_name}'s profile`}
            >
                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                    {candidate.display_name}
                </Text>
                <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                    {metaLine}
                </Text>
            </Pressable>

            <Pressable
                onPress={followed ? undefined : onFollow}
                disabled={followed}
                hitSlop={6}
                style={({ pressed }) => [
                    styles.followBtn,
                    followed
                        ? { borderColor: palette.outlineVariant }
                        : { borderColor: 'rgba(160,63,40,0.35)', opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={followed ? `Following ${candidate.display_name}` : `Follow ${candidate.display_name}`}
            >
                <Text
                    style={[
                        styles.followText,
                        { color: followed ? palette.textMuted : palette.primary },
                    ]}
                >
                    {followed ? 'following' : 'follow'}
                </Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        paddingVertical: 10,
    },
    rowText: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 15,
    },
    meta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        marginTop: 1,
    },
    followBtn: {
        borderWidth: 1.5,
        borderRadius: Radius.full,
        paddingHorizontal: 16,
        paddingVertical: 7,
        flexShrink: 0,
    },
    followText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
});
