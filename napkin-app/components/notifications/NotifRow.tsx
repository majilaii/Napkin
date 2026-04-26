/**
 * NotifRow — single notification row.
 *
 * Layout: [leading icon/avatar] [title (with italic proper nouns) · optional body · time] [trailing thumb/action]
 * Tone: 'fresh' rows get a 2px terracotta spine + 2.5% terracotta wash.
 * No "NEW" badges, no blue dots — keeps with the brand's quiet voice.
 */
import React, { type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
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
}

export function NotifRow({
    tone = 'read',
    leading,
    title,
    body,
    time,
    trailing,
    onPress,
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
                    backgroundColor: fresh ? palette.terracottaScrim : 'transparent',
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
                <Text style={[styles.time, { color: palette.textMuted }]}>
                    {time}
                </Text>
            </View>
            {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
        </View>
    );

    if (!onPress) return Inner;

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
            {Inner}
        </Pressable>
    );
}

/** Inline italic-serif span for proper nouns (restaurant, Table, friend, city). */
export function I({ children }: { children: ReactNode }) {
    return <Text style={inlineStyles.italic}>{children}</Text>;
}

const inlineStyles = StyleSheet.create({
    italic: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontWeight: '500',
    },
});

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: 12,
        paddingVertical: 14,
        paddingHorizontal: 22,
        position: 'relative',
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    spine: {
        position: 'absolute',
        left: 0,
        top: 12,
        bottom: 12,
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
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        lineHeight: 19,
    },
    body: {
        marginTop: 4,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
        lineHeight: 17,
        fontStyle: 'italic',
    },
    time: {
        marginTop: 6,
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        letterSpacing: 0.3,
    },
    trailing: {
        alignSelf: 'center',
        marginLeft: Spacing.sm,
    },
});
