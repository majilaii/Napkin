/**
 * NotifRow — single notification row.
 *
 * Layout: [leading icon/avatar] [title (with italic proper nouns) · optional body · time] [trailing thumb/action]
 * Tone: 'fresh' rows get a 2px terracotta spine + 2.5% terracotta wash.
 * No "NEW" badges, no blue dots — keeps with the brand's quiet voice.
 */
import React, { type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { Colors, IconSize, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type NotifTone = 'fresh' | 'read';

interface Props {
    tone?: NotifTone;
    leading: ReactNode;
    title: ReactNode;
    /** Optional italic-serif body, used for quoted lines like a friend's note. */
    body?: string;
    time: string;
    trailing?: ReactNode;
    onPress?: () => void;
    actionLabel?: string;
}

export function NotifRow({
    tone = 'read',
    leading,
    title,
    body,
    time,
    trailing,
    onPress,
    actionLabel,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const fresh = tone === 'fresh';

    const Inner = (
        <View
            style={[
                styles.row,
                {
                    borderBottomColor: palette.dividerSoft,
                    backgroundColor: fresh ? palette.card : 'transparent',
                },
            ]}
        >
            {fresh ? (
                <View
                    style={[styles.spine, { backgroundColor: palette.primary }]}
                />
            ) : null}
            <View style={styles.leading}>{leading}</View>
            <View style={styles.content}>
                <Text
                    style={[styles.title, { color: palette.text }]}
                    numberOfLines={3}
                >
                    {title}
                </Text>
                {body ? (
                    <Text
                        style={[styles.body, { color: palette.textSecondary }]}
                        numberOfLines={2}
                    >
                        {body}
                    </Text>
                ) : null}
                <View style={styles.meta}>
                    <Text style={[styles.time, { color: palette.textMuted }]}>{time}</Text>
                    {actionLabel && onPress ? <View style={styles.action}>
                        <Text style={[Type.metadata, { color: palette.primary }]}>{actionLabel}</Text>
                        <Ionicons name="arrow-forward-outline" size={IconSize.sm} color={palette.primary} />
                    </View> : null}
                </View>
            </View>
            {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
        </View>
    );

    if (!onPress) return Inner;

    return (
        <Pressable
            accessibilityRole="button"
            onPress={onPress}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
            {Inner}
        </Pressable>
    );
}

/** Proper names use the current upright editorial voice. */
export function I({ children }: { children: ReactNode }) {
    return <Text style={inlineStyles.italic}>{children}</Text>;
}

const inlineStyles = StyleSheet.create({
    italic: {
        ...Type.editorialBody,
    },
});

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: Spacing.sm,
        marginHorizontal: Spacing.md,
        marginBottom: Spacing.sm,
        borderRadius: Radius.lg,
        padding: Spacing.md,
        position: 'relative',
    },
    spine: {
        position: 'absolute',
        left: 0,
        top: Spacing.md,
        bottom: Spacing.md,
        width: 2,
    },
    leading: {
        paddingTop: 2,
    },
    content: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        ...Type.body,
    },
    body: {
        marginTop: Spacing.xs,
        ...Type.quote,
    },
    time: {
        ...Type.metadata,
    },
    trailing: {
        alignSelf: 'center',
        marginLeft: Spacing.sm,
    },
    meta: { marginTop: Spacing.sm, gap: Spacing.xs },
    action: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
});
