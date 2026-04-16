/**
 * ReactorsSheet — bottom sheet showing users who reacted with a given emoji.
 * Displayed oldest-first. Implemented as a simple Modal for React Native
 * compatibility (no third-party bottom sheet library required).
 */
import React from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    StyleSheet,
    FlatList,
} from 'react-native';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Reaction } from '@/hooks/posts/usePostInteractions';

interface ReactorsSheetProps {
    emoji: string;
    reactors: Reaction[];
    onClose: () => void;
}

export function ReactorsSheet({ emoji, reactors, onClose }: ReactorsSheetProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <Modal
            visible
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <Pressable style={styles.backdrop} onPress={onClose} />

            <View
                style={[
                    styles.sheet,
                    { backgroundColor: palette.card },
                ]}
            >
                {/* Handle */}
                <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />

                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.headerEmoji}>{emoji}</Text>
                    <Text style={[Type.titleSmall, { color: palette.text }]}>
                        {reactors.length} {reactors.length === 1 ? 'reaction' : 'reactions'}
                    </Text>
                    <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
                        <Text style={[Type.body, { color: palette.textSecondary }]}>✕</Text>
                    </Pressable>
                </View>

                {/* Reactor list */}
                <FlatList
                    data={reactors}
                    keyExtractor={(r) => r.id}
                    contentContainerStyle={styles.list}
                    renderItem={({ item }) => {
                        const name = item.profiles?.display_name ?? 'Unknown';
                        const initials = name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase();

                        return (
                            <View style={styles.reactorRow}>
                                <View
                                    style={[
                                        styles.avatar,
                                        { backgroundColor: palette.secondaryContainer },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.avatarInitials,
                                            { color: palette.text },
                                        ]}
                                    >
                                        {initials}
                                    </Text>
                                </View>
                                <Text style={[Type.body, { color: palette.text, flex: 1 }]}>
                                    {name}
                                </Text>
                            </View>
                        );
                    }}
                    showsVerticalScrollIndicator={false}
                />
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
    },
    sheet: {
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        paddingBottom: 32,
        maxHeight: '60%',
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        alignSelf: 'center',
        marginTop: Spacing.sm,
        marginBottom: Spacing.sm,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.md,
        gap: Spacing.sm,
    },
    headerEmoji: {
        fontSize: 22,
        lineHeight: 28,
    },
    closeBtn: {
        marginLeft: 'auto',
    },
    list: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.lg,
        gap: Spacing.md,
    },
    reactorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
    },
    avatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarInitials: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
});
